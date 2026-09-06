import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, getRequestMeta, verifyCsrf } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import {
  evaluateAttendanceAttempt,
  recordIntegrityEvent,
  touchDevice,
  type ClientSignals,
} from "@/lib/integrity";
import { verifyBiometric } from "@/lib/biometrics";
import {
  getTodayContext,
  classifyArrival,
  classifyDeparture,
} from "@/lib/attendance";
import { writeAudit } from "@/lib/audit";
import { fail, ok } from "@/lib/utils";

export const dynamic = "force-dynamic";

const signalsSchema = z.object({
  nonce: z.string().min(10).max(200),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().nonnegative(),
  altitude: z.number().nullable().optional(),
  altitudeAccuracy: z.number().nullable().optional(),
  heading: z.number().nullable().optional(),
  speed: z.number().nullable().optional(),
  positionTimestamp: z.number(),
  capturedAt: z.number(),
  timezone: z.string().max(80),
  timezoneOffset: z.number(),
  permissionState: z.string().max(30).nullable().optional(),
  geolocationNative: z.boolean(),
  permissionsApiNative: z.boolean(),
  dateNowNative: z.boolean(),
  webdriver: z.boolean(),
  suspiciousExtensions: z.array(z.string().max(60)).max(20).optional(),
  webrtcIps: z.array(z.string().max(60)).max(20),
  deviceFingerprint: z.string().min(8).max(128),
  platform: z.string().max(80).nullable().optional(),
  hardwareConcurrency: z.number().nullable().optional(),
  deviceMemory: z.number().nullable().optional(),
  screen: z.string().max(40).nullable().optional(),
  languages: z.array(z.string().max(20)).max(20).optional(),
});

const schema = z.object({
  action: z.enum(["CHECK_IN", "CHECK_OUT"]),
  method: z.enum(["GPS", "FINGERPRINT", "FACE"]),
  signals: signalsSchema,
});

