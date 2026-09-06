import "server-only";

import { prisma } from "@/lib/prisma";
import type { Setting } from "@/generated/prisma/client";

/**
 * Server-authoritative face matching.
 *
 * The browser runs @vladmandic/human to produce a 1024-dimension embedding
 * plus liveness and anti-spoof scores. It never decides whether the match
 * succeeded — it submits the embedding and this module compares it against
 * the enrolled templates. A tampered client can send a *forged embedding*,
 * but it cannot simply assert "verified", and a forged embedding still has to
 * survive the geofence, device-binding and nonce checks that wrap it.
 */

export const FACE_DIMENSIONS = 1024;

export interface FaceCapture {
  descriptor: number[];
  detectionScore: number;
  livenessScore: number | null;
  realScore: number | null;
  /** Which liveness challenge the client was asked to perform. */
  challenge?: string | null;
  challengePassed?: boolean;
  snapshot?: string | null;
}

export interface FaceMatchResult {
  matched: boolean;
  score: number;
  templateId: string | null;
  reasons: string[];
  liveness: number | null;
  realScore: number | null;
}

/* ------------------------------------------------------------------ */
/*  Vector maths                                                       */
/* ------------------------------------------------------------------ */

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }

  if (magA === 0 || magB === 0) return 0;
  // Clamp to [0,1]; negative similarity is meaningless for face identity.
  return Math.max(0, dot / (Math.sqrt(magA) * Math.sqrt(magB)));
}

export function isValidDescriptor(d: unknown): d is number[] {
  return (
    Array.isArray(d) &&
    d.length >= 64 &&
    d.length <= 2048 &&
    d.every((v) => typeof v === "number" && Number.isFinite(v)) &&
    // An all-zero or constant vector is a fabricated payload.
    new Set(d.slice(0, 32)).size > 1
  );
}

/* ------------------------------------------------------------------ */
/*  Liveness gate                                                      */
/* ------------------------------------------------------------------ */

export function checkLiveness(
  capture: FaceCapture,
  settings: Setting,
): string[] {
  const reasons: string[] = [];

  if (capture.detectionScore < settings.faceMinDetectionScore) {
    reasons.push("FACE_LOW_DETECTION");
  }

  if (settings.faceLivenessRequired) {
    if (capture.livenessScore === null || capture.livenessScore === undefined) {
      reasons.push("FACE_LIVENESS_MISSING");
    } else if (capture.livenessScore < settings.faceLivenessThreshold) {
      reasons.push("FACE_LIVENESS_FAILED");
    }

    if (capture.realScore === null || capture.realScore === undefined) {
      reasons.push("FACE_ANTISPOOF_MISSING");
    } else if (capture.realScore < settings.faceAntiSpoofThreshold) {
      reasons.push("FACE_SPOOF_SUSPECTED");
    }

    if (capture.challenge && capture.challengePassed === false) {
      reasons.push("FACE_CHALLENGE_FAILED");
    }
  }

  return reasons;
}

/* ------------------------------------------------------------------ */
/*  Matching                                                           */
/* ------------------------------------------------------------------ */

export async function matchFace(
  userId: string,
  capture: FaceCapture,
  settings: Setting,
): Promise<FaceMatchResult> {
  const reasons = checkLiveness(capture, settings);

  if (!isValidDescriptor(capture.descriptor)) {
    return {
      matched: false,
      score: 0,
      templateId: null,
      reasons: [...reasons, "FACE_DESCRIPTOR_INVALID"],
      liveness: capture.livenessScore ?? null,
      realScore: capture.realScore ?? null,
    };
  }

  const templates = await prisma.faceTemplate.findMany({
    where: { userId, status: "ACTIVE", revokedAt: null },
    select: { id: true, descriptor: true },
  });

  if (templates.length === 0) {
    return {
      matched: false,
      score: 0,
      templateId: null,
      reasons: [...reasons, "FACE_NOT_ENROLLED"],
      liveness: capture.livenessScore ?? null,
      realScore: capture.realScore ?? null,
    };
  }

  let best = { score: 0, templateId: null as string | null };
  for (const t of templates) {
    const score = cosineSimilarity(capture.descriptor, t.descriptor);
    if (score > best.score) best = { score, templateId: t.id };
  }

  const passesThreshold = best.score >= settings.faceMatchThreshold;
  if (!passesThreshold) reasons.push("FACE_MATCH_BELOW_THRESHOLD");

  const matched = passesThreshold && reasons.length === 0;

  if (matched && best.templateId) {
    await prisma.faceTemplate
      .update({
        where: { id: best.templateId },
        data: { lastMatchAt: new Date(), matchCount: { increment: 1 } },
      })
      .catch(() => undefined);
  }

  return {
    matched,
    score: Number(best.score.toFixed(4)),
    templateId: best.templateId,
    reasons,
    liveness: capture.livenessScore ?? null,
    realScore: capture.realScore ?? null,
  };
}

/**
 * Guards against one employee enrolling a face that is already registered to
 * somebody else — the classic buddy-punching setup.
 */
export async function findConflictingEnrolment(
  userId: string,
  descriptor: number[],
  threshold: number,
): Promise<{ userId: string; name: string; score: number } | null> {
  const others = await prisma.faceTemplate.findMany({
    where: { userId: { not: userId }, status: "ACTIVE", revokedAt: null },
    select: {
      descriptor: true,
      userId: true,
      user: { select: { name: true } },
    },
  });

  for (const t of others) {
    const score = cosineSimilarity(descriptor, t.descriptor);
    if (score >= threshold) {
      return { userId: t.userId, name: t.user.name, score: Number(score.toFixed(4)) };
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Liveness challenges                                                */
/* ------------------------------------------------------------------ */

export const FACE_CHALLENGES = [
  { id: "BLINK", label: "Blink twice, slowly" },
  { id: "TURN_LEFT", label: "Turn your head slightly to the left" },
  { id: "TURN_RIGHT", label: "Turn your head slightly to the right" },
  { id: "LOOK_UP", label: "Tilt your head slightly upward" },
  { id: "SMILE", label: "Smile" },
] as const;

export type FaceChallengeId = (typeof FACE_CHALLENGES)[number]["id"];

/** A random challenge stops a pre-recorded video from being replayed. */
export function randomChallenge() {
  const pick = FACE_CHALLENGES[Math.floor(Math.random() * FACE_CHALLENGES.length)]!;
  return { id: pick.id, label: pick.label };
}

/** Averages several enrolment captures into one stable template. */
export function averageDescriptors(descriptors: number[][]): number[] {
  if (descriptors.length === 0) return [];
  const dim = descriptors[0]!.length;
  const out = new Array<number>(dim).fill(0);

  for (const d of descriptors) {
    for (let i = 0; i < dim; i++) out[i] += d[i] ?? 0;
  }
  for (let i = 0; i < dim; i++) out[i] /= descriptors.length;

  return out;
}

/**
 * Enrolment captures of the same person should agree with each other. Wide
 * spread means the frames caught different people or a moving photo.
 */
export function enrolmentCoherence(descriptors: number[][]): number {
  if (descriptors.length < 2) return 1;

  let total = 0;
  let pairs = 0;
  for (let i = 0; i < descriptors.length; i++) {
    for (let j = i + 1; j < descriptors.length; j++) {
      total += cosineSimilarity(descriptors[i]!, descriptors[j]!);
      pairs++;
    }
  }

  return pairs === 0 ? 1 : total / pairs;
}
