/**
 * Geospatial + calendar helpers.
 * Pure functions — safe to import from both server and client code.
 */

const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two WGS-84 points. */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    // 0,0 ("Null Island") is the classic signature of a stubbed GPS provider.
    !(lat === 0 && lng === 0)
  );
}

/** km/h implied by moving between two points in a given number of ms. */
export function impliedSpeedKmh(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  elapsedMs: number,
): number {
  if (elapsedMs <= 0) return Number.POSITIVE_INFINITY;
  const meters = haversineMeters(lat1, lng1, lat2, lng2);
  const hours = elapsedMs / 3_600_000;
  return meters / 1000 / hours;
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/* ------------------------------------------------------------------ */
/*  Timezone-aware calendar helpers                                    */
/* ------------------------------------------------------------------ */

/**
 * The calendar date (YYYY-MM-DD) that a given instant falls on, in a
 * specific IANA timezone. Uses Intl so no tz database bundling is required.
 */
export function localDateString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A UTC-midnight Date usable as a Postgres `date` column value. */
export function toDateOnly(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

export function localTimeString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Minutes elapsed since local midnight, in the given timezone. */
export function minutesSinceLocalMidnight(date: Date, timeZone: string): number {
  const [h, m] = localTimeString(date, timeZone).split(":").map(Number);
  return h * 60 + m;
}

/** "09:30" -> 570 */
export function parseClock(value: string): number {
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/** 570 -> "09:30" */
export function formatClock(minutes: number): string {
  const safe = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatMinutesAsHours(minutes: number): string {
  if (!minutes || minutes <= 0) return "0h 0m";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

/** ISO weekday, 1 = Monday … 7 = Sunday, in a given timezone. */
export function isoWeekday(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[name] ?? 1;
}

export function isoWeekdayFromDateString(dateString: string): number {
  const d = new Date(`${dateString}T12:00:00.000Z`);
  const js = d.getUTCDay(); // 0 = Sunday
  return js === 0 ? 7 : js;
}

/** All YYYY-MM-DD dates in a given month. `month` is 1-based. */
export function daysInMonth(year: number, month: number): string[] {
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    return `${year}-${String(month).padStart(2, "0")}-${day}`;
  });
}
