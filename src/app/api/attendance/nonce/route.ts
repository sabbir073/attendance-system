import { z } from "zod";
import { getCurrentUser, verifyCsrf } from "@/lib/session";
import { issueNonce } from "@/lib/integrity";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { fail, ok } from "@/lib/utils";

export const dynamic = "force-dynamic";

const schema = z.object({
  purpose: z.enum(["CHECK_IN", "CHECK_OUT"]),
});

/**
 * Issues the single-use challenge that must accompany a punch. Without a
 * fresh nonce, a previously captured (and perfectly valid-looking) GPS
 * payload can simply be replayed.
 */
export async function POST(request: Request) {
  if (!(await verifyCsrf(request))) {
    return fail("Invalid request token. Reload the page and try again.", 403);
  }

  const user = await getCurrentUser();
  if (!user) return fail("Authentication required.", 401);

  const limit = rateLimit(`nonce:${user.id}`, LIMITS.nonce.limit, LIMITS.nonce.windowMs);
  if (!limit.allowed) {
    return fail("Too many requests. Wait a moment and try again.", 429);
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Invalid request.", 400);

  const { token, expiresAt } = await issueNonce(user.id, parsed.data.purpose);

  return ok({
    nonce: token,
    expiresAt: expiresAt.toISOString(),
    serverTime: Date.now(),
  });
}
