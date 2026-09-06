import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { StatusPill, SimulatedBadge, RiskPill, EmptyState } from "@/components/ui";
import { formatTime, formatDate } from "@/lib/utils";
import { formatMinutesAsHours } from "@/lib/geo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attendance records" };

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; flagged?: string }>;
}) {
  await requireAdmin();
  const settings = await getSettings();
  const params = await searchParams;

  const rows = await prisma.attendance.findMany({
    where: {
      ...(params.flagged === "1" ? { flagged: true } : {}),
      ...(params.status
        ? { status: params.status as never }
        : {}),
      ...(params.q
        ? {
            user: {
              OR: [
                { name: { contains: params.q, mode: "insensitive" } },
                { employeeCode: { contains: params.q, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    include: {
      user: { select: { name: true, employeeCode: true } },
      office: { select: { name: true } },
    },
    orderBy: [{ date: "desc" }, { checkInAt: "desc" }],
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Attendance records</h1>
          <p className="muted mt-1">Most recent 100 entries.</p>
        </div>

        <form className="flex flex-wrap gap-2" action="/admin/attendance">
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Name or employee code"
            className="input w-56"
          />
          <select name="status" defaultValue={params.status ?? ""} className="input w-40">
            <option value="">All statuses</option>
            <option value="PRESENT">Present</option>
            <option value="LATE">Late</option>
            <option value="HALF_DAY">Half day</option>
            <option value="ABSENT">Absent</option>
            <option value="ON_LEAVE">On leave</option>
          </select>
          <select name="flagged" defaultValue={params.flagged ?? ""} className="input w-36">
            <option value="">All records</option>
            <option value="1">Flagged only</option>
          </select>
          <button className="btn-navy">Filter</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No records match those filters" />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Employee</th>
                <th>Status</th>
                <th>In</th>
                <th>Out</th>
                <th>Worked</th>
                <th>Method</th>
                <th>Location</th>
                <th>Accuracy</th>
                <th>Integrity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap font-medium text-slate-900">
                    {formatDate(r.date, "UTC")}
                  </td>
                  <td>
                    <p className="whitespace-nowrap font-medium text-slate-900">
                      {r.user.name}
                    </p>
                    <p className="text-xs text-slate-500">{r.user.employeeCode}</p>
                  </td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td className="tabular-nums">
                    {formatTime(r.checkInAt, settings.timezone)}
                  </td>
                  <td className="tabular-nums">
                    {formatTime(r.checkOutAt, settings.timezone)}
                  </td>
                  <td className="tabular-nums">
                    {formatMinutesAsHours(r.workedMinutes)}
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="badge bg-slate-100 text-slate-700">
                        {r.checkInMethod ?? "—"}
                      </span>
                      {r.checkInSimulated || r.checkOutSimulated ? (
                        <SimulatedBadge />
                      ) : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">
                    {r.checkInLat != null && r.checkInLng != null ? (
                      <>
                        <p className="font-mono text-xs text-slate-700">
                          {r.checkInLat.toFixed(5)}, {r.checkInLng.toFixed(5)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {r.checkInDistance == null
                            ? "—"
                            : `${Math.round(r.checkInDistance)} m from ${r.office?.name ?? "office"}`}
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">
                        No coordinates
                      </span>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {r.checkInAccuracy === null
                      ? "—"
                      : `±${Math.round(r.checkInAccuracy)} m`}
                  </td>
                  <td>
                    {r.flagged ? (
                      <RiskPill score={r.riskScore} />
                    ) : (
                      <span className="badge bg-emerald-100 text-emerald-800">
                        Clean
                      </span>
                    )}
                  </td>
                  <td>
                    <Link
                      href={`/admin/attendance/${r.id}`}
                      className="btn-outline btn-sm whitespace-nowrap"
                    >
                      View map
                    </Link>
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
