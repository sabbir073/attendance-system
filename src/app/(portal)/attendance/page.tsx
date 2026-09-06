import { requireUser } from "@/lib/session";
import { getTodayContext } from "@/lib/attendance";
import { getBiometricStatus } from "@/lib/biometrics";
import { prisma } from "@/lib/prisma";
import { PunchPanel } from "@/components/PunchPanel";
import { StatusPill, SimulatedBadge } from "@/components/ui";
import { formatTime } from "@/lib/utils";
import { formatMinutesAsHours } from "@/lib/geo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mark attendance" };

export default async function AttendancePage() {
  const user = await requireUser();
  const [context, biometrics, office] = await Promise.all([
    getTodayContext(user.id),
    getBiometricStatus(user.id),
    user.officeId
      ? prisma.office.findUnique({ where: { id: user.officeId } })
      : Promise.resolve(null),
  ]);

  const a = context.attendance;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Mark attendance</h1>
        <p className="muted mt-1">
          {new Intl.DateTimeFormat("en-GB", {
            timeZone: context.timezone,
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(new Date())}
          {context.isHoliday ? ` · ${context.holidayName}` : ""}
          {!context.isWorkingDay && !context.isHoliday ? " · Weekend" : ""}
        </p>
      </div>

      {/* today's state */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card card-pad">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Check in
          </p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
            {formatTime(a?.checkInAt, context.timezone)}
          </p>
          {a?.checkInSimulated ? <SimulatedBadge className="mt-2" /> : null}
        </div>

        <div className="card card-pad">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Check out
          </p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
            {formatTime(a?.checkOutAt, context.timezone)}
          </p>
          {a?.checkOutSimulated ? <SimulatedBadge className="mt-2" /> : null}
        </div>

        <div className="card card-pad">
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
          {a?.workedMinutes ? (
            <p className="mt-2 text-xs text-slate-500">
              {formatMinutesAsHours(a.workedMinutes)} worked
            </p>
          ) : null}
        </div>
      </div>

      {/* geofence reference */}
      {office ? (
        <div className="card card-pad">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-title">{office.name}</p>
              <p className="muted mt-0.5">{office.address}</p>
            </div>
            <span className="badge bg-brand-50 text-brand-700">
              {office.radiusMeters} m geofence
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            You must be physically inside this radius. Your GPS accuracy is
            credited towards the boundary, so a noisy fix at the edge is not
            penalised.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No office is assigned to your account, so attendance cannot be
          recorded. Contact your administrator.
        </div>
      )}

      {/* punch */}
      <div className="card card-pad">
        <PunchPanel
          canCheckIn={context.canCheckIn}
          canCheckOut={context.canCheckOut}
          allowedMethods={biometrics.allowedMethods}
          biometricStatus={{
            face: { enrolled: biometrics.face.enrolled },
            fingerprint: { enrolled: biometrics.fingerprint.enrolled },
          }}
          simulationMode={biometrics.simulationMode}
          officeName={office?.name ?? null}
          timezone={context.timezone}
        />
      </div>
    </div>
  );
}
