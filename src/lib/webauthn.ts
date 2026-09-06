import "server-only";

/**
 * WebAuthn ("fingerprint") support, implemented directly against the Web
 * Crypto API.
 *
 * Why no library: the only genuinely tricky part of WebAuthn registration is
 * decoding the CBOR attestation object to recover the public key. We skip
 * that entirely by asking the browser for the key with
 * `AuthenticatorAttestationResponse.getPublicKey()`, which returns SPKI DER
 * directly. What remains is a small amount of well-specified binary parsing
 * and one signature verification — no dependency, no version drift.
 *
 * PRIVACY NOTE: no fingerprint image or biometric template ever reaches this
 * server. The sensor unlocks a hardware-held private key on the device; we
 * only ever see the matching public key and a signature.
 */

/* ------------------------------------------------------------------ */
/*  base64url                                                          */
/* ------------------------------------------------------------------ */

export function b64uToBuffer(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

export function bufferToB64u(buf: ArrayBuffer | Buffer | Uint8Array): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer);
  return b.toString("base64url");
}

/**
 * Web Crypto's `BufferSource` requires a view backed by a plain ArrayBuffer.
 * A Node Buffer may be backed by a SharedArrayBuffer (it is pooled), which
 * TypeScript rejects. Copying into a fresh Uint8Array satisfies both the
 * type and the runtime.
 */
function bytes(buf: Buffer) {
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Relying-party identity                                             */
/* ------------------------------------------------------------------ */

/**
 * The RP ID must be a registrable domain — never an IP address, never a port.
 * `localhost` is explicitly permitted by the spec even over plain HTTP.
 */
export function deriveRpId(host: string | null): string {
  if (!host) return "localhost";
  const hostname = host.split(":")[0]!.trim().toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    // Bare IPv4 — WebAuthn will refuse this. Surfaced to the user as a
    // clear, actionable error rather than a cryptic browser exception.
    throw new WebAuthnUnsupportedHost(hostname);
  }
  return hostname;
}

export class WebAuthnUnsupportedHost extends Error {
  constructor(public host: string) {
    super(
      `Fingerprint sign-in cannot run on the IP address ${host}. Open the app on https:// with a hostname, or on localhost.`,
    );
    this.name = "WebAuthnUnsupportedHost";
  }
}

export function expectedOrigins(host: string | null): string[] {
  if (!host) return ["http://localhost:3000"];
  return [`https://${host}`, `http://${host}`];
}

/* ------------------------------------------------------------------ */
/*  Option builders                                                    */
/* ------------------------------------------------------------------ */

export const COSE_ES256 = -7;
export const COSE_RS256 = -257;

export interface RegistrationOptionsInput {
  rpId: string;
  rpName: string;
  userId: string;
  userName: string;
  userDisplayName: string;
  challenge: string;
  excludeCredentialIds: string[];
  requireUserVerification: boolean;
  allowRoaming: boolean;
}

export function buildRegistrationOptions(input: RegistrationOptionsInput) {
  return {
    challenge: input.challenge,
    rp: { id: input.rpId, name: input.rpName },
    user: {
      id: Buffer.from(input.userId, "utf8").toString("base64url"),
      name: input.userName,
      displayName: input.userDisplayName,
    },
    pubKeyCredParams: [
      { type: "public-key", alg: COSE_ES256 },
      { type: "public-key", alg: COSE_RS256 },
    ],
    timeout: 90_000,
    attestation: "none",
    excludeCredentials: input.excludeCredentialIds.map((id) => ({
      type: "public-key",
      id,
    })),
    authenticatorSelection: {
      // "platform" == the sensor built into this device: Windows Hello,
      // Android fingerprint, Touch ID. This is what makes it a fingerprint
      // punch rather than a portable security key.
      authenticatorAttachment: input.allowRoaming ? undefined : "platform",
      residentKey: "preferred",
      requireResidentKey: false,
      userVerification: input.requireUserVerification ? "required" : "preferred",
    },
  };
}

