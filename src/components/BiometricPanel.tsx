"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson, computeDeviceFingerprint } from "@/lib/client-signals";
import { SimulatedBadge } from "@/components/ui";
import { cn } from "@/lib/utils";

type Kind = "FACE" | "FINGERPRINT";

interface Status {
  enrolled: boolean;
  simulated: boolean;
  enrolledAt: string | null;
}

export function BiometricPanel({
  simulationMode,
  face,
  fingerprint,
}: {
  simulationMode: boolean;
  face: Status;
  fingerprint: Status;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <BiometricCard kind="FACE" status={face} simulationMode={simulationMode} />
      <BiometricCard
        kind="FINGERPRINT"
        status={fingerprint}
        simulationMode={simulationMode}
      />
    </div>
  );
}

function BiometricCard({
  kind,
  status,
  simulationMode,
}: {
  kind: Kind;
  status: Status;
  simulationMode: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"enrol" | "test" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const title = kind === "FACE" ? "Face recognition" : "Fingerprint";

  async function enrol() {
    setBusy("enrol");
    setMessage(null);
    try {
      const deviceFingerprint = await computeDeviceFingerprint().catch(
        () => undefined,
      );
      // Visible capture phase so the enrolment reads as a real ceremony.
      await new Promise((r) => setTimeout(r, 1800));
      const res = await postJson<{ message: string }>("/api/biometric/enrol", {
        kind,
        deviceFingerprint,
      });
      setTone("good");
      setMessage(res.message);
      router.refresh();
    } catch (err) {
      setTone("bad");
      setMessage((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMessage(null);
    try {
      await new Promise((r) => setTimeout(r, 1600));
      const res = await postJson<{
        matched: boolean;
        score: number;
        message: string;
      }>("/api/biometric/verify", { kind });
      setTone(res.matched ? "good" : "bad");
      setMessage(
        res.matched
          ? `${res.message} Match score ${(res.score * 100).toFixed(1)}%.`
          : res.message,
      );
    } catch (err) {
      setTone("bad");
      setMessage((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const scanning = busy !== null;

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{title}</p>
          <p className="muted mt-0.5">
            {status.enrolled
              ? `Enrolled${
                  status.enrolledAt
                    ? ` on ${new Date(status.enrolledAt).toLocaleDateString("en-GB")}`
                    : ""
                }`
              : "Not enrolled"}
          </p>
        </div>
        {status.enrolled && status.simulated ? <SimulatedBadge /> : null}
      </div>

      <div className="my-4 flex justify-center rounded-xl bg-slate-900 py-6">
        <div className="relative h-28 w-28">
          {kind === "FACE" ? (
            <FaceMark active={scanning} />
          ) : (
            <PrintMark active={scanning} />
          )}
          {scanning ? (
            <div
              className="pointer-events-none absolute inset-x-0 h-0.5 bg-brand-400 shadow-[0_0_10px_2px_rgba(61,167,109,0.9)]"
              style={{ animation: "bioScan 1.5s ease-in-out infinite" }}
            />
          ) : null}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={enrol}
          disabled={scanning}
          className="btn-primary btn-sm flex-1"
        >
          {busy === "enrol"
            ? "Capturing…"
            : status.enrolled
              ? "Re-enrol"
              : "Enrol"}
        </button>
        <button
          onClick={test}
          disabled={scanning || !status.enrolled}
          className="btn-outline btn-sm flex-1"
        >
          {busy === "test" ? "Verifying…" : "Test"}
        </button>
      </div>

      {message ? (
        <p
          className={cn(
            "mt-3 rounded-lg px-3 py-2 text-xs",
            tone === "good"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-700",
          )}
        >
          {message}
        </p>
      ) : null}

      {simulationMode ? (
        <p className="mt-3 text-xs text-slate-500">
          Simulation mode is on. No {kind === "FACE" ? "camera" : "sensor"} is
          accessed and the stored record is marked simulated.
        </p>
      ) : null}

      <style>{`
        @keyframes bioScan {
          0%   { top: 6%;  opacity: 0; }
          20%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { top: 94%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function FaceMark({ active }: { active: boolean }) {
  const c = active ? "#3da76d" : "#64748b";
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full">
      <ellipse cx="60" cy="58" rx="26" ry="32" stroke={c} strokeWidth="2" fill="none" />
      <circle cx="51" cy="52" r="2.8" fill={c} />
      <circle cx="69" cy="52" r="2.8" fill={c} />
      <path d="M60 57v9" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <path d="M51 74c3 3 15 3 18 0" stroke={c} strokeWidth="2" fill="none" strokeLinecap="round" />
      {["M12 34V16h18", "M90 16h18v18", "M108 86v18H90", "M30 104H12V86"].map((d) => (
        <path key={d} d={d} stroke={c} strokeWidth="3" fill="none" strokeLinecap="round" />
      ))}
    </svg>
  );
}

function PrintMark({ active }: { active: boolean }) {
  const c = active ? "#3da76d" : "#64748b";
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full">
      {[
        "M60 100V56",
        "M46 99c-3-29 1-44 14-44s17 15 14 44",
        "M33 97c-5-36 5-54 27-54s32 18 27 54",
        "M22 94c-5-42 9-63 38-63s43 21 38 63",
      ].map((d) => (
        <path
          key={d}
          d={d}
          stroke={c}
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
