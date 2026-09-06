"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-signals";
import { cn } from "@/lib/utils";

export interface SettingsShape {
  geofenceEnabled: boolean;
  defaultRadiusMeters: number;
  maxGpsAccuracy: number;
  requireHighAccuracy: boolean;
  blockMockLocation: boolean;
  requireDeviceBinding: boolean;
  maxDevicesPerUser: number;
  impossibleTravelKmh: number;
  vpnPolicy: "OFF" | "WARN" | "STRICT";
  allowUnknownIp: boolean;
  enforceCountryLock: boolean;
  expectedCountry: string;
  allowGpsOnly: boolean;
  allowFingerprint: boolean;
  allowFace: boolean;
  requireBiometric: boolean;
  biometricSimulationMode: boolean;
  simulatedFailureRate: number;
  riskBlockThreshold: number;
  riskFlagThreshold: number;
  sessionTtlHours: number;
  maxFailedLogins: number;
  lockoutMinutes: number;
}

export function SettingsForm({ initial }: { initial: SettingsShape }) {
  const router = useRouter();
  const [form, setForm] = useState<SettingsShape>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const set = <K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await postJson("/api/admin/settings", form);
      setTone("good");
      setMessage("Settings saved and applied immediately.");
      router.refresh();
    } catch (err) {
      setTone("bad");
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {/* --- simulation --- */}
      <Section
        title="Biometric simulation"
        description="Demo mode produces synthetic face and fingerprint results so the full journey works without a camera or sensor. Every record created this way is permanently marked as simulated."
      >
        <Toggle
          label="Simulation mode"
          hint={
            form.biometricSimulationMode
              ? "ON — no real capture. Results are synthetic."
              : "OFF — real face matching and WebAuthn are used."
          }
          checked={form.biometricSimulationMode}
          onChange={(v) => set("biometricSimulationMode", v)}
        />
        <Num
          label="Simulated failure rate (%)"
          hint="Percentage of simulated scans that deliberately fail, to demonstrate retry."
          value={form.simulatedFailureRate}
          onChange={(v) => set("simulatedFailureRate", v)}
          min={0}
          max={100}
        />
      </Section>

      {/* --- methods --- */}
      <Section title="Verification methods">
        <Toggle label="Allow location-only" checked={form.allowGpsOnly} onChange={(v) => set("allowGpsOnly", v)} />
        <Toggle label="Allow fingerprint" checked={form.allowFingerprint} onChange={(v) => set("allowFingerprint", v)} />
        <Toggle label="Allow face recognition" checked={form.allowFace} onChange={(v) => set("allowFace", v)} />
        <Toggle
          label="Require biometric"
          hint="Refuses location-only punches entirely."
          checked={form.requireBiometric}
          onChange={(v) => set("requireBiometric", v)}
        />
      </Section>

      {/* --- geofence --- */}
      <Section title="Geofence">
        <Toggle label="Enforce geofence" checked={form.geofenceEnabled} onChange={(v) => set("geofenceEnabled", v)} />
        <Num label="Default radius (m)" value={form.defaultRadiusMeters} onChange={(v) => set("defaultRadiusMeters", v)} min={20} max={5000} />
        <Num label="Max GPS accuracy (m)" hint="Readings less precise than this are penalised." value={form.maxGpsAccuracy} onChange={(v) => set("maxGpsAccuracy", v)} min={10} max={2000} />
        <Toggle label="Require high accuracy" checked={form.requireHighAccuracy} onChange={(v) => set("requireHighAccuracy", v)} />
      </Section>

      {/* --- anti-spoof --- */}
      <Section title="Anti-spoofing">
        <Toggle label="Block suspected mock location" checked={form.blockMockLocation} onChange={(v) => set("blockMockLocation", v)} />
        <Toggle label="Require device binding" checked={form.requireDeviceBinding} onChange={(v) => set("requireDeviceBinding", v)} />
        <Num label="Max devices per employee" value={form.maxDevicesPerUser} onChange={(v) => set("maxDevicesPerUser", v)} min={1} max={10} />
        <Num label="Impossible travel (km/h)" value={form.impossibleTravelKmh} onChange={(v) => set("impossibleTravelKmh", v)} min={50} max={2000} />
      </Section>

      {/* --- vpn --- */}
      <Section
        title="VPN & network"
        description="On localhost the origin is a private address and cannot be geolocated. Turn off 'Allow unverifiable networks' to see the blocking path fire locally."
      >
        <div>
          <label className="label" htmlFor="vpnPolicy">VPN policy</label>
          <select
            id="vpnPolicy"
            className="input"
            value={form.vpnPolicy}
            onChange={(e) => set("vpnPolicy", e.target.value as SettingsShape["vpnPolicy"])}
          >
            <option value="OFF">Off — ignore</option>
            <option value="WARN">Warn — flag only</option>
            <option value="STRICT">Strict — block the punch</option>
          </select>
        </div>
        <Toggle label="Allow unverifiable networks" checked={form.allowUnknownIp} onChange={(v) => set("allowUnknownIp", v)} />
        <Toggle label="Enforce country lock" checked={form.enforceCountryLock} onChange={(v) => set("enforceCountryLock", v)} />
        <div>
          <label className="label" htmlFor="country">Expected country (ISO-2)</label>
          <input
            id="country"
            className="input uppercase"
            maxLength={2}
            value={form.expectedCountry}
            onChange={(e) => set("expectedCountry", e.target.value.toUpperCase())}
          />
        </div>
      </Section>

      {/* --- thresholds --- */}
      <Section title="Risk thresholds">
        <Num label="Flag at score" value={form.riskFlagThreshold} onChange={(v) => set("riskFlagThreshold", v)} min={5} max={100} />
        <Num label="Block at score" value={form.riskBlockThreshold} onChange={(v) => set("riskBlockThreshold", v)} min={10} max={100} />
      </Section>

      {/* --- sessions --- */}
      <Section title="Sessions & lockout">
        <Num label="Session lifetime (hours)" value={form.sessionTtlHours} onChange={(v) => set("sessionTtlHours", v)} min={1} max={168} />
        <Num label="Failed logins before lockout" value={form.maxFailedLogins} onChange={(v) => set("maxFailedLogins", v)} min={3} max={20} />
        <Num label="Lockout duration (minutes)" value={form.lockoutMinutes} onChange={(v) => set("lockoutMinutes", v)} min={1} max={1440} />
      </Section>

      {message ? (
        <p
          className={cn(
            "rounded-lg px-4 py-3 text-sm",
            tone === "good" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700",
          )}
        >
          {message}
        </p>
      ) : null}

      <div className="sticky bottom-4 flex justify-end">
        <button type="submit" disabled={busy} className="btn-primary shadow-lg">
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card card-pad">
      <p className="section-title">{title}</p>
      {description ? <p className="muted mt-1">{description}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[#0B7A3B]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}

function Num({
  label,
  hint,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        className="input"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
