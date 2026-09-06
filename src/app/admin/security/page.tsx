import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { Stat, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security centre" };

const DECISION_STYLES: Record<string, string> = {
  BLOCKED: "bg-red-100 text-red-700",
  FLAGGED: "bg-amber-100 text-amber-800",
  ALLOWED: "bg-emerald-100 text-emerald-800",
};

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ decision?: string }>;
}) {
  await requireAdmin();
  const settings = await getSettings();
  const params = await searchParams;

  const since = new Date(Date.now() - 7 * 86_400_000);

  const [events, blocked, flagged, vpnHits, mockHits, failedLogins] =
    await Promise.all([
      prisma.integrityEvent.findMany({
        where: params.decision
          ? { decision: params.decision as never }
          : { decision: { in: ["BLOCKED", "FLAGGED"] } },
        include: { user: { select: { name: true, employeeCode: true } } },
        orderBy: { createdAt: "desc" },
        take: 80,
      }),
      prisma.integrityEvent.count({
        where: { decision: "BLOCKED", createdAt: { gte: since } },
      }),
      prisma.integrityEvent.count({
        where: { decision: "FLAGGED", createdAt: { gte: since } },
      }),
      prisma.integrityEvent.count({
        where: { vpnDetected: true, createdAt: { gte: since } },
      }),
      prisma.integrityEvent.count({
        where: { mockLocationSuspected: true, createdAt: { gte: since } },
      }),
      prisma.loginAttempt.count({
        where: { success: false, createdAt: { gte: since } },
      }),
    ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Security centre</h1>
          <p className="muted mt-1">
            Every decision the risk engine made. Last 7 days summarised.
          </p>
        </div>

        <form action="/admin/security" className="flex gap-2">
          <select
            name="decision"
            defaultValue={params.decision ?? ""}
            className="input w-44"
          >
            <option value="">Blocked &amp; flagged</option>
            <option value="BLOCKED">Blocked only</option>
            <option value="FLAGGED">Flagged only</option>
            <option value="ALLOWED">Allowed only</option>
          </select>
          <button className="btn-navy">Filter</button>
        </form>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Blocked" value={blocked} tone={blocked ? "bad" : "default"} />
        <Stat label="Flagged" value={flagged} tone={flagged ? "warn" : "default"} />
        <Stat label="VPN detected" value={vpnHits} tone={vpnHits ? "bad" : "default"} />
        <Stat
          label="Spoofing suspected"
          value={mockHits}
          tone={mockHits ? "bad" : "default"}
        />
        <Stat label="Failed logins" value={failedLogins} />
      </div>

      <div className="rounded-xl border border-navy-200 bg-navy-50 px-4 py-3 text-sm text-navy-900">
        <p className="font-semibold">Current enforcement</p>
        <p className="mt-1">
          VPN policy <strong>{settings.vpnPolicy}</strong> · geofence{" "}
          <strong>{settings.geofenceEnabled ? "on" : "off"}</strong> · device
          binding <strong>{settings.requireDeviceBinding ? "on" : "off"}</strong>{" "}
          · block at risk <strong>{settings.riskBlockThreshold}</strong> · flag at{" "}
          <strong>{settings.riskFlagThreshold}</strong>
          {settings.biometricSimulationMode ? (
            <> · biometrics <strong>SIMULATED</strong></>
          ) : null}
        </p>
      </div>

      {events.length === 0 ? (
        <EmptyState
          title="No matching events"
          description="Nothing has been blocked or flagged."
        />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Employee</th>
                <th>Action</th>
                <th>Decision</th>
                <th>Risk</th>
                <th>Reasons</th>
                <th>Network</th>
                <th>GPS</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs text-slate-600">
                    {formatDateTime(e.createdAt, settings.timezone)}
                  </td>
                  <td>
                    <p className="whitespace-nowrap font-medium text-slate-900">
                      {e.user?.name ?? "—"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {e.user?.employeeCode ?? ""}
                    </p>
                  </td>
                  <td className="whitespace-nowrap text-xs">{e.action}</td>
                  <td>
                    <span className={`badge ${DECISION_STYLES[e.decision]}`}>
                      {e.decision}
                    </span>
                  </td>
                  <td className="tabular-nums">{e.riskScore}</td>
                  <td className="max-w-xs">
                    <span className="text-xs text-slate-600">
                      {e.reasons.length ? e.reasons.join(", ") : "—"}
                    </span>
                  </td>
                  <td className="text-xs">
                    {e.vpnDetected ? (
                      <span className="badge bg-red-100 text-red-700">VPN</span>
                    ) : null}
                    <p className="mt-0.5 text-slate-500">
                      {[e.ipCity, e.ipCountry].filter(Boolean).join(", ") || "—"}
                    </p>
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-600">
                    {e.gpsAccuracy ? `±${Math.round(e.gpsAccuracy)} m` : "—"}
                    {e.distanceMeters
                      ? ` · ${Math.round(e.distanceMeters)} m out`
                      : ""}
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
