import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  getRequestMeta,
  verifyCsrf,
  revokeAllSessions,
  createSession,
} from "@/lib/session";
import { verifyPassword, hashPassword, checkPasswordStrength } from "@/lib/password";
import { getSettings } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { fail, ok } from "@/lib/utils";

export const dynamic = "force-dynamic";

const schema = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  if (!(await verifyCsrf(request))) {
    return fail("Invalid request token. Reload the page and try again.", 403);
  }

  const user = await getCurrentUser();
  if (!user) return fail("Authentication required.", 401);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Invalid request.", 400);

  const settings = await getSettings();
  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

  if (!(await verifyPassword(record.passwordHash, parsed.data.current))) {
    return fail("Your current password is incorrect.", 401);
  }

  if (parsed.data.current === parsed.data.next) {
    return fail("The new password must be different from the current one.", 400);
  }

  const strength = checkPasswordStrength(
    parsed.data.next,
    settings.passwordMinLength,
  );
  if (!strength.ok) return fail(strength.errors.join(" "), 400);

  const meta = await getRequestMeta();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.next),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
    },
  });

  // A password change invalidates every existing session, then issues a fresh
  // one for this browser — so a stolen session elsewhere dies immediately.
  await revokeAllSessions(user.id, "password-changed");
  await createSession({
    userId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    ttlHours: settings.sessionTtlHours,
  });

  await writeAudit({
    actorId: user.id,
    action: "PASSWORD_CHANGED",
    entity: "User",
    entityId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return ok({ changed: true });
}
