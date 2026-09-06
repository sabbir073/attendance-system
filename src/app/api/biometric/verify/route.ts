import { z } from "zod";
import { getCurrentUser, getRequestMeta, verifyCsrf } from "@/lib/session";
import { verifyBiometric } from "@/lib/biometrics";
import { recordIntegrityEvent } from "@/lib/integrity";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { fail, ok } from "@/lib/utils";

export const dynamic = "force-dynamic";

const schema = z.object({ kind: z.enum(["FACE", "FINGERPRINT"]) });

/**
 * Standalone biometric test, used by the "Test verification" button on the
 * profile page. The punch endpoint does its own verification — it never
 * trusts a result produced here, because a client could simply claim success.
 */
export async function POST(request: Request) {
  if (!(await verifyCsrf(request))) {
    return fail("Invalid request token. Reload the page and try again.", 403);
  }

  const user = await getCurrentUser();
  if (!user) return fail("Authentication required.", 401);

  const limit = rateLimit(`biometric:${user.id}`, LIMITS.punch.limit, LIMITS.punch.windowMs);
  if (!limit.allowed) return fail("Too many attempts. Wait a moment.", 429);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Invalid request.", 400);

  const meta = await getRequestMeta();
  const result = await verifyBiometric({ userId: user.id, kind: parsed.data.kind });

  await recordIntegrityEvent({
    userId: user.id,
    action: "BIOMETRIC_VERIFY",
    result: {
      decision: result.matched ? "ALLOWED" : "BLOCKED",
      riskScore: result.matched ? 0 : 50,
      reasons: result.reasons.map((code) => ({ code, label: code, weight: 0 })),
    },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return ok({
    matched: result.matched,
    score: Number(result.score.toFixed(4)),
    liveness: result.liveness,
    simulated: result.simulated,
    message: result.message,
  });
}
