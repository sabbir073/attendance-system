import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { localDateString, toDateOnly, formatMinutesAsHours } from "@/lib/geo";
import { Stat, StatusPill, SimulatedBadge, RiskPill, EmptyState } from "@/components/ui";
import { formatTime, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin dashboard" };

export default async function AdminDashboard() {
  await requireAdmin();
  const settings = await getSettings();

  const today = toDateOnly(localDateString(new Date(), settings.timezone));

  const [
    totalStaff,
    activeStaff,
    todayRows,
    flaggedToday,
    blockedToday,
    offices,
    recentEvents,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.attendance.findMany({
      where: { date: today },
      include: {
        user: { select: { name: true, employeeCode: true } },
        office: { select: { name: true } },
      },
      orderBy: { checkInAt: "asc" },
      take: 12,
    }),
    prisma.attendance.count({ where: { date: today, flagged: true } }),
    prisma.integrityEvent.count({
      where: {
        decision: "BLOCKED",
        createdAt: { gte: new Date(Date.now() - 86_400_000) },
      },
    }),
    prisma.office.count({ where: { isActive: true } }),
    prisma.integrityEvent.findMany({
      where: { decision: { in: ["BLOCKED", "FLAGGED"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const presentCount = await prisma.attendance.count({
    where: { date: today, checkInAt: { not: null } },
  });
  const lateCount = await prisma.attendance.count({
    where: { date: today, status: "LATE" },
  });

  const attendanceRate =
    activeStaff > 0 ? Math.round((presentCount / activeStaff) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Operations dashboard</h1>
        <p className="muted mt-1">
          {new Intl.DateTimeFormat("en-GB", {
            timeZone: settings.timezone,
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(new Date())}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label="Active staff" value={activeStaff} sub={`${totalStaff} total`} />
        <Stat label="Present today" value={presentCount} tone="good" />
        <Stat label="Late today" value={lateCount} tone="warn" />
        <Stat
          label="Attendance rate"
          value={`${attendanceRate}%`}
          tone={attendanceRate >= 85 ? "good" : "warn"}
        />
        <Stat
          label="Flagged today"
          value={flaggedToday}
          tone={flaggedToday ? "bad" : "default"}
        />
        <Stat
          label="Blocked (24h)"
          value={blockedToday}
          tone={blockedToday ? "bad" : "default"}
          sub={`${offices} active sites`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* today's punches */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <p className="section-title">Today&rsquo;s punches</p>
            <Link
              href="/admin/attendance"
              className="text-sm font-semibold text-navy-600 hover:underline"
            >
              View all
            </Link>
          </div>

          {todayRows.length === 0 ? (
            <EmptyState
              title="No attendance recorded yet today"
              description="Records appear here as employees check in."
            />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Status</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Method</th>
                    <th>Office</th>
                  </tr>
                </thead>
                <tbody>
                  {todayRows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <p className="font-medium text-slate-900">{r.user.name}</p>
                        <p className="text-xs text-slate-500">
                          {r.user.employeeCode}
                        </p>
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
                      <td>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="badge bg-slate-100 text-slate-700">
                            {r.checkInMethod ?? "—"}
                          </span>
                          {r.checkInSimulated ? <SimulatedBadge /> : null}
                        </div>
                      </td>
                      <td>{r.office?.name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* security feed */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="section-title">Security events</p>
            <Link
              href="/admin/security"
              className="text-sm font-semibold text-navy-600 hover:underline"
            >
              All
            </Link>
          </div>

          {recentEvents.length === 0 ? (
            <div className="card card-pad">
              <p className="muted">
                No blocked or flagged attempts. Nothing to review.
              </p>
            </div>
          ) : (
            <div className="card divide-y divide-[var(--line)]">
              {recentEvents.map((e) => (
                <div key={e.id} className="p-4">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {e.user?.name ?? "Unknown"}
                    </p>
                    <span
                      className={
                        e.decision === "BLOCKED"
                          ? "badge bg-red-100 text-red-700"
                          : "badge bg-amber-100 text-amber-800"
                      }
                    >
                      {e.decision}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {e.action} · {formatDateTime(e.createdAt, settings.timezone)}
                  </p>
                  {e.reasons.length ? (
                    <p className="mt-1 text-xs text-slate-600">
                      {e.reasons.slice(0, 3).join(", ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
