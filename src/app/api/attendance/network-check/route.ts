import { getCurrentUser, getRequestMeta, isPrivateIp } from "@/lib/session";
import { lookupIp, timezoneMatchesIp } from "@/lib/network-intel";
import { getSettings } from "@/lib/settings";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { fail, ok } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The VPN gate. The attendance UI calls this on load and blocks the punch
 * controls when `blocked` is true, so the employee is told to disconnect
 * before they waste a GPS fix on an attempt that would be refused anyway.
 *
 * The authoritative check still runs again inside the punch endpoint — this
 * is a courtesy, not the enforcement point.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("Authentication required.", 401);

  const limit = rateLimit(
    `netcheck:${user.id}`,
    LIMITS.networkCheck.limit,
    LIMITS.networkCheck.windowMs,
  );
  if (!limit.allowed) return fail("Too many requests.", 429);

  const meta = await getRequestMeta();
  const settings = await getSettings();
  const intel = await lookupIp(meta.ip);

  const reasons: string[] = [];
  let blocked = false;
  let warning = false;

  const enforcing = settings.vpnPolicy === "STRICT";

  if (!intel.resolved) {
    // Localhost / private LAN — normal during local Docker testing.
    if (!settings.allowUnknownIp) {
      blocked = enforcing;
      reasons.push("Your network could not be verified.");
    }
  } else {
    if (intel.vpn || intel.proxy || intel.tor) {
      reasons.push(
        "A VPN, proxy or Tor connection was detected. Turn it off completely before recording attendance.",
      );
      blocked = enforcing;
      warning = true;
    } else if (intel.hosting) {
      reasons.push(
        "Your connection comes from a datacenter, which usually means a VPN or proxy is active.",
      );
      blocked = enforcing;
      warning = true;
    }

    if (
      settings.enforceCountryLock &&
      intel.countryCode &&
      intel.countryCode !== settings.expectedCountry
    ) {
      reasons.push(
        `Your connection appears to originate from ${intel.country ?? intel.countryCode}.`,
      );
      blocked = enforcing;
      warning = true;
    }
  }

  return ok({
    blocked,
    warning,
    reasons,
    policy: settings.vpnPolicy,
    network: {
      // Never expose the full address back to the browser.
      ipKnown: intel.resolved,
      isLocal: isPrivateIp(meta.ip),
      country: intel.country,
      countryCode: intel.countryCode,
      city: intel.city,
      isp: intel.isp,
      vpn: intel.vpn,
      proxy: intel.proxy,
      hosting: intel.hosting,
      provider: intel.provider,
    },
    serverTime: Date.now(),
  });
}
