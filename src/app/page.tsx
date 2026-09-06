import { redirect } from "next/navigation";
import { getCurrentUser, isAdminRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(isAdminRole(user.role) ? "/admin" : "/dashboard");
}
