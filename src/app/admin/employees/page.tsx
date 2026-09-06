import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui";
import { formatDate, formatDateTime, initials } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employees" };

const ROLE_STYLES: Record<string, string> = {
  SUPER_ADMIN: "bg-navy-100 text-navy-800",
  ADMIN: "bg-navy-100 text-navy-800",
  HR: "bg-violet-100 text-violet-800",
  MANAGER: "bg-sky-100 text-sky-800",
  EMPLOYEE: "bg-slate-100 text-slate-700",
};

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const users = await prisma.user.findMany({
    where: params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" } },
            { email: { contains: params.q, mode: "insensitive" } },
            { employeeCode: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : undefined,
    include: {
      department: { select: { name: true } },
      office: { select: { name: true } },
      _count: { select: { devices: true, faceTemplates: true, credentials: true } },
    },
    orderBy: { employeeCode: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Employees</h1>
          <p className="muted mt-1">{users.length} records</p>
        </div>
        <form action="/admin/employees" className="flex gap-2">
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Search name, email or code"
            className="input w-64"
          />
          <button className="btn-navy">Search</button>
        </form>
      </div>

      {users.length === 0 ? (
        <EmptyState title="No employees found" />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Department</th>
                <th>Office</th>
                <th>Biometrics</th>
                <th>Devices</th>
                <th>Status</th>
                <th>Last login</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                        {initials(u.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">
                          {u.name}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {u.employeeCode} · {u.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${ROLE_STYLES[u.role] ?? ""}`}>
                      {u.role.replace("_", " ")}
                    </span>
                  </td>
                  <td>{u.department?.name ?? "—"}</td>
                  <td>{u.office?.name ?? "—"}</td>
                  <td>
                    <div className="flex gap-1">
                      <span
                        className={
                          u._count.faceTemplates
                            ? "badge bg-emerald-100 text-emerald-800"
                            : "badge bg-slate-100 text-slate-500"
                        }
                      >
                        Face
                      </span>
                      <span
                        className={
                          u._count.credentials
                            ? "badge bg-emerald-100 text-emerald-800"
                            : "badge bg-slate-100 text-slate-500"
                        }
                      >
                        Print
                      </span>
                    </div>
                  </td>
                  <td className="tabular-nums">{u._count.devices}</td>
                  <td>
                    <span
                      className={
                        u.status === "ACTIVE"
                          ? "badge bg-emerald-100 text-emerald-800"
                          : "badge bg-red-100 text-red-700"
                      }
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-500">
                    {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
