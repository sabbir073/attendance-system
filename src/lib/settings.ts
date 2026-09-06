import "server-only";

import { prisma } from "@/lib/prisma";
import type { Setting } from "@/generated/prisma/client";

let cached: { at: number; value: Setting } | null = null;
const TTL_MS = 15_000;

export async function getSettings(force = false): Promise<Setting> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    return cached.value;
  }

  const value = await prisma.setting.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
  });

  cached = { at: Date.now(), value };
  return value;
}

export function invalidateSettings() {
  cached = null;
}
