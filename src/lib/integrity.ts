import "server-only";

import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { lookupIp, timezoneMatchesIp, type IpIntel } from "@/lib/network-intel";
import { generateToken, isPrivateIp } from "@/lib/session";
import { haversineMeters, impliedSpeedKmh, isValidCoordinate } from "@/lib/geo";
import type { Office } from "@/generated/prisma/client";

/* ------------------------------------------------------------------ */
/*  Client-collected signals                                           */
/* ------------------------------------------------------------------ */

export type PunchMethod = "GPS" | "FINGERPRINT" | "FACE";

/** Outcome of the identity-verification step, decided before the risk engine runs. */
export interface BiometricOutcome {
  method: PunchMethod;
  verified: boolean;
  reasons: string[];
  faceScore?: number | null;
  liveness?: number | null;
  realScore?: number | null;
  credentialId?: string | null;
  templateId?: string | null;
}

export interface ClientSignals {
  nonce: string;
  method: PunchMethod;

  // Geolocation API output
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number | null;
  altitudeAccuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  positionTimestamp: number;

  // Environment
  capturedAt: number;
  timezone: string;
  timezoneOffset: number;
  permissionState?: string | null;

  // Tamper indicators
  geolocationNative: boolean;
  permissionsApiNative: boolean;
  dateNowNative: boolean;
  webdriver: boolean;
  suspiciousExtensions?: string[];

  // Network
  webrtcIps: string[];

  // Device
  deviceFingerprint: string;
  platform?: string | null;
  hardwareConcurrency?: number | null;
  deviceMemory?: number | null;
  screen?: string | null;
  languages?: string[];
}

export type Decision = "ALLOWED" | "FLAGGED" | "BLOCKED";

export interface RiskReason {
  code: string;
  label: string;
  weight: number;
  fatal?: boolean;
}

export interface EvaluationResult {
  decision: Decision;
  riskScore: number;
  reasons: RiskReason[];
  reasonCodes: string[];
  blockingMessage: string | null;
  intel: IpIntel;
  distanceMeters: number | null;
  office: Office | null;
  mockLocationSuspected: boolean;
  clockSkewMs: number;
  vpnDetected: boolean;
  deviceKnown: boolean;
  method: PunchMethod;
  biometric: BiometricOutcome | null;
}

/* ------------------------------------------------------------------ */
/*  Nonce (anti-replay)                                                */
/* ------------------------------------------------------------------ */

const NONCE_TTL_MS = 120_000;

export async function issueNonce(userId: string, purpose: string) {
  const token = generateToken(24);
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);

  await prisma.nonce.create({
    data: { token, userId, purpose, expiresAt },
  });

  // Opportunistic cleanup of expired challenges.
  prisma.nonce
    .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 3_600_000) } } })
    .catch(() => undefined);

  return { token, expiresAt };
}

async function consumeNonce(
  token: string,
  userId: string,
  purpose: string,
): Promise<boolean> {
  if (!token) return false;

  const record = await prisma.nonce.findUnique({ where: { token } });
  if (!record) return false;
  if (record.userId !== userId) return false;
  if (record.purpose !== purpose) return false;
  if (record.usedAt) return false;
  if (record.expiresAt.getTime() < Date.now()) return false;

  // Atomic single-use claim: updateMany with usedAt = null wins exactly once.
  const claimed = await prisma.nonce.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  return claimed.count === 1;
}

/* ------------------------------------------------------------------ */
/*  Risk engine                                                        */
/* ------------------------------------------------------------------ */

export interface EvaluateInput {
  userId: string;
  action: "CHECK_IN" | "CHECK_OUT";
  signals: ClientSignals;
  ip: string | null;
  userAgent: string | null;
  office: Office | null;
  /** Result of the fingerprint / face step. Absent for a GPS-only punch. */
  biometric?: BiometricOutcome | null;
  /** True when the employee has any active biometric enrolment. */
  hasEnrolledBiometric?: boolean;
}

