import type { AttendanceStatus } from "@/generated/prisma/client";

/**
 * Client-safe presentation map.
 *
 * Deliberately NOT in lib/attendance.ts: that module imports "server-only"
 * and Prisma, so importing it from a shared UI component drags the database
 * driver into the browser bundle and the build fails.
 */
export const STATUS_STYLES: Record<
  AttendanceStatus,
  { label: string; className: string }
> = {
  PRESENT: { label: "Present", className: "bg-emerald-100 text-emerald-800" },
  LATE: { label: "Late", className: "bg-amber-100 text-amber-800" },
  HALF_DAY: { label: "Half day", className: "bg-orange-100 text-orange-800" },
  ABSENT: { label: "Absent", className: "bg-red-100 text-red-700" },
  ON_LEAVE: { label: "On leave", className: "bg-violet-100 text-violet-800" },
  HOLIDAY: { label: "Holiday", className: "bg-sky-100 text-sky-800" },
  WEEKEND: { label: "Weekend", className: "bg-slate-100 text-slate-600" },
};
