import "server-only";

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { FACE_DIMENSIONS } from "@/lib/face";
import type { Setting, VerificationMethod } from "@/generated/prisma/client";

/**
 * ============================================================
 *  Biometric provider abstraction
 * ============================================================
 *
 * Two implementations sit behind one interface:
 *
 *   SimulatedProvider — DEMO MODE. No camera, no fingerprint sensor, no
 *     authenticator. Produces plausible synthetic scores so the complete
 *     enrol → verify → punch journey can be demonstrated on hardware that
 *     has none of those devices.
 *
 *   HardwareProvider  — the real path, delegating to lib/face.ts (embedding
 *     match + liveness) and lib/webauthn.ts (assertion signature
 *     verification). Selected automatically when simulation is switched off.
 *
 * The selector is `Setting.biometricSimulationMode`, editable from
 * Admin → Settings. Nothing else in the application needs to know which
 * provider ran.
 *
 * ------------------------------------------------------------
 *  INTEGRITY RULE
 * ------------------------------------------------------------
 * Every artefact produced in simulation mode is stamped `simulated = true`
 * and that flag is never cleared. An attendance row, a face template and a
 * credential each carry it, so a demo punch can never later be presented as
 * evidence that a real person's face or fingerprint was actually verified.
 * This is the whole reason the flag exists — do not "tidy" it away.
 */

export type BiometricKind = "FACE" | "FINGERPRINT";

export interface BiometricOutcome {
  matched: boolean;
  /** 0..1 similarity. Synthetic in simulation mode. */
  score: number;
  threshold: number;
  liveness: number | null;
  realScore: number | null;
  simulated: boolean;
  credentialId: string | null;
  templateId: string | null;
  reasons: string[];
  /** Human-readable, safe to show in the UI. */
  message: string;
}

export interface EnrolOutcome {
  ok: boolean;
  simulated: boolean;
  id: string | null;
  quality: number;
  message: string;
}

/* ------------------------------------------------------------------ */
/*  Deterministic synthetic scoring                                    */
/* ------------------------------------------------------------------ */

/**
 * Derives a stable pseudo-random value in [0,1) from a seed string.
 *
 * Deterministic on purpose: the same user verifying against the same enrolled
 * template gets a consistent-looking score band across a demo, instead of a
 * number that jumps around and looks obviously fake to an audience.
 */
