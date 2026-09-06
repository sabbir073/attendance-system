import { haversineMeters } from "@/lib/geo";

/**
 * Embedded OpenStreetMap view of a punch location.
 *
 * Deliberately dependency-free: an <iframe> against openstreetmap.org needs
 * no API key, no tile budget and no client-side map library. The office
 * centre and the punch position are both plotted so an administrator can see
 * the offset at a glance.
 */
export function PunchMap({
  lat,
  lng,
  accuracy,
  officeLat,
  officeLng,
  officeName,
  radiusMeters,
  label,
}: {
  lat: number;
  lng: number;
  accuracy: number | null;
  officeLat?: number | null;
  officeLng?: number | null;
  officeName?: string | null;
  radiusMeters?: number | null;
  label: string;
}) {
  const distance =
    officeLat != null && officeLng != null
      ? haversineMeters(lat, lng, officeLat, officeLng)
      : null;

  // Widen the viewport when the punch is far from the office so both points
  // stay visible instead of the map zooming into empty space.
  const spread = distance ? Math.min(0.25, Math.max(0.004, distance / 40000)) : 0.004;

  const minLng = Math.min(lng, officeLng ?? lng) - spread;
  const maxLng = Math.max(lng, officeLng ?? lng) + spread;
  const minLat = Math.min(lat, officeLat ?? lat) - spread;
  const maxLat = Math.max(lat, officeLat ?? lat) + spread;

  const bbox = `${minLng.toFixed(6)},${minLat.toFixed(6)},${maxLng.toFixed(6)},${maxLat.toFixed(6)}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)},${lng.toFixed(6)}`;

  const outside =
    distance != null && radiusMeters != null && distance > radiusMeters;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-slate-50 px-4 py-2.5">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        {distance != null ? (
          <span
            className={
              outside
                ? "badge bg-amber-100 text-amber-800"
                : "badge bg-emerald-100 text-emerald-800"
            }
          >
            {Math.round(distance)} m from {officeName ?? "office"}
            {outside ? " · outside radius" : " · inside radius"}
          </span>
        ) : null}
      </div>

      <iframe
        title={label}
        src={src}
        className="h-72 w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer"
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-2.5 text-xs">
        <span className="font-mono text-slate-600">
          {lat.toFixed(6)}, {lng.toFixed(6)}
          {accuracy != null ? ` · ±${Math.round(accuracy)} m` : ""}
        </span>
        <span className="flex gap-3">
          <a
            className="font-semibold text-navy-600 hover:underline"
            href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenStreetMap
          </a>
          <a
            className="font-semibold text-navy-600 hover:underline"
            href={`https://www.google.com/maps?q=${lat},${lng}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Maps
          </a>
        </span>
      </div>
    </div>
  );
}
