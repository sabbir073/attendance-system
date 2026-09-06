import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { PunchMap } from "@/components/PunchMap";
import { StatusPill, SimulatedBadge, RiskPill } from "@/components/ui";
import { formatTime, formatDate, formatDateTime } from "@/lib/utils";
import { formatMinutesAsHours } from "@/lib/geo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Punch detail" };

export default async function PunchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const settings = await getSettings();
  const { id } = await params;

  const record = await prisma.attendance.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          employeeCode: true,
          email: true,
          designation: true,
          department: { select: { name: true } },
        },
      },
      office: true,
    },
  });

  if (!record) notFound();

  // Integrity events recorded around this punch, for the evidence trail.
  const events = await prisma.integrityEvent.findMany({
    where: {
      userId: record.userId,
      action: { in: ["CHECK_IN", "CHECK_OUT"] },
      createdAt: {
        gte: new Date(record.createdAt.getTime() - 60_000),
        lte: new Date(record.updatedAt.getTime() + 60_000),
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/attendance"
          className="text-sm font-semibold text-navy-600 hover:underline"
        >
          ← Back to attendance
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          {record.user.name}
        </h1>
        <p className="muted mt-1">
          {record.user.employeeCode}
          {record.user.designation ? ` · ${record.user.designation}` : ""}
          {record.user.department ? ` · ${record.user.department.name}` : ""} ·{" "}
          {formatDate(record.date, "UTC")}
        </p>
      </div>

      {/* summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Box label="Status">
          <StatusPill status={record.status} />
        </Box>
        <Box label="Check in">
          <p className="text-lg font-bold tabular-nums">
            {formatTime(record.checkInAt, settings.timezone)}
          </p>
        </Box>
        <Box label="Check out">
          <p className="text-lg font-bold tabular-nums">
            {formatTime(record.checkOutAt, settings.timezone)}
          </p>
        </Box>
        <Box label="Worked">
          <p className="text-lg font-bold tabular-nums">
            {formatMinutesAsHours(record.workedMinutes)}
          </p>
        </Box>
        <Box label="Integrity">
          {record.flagged ? (
            <RiskPill score={record.riskScore} />
          ) : (
            <span className="badge bg-emerald-100 text-emerald-800">Clean</span>
          )}
        </Box>
      </div>

      {record.flagged && record.flagReasons.length ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">
            Flagged for review
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-amber-900">
            {record.flagReasons.map((r) => (
              <li key={r}>{REASON_LABELS[r] ?? r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* maps */}
      <div className="grid gap-5 lg:grid-cols-2">
        {record.checkInLat != null && record.checkInLng != null ? (
          <PunchMap
            label={`Check-in location · ${formatTime(record.checkInAt, settings.timezone)}`}
            lat={record.checkInLat}
            lng={record.checkInLng}
            accuracy={record.checkInAccuracy}
            officeLat={record.office?.latitude}
            officeLng={record.office?.longitude}
            officeName={record.office?.name}
            radiusMeters={record.office?.radiusMeters}
          />
        ) : (
          <NoLocation label="Check-in location" />
        )}

        {record.checkOutLat != null && record.checkOutLng != null ? (
          <PunchMap
            label={`Check-out location · ${formatTime(record.checkOutAt, settings.timezone)}`}
            lat={record.checkOutLat}
            lng={record.checkOutLng}
            accuracy={record.checkOutAccuracy}
            officeLat={record.office?.latitude}
            officeLng={record.office?.longitude}
            officeName={record.office?.name}
            radiusMeters={record.office?.radiusMeters}
          />
        ) : (
          <NoLocation label="Check-out location" />
        )}
      </div>

      {/* evidence */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card card-pad">
          <p className="section-title mb-4">Check-in evidence</p>
          <dl className="space-y-2.5 text-sm">
            <Row label="Method">
              <span className="badge bg-slate-100 text-slate-700">
                {record.checkInMethod ?? "—"}
              </span>
              {record.checkInSimulated ? <SimulatedBadge /> : null}
            </Row>
            <Row label="Distance from office">
              {record.checkInDistance == null
                ? "—"
                : `${Math.round(record.checkInDistance)} m`}
            </Row>
            <Row label="GPS accuracy">
              {record.checkInAccuracy == null
                ? "—"
                : `±${Math.round(record.checkInAccuracy)} m`}
            </Row>
            <Row label="IP address">
              <span className="font-mono text-xs">{record.checkInIp ?? "—"}</span>
            </Row>
            <Row label="Face score">
              {record.checkInFaceScore == null
                ? "—"
                : `${(record.checkInFaceScore * 100).toFixed(1)}%`}
            </Row>
            <Row label="Liveness">
              {record.checkInLiveness == null
                ? "—"
                : `${(record.checkInLiveness * 100).toFixed(1)}%`}
            </Row>
          </dl>
        </div>

        <div className="card card-pad">
          <p className="section-title mb-4">Check-out evidence</p>
          <dl className="space-y-2.5 text-sm">
            <Row label="Method">
              <span className="badge bg-slate-100 text-slate-700">
                {record.checkOutMethod ?? "—"}
              </span>
              {record.checkOutSimulated ? <SimulatedBadge /> : null}
            </Row>
            <Row label="Distance from office">
              {record.checkOutDistance == null
                ? "—"
                : `${Math.round(record.checkOutDistance)} m`}
            </Row>
            <Row label="GPS accuracy">
              {record.checkOutAccuracy == null
                ? "—"
                : `±${Math.round(record.checkOutAccuracy)} m`}
            </Row>
            <Row label="IP address">
              <span className="font-mono text-xs">
                {record.checkOutIp ?? "—"}
              </span>
            </Row>
            <Row label="Assigned office">
              {record.office?.name ?? "—"}
            </Row>
            <Row label="Office radius">
              {record.office ? `${record.office.radiusMeters} m` : "—"}
            </Row>
          </dl>
        </div>
      </div>

      {/* trail */}
      {events.length ? (
        <div>
          <p className="section-title mb-3">Integrity trail</p>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Decision</th>
                  <th>Risk</th>
                  <th>Coordinates</th>
                  <th>Network</th>
                  <th>Reasons</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-xs">
                      {formatDateTime(e.createdAt, settings.timezone)}
                    </td>
                    <td className="text-xs">{e.action}</td>
                    <td>
                      <span
                        className={
                          e.decision === "BLOCKED"
                            ? "badge bg-red-100 text-red-700"
                            : e.decision === "FLAGGED"
                              ? "badge bg-amber-100 text-amber-800"
                              : "badge bg-emerald-100 text-emerald-800"
                        }
                      >
                        {e.decision}
                      </span>
                    </td>
                    <td className="tabular-nums">{e.riskScore}</td>
                    <td className="whitespace-nowrap font-mono text-xs">
                      {e.gpsLat != null && e.gpsLng != null
                        ? `${e.gpsLat.toFixed(5)}, ${e.gpsLng.toFixed(5)}`
                        : "—"}
                    </td>
                    <td className="text-xs">
                      {e.vpnDetected ? (
                        <span className="badge bg-red-100 text-red-700">VPN</span>
                      ) : null}{" "}
                      {[e.ipCity, e.ipCountry].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="max-w-xs text-xs text-slate-600">
                      {e.reasons.join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card card-pad">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-2 last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="flex flex-wrap items-center justify-end gap-1.5 font-medium text-slate-900">
        {children}
      </dd>
    </div>
  );
}

function NoLocation({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <p className="font-semibold text-slate-700">{label}</p>
      <p className="muted mt-1">No coordinates were recorded for this punch.</p>
    </div>
  );
}

const REASON_LABELS: Record<string, string> = {
  OUTSIDE_GEOFENCE: "Recorded outside the office radius",
  LOW_ACCURACY: "GPS accuracy below the configured minimum",
  IMPOSSIBLE_ACCURACY: "Reported accuracy of 0 m — mock provider suspected",
  STALE_POSITION: "GPS reading was not fresh",
  CLOCK_SKEW: "Device clock out of sync",
  IMPOSSIBLE_TRAVEL: "Implied travel speed exceeds the threshold",
  VPN_DETECTED: "VPN, proxy or Tor connection",
  DATACENTER_IP: "Connection from a datacenter address",
  COUNTRY_MISMATCH: "Connection from an unexpected country",
  IP_GPS_DIVERGENCE: "GPS position far from network location",
  TIMEZONE_IP_MISMATCH: "Device timezone does not match network location",
  WEBRTC_IP_LEAK: "Browser reported a different public address",
  NEW_DEVICE_ENROLLED: "New device registered",
  DEVICE_NOT_TRUSTED: "Device pending administrator approval",
  UNKNOWN_DEVICE: "Unregistered device",
  GEOLOCATION_OVERRIDDEN: "Geolocation API had been replaced",
  BIOMETRIC_DOWNGRADE: "Used location only despite enrolled biometrics",
  FACE_MARGINAL_MATCH: "Face match only just above threshold",
  BIOMETRIC_ON_NEW_DEVICE: "Biometric succeeded on an unseen device",
};
