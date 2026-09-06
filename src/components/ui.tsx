import Image from "next/image";
import { cn } from "@/lib/utils";
import type { AttendanceStatus } from "@/generated/prisma/client";
import { STATUS_STYLES } from "@/lib/status";

export function Logo({
  size = 40,
  showText = true,
}: {
  size?: number;
  showText?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Image
        src="/logo.svg"
        alt="DESCO"
        width={size * 3.33}
        height={size}
        priority
        className="h-auto"
        style={{ width: size * 3.33, height: "auto" }}
      />
      {showText ? null : null}
    </div>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("card card-pad", className)}>{children}</div>;
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad" | "info";
}) {
  const tones = {
    default: "text-slate-900",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-red-600",
    info: "text-navy-500",
  };
  return (
    <div className="card card-pad">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={cn("mt-2 text-3xl font-bold tabular-nums", tones[tone])}>
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function StatusPill({ status }: { status: AttendanceStatus }) {
  const s = STATUS_STYLES[status];
  return <span className={cn("badge", s.className)}>{s.label}</span>;
}

/**
 * Shown wherever a biometric result came from simulation mode. Deliberately
 * loud: a demo punch must never be mistaken for real biometric verification.
 */
export function SimulatedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "badge border border-amber-300 bg-amber-50 text-amber-800",
        className,
      )}
      title="No camera or fingerprint sensor was used. This result is synthetic."
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      SIMULATED
    </span>
  );
}

export function RiskPill({ score }: { score: number }) {
  const tone =
    score >= 70
      ? "bg-red-100 text-red-700"
      : score >= 35
        ? "bg-amber-100 text-amber-800"
        : "bg-emerald-100 text-emerald-800";
  return <span className={cn("badge", tone)}>Risk {score}</span>;
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"
            stroke="#94a3b8"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className="font-semibold text-slate-800">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      ) : null}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "error" | "success";
  title?: string;
  children: React.ReactNode;
}) {
  const tones = {
    info: "border-navy-200 bg-navy-50 text-navy-800",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    error: "border-red-300 bg-red-50 text-red-800",
    success: "border-emerald-300 bg-emerald-50 text-emerald-800",
  };
  return (
    <div className={cn("rounded-xl border px-4 py-3 text-sm", tones[tone])}>
      {title ? <p className="mb-0.5 font-semibold">{title}</p> : null}
      <div className="[&_p]:mt-1">{children}</div>
    </div>
  );
}