export async function evaluateAttendanceAttempt(
  input: EvaluateInput,
): Promise<EvaluationResult> {
  const settings = await getSettings();
  const { signals, office } = input;

  const reasons: RiskReason[] = [];
  const add = (code: string, label: string, weight: number, fatal = false) =>
    reasons.push({ code, label, weight, fatal });

  /* --- 1. Anti-replay challenge --------------------------------- */
  const nonceOk = await consumeNonce(signals.nonce, input.userId, input.action);
  if (!nonceOk) {
    add(
      "NONCE_INVALID",
      "Security challenge was missing, expired, or already used. Reload the page and try again.",
      100,
      true,
    );
  }

  /* --- 2. Coordinate sanity ------------------------------------- */
  if (!isValidCoordinate(signals.latitude, signals.longitude)) {
    add("COORDS_INVALID", "The reported coordinates are not valid.", 100, true);
  }

  /* --- 3. Runtime tampering ------------------------------------- */
  // If getCurrentPosition is no longer the browser's native function, the
  // Geolocation API has been overridden (DevTools sensors, an extension, or
  // an injected script).
  if (signals.geolocationNative === false) {
    add(
      "GEOLOCATION_OVERRIDDEN",
      "The browser's location function has been replaced. Location spoofing detected.",
      100,
      settings.blockMockLocation,
    );
  }
  if (signals.permissionsApiNative === false) {
    add("PERMISSIONS_API_PATCHED", "The Permissions API has been modified.", 45);
  }
  if (signals.dateNowNative === false) {
    add("CLOCK_PATCHED", "The device clock function has been modified.", 55);
  }
  if (signals.webdriver) {
    add(
      "AUTOMATION_DETECTED",
      "Browser automation (WebDriver) is active.",
      85,
      true,
    );
  }
  if (signals.suspiciousExtensions?.length) {
    add(
      "SPOOFING_EXTENSION",
      `A known location-spoofing extension was detected (${signals.suspiciousExtensions.join(", ")}).`,
      70,
      settings.blockMockLocation,
    );
  }

  /* --- 4. GPS quality ------------------------------------------- */
  const accuracy = Number(signals.accuracy ?? 0);
  if (settings.requireHighAccuracy && accuracy > settings.maxGpsAccuracy) {
    add(
      "LOW_ACCURACY",
      `GPS accuracy is ±${Math.round(accuracy)} m, which exceeds the ±${settings.maxGpsAccuracy} m limit. Move outdoors or enable precise location.`,
      35,
    );
  }
  // Real GPS never reports a perfect fix. 0 m accuracy is a mock provider.
  if (accuracy === 0) {
    add(
      "IMPOSSIBLE_ACCURACY",
      "Reported GPS accuracy of 0 m is not physically possible.",
      70,
      settings.blockMockLocation,
    );
  }
  const positionAgeMs = Date.now() - Number(signals.positionTimestamp ?? 0);
  if (positionAgeMs > 90_000 || positionAgeMs < -30_000) {
    add(
      "STALE_POSITION",
      "The GPS reading is not fresh. A cached or replayed position was submitted.",
      45,
    );
  }

  /* --- 5. Clock skew -------------------------------------------- */
  const clockSkewMs = Math.abs(Date.now() - Number(signals.capturedAt ?? 0));
  if (clockSkewMs > settings.maxClockSkewMs) {
    add(
      "CLOCK_SKEW",
      `The device clock is off by ${Math.round(clockSkewMs / 1000)} seconds. Sync your clock and retry.`,
      40,
    );
  }

  /* --- 6. Geofence ---------------------------------------------- */
  let distanceMeters: number | null = null;
  if (settings.geofenceEnabled) {
    if (!office) {
      add(
        "NO_OFFICE_ASSIGNED",
        "No office location is assigned to your account. Contact the administrator.",
        100,
        true,
      );
    } else {
      distanceMeters = haversineMeters(
        signals.latitude,
        signals.longitude,
        office.latitude,
        office.longitude,
      );
      // Give credit for GPS uncertainty so a legitimate user standing at the
      // boundary is not punished for a noisy fix.
      const effective = Math.max(0, distanceMeters - Math.min(accuracy, 50));
      if (effective > office.radiusMeters) {
        add(
          "OUTSIDE_GEOFENCE",
          `You are ${Math.round(distanceMeters)} m from ${office.name}. You must be within ${office.radiusMeters} m to record attendance.`,
          100,
          true,
        );
      }
    }
  }

  /* --- 7. Impossible travel ------------------------------------- */
  const lastEvent = await prisma.integrityEvent.findFirst({
    where: {
      userId: input.userId,
      gpsLat: { not: null },
      decision: { in: ["ALLOWED", "FLAGGED"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (lastEvent?.gpsLat != null && lastEvent.gpsLng != null) {
    const elapsed = Date.now() - lastEvent.createdAt.getTime();
    const kmh = impliedSpeedKmh(
      lastEvent.gpsLat,
      lastEvent.gpsLng,
      signals.latitude,
      signals.longitude,
      elapsed,
    );
    if (elapsed > 5_000 && kmh > settings.impossibleTravelKmh) {
      add(
        "IMPOSSIBLE_TRAVEL",
        `Your position implies travelling at ${Math.round(kmh)} km/h since the last reading.`,
        65,
      );
    }
  }

  /* --- 8. Network / VPN ----------------------------------------- */
  const intel = await lookupIp(input.ip);
  const ipUnknown = !intel.resolved;
  let vpnDetected = false;

  if (ipUnknown) {
    if (!settings.allowUnknownIp) {
      add(
        "IP_UNRESOLVED",
        "Your network could not be verified. Connect to a normal internet connection and retry.",
        60,
        true,
      );
    } else {
      add(
        "IP_UNRESOLVED_ALLOWED",
        "Network origin could not be verified (private or local address).",
        5,
      );
    }
  } else {
    if (intel.vpn || intel.proxy || intel.tor) {
      vpnDetected = true;
      const fatal = settings.vpnPolicy === "STRICT";
      add(
        "VPN_DETECTED",
        "A VPN, proxy or Tor connection was detected. Turn it off completely before recording attendance.",
        90,
        fatal,
      );
    } else if (intel.hosting) {
      vpnDetected = true;
      const fatal = settings.vpnPolicy === "STRICT";
      add(
        "DATACENTER_IP",
        "Your connection originates from a datacenter, which usually means a VPN or proxy. Disconnect it and retry.",
        75,
        fatal,
      );
    }

    if (settings.enforceCountryLock && intel.countryCode) {
      if (intel.countryCode !== settings.expectedCountry) {
        add(
          "COUNTRY_MISMATCH",
          `Your connection appears to originate from ${intel.country ?? intel.countryCode}, not ${settings.expectedCountry}.`,
          80,
          settings.vpnPolicy === "STRICT",
        );
      }
    }

    // GPS says Dhaka, IP says Frankfurt -> tunnelled connection.
    if (
      intel.latitude != null &&
      intel.longitude != null &&
      isValidCoordinate(signals.latitude, signals.longitude)
    ) {
      const ipGpsGapKm =
        haversineMeters(
          signals.latitude,
          signals.longitude,
          intel.latitude,
          intel.longitude,
        ) / 1000;
      if (ipGpsGapKm > 500) {
        add(
          "IP_GPS_DIVERGENCE",
          `Your GPS position and network location are ${Math.round(ipGpsGapKm)} km apart.`,
          55,
        );
      }
    }
  }

  // Browser timezone vs IP country.
  const tzCheck = timezoneMatchesIp(signals.timezone, intel);
  if (tzCheck === "mismatch") {
    vpnDetected = true;
    add(
      "TIMEZONE_IP_MISMATCH",
      "Your device timezone does not match your network location — a strong VPN indicator.",
      50,
      settings.blockOnIpMismatch && settings.vpnPolicy === "STRICT",
    );
  }

  // WebRTC-discovered public address vs the address the server sees.
  const publicWebrtc = (signals.webrtcIps ?? []).filter(
    (candidate) => candidate && !isPrivateIp(candidate),
  );
  if (input.ip && publicWebrtc.length > 0) {
    const mismatch = publicWebrtc.some((candidate) => candidate !== input.ip);
    if (mismatch) {
      vpnDetected = true;
      add(
        "WEBRTC_IP_LEAK",
        "Your browser reports a different public address than your connection — VPN or proxy in use.",
        60,
        settings.vpnPolicy === "STRICT" && settings.blockOnIpMismatch,
      );
    }
  }

  /* --- 9. Device binding ---------------------------------------- */
  let deviceKnown = false;
  if (signals.deviceFingerprint) {
    const device = await prisma.device.findUnique({
      where: {
        userId_fingerprint: {
          userId: input.userId,
          fingerprint: signals.deviceFingerprint,
        },
      },
    });
    deviceKnown = Boolean(device);

    if (!device && settings.requireDeviceBinding) {
      const count = await prisma.device.count({ where: { userId: input.userId } });
      if (count >= settings.maxDevicesPerUser) {
        add(
          "UNKNOWN_DEVICE",
          `This device is not registered and you have reached the limit of ${settings.maxDevicesPerUser} devices. Ask an administrator to approve it.`,
          70,
          true,
        );
      } else {
        add(
          "NEW_DEVICE_ENROLLED",
          "A new device was registered to your account.",
          15,
        );
      }
    } else if (device && !device.trusted) {
      add("DEVICE_NOT_TRUSTED", "This device is pending administrator approval.", 20);
    }
  } else {
    add("NO_DEVICE_FINGERPRINT", "The device could not be identified.", 30);
  }

  /* --- 10. Verification method policy --------------------------- */
  const method = signals.method ?? "GPS";
  const bio = input.biometric ?? null;

  const methodAllowed =
    (method === "GPS" && settings.allowGpsOnly) ||
    (method === "FINGERPRINT" && settings.allowFingerprint) ||
    (method === "FACE" && settings.allowFace);

  if (!methodAllowed) {
    add(
      "METHOD_DISABLED",
      `The ${methodLabel(method)} method is currently disabled by policy. Use another method.`,
      100,
      true,
    );
  }

  if (method === "GPS") {
    if (settings.requireBiometric) {
      add(
        "BIOMETRIC_REQUIRED",
        "Policy requires fingerprint or face verification. Location alone is not sufficient.",
        100,
        true,
      );
    } else if (settings.preferEnrolledMethod && input.hasEnrolledBiometric) {
      // Falling back to GPS when a biometric is enrolled is the classic
      // downgrade attack, so it is permitted but never silent.
      add(
        "BIOMETRIC_DOWNGRADE",
        "You have biometric verification enrolled but recorded attendance with location only.",
        40,
      );
    }
  } else {
    if (!bio) {
      add(
        "BIOMETRIC_MISSING",
        "The verification step did not complete. Try again.",
        100,
        true,
      );
    } else if (!bio.verified) {
      add(
        "BIOMETRIC_FAILED",
        biometricFailureMessage(method, bio.reasons),
        100,
        true,
      );
    } else if (bio.method !== method) {
      add(
        "BIOMETRIC_METHOD_MISMATCH",
        "The verification result does not correspond to the requested method.",
        100,
        true,
      );
    }
  }

  // A borderline face match is allowed through but surfaced for review.
  if (method === "FACE" && bio?.verified && typeof bio.faceScore === "number") {
    const margin = bio.faceScore - settings.faceMatchThreshold;
    if (margin < 0.05) {
      add(
        "FACE_MARGINAL_MATCH",
        `Face matched at ${(bio.faceScore * 100).toFixed(1)}%, only just above the ${(settings.faceMatchThreshold * 100).toFixed(0)}% threshold.`,
        25,
      );
    }
  }

  // A biometric that succeeds on a device the employee has never used is
  // worth a second look even though the biometric itself passed.
  if (method !== "GPS" && bio?.verified && !deviceKnown) {
    add(
      "BIOMETRIC_ON_NEW_DEVICE",
      "Biometric verification succeeded on a device not previously seen for this account.",
      20,
    );
  }

  /* --- 11. Verdict ---------------------------------------------- */
  const riskScore = Math.min(
    100,
    reasons.reduce((sum, r) => sum + r.weight, 0),
  );
  const hasFatal = reasons.some((r) => r.fatal);

  let decision: Decision = "ALLOWED";
  if (hasFatal || riskScore >= settings.riskBlockThreshold) {
    decision = "BLOCKED";
  } else if (riskScore >= settings.riskFlagThreshold) {
    decision = "FLAGGED";
  }

  const blockingMessage =
    decision === "BLOCKED"
      ? (reasons.find((r) => r.fatal) ?? reasons.slice().sort((a, b) => b.weight - a.weight)[0])
          ?.label ?? "This attendance attempt was blocked by the security policy."
      : null;

  const mockLocationSuspected = reasons.some((r) =>
    [
      "GEOLOCATION_OVERRIDDEN",
      "IMPOSSIBLE_ACCURACY",
      "AUTOMATION_DETECTED",
      "SPOOFING_EXTENSION",
      "IMPOSSIBLE_TRAVEL",
      "STALE_POSITION",
    ].includes(r.code),
  );

  return {
    decision,
    riskScore,
    reasons,
    reasonCodes: reasons.map((r) => r.code),
    blockingMessage,
    intel,
    distanceMeters,
    office,
    mockLocationSuspected,
    clockSkewMs,
    vpnDetected,
    deviceKnown,
    method,
    biometric: bio,
  };
}

function methodLabel(method: PunchMethod): string {
  if (method === "FINGERPRINT") return "fingerprint";
  if (method === "FACE") return "face recognition";
  return "location-only";
}

const BIOMETRIC_MESSAGES: Record<string, string> = {
  FACE_NOT_ENROLLED:
    "No face is enrolled for your account. Enrol your face from your profile first.",
  FACE_MATCH_BELOW_THRESHOLD:
    "Your face did not match the enrolled record closely enough. Face the camera squarely in good light and try again.",
  FACE_LIVENESS_FAILED:
    "Liveness check failed. Hold the camera at eye level and follow the on-screen instruction.",
  FACE_LIVENESS_MISSING: "Liveness could not be measured. Try again in better light.",
  FACE_SPOOF_SUSPECTED:
    "The camera appears to be pointed at a photograph or a screen rather than a live person.",
  FACE_ANTISPOOF_MISSING: "Anti-spoof check could not run. Try again.",
  FACE_CHALLENGE_FAILED:
    "The requested action was not detected. Follow the on-screen instruction exactly.",
  FACE_LOW_DETECTION:
    "Your face was not clearly visible. Remove obstructions and improve lighting.",
  FACE_DESCRIPTOR_INVALID: "The captured face data was rejected as invalid.",
  WEBAUTHN_NO_CREDENTIAL:
    "No fingerprint is registered for your account. Register it from your profile first.",
  WEBAUTHN_BAD_SIGNATURE:
    "The fingerprint signature could not be verified. Try again.",
  WEBAUTHN_USER_NOT_VERIFIED:
    "The device did not confirm your fingerprint. Use the sensor rather than a PIN if your policy requires biometrics.",
  WEBAUTHN_COUNTER_REGRESSION:
    "The authenticator reported an out-of-order counter, which can indicate a cloned credential. The credential has been suspended.",
  WEBAUTHN_CREDENTIAL_REVOKED:
    "This fingerprint credential has been revoked. Ask an administrator to re-enrol it.",
};

function biometricFailureMessage(method: PunchMethod, reasons: string[]): string {
  for (const r of reasons) {
    if (BIOMETRIC_MESSAGES[r]) return BIOMETRIC_MESSAGES[r]!;
  }
  return method === "FACE"
    ? "Face verification failed."
    : "Fingerprint verification failed.";
}

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

export async function recordIntegrityEvent(params: {
  userId: string | null;
  action:
    | "LOGIN"
    | "CHECK_IN"
    | "CHECK_OUT"
    | "NETWORK_CHECK"
    | "BIOMETRIC_ENROL"
    | "BIOMETRIC_VERIFY";
  result: Partial<EvaluationResult> & {
    decision: Decision;
    riskScore: number;
  };
  signals?: Partial<ClientSignals>;
  ip: string | null;
  userAgent: string | null;
}) {
  const { result, signals, intel } = {
    ...params,
    intel: params.result.intel,
  };

  return prisma.integrityEvent.create({
    data: {
      userId: params.userId,
      action: params.action,
      decision: result.decision,
      riskScore: result.riskScore,
      reasons: result.reasons?.map((r) => r.code) ?? [],
      ip: params.ip,
      ipCountry: intel?.countryCode ?? null,
      ipCity: intel?.city ?? null,
      ipIsp: intel?.isp ?? null,
      ipAsn: intel?.asn ?? null,
      vpnDetected: Boolean(result.vpnDetected),
      proxyDetected: Boolean(intel?.proxy),
      hostingDetected: Boolean(intel?.hosting),
      method: result.method ?? null,
      faceScore: result.biometric?.faceScore ?? null,
      livenessScore: result.biometric?.liveness ?? null,
      realScore: result.biometric?.realScore ?? null,
      credentialId: result.biometric?.credentialId ?? null,
      browserTimezone: signals?.timezone ?? null,
      clockSkewMs: result.clockSkewMs ?? null,
      gpsLat: signals?.latitude ?? null,
      gpsLng: signals?.longitude ?? null,
      gpsAccuracy: signals?.accuracy ?? null,
      distanceMeters: result.distanceMeters ?? null,
      mockLocationSuspected: Boolean(result.mockLocationSuspected),
      webrtcIps: signals?.webrtcIps ?? [],
      deviceFingerprint: signals?.deviceFingerprint ?? null,
      userAgent: params.userAgent,
      raw: {
        reasons: result.reasons ?? [],
        intel: intel ?? null,
      } as never,
    },
  });
}

/** Registers or refreshes the device record after a successful punch. */
export async function touchDevice(
  userId: string,
  fingerprint: string | null | undefined,
  userAgent: string | null,
) {
  if (!fingerprint) return;

  await prisma.device.upsert({
    where: { userId_fingerprint: { userId, fingerprint } },
    update: { lastUsedAt: new Date(), useCount: { increment: 1 } },
    create: {
      userId,
      fingerprint,
      userAgent,
      label: deviceLabel(userAgent),
      trusted: false,
      useCount: 1,
    },
  });
}

function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os =
    /Windows NT 10/.test(ua) ? "Windows" :
    /Windows/.test(ua) ? "Windows" :
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad|iOS/.test(ua) ? "iOS" :
    /Mac OS X/.test(ua) ? "macOS" :
    /Linux/.test(ua) ? "Linux" : "Unknown OS";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}