function seededUnit(seed: string): number {
  const digest = crypto.createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

/** Scores cluster in a believable "genuine match" band, 0.86 – 0.98. */
function syntheticMatchScore(seed: string): number {
  return 0.86 + seededUnit(`match:${seed}`) * 0.12;
}

/** Liveness and anti-spoof land in a believable 0.80 – 0.97. */
function syntheticLiveness(seed: string): number {
  return 0.8 + seededUnit(`live:${seed}`) * 0.17;
}

/**
 * A synthetic descriptor so enrolled demo records are shaped exactly like
 * real ones. Deterministic per user, unit-normalised like a genuine
 * embedding, so cosineSimilarity() behaves sensibly if the record is ever
 * read by the real matcher.
 */
function syntheticDescriptor(seed: string): number[] {
  const out: number[] = [];
  let block = crypto.createHash("sha512").update(seed).digest();
  let cursor = 0;

  for (let i = 0; i < FACE_DIMENSIONS; i++) {
    if (cursor + 2 > block.length) {
      block = crypto.createHash("sha512").update(block).digest();
      cursor = 0;
    }
    out.push(block.readUInt16BE(cursor) / 65535 - 0.5);
    cursor += 2;
  }

  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
  return out.map((v) => v / norm);
}

/** Should this simulated attempt deliberately fail, per policy? */
function shouldFail(settings: Setting, seed: string): boolean {
  const rate = Math.max(0, Math.min(100, settings.simulatedFailureRate));
  if (rate === 0) return false;
  return seededUnit(`fail:${seed}:${Date.now() >> 13}`) * 100 < rate;
}

/* ------------------------------------------------------------------ */
/*  Enrolment                                                          */
/* ------------------------------------------------------------------ */

export async function enrolBiometric(params: {
  userId: string;
  kind: BiometricKind;
  label?: string | null;
  deviceFingerprint?: string | null;
  userAgent?: string | null;
}): Promise<EnrolOutcome> {
  const settings = await getSettings();

  if (!settings.biometricSimulationMode) {
    return {
      ok: false,
      simulated: false,
      id: null,
      quality: 0,
      message:
        "Simulation mode is off. Real enrolment runs through the face capture or WebAuthn flow, which requires a camera or platform authenticator.",
    };
  }

  const seed = `${params.userId}:${params.kind}`;

  if (params.kind === "FACE") {
    // Retire any previous simulated template so a user has one active demo face.
    await prisma.faceTemplate.updateMany({
      where: { userId: params.userId, simulated: true, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });

    const quality = 0.88 + seededUnit(`q:${seed}`) * 0.1;

    const template = await prisma.faceTemplate.create({
      data: {
        userId: params.userId,
        descriptor: syntheticDescriptor(seed),
        dimensions: FACE_DIMENSIONS,
        quality,
        liveness: syntheticLiveness(seed),
        realScore: syntheticLiveness(`real:${seed}`),
        status: "ACTIVE",
        simulated: true,
        label: params.label ?? "Simulated face template",
      },
    });

    return {
      ok: true,
      simulated: true,
      id: template.id,
      quality,
      message: "Face enrolled in simulation mode. No camera was used.",
    };
  }

  // FINGERPRINT — a placeholder credential row. No authenticator involved, so
  // there is no key pair; the public key field records that explicitly rather
  // than storing something that merely looks like one.
  await prisma.webAuthnCredential.updateMany({
    where: { userId: params.userId, simulated: true, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "re-enrolled" },
  });

  const credential = await prisma.webAuthnCredential.create({
    data: {
      userId: params.userId,
      credentialId: `sim_${crypto.randomBytes(16).toString("base64url")}`,
      publicKey: "SIMULATED-NO-KEY-MATERIAL",
      algorithm: -7,
      status: "ACTIVE",
      simulated: true,
      userVerified: true,
      label: params.label ?? "Simulated fingerprint",
      deviceFingerprint: params.deviceFingerprint ?? null,
      transports: ["internal"],
    },
  });

  return {
    ok: true,
    simulated: true,
    id: credential.id,
    quality: 0.92,
    message: "Fingerprint enrolled in simulation mode. No sensor was used.",
  };
}

/* ------------------------------------------------------------------ */
/*  Verification                                                       */
/* ------------------------------------------------------------------ */

export async function verifyBiometric(params: {
  userId: string;
  kind: BiometricKind;
}): Promise<BiometricOutcome> {
  const settings = await getSettings();
  const seed = `${params.userId}:${params.kind}`;

  const base: BiometricOutcome = {
    matched: false,
    score: 0,
    threshold:
      params.kind === "FACE" ? settings.faceMatchThreshold : 1,
    liveness: null,
    realScore: null,
    simulated: true,
    credentialId: null,
    templateId: null,
    reasons: [],
    message: "",
  };

  if (!settings.biometricSimulationMode) {
    return {
      ...base,
      simulated: false,
      reasons: ["SIMULATION_DISABLED"],
      message:
        "Simulation mode is off. Use the real capture flow for this method.",
    };
  }

  /* --- must be enrolled first ---------------------------------- */
  if (params.kind === "FACE") {
    const template = await prisma.faceTemplate.findFirst({
      where: { userId: params.userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });

    if (!template) {
      return {
        ...base,
        reasons: ["NOT_ENROLLED"],
        message: "No face is enrolled for your account. Enrol from your profile first.",
      };
    }

    if (shouldFail(settings, seed)) {
      return {
        ...base,
        score: 0.41 + seededUnit(`low:${seed}`) * 0.2,
        templateId: template.id,
        reasons: ["NO_MATCH"],
        message: "Face did not match the enrolled template. Try again.",
      };
    }

    const score = syntheticMatchScore(seed);
    const liveness = syntheticLiveness(seed);

    await prisma.faceTemplate.update({
      where: { id: template.id },
      data: { lastMatchAt: new Date(), matchCount: { increment: 1 } },
    });

    return {
      ...base,
      matched: true,
      score,
      liveness,
      realScore: syntheticLiveness(`real:${seed}`),
      templateId: template.id,
      reasons: ["SIMULATED_MATCH"],
      message: "Face verified (simulated).",
    };
  }

  const credential = await prisma.webAuthnCredential.findFirst({
    where: { userId: params.userId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  if (!credential) {
    return {
      ...base,
      reasons: ["NOT_ENROLLED"],
      message:
        "No fingerprint is enrolled for your account. Enrol from your profile first.",
    };
  }

  if (shouldFail(settings, seed)) {
    return {
      ...base,
      credentialId: credential.credentialId,
      reasons: ["NO_MATCH"],
      message: "Fingerprint not recognised. Try again.",
    };
  }

  await prisma.webAuthnCredential.update({
    where: { id: credential.id },
    data: { lastUsedAt: new Date(), useCount: { increment: 1 } },
  });

  return {
    ...base,
    matched: true,
    score: 1,
    credentialId: credential.credentialId,
    reasons: ["SIMULATED_MATCH"],
    message: "Fingerprint verified (simulated).",
  };
}

/* ------------------------------------------------------------------ */
/*  Enrolment status (for UI)                                          */
/* ------------------------------------------------------------------ */

export interface BiometricStatusSummary {
  simulationMode: boolean;
  face: { enrolled: boolean; simulated: boolean; enrolledAt: Date | null };
  fingerprint: { enrolled: boolean; simulated: boolean; enrolledAt: Date | null };
  allowedMethods: VerificationMethod[];
  requireBiometric: boolean;
}

export async function getBiometricStatus(
  userId: string,
): Promise<BiometricStatusSummary> {
  const settings = await getSettings();

  const [face, credential] = await Promise.all([
    prisma.faceTemplate.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.webAuthnCredential.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const allowedMethods: VerificationMethod[] = [];
  if (settings.allowGpsOnly && !settings.requireBiometric) allowedMethods.push("GPS");
  if (settings.allowFingerprint) allowedMethods.push("FINGERPRINT");
  if (settings.allowFace) allowedMethods.push("FACE");

  return {
    simulationMode: settings.biometricSimulationMode,
    face: {
      enrolled: Boolean(face),
      simulated: face?.simulated ?? false,
      enrolledAt: face?.createdAt ?? null,
    },
    fingerprint: {
      enrolled: Boolean(credential),
      simulated: credential?.simulated ?? false,
      enrolledAt: credential?.createdAt ?? null,
    },
    allowedMethods,
    requireBiometric: settings.requireBiometric,
  };
}
