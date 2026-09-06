import { redirect } from "next/navigation";
import { getCurrentUser, isAdminRole } from "@/lib/session";
import { AppShell, ICONS, type NavItem } from "@/components/AppShell";

export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: ICONS.home },
  { href: "/admin/attendance", label: "Attendance", icon: ICONS.clock },
  { href: "/admin/employees", label: "Employees", icon: ICONS.users },
  { href: "/admin/offices", label: "Offices & geofences", icon: ICONS.pin },
  { href: "/admin/security", label: "Security centre", icon: ICONS.shield },
  { href: "/admin/settings", label: "Settings", icon: ICONS.cog },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role)) redirect("/dashboard");

  return (
    <AppShell
      nav={NAV}
      variant="admin"
      user={{ name: user.name, role: user.role, designation: user.designation }}
    >
      {children}
    </AppShell>
  );
}
