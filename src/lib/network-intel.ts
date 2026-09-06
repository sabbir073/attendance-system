import "server-only";

import { isPrivateIp } from "@/lib/session";

/**
 * IP intelligence used for VPN / proxy / datacenter detection.
 *
 * Provider order:
 *   1. proxycheck.io   (PROXYCHECK_KEY)   — best VPN signal
 *   2. ipinfo.io       (IPINFO_TOKEN)     — privacy/ASN flags
 *   3. ip-api.com      (keyless, free)    — proxy/hosting/mobile flags
 *
 * Results are cached in-process for 10 minutes so a burst of punches at
 * 09:00 does not exhaust the free-tier rate limits.
 */

export interface IpIntel {
  ip: string | null;
  resolved: boolean;
  /** True when *any* provider signal indicates a VPN/proxy/datacenter exit. */
  vpn: boolean;
  proxy: boolean;
  hosting: boolean;
  tor: boolean;
  mobile: boolean;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  isp: string | null;
  asn: string | null;
  latitude: number | null;
  longitude: number | null;
  provider: string;
  error?: string;
}

const EMPTY: IpIntel = {
  ip: null,
  resolved: false,
  vpn: false,
  proxy: false,
  hosting: false,
  tor: false,
  mobile: false,
  country: null,
  countryCode: null,
  city: null,
  region: null,
  isp: null,
  asn: null,
  latitude: null,
  longitude: null,
  provider: "none",
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: IpIntel }>();

/**
 * Keyword heuristics over the ISP/organisation string. Catches the long tail
 * of consumer VPN exits and cloud hosts even when a provider does not flag
 * them explicitly.
 */
const HOSTING_KEYWORDS = [
  "amazon", "aws", "google cloud", "gcp", "microsoft azure", "azure",
  "digitalocean", "linode", "vultr", "hetzner", "ovh", "contabo",
  "oracle cloud", "alibaba", "tencent", "scaleway", "leaseweb", "choopa",
  "m247", "datacamp", "packethub", "cogent", "hostinger", "namecheap",
  "colocation", "data center", "datacenter", "hosting", "server",
];

const VPN_KEYWORDS = [
  "vpn", "nordvpn", "expressvpn", "surfshark", "cyberghost", "privatevpn",
  "protonvpn", "mullvad", "windscribe", "ipvanish", "hidemyass", "purevpn",
  "private internet access", "tunnelbear", "zenmate", "hola", "psiphon",
  "opera vpn", "cloudflare warp", "tailscale", "zerotier", "proxy", "tor exit",
];

function keywordScan(text: string | null | undefined) {
  const t = (text ?? "").toLowerCase();
  return {
    hosting: HOSTING_KEYWORDS.some((k) => t.includes(k)),
    vpn: VPN_KEYWORDS.some((k) => t.includes(k)),
  };
}

