"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson, computeDeviceFingerprint } from "@/lib/client-signals";
import { SimulatedBadge } from "@/components/ui";
import { cn } from "@/lib/utils";

interface Status {
  simulationMode: boolean;
  face: { enrolled: boolean; simulated: boolean };
  fingerprint: { enrolled: boolean; simulated: boolean };
}

export function BiometricEnrol({ initial }: { initial: Status }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function enrol(kind: "FACE" | "FINGERPRINT") {
    setBusy(kind);
    setMsg(null);
    try {
      // Visible capture phase — matches what real enrolment feels like.
      await new Promise((r) => setTimeout(r, 2400));
      const deviceFingerprint = await computeDeviceFingerprint().catch(
        () => undefined,
      );
      const res = await postJson<{ message: string; simulated: boolean }>(
        "/api/biometric/enrol",
        { kind, deviceFingerprint },
      );
      setStatus((s) => ({
        ...s,
        [kind === "FACE" ? "face" : "fingerprint"]: {
          enrolled: true,
          simulated: res.simulated,
        },
      }));
      setMsg({ tone: "ok", text: res.message });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function test(kind: "FACE" | "FINGERPRINT") {
    setBusy(`test-${kind}`);
    setMsg(null);
    try {
      await new Promise((r) => setTimeout(r, 1800));
      const res = await postJson<{
        matched: boolean;
        score: number;
        message: string;
      }>("/api/biometric/verify", { kind });
      setMsg({
        tone: res.matched ? "ok" : "err",
        text: `${res.message} (score ${(res.score * 100).toFixed(1)}%)`,
      });
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {status.simulationMode ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <SimulatedBadge />
          <p className="text-xs text-amber-900">
            Simulation mode is on. Enrolment and verification produce synthetic
            results — no camera or fingerprint sensor is accessed. Every record
            created this way is permanently marked as simulated. An
            administrator can switch this off in Settings to activate real
            capture.
          </p>
        </div>
      ) : null}

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

      <div className="grid gap-4 sm:grid-cols-2">
        <MethodCard
          title="Face recognition"
          enrolled={status.face.enrolled}
          simulated={status.face.simulated}
          scanning={busy === "FACE"}
          testing={busy === "test-FACE"}
          onEnrol={() => enrol("FACE")}
          onTest={() => test("FACE")}
          disabled={Boolean(busy)}
        />
        <MethodCard
          title="Fingerprint"
          enrolled={status.fingerprint.enrolled}
          simulated={status.fingerprint.simulated}
          scanning={busy === "FINGERPRINT"}
          testing={busy === "test-FINGERPRINT"}
          onEnrol={() => enrol("FINGERPRINT")}
          onTest={() => test("FINGERPRINT")}
          disabled={Boolean(busy)}
        />
      </div>
    </div>
  );
}

function MethodCard({
  title,
  enrolled,
  simulated,
  scanning,
  testing,
  onEnrol,
  onTest,
  disabled,
}: {
  title: string;
  enrolled: boolean;
  simulated: boolean;
  scanning: boolean;
  testing: boolean;
  onEnrol: () => void;
  onTest: () => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">{title}</p>
        {enrolled ? (
          <span className="badge bg-emerald-100 text-emerald-800">Enrolled</span>
        ) : (
          <span className="badge bg-slate-100 text-slate-600">Not enrolled</span>
        )}
      </div>

      <div className="mb-3 flex h-24 items-center justify-center rounded-lg bg-slate-900">
        <div className="relative h-16 w-16">
          <svg viewBox="0 0 64 64" className="h-full w-full">
            <circle
              cx="32"
              cy="32"
              r="26"
              fill="none"
              stroke={scanning ? "#3da76d" : enrolled ? "#3da76d" : "#475569"}
              strokeWidth="3"
              strokeDasharray={scanning ? "10 6" : undefined}
              style={
                scanning
                  ? {
                      transformOrigin: "center",
                      animation: "spin 1.1s linear infinite",
                    }
                  : undefined
              }
            />
            {enrolled && !scanning ? (
              <path
                d="m22 33 7 7 14-15"
                fill="none"
                stroke="#3da76d"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </svg>
        </div>
      </div>

      {simulated && enrolled ? <SimulatedBadge className="mb-3" /> : null}

      <div className="flex gap-2">
        <button
          onClick={onEnrol}
          disabled={disabled}
          className="btn-primary btn-sm flex-1"
        >
          {scanning ? "Capturing…" : enrolled ? "Re-enrol" : "Enrol"}
        </button>
        {enrolled ? (
          <button
            onClick={onTest}
            disabled={disabled}
            className="btn-outline btn-sm flex-1"
          >
            {testing ? "Testing…" : "Test"}
          </button>
        ) : null}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
