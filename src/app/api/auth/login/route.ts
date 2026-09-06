import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, fakeVerify } from "@/lib/password";
import { createSession, getRequestMeta } from "@/lib/session";
import { rateLimit, LIMITS, resetRateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { fail, ok } from "@/lib/utils";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  totp: z.string().trim().max(10).optional(),
  deviceFingerprint: z.string().max(128).optional(),
});

/** Deliberately identical for every failure mode — no user enumeration. */
const GENERIC = "Incorrect email or password.";

async function logAttempt(
  email: string,
  ip: string | null,
  userAgent: string | null,
  success: boolean,
  reason: string,
) {
  await prisma.loginAttempt
    .create({ data: { email, ip, userAgent, success, reason } })
    .catch(() => undefined);
}

export async function POST(request: Request) {
  const meta = await getRequestMeta();
  const settings = await getSettings();

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("Enter a valid email address and password.", 400);

  const { email, password, totp, deviceFingerprint } = parsed.data;

  /* --- rate limiting: per account and per source address ---------- */
  const perEmail = rateLimit(`login:email:${email}`, LIMITS.login.limit, LIMITS.login.windowMs);
  if (!perEmail.allowed) {
    await logAttempt(email, meta.ip, meta.userAgent, false, "RATE_LIMITED");
    return fail(
      `Too many attempts. Try again in ${perEmail.retryAfterSeconds} seconds.`,
      429,
      { retryAfter: perEmail.retryAfterSeconds },
    );
  }

  const perIp = rateLimit(
    `login:ip:${meta.ip ?? "unknown"}`,
    LIMITS.loginPerIp.limit,
    LIMITS.loginPerIp.windowMs,
  );
  if (!perIp.allowed) {
    await logAttempt(email, meta.ip, meta.userAgent, false, "RATE_LIMITED_IP");
    return fail("Too many attempts from this network. Try again shortly.", 429);
  }

  const user = await prisma.user.findUnique({ where: { email } });

  /* --- unknown account: burn equivalent CPU, then fail generically -- */
  if (!user) {
    await fakeVerify(password);
    await logAttempt(email, meta.ip, meta.userAgent, false, "NO_SUCH_USER");
    return fail(GENERIC, 401);
  }

  /* --- lockout ---------------------------------------------------- */
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    await logAttempt(email, meta.ip, meta.userAgent, false, "LOCKED");
    return fail(`Account locked. Try again in ${mins} minute(s).`, 423);
  }

  if (user.status !== "ACTIVE") {
    await logAttempt(email, meta.ip, meta.userAgent, false, "INACTIVE");
    return fail("This account is not active. Contact your administrator.", 403);
  }

  /* --- password --------------------------------------------------- */
  const valid = await verifyPassword(user.passwordHash, password);

  if (!valid) {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= settings.maxFailedLogins;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failures,
        lockedUntil: lock
          ? new Date(Date.now() + settings.lockoutMinutes * 60_000)
          : null,
      },
    });

    await logAttempt(email, meta.ip, meta.userAgent, false, "BAD_PASSWORD");

    if (lock) {
      return fail(
        `Too many failed attempts. Account locked for ${settings.lockoutMinutes} minutes.`,
        423,
      );
    }
    return fail(GENERIC, 401);
  }

  /* --- second factor ---------------------------------------------- */
  if (user.twoFactorEnabled && user.twoFactorSecret) {
    if (!totp) {
      return Response.json(
        { ok: false, error: "Enter your authenticator code.", requires2fa: true },
        { status: 401 },
      );
    }

    const { TOTP, Secret } = await import("otpauth");
    const verifier = new TOTP({
      issuer: settings.organisationShort,
      label: user.email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(user.twoFactorSecret),
    });

    // window: 1 tolerates one step of clock drift either way.
    if (verifier.validate({ token: totp, window: 1 }) === null) {
      await logAttempt(email, meta.ip, meta.userAgent, false, "BAD_TOTP");
      return Response.json(
        { ok: false, error: "Incorrect authenticator code.", requires2fa: true },
        { status: 401 },
      );
    }
  }

  /* --- success ----------------------------------------------------- */
  resetRateLimit(`login:email:${email}`);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: meta.ip,
    },
  });

  await createSession({
    userId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    deviceFingerprint: deviceFingerprint ?? null,
    ttlHours: settings.sessionTtlHours,
  });

  await logAttempt(email, meta.ip, meta.userAgent, true, "OK");
  await writeAudit({
    actorId: user.id,
    action: "LOGIN",
    entity: "User",
    entityId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  const isAdmin = ["ADMIN", "SUPER_ADMIN", "HR"].includes(user.role);

  return ok({
    redirect: user.mustChangePassword
      ? "/profile?change=1"
      : isAdmin
        ? "/admin"
        : "/dashboard",
    name: user.name,
    role: user.role,
  });
}