async function fetchJson(url: string, timeoutMs = 4000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------- providers ---------------------------- */

async function viaProxycheck(ip: string, key: string): Promise<IpIntel | null> {
  const data = (await fetchJson(
    `https://proxycheck.io/v2/${ip}?key=${key}&vpn=3&asn=1&risk=1`,
  )) as Record<string, any> | null;
  if (!data || data.status !== "ok") return null;

  const node = data[ip];
  if (!node) return null;

  const type = String(node.type ?? "").toLowerCase();
  const isProxy = String(node.proxy ?? "no").toLowerCase() === "yes";
  const scan = keywordScan(node.provider ?? node.organisation);

  return {
    ...EMPTY,
    ip,
    resolved: true,
    proxy: isProxy,
    vpn: isProxy || type.includes("vpn") || scan.vpn,
    hosting: type.includes("hosting") || type.includes("business") === false && scan.hosting,
    tor: type.includes("tor"),
    mobile: type.includes("mobile"),
    country: node.country ?? null,
    countryCode: node.isocode ?? null,
    city: node.city ?? null,
    region: node.region ?? null,
    isp: node.provider ?? node.organisation ?? null,
    asn: node.asn ?? null,
    latitude: typeof node.latitude === "number" ? node.latitude : null,
    longitude: typeof node.longitude === "number" ? node.longitude : null,
    provider: "proxycheck.io",
  };
}

async function viaIpinfo(ip: string, token: string): Promise<IpIntel | null> {
  const data = (await fetchJson(
    `https://ipinfo.io/${ip}/json?token=${token}`,
  )) as Record<string, any> | null;
  if (!data || data.error) return null;

  const privacy = data.privacy ?? {};
  const scan = keywordScan(data.org ?? data.company?.name);
  const [lat, lng] = String(data.loc ?? "").split(",");

  return {
    ...EMPTY,
    ip,
    resolved: true,
    proxy: Boolean(privacy.proxy) || Boolean(privacy.relay),
    vpn: Boolean(privacy.vpn) || Boolean(privacy.proxy) || scan.vpn,
    hosting: Boolean(privacy.hosting) || scan.hosting,
    tor: Boolean(privacy.tor),
    mobile: false,
    country: data.country ?? null,
    countryCode: data.country ?? null,
    city: data.city ?? null,
    region: data.region ?? null,
    isp: data.org ?? null,
    asn: data.asn?.asn ?? (String(data.org ?? "").match(/AS\d+/)?.[0] ?? null),
    latitude: lat ? Number(lat) : null,
    longitude: lng ? Number(lng) : null,
    provider: "ipinfo.io",
  };
}

async function viaIpApi(ip: string): Promise<IpIntel | null> {
  const fields =
    "status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,proxy,hosting,mobile,query";
  const data = (await fetchJson(
    `http://ip-api.com/json/${ip}?fields=${fields}`,
  )) as Record<string, any> | null;
  if (!data || data.status !== "success") return null;

  const scan = keywordScan(`${data.isp ?? ""} ${data.org ?? ""} ${data.as ?? ""}`);

  return {
    ...EMPTY,
    ip,
    resolved: true,
    proxy: Boolean(data.proxy),
    vpn: Boolean(data.proxy) || scan.vpn,
    hosting: Boolean(data.hosting) || scan.hosting,
    tor: false,
    mobile: Boolean(data.mobile),
    country: data.country ?? null,
    countryCode: data.countryCode ?? null,
    city: data.city ?? null,
    region: data.regionName ?? null,
    isp: data.isp ?? data.org ?? null,
    asn: data.as ?? null,
    latitude: typeof data.lat === "number" ? data.lat : null,
    longitude: typeof data.lon === "number" ? data.lon : null,
    provider: "ip-api.com",
  };
}

/* ------------------------------ public ------------------------------ */

export async function lookupIp(ip: string | null | undefined): Promise<IpIntel> {
  if (!ip) return { ...EMPTY, error: "no-ip" };

  // Private / loopback addresses (i.e. localhost Docker) cannot be geolocated.
  if (isPrivateIp(ip)) {
    return { ...EMPTY, ip, provider: "private-range", error: "private-ip" };
  }

  const cached = cache.get(ip);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  let result: IpIntel | null = null;

  const proxycheckKey = process.env.PROXYCHECK_KEY;
  const ipinfoToken = process.env.IPINFO_TOKEN;

  if (proxycheckKey) result = await viaProxycheck(ip, proxycheckKey);
  if (!result && ipinfoToken) result = await viaIpinfo(ip, ipinfoToken);
  if (!result) result = await viaIpApi(ip);

  const value = result ?? { ...EMPTY, ip, error: "lookup-failed" };
  cache.set(ip, { at: Date.now(), value });

  // Keep the cache small.
  if (cache.size > 5000) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
  }

  return value;
}

/**
 * Rough IANA-timezone -> ISO country mapping for the mismatch heuristic.
 * A user whose browser says Asia/Dhaka but whose IP resolves to the
 * Netherlands is almost certainly on a VPN.
 */
const TZ_COUNTRY: Record<string, string> = {
  "Asia/Dhaka": "BD",
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Asia/Karachi": "PK",
  "Asia/Kathmandu": "NP",
  "Asia/Colombo": "LK",
  "Asia/Yangon": "MM",
  "Asia/Bangkok": "TH",
  "Asia/Singapore": "SG",
  "Asia/Kuala_Lumpur": "MY",
  "Asia/Dubai": "AE",
  "Asia/Riyadh": "SA",
  "Asia/Qatar": "QA",
  "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR",
  "Asia/Shanghai": "CN",
  "Europe/London": "GB",
  "Europe/Amsterdam": "NL",
  "Europe/Berlin": "DE",
  "Europe/Paris": "FR",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Los_Angeles": "US",
  "America/Toronto": "CA",
  "Australia/Sydney": "AU",
  UTC: "",
};

export function timezoneCountry(tz: string | null | undefined): string | null {
  if (!tz) return null;
  return TZ_COUNTRY[tz] ?? null;
}

export function timezoneMatchesIp(
  browserTimezone: string | null | undefined,
  intel: IpIntel,
): "match" | "mismatch" | "unknown" {
  if (!intel.resolved || !intel.countryCode) return "unknown";
  const expected = timezoneCountry(browserTimezone);
  if (!expected) return "unknown";
  return expected === intel.countryCode ? "match" : "mismatch";
}
