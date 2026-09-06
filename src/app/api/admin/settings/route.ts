import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, getRequestMeta, verifyCsrf, AuthError } from "@/lib/session";
import { getSettings, invalidateSettings } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { fail, ok } from "@/lib/utils";

export const dynamic = "force-dynamic";

const schema = z.object({
  vpnPolicy: z.enum(["OFF", "WARN", "STRICT"]),
  geofenceEnabled: z.boolean(),
  geofenceBlocks: z.boolean(),
  enforceCountryLock: z.boolean(),
  allowUnknownIp: z.boolean(),
  blockMockLocation: z.boolean(),
  requireDeviceBinding: z.boolean(),
  maxDevicesPerUser: z.number().int().min(1).max(10),
  maxGpsAccuracy: z.number().int().min(10).max(1000),
  impossibleTravelKmh: z.number().int().min(50).max(2000),
  riskBlockThreshold: z.number().int().min(10).max(100),
  riskFlagThreshold: z.number().int().min(5).max(100),
  biometricSimulationMode: z.boolean(),
  simulatedFailureRate: z.number().int().min(0).max(100),
  requireBiometric: z.boolean(),
  allowGpsOnly: z.boolean(),
  allowFace: z.boolean(),
  allowFingerprint: z.boolean(),
  sessionTtlHours: z.number().int().min(1).max(168),
  maxFailedLogins: z.number().int().min(3).max(20),
  lockoutMinutes: z.number().int().min(1).max(1440),
});

export async function PUT(request: Request) {
  try {
    if (!(await verifyCsrf(request))) {
      return fail("Invalid request token. Reload the page and try again.", 403);
    }

    const admin = await requireAdmin();

    const limit = rateLimit(
      `settings:${admin.id}`,
      LIMITS.adminWrite.limit,
      LIMITS.adminWrite.windowMs,
    );
    if (!limit.allowed) return fail("Too many changes. Slow down.", 429);

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail(
        parsed.error.issues[0]?.message ?? "One or more values are out of range.",
        400,
      );
    }

    const data = parsed.data;

    if (data.riskFlagThreshold >= data.riskBlockThreshold) {
      return fail("The flag threshold must be lower than the block threshold.", 400);
    }
    if (!data.allowGpsOnly && !data.allowFace && !data.allowFingerprint) {
      return fail("At least one verification method must remain enabled.", 400);
    }

    const before = await getSettings();

    const after = await prisma.setting.update({
      where: { id: "global" },
      data,
    });

    invalidateSettings();

    const meta = await getRequestMeta();
    await writeAudit({
      actorId: admin.id,
      action: "SETTINGS_UPDATE",
      entity: "Setting",
      entityId: "global",
      before,
      after,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return ok({ saved: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return fail(
        err.code === "FORBIDDEN"
          ? "You do not have permission to change settings."
          : "Authentication required.",
        err.code === "FORBIDDEN" ? 403 : 401,
      );
    }
    return fail("Settings could not be saved.", 500);
  }
}
