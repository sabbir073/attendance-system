import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getMonthSummary } from "@/lib/attendance";
import { getSettings } from "@/lib/settings";
import { Stat, StatusPill, SimulatedBadge, RiskPill, EmptyState } from "@/components/ui";
import { formatTime, formatDate, MONTH_NAMES } from "@/lib/utils";
import { formatMinutesAsHours } from "@/lib/geo";

export const dynamic = "force-dynamic";
export const metadata = { title: "My history" };

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const params = await searchParams;

  const now = new Date();
  const year = Number(params.year) || now.getUTCFullYear();
  const month = Number(params.month) || now.getUTCMonth() + 1;

  const { rows, summary } = await getMonthSummary(user.id, year, month);

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My history</h1>
          <p className="muted mt-1">
            {MONTH_NAMES[month - 1]} {year}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/history?year=${prev.y}&month=${prev.m}`}
            className="btn-outline btn-sm"
          >
            ← {MONTH_NAMES[prev.m - 1]?.slice(0, 3)}
          </Link>
          <Link href="/history" className="btn-outline btn-sm">
            This month
          </Link>
          <Link
            href={`/history?year=${next.y}&month=${next.m}`}
            className="btn-outline btn-sm"
          >
            {MONTH_NAMES[next.m - 1]?.slice(0, 3)} →
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Present" value={summary.present} tone="good" />
        <Stat label="Late" value={summary.late} tone="warn" />
        <Stat label="Half day" value={summary.halfDay} tone="warn" />
        <Stat label="Absent" value={summary.absent} tone="bad" />
        <Stat label="Flagged" value={summary.flagged} tone={summary.flagged ? "bad" : "default"} />
        <Stat
          label="Total hours"
          value={formatMinutesAsHours(summary.totalWorkedMinutes)}
          tone="info"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={`No records for ${MONTH_NAMES[month - 1]} ${year}`}
          description="Try another month, or check in to create today's record."
        />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>In</th>
                <th>Out</th>
                <th>Worked</th>
                <th>Late</th>
                <th>Method</th>
                <th>Distance</th>
                <th>Integrity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap font-medium text-slate-900">
                    {formatDate(r.date, "UTC")}
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
                  <td className="tabular-nums">
                    {r.lateMinutes ? `${r.lateMinutes} m` : "—"}
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
                  <td className="tabular-nums">
                    {r.checkInDistance === null
                      ? "—"
                      : `${Math.round(r.checkInDistance)} m`}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