export async function POST(request: Request) {
  if (!(await verifyCsrf(request))) {
    return fail("Invalid request token. Reload the page and try again.", 403);
  }

  const user = await getCurrentUser();
  if (!user) return fail("Authentication required.", 401);

  const limit = rateLimit(`punch:${user.id}`, LIMITS.punch.limit, LIMITS.punch.windowMs);
  if (!limit.allowed) {
    return fail(
      `Too many attempts. Wait ${limit.retryAfterSeconds} seconds.`,
      429,
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("The attendance payload was incomplete or malformed.", 400);
  }

  const { action, method, signals } = parsed.data;
  const meta = await getRequestMeta();
  const settings = await getSettings();

  /* --- 1. Is this punch even applicable right now? ---------------- */
  const context = await getTodayContext(user.id);

  if (action === "CHECK_IN" && !context.canCheckIn) {
    return fail("You have already checked in today.", 409);
  }
  if (action === "CHECK_OUT" && !context.canCheckOut) {
    return fail(
      context.attendance?.checkOutAt
        ? "You have already checked out today."
        : "You must check in before you can check out.",
      409,
    );
  }

  /* --- 2. Method allowed by policy? ------------------------------- */
  if (method === "GPS" && (settings.requireBiometric || !settings.allowGpsOnly)) {
    return fail(
      "Location-only attendance is disabled. Verify with fingerprint or face.",
      403,
    );
  }
  if (method === "FACE" && !settings.allowFace) {
    return fail("Face verification is disabled by policy.", 403);
  }
  if (method === "FINGERPRINT" && !settings.allowFingerprint) {
    return fail("Fingerprint verification is disabled by policy.", 403);
  }

  /* --- 3. Risk engine (nonce, geofence, VPN, device, tampering) ---- */
  const office = await (async () => {
    const u = await prisma.user.findUnique({
      where: { id: user.id },
      include: { office: true },
    });
    return u?.office ?? null;
  })();

  const evaluation = await evaluateAttendanceAttempt({
    userId: user.id,
    action,
    signals: signals as ClientSignals,
    ip: meta.ip,
    userAgent: meta.userAgent,
    office,
  });

  if (evaluation.decision === "BLOCKED") {
    await recordIntegrityEvent({
      userId: user.id,
      action,
      result: evaluation,
      signals,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return Response.json(
      {
        ok: false,
        error: evaluation.blockingMessage ?? "Attendance was blocked by policy.",
        decision: "BLOCKED",
        riskScore: evaluation.riskScore,
        reasons: evaluation.reasons.map((r) => ({ code: r.code, label: r.label })),
        distanceMeters: evaluation.distanceMeters,
      },
      { status: 422 },
    );
  }

  /* --- 4. Biometric step ------------------------------------------ */
  let biometric = null;
  if (method !== "GPS") {
    biometric = await verifyBiometric({
      userId: user.id,
      kind: method === "FACE" ? "FACE" : "FINGERPRINT",
    });

    if (!biometric.matched) {
      await recordIntegrityEvent({
        userId: user.id,
        action,
        result: { ...evaluation, decision: "BLOCKED" },
        signals,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return Response.json(
        {
          ok: false,
          error: biometric.message,
          decision: "BLOCKED",
          biometricFailed: true,
          simulated: biometric.simulated,
        },
        { status: 422 },
      );
    }
  }

  /* --- 5. Commit --------------------------------------------------- */
  const now = new Date();
  const flagged = evaluation.decision === "FLAGGED";
  const simulated = biometric?.simulated ?? false;

  let record;

  if (action === "CHECK_IN") {
    const { status, lateMinutes } = classifyArrival(
      now,
      context.shift,
      context.timezone,
    );

    record = await prisma.attendance.upsert({
      where: { userId_date: { userId: user.id, date: context.dateOnly } },
      update: {
        checkInAt: now,
        status,
        lateMinutes,
        officeId: office?.id ?? null,
        source: "WEB",
        checkInMethod: method,
        checkInFaceScore: method === "FACE" ? biometric?.score ?? null : null,
        checkInLiveness: method === "FACE" ? biometric?.liveness ?? null : null,
        checkInRealScore: method === "FACE" ? biometric?.realScore ?? null : null,
        checkInCredentialId:
          method === "FINGERPRINT" ? biometric?.credentialId ?? null : null,
        checkInSimulated: simulated,
        checkInLat: signals.latitude,
        checkInLng: signals.longitude,
        checkInAccuracy: signals.accuracy,
        checkInDistance: evaluation.distanceMeters,
        checkInIp: meta.ip,
        riskScore: evaluation.riskScore,
        flagged,
        flagReasons: evaluation.reasonCodes,
      },
      create: {
        userId: user.id,
        date: context.dateOnly,
        checkInAt: now,
        status,
        lateMinutes,
        officeId: office?.id ?? null,
        source: "WEB",
        checkInMethod: method,
        checkInFaceScore: method === "FACE" ? biometric?.score ?? null : null,
        checkInLiveness: method === "FACE" ? biometric?.liveness ?? null : null,
        checkInRealScore: method === "FACE" ? biometric?.realScore ?? null : null,
        checkInCredentialId:
          method === "FINGERPRINT" ? biometric?.credentialId ?? null : null,
        checkInSimulated: simulated,
        checkInLat: signals.latitude,
        checkInLng: signals.longitude,
        checkInAccuracy: signals.accuracy,
        checkInDistance: evaluation.distanceMeters,
        checkInIp: meta.ip,
        riskScore: evaluation.riskScore,
        flagged,
        flagReasons: evaluation.reasonCodes,
      },
    });
  } else {
    const existing = context.attendance!;
    const { workedMinutes, earlyLeaveMinutes, overtimeMinutes } =
      classifyDeparture(existing.checkInAt!, now, context.shift, context.timezone);

    record = await prisma.attendance.update({
      where: { id: existing.id },
      data: {
        checkOutAt: now,
        workedMinutes,
        earlyLeaveMinutes,
        overtimeMinutes,
        checkOutMethod: method,
        checkOutFaceScore: method === "FACE" ? biometric?.score ?? null : null,
        checkOutLiveness: method === "FACE" ? biometric?.liveness ?? null : null,
        checkOutRealScore: method === "FACE" ? biometric?.realScore ?? null : null,
        checkOutCredentialId:
          method === "FINGERPRINT" ? biometric?.credentialId ?? null : null,
        checkOutSimulated: simulated,
        checkOutLat: signals.latitude,
        checkOutLng: signals.longitude,
        checkOutAccuracy: signals.accuracy,
        checkOutDistance: evaluation.distanceMeters,
        checkOutIp: meta.ip,
        riskScore: Math.max(existing.riskScore, evaluation.riskScore),
        flagged: existing.flagged || flagged,
        flagReasons: [
          ...new Set([...existing.flagReasons, ...evaluation.reasonCodes]),
        ],
      },
    });
  }

  await Promise.all([
    recordIntegrityEvent({
      userId: user.id,
      action,
      result: evaluation,
      signals,
      ip: meta.ip,
      userAgent: meta.userAgent,
    }),
    touchDevice(user.id, signals.deviceFingerprint, meta.userAgent),
    writeAudit({
      actorId: user.id,
      action,
      entity: "Attendance",
      entityId: record.id,
      after: { method, simulated, riskScore: evaluation.riskScore },
      ip: meta.ip,
      userAgent: meta.userAgent,
    }),
  ]);

  return ok({
    id: record.id,
    action,
    method,
    simulated,
    status: record.status,
    checkInAt: record.checkInAt,
    checkOutAt: record.checkOutAt,
    workedMinutes: record.workedMinutes,
    lateMinutes: record.lateMinutes,
    distanceMeters: evaluation.distanceMeters,
    accuracy: signals.accuracy,
    office: office?.name ?? null,
    riskScore: evaluation.riskScore,
    flagged: record.flagged,
    warnings: evaluation.reasons
      .filter((r) => !r.fatal)
      .map((r) => ({ code: r.code, label: r.label })),
  });
}