export function buildAuthenticationOptions(input: {
  rpId: string;
  challenge: string;
  allowCredentialIds: string[];
  requireUserVerification: boolean;
}) {
  return {
    challenge: input.challenge,
    rpId: input.rpId,
    timeout: 90_000,
    userVerification: input.requireUserVerification ? "required" : "preferred",
    allowCredentials: input.allowCredentialIds.map((id) => ({
      type: "public-key",
      id,
      transports: ["internal", "hybrid"],
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Authenticator data                                                 */
/* ------------------------------------------------------------------ */

export const FLAG_UP = 0x01; // user present
export const FLAG_UV = 0x04; // user verified (i.e. fingerprint matched)
export const FLAG_BE = 0x08; // backup eligible
export const FLAG_BS = 0x10; // backup state
export const FLAG_AT = 0x40; // attested credential data present

export interface ParsedAuthData {
  rpIdHash: Buffer;
  flags: number;
  userPresent: boolean;
  userVerified: boolean;
  backupEligible: boolean;
  backedUp: boolean;
  signCount: number;
  aaguid: string | null;
  credentialId: string | null;
}

export function parseAuthenticatorData(data: Buffer): ParsedAuthData {
  if (data.length < 37) {
    throw new Error("Authenticator data is truncated.");
  }

  const rpIdHash = data.subarray(0, 32);
  const flags = data[32]!;
  const signCount = data.readUInt32BE(33);

  let aaguid: string | null = null;
  let credentialId: string | null = null;

  if (flags & FLAG_AT && data.length >= 55) {
    const raw = data.subarray(37, 53);
    aaguid = [
      raw.subarray(0, 4).toString("hex"),
      raw.subarray(4, 6).toString("hex"),
      raw.subarray(6, 8).toString("hex"),
      raw.subarray(8, 10).toString("hex"),
      raw.subarray(10, 16).toString("hex"),
    ].join("-");

    const credIdLen = data.readUInt16BE(53);
    if (data.length >= 55 + credIdLen) {
      credentialId = bufferToB64u(data.subarray(55, 55 + credIdLen));
    }
  }

  return {
    rpIdHash,
    flags,
    userPresent: Boolean(flags & FLAG_UP),
    userVerified: Boolean(flags & FLAG_UV),
    backupEligible: Boolean(flags & FLAG_BE),
    backedUp: Boolean(flags & FLAG_BS),
    signCount,
    aaguid,
    credentialId,
  };
}

/* ------------------------------------------------------------------ */
/*  Client data                                                        */
/* ------------------------------------------------------------------ */

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

export function verifyClientData(
  clientDataJSONb64u: string,
  opts: {
    expectedType: "webauthn.create" | "webauthn.get";
    expectedChallenge: string;
    expectedOrigins: string[];
  },
): ClientData {
  let parsed: ClientData;
  try {
    parsed = JSON.parse(b64uToBuffer(clientDataJSONb64u).toString("utf8"));
  } catch {
    throw new Error("Client data could not be parsed.");
  }

  if (parsed.type !== opts.expectedType) {
    throw new Error("Unexpected WebAuthn ceremony type.");
  }
  if (parsed.challenge !== opts.expectedChallenge) {
    throw new Error("Challenge mismatch — this response was not issued by us.");
  }
  if (!opts.expectedOrigins.includes(parsed.origin)) {
    throw new Error(`Origin ${parsed.origin} is not permitted.`);
  }
  if (parsed.crossOrigin) {
    throw new Error("Cross-origin WebAuthn responses are refused.");
  }

  return parsed;
}

export async function rpIdHashMatches(
  rpIdHash: Buffer,
  rpId: string,
): Promise<boolean> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rpId),
  );
  return Buffer.from(digest).equals(rpIdHash);
}

/* ------------------------------------------------------------------ */
/*  Signature verification                                             */
/* ------------------------------------------------------------------ */

/**
 * WebAuthn ES256 signatures are DER-encoded SEQUENCE { r INTEGER, s INTEGER }.
 * Web Crypto's ECDSA verifier expects the raw P-1363 form (r || s, 32 bytes
 * each), so we transcode.
 */
function derToP1363(der: Buffer): Buffer {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error("Malformed ECDSA signature.");

  // Length byte(s) — skip long-form if present.
  const first = der[offset++]!;
  if (first & 0x80) offset += first & 0x7f;

  const readInt = (): Buffer => {
    if (der[offset++] !== 0x02) throw new Error("Malformed ECDSA integer.");
    const len = der[offset++]!;
    let value = der.subarray(offset, offset + len);
    offset += len;
    // Strip DER's leading zero sign byte, then left-pad to 32.
    while (value.length > 32 && value[0] === 0x00) value = value.subarray(1);
    if (value.length < 32) {
      value = Buffer.concat([Buffer.alloc(32 - value.length, 0), value]);
    }
    return value;
  };

  return Buffer.concat([readInt(), readInt()]);
}

export async function verifyAssertionSignature(params: {
  publicKeySpkiB64u: string;
  algorithm: number;
  authenticatorDataB64u: string;
  clientDataJSONb64u: string;
  signatureB64u: string;
}): Promise<boolean> {
  const spki = b64uToBuffer(params.publicKeySpkiB64u);
  const authData = b64uToBuffer(params.authenticatorDataB64u);
  const clientData = b64uToBuffer(params.clientDataJSONb64u);
  const signature = b64uToBuffer(params.signatureB64u);

  // Signed payload = authenticatorData || SHA-256(clientDataJSON)
  const clientHash = Buffer.from(
    await crypto.subtle.digest("SHA-256", bytes(clientData)),
  );
  const signed = Buffer.concat([authData, clientHash]);

  try {
    if (params.algorithm === COSE_ES256) {
      const key = await crypto.subtle.importKey(
        "spki",
        bytes(spki),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      return crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        bytes(derToP1363(signature)),
        bytes(signed),
      );
    }

    if (params.algorithm === COSE_RS256) {
      const key = await crypto.subtle.importKey(
        "spki",
        bytes(spki),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      return crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        bytes(signature),
        bytes(signed),
      );
    }
  } catch {
    return false;
  }

  return false;
}

/** Web Crypto reports algorithms as COSE identifiers via getPublicKeyAlgorithm(). */
export function isSupportedAlgorithm(alg: number): boolean {
  return alg === COSE_ES256 || alg === COSE_RS256;
}
