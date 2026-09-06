"use client";

import { useState } from "react";
import { postJson } from "@/lib/client-signals";
import { cn } from "@/lib/utils";

export function PasswordForm({ minLength }: { minLength: number }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const checks = [
    { ok: next.length >= minLength, label: `At least ${minLength} characters` },
    { ok: /[a-z]/.test(next) && /[A-Z]/.test(next), label: "Upper and lower case" },
    { ok: /[0-9]/.test(next), label: "A digit" },
    { ok: /[^A-Za-z0-9]/.test(next), label: "A special character" },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (next !== confirm) {
      setTone("bad");
      setMessage("The new passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      await postJson("/api/auth/password", { current, next });
      setTone("good");
      setMessage("Password changed. All other sessions have been signed out.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setTone("bad");
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="current">Current password</label>
        <input
          id="current"
          type="password"
          className="input"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="next">New password</label>
        <input
          id="next"
          type="password"
          className="input"
          autoComplete="new-password"
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {checks.map((c) => (
            <li
              key={c.label}
              className={cn(
                "flex items-center gap-1.5 text-xs",
                c.ok ? "text-emerald-700" : "text-slate-500",
              )}
            >
              <span
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] text-white",
                  c.ok ? "bg-emerald-500" : "bg-slate-300",
                )}
              >
                ✓
              </span>
              {c.label}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <label className="label" htmlFor="confirm">Confirm new password</label>
        <input
          id="confirm"
          type="password"
          className="input"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      {message ? (
        <p
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            tone === "good"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-700",
          )}
        >
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || !checks.every((c) => c.ok)}
        className="btn-primary"
      >
        {busy ? "Updating…" : "Change password"}
      </button>
    </form>
  );
}
