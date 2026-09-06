import "server-only";

import { prisma } from "@/lib/prisma";

export interface AuditInput {
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/** Redacted before anything is written to the immutable audit trail. */
const SENSITIVE_KEYS = new Set([
  "passwordHash",
  "password",
  "twoFactorSecret",
  "tokenHash",
  "token",
  "csrf",
]);

function sanitise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(sanitise);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) ? "[redacted]" : sanitise(v);
    }
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function writeAudit(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        before: (sanitise(input.before) ?? undefined) as never,
        after: (sanitise(input.after) ?? undefined) as never,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch {
    // Auditing must never break the primary operation.
  }
}
