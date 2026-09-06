/**
 * Browser-side signal collection for the attendance punch.
 *
 * Everything here is advisory. A determined user can tamper with any of it,
 * which is exactly why the server re-checks what it can (geofence, IP
 * intelligence, nonce, impossible travel) and treats these values as evidence
 * to be scored rather than as facts to be trusted.
 */

export interface CollectedSignals {
  nonce: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  positionTimestamp: number;
  capturedAt: number;
  timezone: string;
  timezoneOffset: number;
  permissionState: string | null;
  geolocationNative: boolean;
  permissionsApiNative: boolean;
  dateNowNative: boolean;
  webdriver: boolean;
  suspiciousExtensions: string[];
  webrtcIps: string[];
  deviceFingerprint: string;
  platform: string | null;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  screen: string | null;
  languages: string[];
}

/* ------------------------------------------------------------------ */
/*  Tamper detection                                                   */
/* ------------------------------------------------------------------ */

/**
 * A browser's built-in functions stringify to "[native code]". If
 * getCurrentPosition has been replaced — by DevTools sensor emulation, a
 * spoofing extension, or an injected script — this returns false.
 */
function isNative(fn: unknown): boolean {
  try {
    return (
      typeof fn === "function" &&
      Function.prototype.toString.call(fn).includes("[native code]")
    );
  } catch {
    return false;
  }
}

function detectSpoofingExtensions(): string[] {
  const found: string[] = [];
  try {
    const w = window as unknown as Record<string, unknown>;
    // Common globals injected by location-spoofing tooling.
    const markers: Record<string, string> = {
      __gps_spoof__: "GPS spoofer",
      __fake_geo__: "Fake GPS",
      __locationGuard__: "Location Guard",
      locationGuardSeed: "Location Guard",
      __webdriver_evaluate: "WebDriver",
      __selenium_unwrapped: "Selenium",
      __puppeteer_evaluation_script__: "Puppeteer",
      _phantom: "PhantomJS",
      callPhantom: "PhantomJS",
    };
    for (const [key, label] of Object.entries(markers)) {
      if (key in w && !found.includes(label)) found.push(label);
    }
  } catch {
    /* ignore */
  }
  return found;
}

/* ------------------------------------------------------------------ */
/*  Device fingerprint                                                 */
/* ------------------------------------------------------------------ */

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A stable-per-browser fingerprint. Deliberately built from slow-moving
 * hardware and locale traits so it survives restarts but changes if the user
 * moves to a different machine.
 */
export async function computeDeviceFingerprint(): Promise<string> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const parts = [
    nav.userAgent,
    nav.language,
    (nav.languages ?? []).join(","),
    String(nav.hardwareConcurrency ?? ""),
    String(nav.deviceMemory ?? ""),
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    String(new Date().getTimezoneOffset()),
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    canvasSignature(),
  ];
  return sha256Hex(parts.join("|"));
}

/** Tiny canvas render — GPU/driver differences make this a useful discriminator. */
function canvasSignature(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Segoe UI'";
    ctx.fillStyle = "#0B7A3B";
    ctx.fillRect(0, 0, 200, 40);
    ctx.fillStyle = "#0E4C92";
    ctx.fillText("DESCO-AMS-fp", 2, 4);
    return canvas.toDataURL().slice(-64);
  } catch {
    return "canvas-error";
  }
}

/* ------------------------------------------------------------------ */
/*  WebRTC address discovery                                           */
/* ------------------------------------------------------------------ */

/**
 * Collects ICE candidate addresses. When the browser reports a public address
 * that differs from the one the server sees, traffic is being tunnelled —
 * a strong VPN/proxy indicator.
 */
export function collectWebRtcIps(timeoutMs = 2500): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>();

    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
    } catch {
      resolve([]);
      return;
    }

    const finish = () => {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      resolve([...found]);
    };

    const timer = setTimeout(finish, timeoutMs);

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        clearTimeout(timer);
        finish();
        return;
      }
      const match = /([0-9]{1,3}(?:\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(?::[a-f0-9]{0,4}){2,7})/i.exec(
        event.candidate.candidate,
      );
      // mDNS-obfuscated candidates (.local) carry no useful information.
      if (match?.[1] && !match[1].endsWith(".local")) found.add(match[1]);
    };

    try {
      pc.createDataChannel("probe");
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timer);
          finish();
        });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Geolocation                                                        */
/* ------------------------------------------------------------------ */

export class GeolocationFailure extends Error {
  constructor(
    public code: "DENIED" | "UNAVAILABLE" | "TIMEOUT" | "UNSUPPORTED",
    message: string,
  ) {
    super(message);
    this.name = "GeolocationFailure";
  }
}

export function getPosition(timeoutMs = 20000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new GeolocationFailure("UNSUPPORTED", "This browser cannot provide location."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(
            new GeolocationFailure(
              "DENIED",
              "Location permission was denied. Allow location access for this site and try again.",
            ),
          );
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          reject(
            new GeolocationFailure(
              "UNAVAILABLE",
              "Your position could not be determined. Move somewhere with a clearer sky view.",
            ),
          );
        } else {
          reject(
            new GeolocationFailure(
              "TIMEOUT",
              "Timed out waiting for a GPS fix. Try again.",
            ),
          );
        }
      },
      {
        enableHighAccuracy: true,
        // Force a fresh fix — a cached position is exactly what a replay
        // attack would supply.
        maximumAge: 0,
        timeout: timeoutMs,
      },
    );
  });
}

/* ------------------------------------------------------------------ */
/*  Orchestration                                                      */
/* ------------------------------------------------------------------ */

export async function collectSignals(nonce: string): Promise<CollectedSignals> {
  // Capture nativeness BEFORE anything else touches these APIs.
  const geolocationNative = isNative(navigator.geolocation?.getCurrentPosition);
  const permissionsApiNative = isNative(navigator.permissions?.query);
  const dateNowNative = isNative(Date.now);

  let permissionState: string | null = null;
  try {
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    });
    permissionState = status.state;
  } catch {
    /* Permissions API unavailable — not fatal. */
  }

  const [position, webrtcIps, deviceFingerprint] = await Promise.all([
    getPosition(),
    collectWebRtcIps(),
    computeDeviceFingerprint(),
  ]);

  const nav = navigator as Navigator & { deviceMemory?: number };

  return {
    nonce,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    altitude: position.coords.altitude,
    altitudeAccuracy: position.coords.altitudeAccuracy,
    heading: position.coords.heading,
    speed: position.coords.speed,
    positionTimestamp: position.timestamp,
    capturedAt: Date.now(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    timezoneOffset: new Date().getTimezoneOffset(),
    permissionState,
    geolocationNative,
    permissionsApiNative,
    dateNowNative,
    webdriver: Boolean(navigator.webdriver),
    suspiciousExtensions: detectSpoofingExtensions(),
    webrtcIps,
    deviceFingerprint,
    platform: nav.platform ?? null,
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    screen: `${screen.width}x${screen.height}`,
    languages: [...(nav.languages ?? [])],
  };
}

/** Reads the CSRF cookie for the double-submit header. */
export function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)desco_csrf=([^;]+)/);
  return match?.[1] ?? "";
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrfToken(),
    },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.ok === false) {
    const err = new Error(
      (data.error as string) ?? `Request failed (${res.status})`,
    );
    Object.assign(err, { payload: data, status: res.status });
    throw err;
  }
  return (data.data ?? data) as T;
}
