import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell, ICONS, type NavItem } from "@/components/AppShell";

export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: ICONS.home },
  { href: "/attendance", label: "Mark attendance", icon: ICONS.clock },
  { href: "/history", label: "My history", icon: ICONS.calendar },
  { href: "/profile", label: "Profile & security", icon: ICONS.user },
];

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell
      nav={NAV}
      variant="portal"
      user={{
        name: user.name,
        role: user.role,
        designation: user.designation,
      }}
    >
      {children}
    </AppShell>
  );
}
