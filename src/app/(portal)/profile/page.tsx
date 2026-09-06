import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getBiometricStatus } from "@/lib/biometrics";
import { BiometricEnrol } from "@/components/BiometricEnrol";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile & security" };

export default async function ProfilePage() {
  const user = await requireUser();

  const [profile, biometrics, devices, sessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { department: true, office: true, shift: true },
    }),
    getBiometricStatus(user.id),
    prisma.device.findMany({
      where: { userId: user.id },
      orderBy: { lastUsedAt: "desc" },
    }),
    prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      take: 5,
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Profile &amp; security</h1>

      {/* identity */}
      <div className="card card-pad">
        <p className="section-title mb-4">Employee details</p>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <Field label="Name" value={profile.name} />
          <Field label="Employee code" value={profile.employeeCode} />
          <Field label="Email" value={profile.email} />
          <Field label="Designation" value={profile.designation ?? "—"} />
          <Field label="Department" value={profile.department?.name ?? "—"} />
          <Field label="Office" value={profile.office?.name ?? "—"} />
          <Field label="Shift" value={profile.shift?.name ?? "—"} />
          <Field label="Role" value={profile.role.replace("_", " ")} />
        </dl>
      </div>

      {/* biometrics */}
      <div className="card card-pad">
        <p className="section-title mb-1">Biometric enrolment</p>
        <p className="muted mb-4">
          Enrol a method here before using it to record attendance.
        </p>
        <BiometricEnrol
          initial={{
            simulationMode: biometrics.simulationMode,
            face: {
              enrolled: biometrics.face.enrolled,
              simulated: biometrics.face.simulated,
            },
            fingerprint: {
              enrolled: biometrics.fingerprint.enrolled,
              simulated: biometrics.fingerprint.simulated,
            },
          }}
        />
      </div>

      {/* devices */}
      <div className="card card-pad">
        <p className="section-title mb-1">Registered devices</p>
        <p className="muted mb-4">
          Attendance is bound to these devices. An unrecognised device is
          flagged, and blocked once the limit is reached.
        </p>

        {devices.length === 0 ? (
          <p className="muted">No devices registered yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {d.label ?? "Unknown device"}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    Last used {formatDateTime(d.lastUsedAt)} · {d.useCount} punches
                  </p>
                </div>
                <span
                  className={
                    d.trusted
                      ? "badge bg-emerald-100 text-emerald-800"
                      : "badge bg-amber-100 text-amber-800"
                  }
                >
                  {d.trusted ? "Trusted" : "Pending approval"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* sessions */}
      <div className="card card-pad">
        <p className="section-title mb-4">Active sessions</p>
        <ul className="divide-y divide-[var(--line)]">
          {sessions.map((s) => (
            <li key={s.id} className="py-3">
              <p className="truncate text-sm text-slate-800">
                {s.userAgent ?? "Unknown client"}
              </p>
              <p className="text-xs text-slate-500">
                Last seen {formatDateTime(s.lastSeenAt)} · expires{" "}
                {formatDateTime(s.expiresAt)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}
