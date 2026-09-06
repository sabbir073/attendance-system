"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { csrfToken } from "@/lib/client-signals";
import { cn } from "@/lib/utils";

export interface SettingsForm {
  vpnPolicy: "OFF" | "WARN" | "STRICT";
  geofenceEnabled: boolean;
  geofenceBlocks: boolean;
  enforceCountryLock: boolean;
  allowUnknownIp: boolean;
  blockMockLocation: boolean;
  requireDeviceBinding: boolean;
  maxDevicesPerUser: number;
  maxGpsAccuracy: number;
  impossibleTravelKmh: number;
  riskBlockThreshold: number;
  riskFlagThreshold: number;
  biometricSimulationMode: boolean;
  simulatedFailureRate: number;
  requireBiometric: boolean;
  allowGpsOnly: boolean;
  allowFace: boolean;
  allowFingerprint: boolean;
  sessionTtlHours: number;
  maxFailedLogins: number;
  lockoutMinutes: number;
}

export function SettingsEditor({ initial }: { initial: SettingsForm }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  function set<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setMsg({ tone: "err", text: data.error ?? "Could not save." });
        return;
      }
      setMsg({ tone: "ok", text: "Settings saved and applied immediately." });
      router.refresh();
    } catch {
      setMsg({ tone: "err", text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {msg ? (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            msg.tone === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-red-300 bg-red-50 text-red-800",
          )}
        >
          {msg.text}
        </div>
      ) : null}

      {/* biometrics */}
      <Section
        title="Biometrics"
        description="Simulation mode produces synthetic face and fingerprint results so the system can be demonstrated without a camera or sensor. Records created this way are permanently marked as simulated."
      >
        <Toggle
          label="Simulation mode"
          hint="Off = use real face capture and WebAuthn."
          checked={form.biometricSimulationMode}
          onChange={(v) => set("biometricSimulationMode", v)}
        />
        <Number
          label="Simulated failure rate"
          hint="Percent of demo attempts that deliberately fail, to show retry handling."
          suffix="%"
          value={form.simulatedFailureRate}
          min={0}
          max={100}
          onChange={(v) => set("simulatedFailureRate", v)}
        />
        <Toggle
          label="Allow location-only punches"
          checked={form.allowGpsOnly}
          onChange={(v) => set("allowGpsOnly", v)}
        />
        <Toggle
          label="Require a biometric method"
          hint="Refuses GPS-only attendance."
          checked={form.requireBiometric}
          onChange={(v) => set("requireBiometric", v)}
        />
        <Toggle
          label="Allow face recognition"
          checked={form.allowFace}
          onChange={(v) => set("allowFace", v)}
        />
        <Toggle
          label="Allow fingerprint"
          checked={form.allowFingerprint}
          onChange={(v) => set("allowFingerprint", v)}
        />
      </Section>

      {/* network */}
      <Section
        title="Network & VPN"
        description="STRICT blocks a punch outright when a VPN, proxy or datacenter address is detected. WARN records it and allows the punch."
      >
        <Select
          label="VPN policy"
          value={form.vpnPolicy}
          options={[
            { value: "STRICT", label: "STRICT — block the punch" },
            { value: "WARN", label: "WARN — allow but flag" },
            { value: "OFF", label: "OFF — do not check" },
          ]}
          onChange={(v) => set("vpnPolicy", v as SettingsForm["vpnPolicy"])}
        />
        <Toggle
          label="Enforce country lock"
          hint="Refuse connections that resolve outside the expected country."
          checked={form.enforceCountryLock}
          onChange={(v) => set("enforceCountryLock", v)}
        />
        <Toggle
          label="Allow unverifiable networks"
          hint="Leave ON for local deployments — private IPs cannot be geolocated."
          checked={form.allowUnknownIp}
          onChange={(v) => set("allowUnknownIp", v)}
        />
      </Section>

      {/* location */}
      <Section title="Location integrity">
        <Toggle
          label="Enforce geofence"
          hint="Measure distance from the assigned office on every punch."
          checked={form.geofenceEnabled}
          onChange={(v) => set("geofenceEnabled", v)}
        />
        <Toggle
          label="Refuse punches outside the radius"
          hint="Off (recommended): the punch is recorded and flagged, and the exact location is shown to administrators. On: the employee is blocked."
          checked={form.geofenceBlocks}
          onChange={(v) => set("geofenceBlocks", v)}
        />
        <Toggle
          label="Block suspected mock location"
          hint="Refuses a punch when the geolocation API appears overridden."
          checked={form.blockMockLocation}
          onChange={(v) => set("blockMockLocation", v)}
        />
        <Number
          label="Maximum GPS accuracy"
          suffix="m"
          value={form.maxGpsAccuracy}
          min={10}
          max={1000}
          onChange={(v) => set("maxGpsAccuracy", v)}
        />
        <Number
          label="Impossible travel speed"
          suffix="km/h"
          value={form.impossibleTravelKmh}
          min={50}
          max={2000}
          onChange={(v) => set("impossibleTravelKmh", v)}
        />
      </Section>

      {/* devices & risk */}
      <Section title="Devices & risk scoring">
        <Toggle
          label="Require device binding"
          checked={form.requireDeviceBinding}
          onChange={(v) => set("requireDeviceBinding", v)}
        />
        <Number
          label="Maximum devices per employee"
          value={form.maxDevicesPerUser}
          min={1}
          max={10}
          onChange={(v) => set("maxDevicesPerUser", v)}
        />
        <Number
          label="Flag at risk score"
          value={form.riskFlagThreshold}
          min={5}
          max={99}
          onChange={(v) => set("riskFlagThreshold", v)}
        />
        <Number
          label="Block at risk score"
          value={form.riskBlockThreshold}
          min={10}
          max={100}
          onChange={(v) => set("riskBlockThreshold", v)}
        />
      </Section>

      {/* sessions */}
      <Section title="Sessions & lockout">
        <Number
          label="Session lifetime"
          suffix="hours"
          value={form.sessionTtlHours}
          min={1}
          max={168}
          onChange={(v) => set("sessionTtlHours", v)}
        />
        <Number
          label="Failed logins before lockout"
          value={form.maxFailedLogins}
          min={3}
          max={20}
          onChange={(v) => set("maxFailedLogins", v)}
        />
        <Number
          label="Lockout duration"
          suffix="minutes"
          value={form.lockoutMinutes}
          min={1}
          max={1440}
          onChange={(v) => set("lockoutMinutes", v)}
        />
      </Section>

      <div className="sticky bottom-0 -mx-4 border-t border-[var(--line)] bg-white/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------- controls ---------------------------- */

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
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[#0B7A3B]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint ? (
          <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

function Number({
  label,
  hint,
  suffix,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  suffix?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <label className="block text-sm font-medium text-slate-800">{label}</label>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          className="input"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(globalThis.Number(e.target.value))}
        />
        {suffix ? (
          <span className="text-sm text-slate-500">{suffix}</span>
        ) : null}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <label className="block text-sm font-medium text-slate-800">{label}</label>
      <select
        className="input mt-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
