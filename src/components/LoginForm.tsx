"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { computeDeviceFingerprint } from "@/lib/client-signals";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const deviceFingerprint = await computeDeviceFingerprint().catch(
        () => undefined,
      );

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          totp: totp || undefined,
          deviceFingerprint,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.ok === false) {
        if (data.requires2fa) setNeeds2fa(true);
        setError(data.error ?? "Sign-in failed.");
        return;
      }

      router.replace(data.data.redirect);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="email">
          Official email
        </label>
        <input
          id="email"
          type="email"
          className="input"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@desco.gov.bd"
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="input"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••"
        />
      </div>

      {needs2fa ? (
        <div>
          <label className="label" htmlFor="totp">
            Authenticator code
          </label>
          <input
            id="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="input tracking-[0.4em]"
            maxLength={6}
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            Six-digit code from your authenticator app.
          </p>
        </div>
      ) : null}

      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? "Verifying…" : "Sign in"}
      </button>
    </form>
  );
}
