import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getTodayContext, getMonthSummary } from "@/lib/attendance";
import { prisma } from "@/lib/prisma";
import { Stat, StatusPill, SimulatedBadge, EmptyState } from "@/components/ui";
import { formatTime, formatDate } from "@/lib/utils";
import { formatMinutesAsHours } from "@/lib/geo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const context = await getTodayContext(user.id);

  const now = new Date();
  const { summary } = await getMonthSummary(
    user.id,
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
  );

  const recent = await prisma.attendance.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
    take: 7,
    include: { office: { select: { name: true } } },
  });

  const a = context.attendance;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome back, {user.name.split(" ")[0]}
          </h1>
          <p className="muted mt-1">
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: context.timezone,
              weekday: "long",
              day: "numeric",
              month: "long",
            }).format(now)}
          </p>
        </div>

        <Link href="/attendance" className="btn-primary">
          {context.canCheckIn
            ? "Check in now"
            : context.canCheckOut
              ? "Check out"
              : "View attendance"}
        </Link>
      </div>

      {/* today */}
      <div className="card card-pad">
        <p className="section-title mb-4">Today</p>
        <div className="grid gap-5 sm:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Check in
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {formatTime(a?.checkInAt, context.timezone)}
            </p>
            {a?.checkInSimulated ? <SimulatedBadge className="mt-1.5" /> : null}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Check out
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {formatTime(a?.checkOutAt, context.timezone)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Worked
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {a ? formatMinutesAsHours(a.workedMinutes) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Status
            </p>
            <div className="mt-2">
              {a ? (
                <StatusPill status={a.status} />
              ) : (
                <span className="badge bg-slate-100 text-slate-600">
                  Not recorded
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* month */}
      <div>
        <p className="section-title mb-3">This month</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Present" value={summary.present} tone="good" />
          <Stat label="Late" value={summary.late} tone="warn" />
          <Stat label="Absent" value={summary.absent} tone="bad" />
          <Stat
            label="Hours worked"
            value={formatMinutesAsHours(summary.totalWorkedMinutes)}
            tone="info"
          />
        </div>
      </div>

      {/* recent */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="section-title">Recent activity</p>
          <Link
            href="/history"
            className="text-sm font-semibold text-brand-600 hover:underline"
          >
            View full history
          </Link>
        </div>

        {recent.length === 0 ? (
          <EmptyState
            title="No attendance yet"
            description="Your records will appear here once you check in."
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
                  <th>Office</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-slate-900">
                      {formatDate(r.date, "UTC")}
                    </td>
                    <td>
                      <StatusPill status={r.status} />
                    </td>
                    <td className="tabular-nums">
                      {formatTime(r.checkInAt, context.timezone)}
                    </td>
                    <td className="tabular-nums">
                      {formatTime(r.checkOutAt, context.timezone)}
                    </td>
                    <td className="tabular-nums">
                      {formatMinutesAsHours(r.workedMinutes)}
                    </td>
                    <td>{r.office?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
