import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Offices & geofences" };

export default async function OfficesPage() {
  await requireAdmin();

  const offices = await prisma.office.findMany({
    include: { _count: { select: { users: true, attendance: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Offices &amp; geofences</h1>
        <p className="muted mt-1">
          An employee must be physically inside the radius of their assigned
          office for a punch to be accepted.
        </p>
      </div>

      {offices.length === 0 ? (
        <EmptyState title="No offices configured" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {offices.map((o) => (
            <div key={o.id} className="card card-pad">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{o.name}</p>
                  <p className="muted mt-0.5">{o.address}</p>
                </div>
                <span
                  className={
                    o.isActive
                      ? "badge bg-emerald-100 text-emerald-800"
                      : "badge bg-slate-100 text-slate-600"
                  }
                >
                  {o.isActive ? "Active" : "Inactive"}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-[var(--line)] pt-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-slate-500">Code</dt>
                  <dd className="font-semibold">{o.code}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Radius</dt>
                  <dd className="font-semibold tabular-nums">
                    {o.radiusMeters} m
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Staff</dt>
                  <dd className="font-semibold tabular-nums">{o._count.users}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Punches</dt>
                  <dd className="font-semibold tabular-nums">
                    {o._count.attendance}
                  </dd>
                </div>
              </dl>

              <p className="mt-3 font-mono text-xs text-slate-500">
                {o.latitude.toFixed(6)}, {o.longitude.toFixed(6)} · {o.timezone}
              </p>

              <a
                href={`https://www.openstreetmap.org/?mlat=${o.latitude}&mlon=${o.longitude}#map=17/${o.latitude}/${o.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline btn-sm mt-3"
              >
                View on map
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
