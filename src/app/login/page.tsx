import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdminRole } from "@/lib/session";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(isAdminRole(user.role) ? "/admin" : "/dashboard");

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-navy-600 p-12 text-white lg:flex">
        <div
          className="absolute inset-0 opacity-15"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, #0B7A3B 0%, transparent 45%), radial-gradient(circle at 80% 70%, #F2A104 0%, transparent 40%)",
          }}
        />
        <div className="relative">
          <div className="inline-flex rounded-xl bg-white px-4 py-3">
            <Image
              src="/logo.svg"
              alt="DESCO"
              width={180}
              height={54}
              priority
              style={{ width: 180, height: "auto" }}
            />
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-tight">
            Attendance you can actually verify
          </h1>
          <p className="mt-4 text-navy-100">
            Every punch is bound to a geofenced office, a registered device and
            a verified network, then scored and logged — so the record can be
            defended rather than merely trusted.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-navy-100">
            {[
              "GPS geofence with anti-spoofing checks",
              "VPN, proxy and datacenter detection",
              "Fingerprint and face verification",
              "Full integrity audit trail",
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path
                      d="m5 13 4 4L19 7"
                      stroke="white"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-navy-200">
          © {new Date().getFullYear()} Dhaka Electric Supply Company Limited
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Image
              src="/logo.svg"
              alt="DESCO"
              width={160}
              height={48}
              priority
              style={{ width: 160, height: "auto" }}
            />
          </div>

          <h2 className="text-2xl font-bold text-slate-900">Sign in</h2>
          <p className="mt-1.5 mb-7 text-sm text-slate-500">
            Use your official DESCO credentials.
          </p>

          <LoginForm />

          <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              Demo accounts
            </p>
            <dl className="space-y-1.5 text-xs text-slate-600">
              <div>
                <dt className="font-semibold">Admin</dt>
                <dd className="font-mono">admin@desco.gov.bd · Admin@Desco2026</dd>
              </div>
              <div>
                <dt className="font-semibold">Employee</dt>
                <dd className="font-mono">mahedi@desco.gov.bd · Employee@2026</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
