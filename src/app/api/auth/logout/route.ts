import { destroySession, getCurrentUser, getRequestMeta, verifyCsrf } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { fail, ok } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await verifyCsrf(request))) {
    return fail("Invalid request token. Reload the page and try again.", 403);
  }

  const user = await getCurrentUser();
  const meta = await getRequestMeta();

  await destroySession("logout");

  if (user) {
    await writeAudit({
      actorId: user.id,
      action: "LOGOUT",
      entity: "User",
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  return ok({ redirect: "/login" });
}
