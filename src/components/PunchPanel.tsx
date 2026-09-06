"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collectSignals,
  postJson,
  GeolocationFailure,
} from "@/lib/client-signals";
import { SimulatedBadge } from "@/components/ui";
import { cn, formatTime } from "@/lib/utils";

type Method = "GPS" | "FINGERPRINT" | "FACE";
type Phase = "idle" | "scanning" | "locating" | "submitting" | "done" | "error";

interface NetworkState {
  blocked: boolean;
  warning: boolean;
  reasons: string[];
  policy: string;
  network: {
    ipKnown: boolean;
    isLocal: boolean;
    country: string | null;
    city: string | null;
    isp: string | null;
    vpn: boolean;
    proxy: boolean;
    hosting: boolean;
  };
}

interface PunchResult {
  action: string;
  method: Method;
  simulated: boolean;
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  distanceMeters: number | null;
  accuracy: number;
  office: string | null;
  riskScore: number;
  flagged: boolean;
  warnings: { code: string; label: string }[];
}

export function PunchPanel({
  canCheckIn,
  canCheckOut,
  allowedMethods,
  biometricStatus,
  simulationMode,
  officeName,
  timezone,
}: {
  canCheckIn: boolean;
  canCheckOut: boolean;
  allowedMethods: Method[];
  biometricStatus: {
    face: { enrolled: boolean };
    fingerprint: { enrolled: boolean };
  };
  simulationMode: boolean;
  officeName: string | null;
  timezone: string;
}) {
  const router = useRouter();

  const [method, setMethod] = useState<Method>(allowedMethods[0] ?? "GPS");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<{ code: string; label: string }[]>([]);
  const [result, setResult] = useState<PunchResult | null>(null);
  const [net, setNet] = useState<NetworkState | null>(null);
  const [netLoading, setNetLoading] = useState(true);

  /* ---------------- VPN gate ---------------- */

  const checkNetwork = useCallback(async () => {
    setNetLoading(true);
    try {
      const res = await fetch("/api/attendance/network-check", {
        credentials: "same-origin",
      });
      const data = await res.json();
      setNet(data.data ?? data);
    } catch {
      setNet(null);
    } finally {
      setNetLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkNetwork();
  }, [checkNetwork]);

  /* ---------------- punch ---------------- */

  async function punch(action: "CHECK_IN" | "CHECK_OUT") {
    setError(null);
    setReasons([]);
    setResult(null);

    try {
      // 1. Biometric theatre (simulated) — a visible, timed scan phase.
      if (method !== "GPS") {
        setPhase("scanning");
        await new Promise((r) => setTimeout(r, 2200));
      }

      // 2. Server challenge — single use, 2-minute life.
      setPhase("locating");
      const { nonce } = await postJson<{ nonce: string }>(
        "/api/attendance/nonce",
        { purpose: action },
      );

      // 3. GPS + integrity signals.
      const signals = await collectSignals(nonce);

      // 4. Submit.
      setPhase("submitting");
      const data = await postJson<PunchResult>("/api/attendance/punch", {
        action,
        method,
        signals,
      });

      setResult(data);
      setPhase("done");
      router.refresh();
    } catch (err) {
      const payload = (err as { payload?: Record<string, unknown> }).payload;
      if (payload?.reasons) {
        setReasons(payload.reasons as { code: string; label: string }[]);
      }
      setError(
        err instanceof GeolocationFailure
          ? err.message
          : ((err as Error).message ?? "Attendance could not be recorded."),
      );
      setPhase("error");
    }
  }

  const busy =
    phase === "scanning" || phase === "locating" || phase === "submitting";
  const hardBlocked = net?.blocked === true;

  const methodReady =
    method === "GPS" ||
    (method === "FACE" && biometricStatus.face.enrolled) ||
    (method === "FINGERPRINT" && biometricStatus.fingerprint.enrolled);

  return (
    <div className="space-y-5">
      {/* ---------- network status ---------- */}
      <div
        className={cn(
          "rounded-xl border px-4 py-3",
          netLoading
            ? "border-slate-200 bg-slate-50"
            : hardBlocked
              ? "border-red-300 bg-red-50"
              : net?.warning
                ? "border-amber-300 bg-amber-50"
                : "border-emerald-200 bg-emerald-50",
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "relative mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
              netLoading
                ? "bg-slate-400"
                : hardBlocked
                  ? "bg-red-500"
                  : net?.warning
                    ? "bg-amber-500"
                    : "bg-emerald-500 pulse-ring text-emerald-500",
            )}
          />
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-sm font-semibold",
                netLoading
                  ? "text-slate-700"
                  : hardBlocked
                    ? "text-red-800"
                    : net?.warning
                      ? "text-amber-900"
                      : "text-emerald-800",
              )}
            >
              {netLoading
                ? "Checking your network…"
                : hardBlocked
                  ? "VPN detected — attendance is blocked"
                  : net?.warning
                    ? "Network warning"
                    : "Network verified"}
            </p>

            {net?.reasons?.length ? (
              <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
                {net.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}

            {net && !netLoading ? (
              <p className="mt-1 text-xs text-slate-500">
                {net.network.isLocal
                  ? "Local network — origin cannot be geolocated in a local deployment."
                  : [net.network.city, net.network.country, net.network.isp]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
            ) : null}

            {hardBlocked ? (
              <button
                onClick={checkNetwork}
                className="btn-outline btn-sm mt-2.5"
              >
                I have turned off my VPN — re-check
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---------- method selector ---------- */}
      <div>
        <p className="label">Verification method</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {allowedMethods.map((m) => {
            const enrolled =
              m === "GPS" ||
              (m === "FACE" && biometricStatus.face.enrolled) ||
              (m === "FINGERPRINT" && biometricStatus.fingerprint.enrolled);

            return (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                disabled={busy}
                className={cn(
                  "rounded-xl border-2 px-4 py-3 text-left transition",
                  method === m
                    ? "border-brand-500 bg-brand-50"
                    : "border-slate-200 bg-white hover:border-slate-300",
                  busy && "opacity-60",
                )}
              >
                <span className="block text-sm font-semibold text-slate-900">
                  {m === "GPS"
                    ? "Location only"
                    : m === "FACE"
                      ? "Face recognition"
                      : "Fingerprint"}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {m === "GPS"
                    ? "Geofence + integrity"
                    : enrolled
                      ? "Enrolled"
                      : "Not enrolled"}
                </span>
              </button>
            );
          })}
        </div>

        {simulationMode && method !== "GPS" ? (
          <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            <SimulatedBadge />
            <p className="text-xs text-amber-900">
              Demo mode. No camera or fingerprint sensor is used — the scan is
              synthetic and the record is permanently marked as simulated.
            </p>
          </div>
        ) : null}

        {!methodReady ? (
          <p className="mt-2 text-sm text-amber-700">
            You have not enrolled this method yet. Enrol it on the Profile &
            security page first.
          </p>
        ) : null}
      </div>

      {/* ---------- scanner ---------- */}
      {method !== "GPS" ? (
        <Scanner kind={method} active={phase === "scanning"} />
      ) : null}

      {/* ---------- actions ---------- */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => punch("CHECK_IN")}
          disabled={!canCheckIn || busy || hardBlocked || !methodReady}
          className="btn-primary flex-1 py-3"
        >
          {phase === "scanning"
            ? "Scanning…"
            : phase === "locating"
              ? "Getting location…"
              : phase === "submitting"
                ? "Recording…"
                : "Check in"}
        </button>
        <button
          onClick={() => punch("CHECK_OUT")}
          disabled={!canCheckOut || busy || hardBlocked || !methodReady}
          className="btn-navy flex-1 py-3"
        >
          Check out
        </button>
      </div>

      {phase === "locating" ? (
        <p className="text-center text-sm text-slate-500">
          Acquiring a fresh GPS fix. Keep this tab open.
        </p>
      ) : null}

      {/* ---------- error ---------- */}
      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">{error}</p>
          {reasons.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
              {reasons.map((r) => (
                <li key={r.code}>{r.label}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ---------- success ---------- */}
      {result ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-emerald-900">
              {result.action === "CHECK_IN" ? "Checked in" : "Checked out"} at{" "}
              {formatTime(
                result.action === "CHECK_IN"
                  ? result.checkInAt
                  : result.checkOutAt,
                timezone,
              )}
            </p>
            {result.simulated ? <SimulatedBadge /> : null}
          </div>

          <dl className="grid gap-x-6 gap-y-1 text-sm text-emerald-900 sm:grid-cols-2">
            <Row label="Office" value={result.office ?? officeName ?? "—"} />
            <Row
              label="Distance"
              value={
                result.distanceMeters === null
                  ? "—"
                  : `${Math.round(result.distanceMeters)} m from centre`
              }
            />
            <Row label="GPS accuracy" value={`±${Math.round(result.accuracy)} m`} />
            <Row label="Risk score" value={String(result.riskScore)} />
          </dl>

          {result.warnings.length ? (
            <div className="mt-3 border-t border-emerald-200 pt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Noted for review
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-emerald-800">
                {result.warnings.map((w) => (
                  <li key={w.code}>{w.label}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="text-xs font-medium opacity-70">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Simulated scanners                                                 */
/* ------------------------------------------------------------------ */

function Scanner({ kind, active }: { kind: "FACE" | "FINGERPRINT"; active: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-slate-900 py-8">
      <div className="relative h-40 w-40">
        {kind === "FACE" ? <FaceGraphic active={active} /> : <PrintGraphic active={active} />}

        {active ? (
          <div
            className="pointer-events-none absolute inset-x-0 h-0.5 bg-brand-400 shadow-[0_0_12px_2px_rgba(61,167,109,0.9)]"
            style={{ animation: "scanline 1.6s ease-in-out infinite" }}
          />
        ) : null}
      </div>

      <p className="mt-4 text-sm font-medium text-slate-300">
        {active
          ? kind === "FACE"
            ? "Analysing facial geometry…"
            : "Reading ridge pattern…"
          : kind === "FACE"
            ? "Face scanner ready"
            : "Fingerprint scanner ready"}
      </p>

      <style>{`
        @keyframes scanline {
          0%   { top: 4%;  opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { top: 96%; opacity: 0; }
        }
        @keyframes traceIn {
          from { stroke-dashoffset: 400; }
          to   { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}

function FaceGraphic({ active }: { active: boolean }) {
  const stroke = active ? "#3da76d" : "#475569";
  return (
    <svg viewBox="0 0 160 160" className="h-full w-full">
      {[
        "M14 46V22a8 8 0 0 1 8-8h24",
        "M114 14h24a8 8 0 0 1 8 8v24",
        "M146 114v24a8 8 0 0 1-8 8h-24",
        "M46 146H22a8 8 0 0 1-8-8v-24",
      ].map((d) => (
        <path
          key={d}
          d={d}
          stroke={active ? "#3da76d" : "#64748b"}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
      ))}

      <ellipse cx="80" cy="78" rx="34" ry="42" stroke={stroke} strokeWidth="2" fill="none" />
      <circle cx="68" cy="70" r="3.5" fill={stroke} />
      <circle cx="92" cy="70" r="3.5" fill={stroke} />
      <path d="M80 76v12" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      <path d="M68 98c4 4 20 4 24 0" stroke={stroke} strokeWidth="2" fill="none" strokeLinecap="round" />

      {active
        ? [
            "M46 62h68", "M46 78h68", "M46 94h68",
            "M62 40v76", "M80 36v84", "M98 40v76",
          ].map((d) => (
            <path key={d} d={d} stroke="#3da76d" strokeWidth="0.6" opacity="0.35" />
          ))
        : null}
    </svg>
  );
}

function PrintGraphic({ active }: { active: boolean }) {
  const stroke = active ? "#3da76d" : "#64748b";
  const arcs = [
    "M80 132c0-42 0-62 0-62",
    "M62 130c-4-38 2-58 18-58s22 20 18 58",
    "M46 128c-6-48 6-72 34-72s40 24 34 72",
    "M32 124c-6-56 12-84 48-84s54 28 48 84",
  ];
  return (
    <svg viewBox="0 0 160 160" className="h-full w-full">
      {arcs.map((d, i) => (
        <path
          key={d}
          d={d}
          stroke={stroke}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={active ? 400 : undefined}
          style={
            active
              ? {
                  animation: `traceIn 1.4s ease-out ${i * 0.12}s both`,
                }
              : undefined
          }
        />
      ))}
    </svg>
  );
}
