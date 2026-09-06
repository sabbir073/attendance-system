import { requireAdmin } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { SettingsEditor } from "@/components/SettingsEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdmin();
  const s = await getSettings(true);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="muted mt-1">
          Policy is applied on the next request — no redeploy needed. Changes
          are written to the audit log.
        </p>
      </div>

      <SettingsEditor
        initial={{
          vpnPolicy: s.vpnPolicy,
          geofenceEnabled: s.geofenceEnabled,
          enforceCountryLock: s.enforceCountryLock,
          allowUnknownIp: s.allowUnknownIp,
          blockMockLocation: s.blockMockLocation,
          requireDeviceBinding: s.requireDeviceBinding,
          maxDevicesPerUser: s.maxDevicesPerUser,
          maxGpsAccuracy: s.maxGpsAccuracy,
          impossibleTravelKmh: s.impossibleTravelKmh,
          riskBlockThreshold: s.riskBlockThreshold,
          riskFlagThreshold: s.riskFlagThreshold,
          biometricSimulationMode: s.biometricSimulationMode,
          simulatedFailureRate: s.simulatedFailureRate,
          requireBiometric: s.requireBiometric,
          allowGpsOnly: s.allowGpsOnly,
          allowFace: s.allowFace,
          allowFingerprint: s.allowFingerprint,
          sessionTtlHours: s.sessionTtlHours,
          maxFailedLogins: s.maxFailedLogins,
          lockoutMinutes: s.lockoutMinutes,
        }}
      />
    </div>
  );
}
