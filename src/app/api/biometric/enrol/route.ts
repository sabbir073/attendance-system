import { z } from "zod";
import { getCurrentUser, getRequestMeta, verifyCsrf } from "@/lib/session";
import { enrolBiometric, getBiometricStatus } from "@/lib/biometrics";
import { writeAudit } from "@/lib/audit";
import { fail, ok } from "@/lib/utils";

export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.enum(["FACE", "FINGERPRINT"]),
  label: z.string().trim().max(60).optional(),
  deviceFingerprint: z.string().max(128).optional(),
});

/** Current enrolment state, used to render the profile page. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("Authentication required.", 401);
  return ok(await getBiometricStatus(user.id));
}

export async function POST(request: Request) {
  if (!(await verifyCsrf(request))) {
    return fail("Invalid request token. Reload the page and try again.", 403);
  }

  const user = await getCurrentUser();
  if (!user) return fail("Authentication required.", 401);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Invalid enrolment request.", 400);

  const meta = await getRequestMeta();

  const result = await enrolBiometric({
    userId: user.id,
    kind: parsed.data.kind,
    label: parsed.data.label,
    deviceFingerprint: parsed.data.deviceFingerprint,
    userAgent: meta.userAgent,
  });

  if (!result.ok) return fail(result.message, 400);

  await writeAudit({
    actorId: user.id,
    action: "BIOMETRIC_ENROL",
    entity: parsed.data.kind === "FACE" ? "FaceTemplate" : "WebAuthnCredential",
    entityId: result.id,
    after: { simulated: result.simulated, quality: result.quality },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return ok(result);
}
