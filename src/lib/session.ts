import "server-only";

import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/client";

export const SESSION_COOKIE = "desco_session";
export const CSRF_COOKIE = "desco_csrf";

const SECRET = process.env.SESSION_SECRET ?? "";

if (SECRET.length < 32 && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be at least 32 characters in production.");
}

/* ------------------------------------------------------------------ */
/*  Token helpers                                                      */
/* ------------------------------------------------------------------ */

export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * Keyed hash. The database never holds a usable session token — only its
 * HMAC. An attacker with a DB dump still cannot mint a valid cookie.
 */
export function hashToken(token: string): string {
  return crypto.createHmac("sha256", SECRET).update(token).digest("hex");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ------------------------------------------------------------------ */
/*  Request metadata                                                   */
/* ------------------------------------------------------------------ */

const PRIVATE_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

export function isPrivateIp(ip: string | null | undefined): boolean {
  if (!ip) return true;
  const clean = ip.replace(/^::ffff:/, "");
  if (clean === "localhost" || clean === "unknown") return true;
  return PRIVATE_RANGES.some((r) => r.test(clean));
}

export async function getRequestMeta() {
  const h = await headers();
  const trustProxy = process.env.TRUST_PROXY !== "false";

  let ip: string | null = null;
  if (trustProxy) {
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) ip = forwarded.split(",")[0]?.trim() ?? null;
    if (!ip) ip = h.get("x-real-ip");
    if (!ip) ip = h.get("cf-connecting-ip");
  }

  return {
    ip: ip ? ip.replace(/^::ffff:/, "") : null,
    userAgent: h.get("user-agent"),
    origin: h.get("origin"),
    host: h.get("host"),
  };
}

/* ------------------------------------------------------------------ */
/*  Session lifecycle                                                  */
/* ------------------------------------------------------------------ */

/**
 * Whether to mark cookies `Secure`.
 *
 * Keying this off NODE_ENV is the usual shortcut and it is wrong here: the
 * production image is routinely reached over plain HTTP, either on
 * http://localhost:3000 or on a LAN address from a phone during GPS testing.
 * A `Secure` cookie is silently discarded on those origins, so login appears
 * to succeed and then every subsequent request is anonymous.
 *
 * So: trust the actual transport. `x-forwarded-proto` when behind a reverse
 * proxy, overridable with COOKIE_SECURE for deployments that terminate TLS
 * somewhere this process cannot observe.
 */
async function useSecureCookies(): Promise<boolean> {
  const override = process.env.COOKIE_SECURE;
  if (override === "true") return true;
  if (override === "false") return false;

  const h = await headers();
  return (h.get("x-forwarded-proto") ?? "").split(",")[0]?.trim() === "https";
}

export interface CreateSessionInput {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  ttlHours?: number;
}

export async function createSession(input: CreateSessionInput) {
  const token = generateToken(32);
  const csrf = generateToken(24);
  const ttlHours = input.ttlHours ?? 12;
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

  await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(token),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      deviceFingerprint: input.deviceFingerprint ?? null,
      expiresAt,
    },
  });

  const jar = await cookies();
  const secure = await useSecureCookies();

  // Session cookie: httpOnly so JS (and XSS payloads) cannot read it.
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  // CSRF cookie: readable by JS on purpose (double-submit pattern).
  jar.set(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });

  return { token, csrf, expiresAt };
}

export async function destroySession(reason = "logout") {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

export async function revokeAllSessions(userId: string, reason: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/* ------------------------------------------------------------------ */
/*  Current user                                                       */
/* ------------------------------------------------------------------ */

export type SessionUser = {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  avatarUrl: string | null;
  designation: string | null;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  officeId: string | null;
  shiftId: string | null;
  departmentId: string | null;
  sessionId: string;
};

/**
 * Cached per-request so multiple server components share one DB round trip.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  if (session.user.status !== "ACTIVE") return null;

  // Sliding "last seen" — cheap, throttled to once a minute.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      })
      .catch(() => undefined);
  }

  const u = session.user;
  return {
    id: u.id,
    employeeCode: u.employeeCode,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    avatarUrl: u.avatarUrl,
    designation: u.designation,
    mustChangePassword: u.mustChangePassword,
    twoFactorEnabled: u.twoFactorEnabled,
    officeId: u.officeId,
    shiftId: u.shiftId,
    departmentId: u.departmentId,
    sessionId: session.id,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("UNAUTHENTICATED");
  return user;
}

const ADMIN_ROLES: Role[] = ["ADMIN", "SUPER_ADMIN", "HR"];

export function isAdminRole(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isAdminRole(user.role)) throw new AuthError("FORBIDDEN");
  return user;
}

export class AuthError extends Error {
  constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code);
    this.name = "AuthError";
  }
}

/* ------------------------------------------------------------------ */
/*  CSRF                                                               */
/* ------------------------------------------------------------------ */

/**
 * Double-submit cookie check plus a strict Origin check. Both must pass for
 * any state-changing request.
 */
export async function verifyCsrf(request: Request): Promise<boolean> {
  const jar = await cookies();
  const cookieToken = jar.get(CSRF_COOKIE)?.value;
  const headerToken = request.headers.get("x-csrf-token");

  if (!cookieToken || !headerToken) return false;
  if (!timingSafeEqual(cookieToken, headerToken)) return false;

  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("host");
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }

  return true;
}
