import "server-only";

import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import {
  localDateString,
  toDateOnly,
  minutesSinceLocalMidnight,
  parseClock,
  isoWeekday,
} from "@/lib/geo";
import type {
  AttendanceStatus,
  Shift,
  Attendance,
} from "@/generated/prisma/client";

export interface TodayContext {
  date: string;
  dateOnly: Date;
  timezone: string;
  attendance: Attendance | null;
  shift: Shift | null;
  isWorkingDay: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  canCheckIn: boolean;
  canCheckOut: boolean;
}

/**
 * Everything the punch screen needs to decide what to offer the employee.
 * Timezone-aware: "today" is the calendar day in the office's timezone, not
 * the server's.
 */
export async function getTodayContext(userId: string): Promise<TodayContext> {
  const settings = await getSettings();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { shift: true, office: true },
  });

  const timezone = user.office?.timezone ?? settings.timezone;
  const now = new Date();
  const date = localDateString(now, timezone);
  const dateOnly = toDateOnly(date);

  const [attendance, holiday] = await Promise.all([
    prisma.attendance.findUnique({
      where: { userId_date: { userId, date: dateOnly } },
    }),
    prisma.holiday.findUnique({ where: { date: dateOnly } }),
  ]);

  const weekday = isoWeekday(now, timezone);
  const workingDays = user.shift?.workingDays ?? [7, 1, 2, 3, 4];
  const isWorkingDay = workingDays.includes(weekday);

  return {
    date,
    dateOnly,
    timezone,
    attendance,
    shift: user.shift,
    isWorkingDay,
    isHoliday: Boolean(holiday),
    holidayName: holiday?.name ?? null,
    canCheckIn: !attendance?.checkInAt,
    canCheckOut: Boolean(attendance?.checkInAt) && !attendance?.checkOutAt,
  };
}

/**
 * Derives attendance status from arrival time against the assigned shift.
 * Grace minutes are honoured, so an employee arriving inside the grace window
 * is PRESENT rather than LATE.
 */
export function classifyArrival(
  checkInAt: Date,
  shift: Shift | null,
  timezone: string,
): { status: AttendanceStatus; lateMinutes: number } {
  if (!shift) return { status: "PRESENT", lateMinutes: 0 };

  const arrived = minutesSinceLocalMidnight(checkInAt, timezone);
  const expected = parseClock(shift.startTime);
  const late = arrived - (expected + shift.graceMinutes);

  if (late <= 0) return { status: "PRESENT", lateMinutes: 0 };

  const lateMinutes = arrived - expected;
  if (lateMinutes >= shift.halfDayAfterMinutes) {
    return { status: "HALF_DAY", lateMinutes };
  }
  return { status: "LATE", lateMinutes };
}

export function classifyDeparture(
  checkInAt: Date,
  checkOutAt: Date,
  shift: Shift | null,
  timezone: string,
): { workedMinutes: number; earlyLeaveMinutes: number; overtimeMinutes: number } {
  const workedMinutes = Math.max(
    0,
    Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60_000),
  );

  if (!shift) {
    return { workedMinutes, earlyLeaveMinutes: 0, overtimeMinutes: 0 };
  }

  const left = minutesSinceLocalMidnight(checkOutAt, timezone);
  let expectedEnd = parseClock(shift.endTime);
  // Overnight shift (e.g. 22:00 -> 06:00)
  if (expectedEnd < parseClock(shift.startTime)) expectedEnd += 1440;

  const earlyLeaveMinutes = Math.max(0, expectedEnd - left);
  const overtimeMinutes = Math.max(0, workedMinutes - shift.minWorkMinutes);

  return { workedMinutes, earlyLeaveMinutes, overtimeMinutes };
}

/** Aggregate figures for a calendar month, used by history and reports. */
export async function getMonthSummary(
  userId: string,
  year: number,
  month: number,
) {
  const start = toDateOnly(
    `${year}-${String(month).padStart(2, "0")}-01`,
  );
  const end = new Date(Date.UTC(year, month, 1));

  const rows = await prisma.attendance.findMany({
    where: { userId, date: { gte: start, lt: end } },
    orderBy: { date: "asc" },
    include: { office: { select: { name: true } } },
  });

  const summary = {
    present: 0,
    late: 0,
    halfDay: 0,
    absent: 0,
    onLeave: 0,
    flagged: 0,
    totalWorkedMinutes: 0,
    totalLateMinutes: 0,
  };

  for (const r of rows) {
    if (r.status === "PRESENT") summary.present++;
    else if (r.status === "LATE") summary.late++;
    else if (r.status === "HALF_DAY") summary.halfDay++;
    else if (r.status === "ABSENT") summary.absent++;
    else if (r.status === "ON_LEAVE") summary.onLeave++;
    if (r.flagged) summary.flagged++;
    summary.totalWorkedMinutes += r.workedMinutes;
    summary.totalLateMinutes += r.lateMinutes;
  }

  return { rows, summary };
}

export const STATUS_STYLES_MOVED =
  "See lib/status.ts — kept client-safe so UI components do not import Prisma.";
