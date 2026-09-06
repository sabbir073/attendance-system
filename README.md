<div align="center">
  <img src="public/logo.svg" alt="DESCO" height="72" />
  <h1>DESCO Attendance Management System</h1>
  <p><strong>Geofenced · VPN-aware · Device-bound attendance for Dhaka Electric Supply Company Limited</strong></p>
</div>

---

> **Logo notice.** `public/logo.svg` is an **original placeholder mark** created for this project, not DESCO's registered trademark. Replace that single file with the official asset before any real deployment.

---

## What this is

A full-stack attendance platform where every punch carries verifiable evidence: GPS position inside an office geofence, a network that isn't a VPN, a registered device, and a fresh single-use server challenge. Every decision the risk engine makes is written to an immutable audit trail, so an attendance record can be defended after the fact rather than merely trusted.

## Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16.3 (App Router, Turbopack) |
| UI | React 19 · Tailwind CSS v4 |
| ORM | Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`) |
| Database | PostgreSQL 18 |
| Runtime | Node.js 24 (Alpine) |
| Hashing | Argon2id (`@node-rs/argon2`) |
| 2FA | TOTP (`otpauth`) |
| Orchestration | Docker Compose |

---

## Quick start

```bash
git clone https://github.com/sabbir073/attendance-system.git
cd attendance-system

cp .env.example .env
# Generate a session secret and paste it into .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

docker compose up --build
```

| Service | URL |
| --- | --- |
| Application | http://localhost:3000 |
| Adminer (DB UI) | http://localhost:8080 |
| PostgreSQL | `localhost:5433` |

The entrypoint waits for PostgreSQL, applies the schema with `prisma db push`, and runs the idempotent seed before starting Next.js.

### Seeded accounts

| Role | Email | Password |
| --- | --- | --- |
| Super Admin | `admin@desco.gov.bd` | `Admin@Desco2026` |
| HR | `hr@desco.gov.bd` | `Hr@Desco2026` |
| Manager | `mahedi@desco.gov.bd` | `Employee@2026` |
| Employee | `rakibul@desco.gov.bd` | `Employee@2026` |

Change every one of these before the system touches real data.

---

## Security model

### Authentication

- **Argon2id** password hashing at OWASP's second recommended configuration (19 MiB, t=2, p=1).
- **Opaque session tokens.** The database stores only an HMAC-SHA256 of the token, keyed with `SESSION_SECRET`. A database dump cannot be replayed as a valid cookie.
- **httpOnly + Secure + SameSite** session cookie; a separate JS-readable CSRF cookie implements the double-submit pattern, backed by a strict `Origin` check.
- **User-enumeration resistance.** A dummy Argon2 verification runs when an account doesn't exist, so "unknown email" and "wrong password" cost the same wall-clock time.
- **Account lockout** after a configurable number of failed attempts, plus per-email and per-IP sliding-window rate limits.
- **TOTP 2FA**, optional per user and enforceable for administrative roles.
- Server-side authorisation on every page and route handler. Edge middleware performs a cookie-presence check only and is never treated as proof of identity.

### Location integrity

Each punch is scored by a ten-group risk engine. Reasons carry weights; fatal reasons block outright, and the remainder accumulate against configurable block and flag thresholds.

| Check | Signal |
| --- | --- |
| Anti-replay | Single-use, 2-minute server nonce claimed atomically |
| Coordinate sanity | Range validation; `0,0` rejected as a stub provider |
| Runtime tampering | `getCurrentPosition` verified as native; Permissions API and `Date.now` patch detection; `navigator.webdriver` |
| GPS quality | Accuracy ceiling; a reported accuracy of **0 m** is treated as proof of a mock provider |
| Freshness | Position timestamp must be recent — defeats cached or replayed fixes |
| Clock skew | Device clock compared against server time |
| Geofence | Haversine distance against the assigned office radius, with credit for genuine GPS uncertainty |
| Impossible travel | Implied km/h since the last accepted reading |
| Network origin | IP intelligence, WebRTC-vs-HTTP address comparison, GPS-vs-IP divergence |
| Device binding | Fingerprint bound to the user, with an enrolment cap and admin approval |

### VPN detection

Three providers in priority order — **proxycheck.io** → **ipinfo.io** → **ip-api.com** (keyless fallback) — combined with ISP/ASN keyword scanning, datacenter detection, country lock, and a browser-timezone-vs-IP-country mismatch heuristic. Results cache for 10 minutes so a 09:00 rush doesn't exhaust free-tier quotas. Policy is `OFF` / `WARN` / `STRICT`; under `STRICT` the attendance UI is hard-gated until the tunnel is off.

### Honest limitations

Read this before promising anything to a stakeholder.

1. **Browser geolocation cannot be made unspoofable.** A rooted Android with a mock-location app, or a patched browser build, can feed fabricated coordinates. The engine above raises the cost substantially and makes every attempt auditable — it does not make spoofing impossible. Genuine enforcement requires a native Android client attested by the **Play Integrity API**, or hardware attendance terminals.
2. **VPN detection is heuristic.** Residential-proxy exits and self-hosted WireGuard on a home IP will not be flagged by IP reputation. The WebRTC and timezone cross-checks catch a large share of the remainder, not all of it.
3. **The rate limiter is in-process.** Correct for a single container. Move it to Redis before scaling horizontally.
4. **`prisma db push` is used instead of migrations** for fast local bring-up. Generate proper migrations before production.

---

## Configuration

All runtime policy lives in the `settings` table (one row, `id = "global"`) and is editable from **Admin → Settings** without a redeploy: geofence radius, GPS accuracy ceiling, VPN policy, device limits, clock-skew tolerance, impossible-travel threshold, risk thresholds, session TTL, lockout rules, and password policy.

Environment variables are documented in [`.env.example`](.env.example).

---

## Project layout

```
├── docker/entrypoint.sh      # wait-for-db, schema push, seed, start
├── prisma/
│   ├── schema.prisma         # 16 models
│   └── seed.ts               # offices, shifts, holidays, users, history
├── public/logo.svg           # placeholder DESCO mark — replace
└── src/
    ├── app/                  # App Router: portal, admin, API routes
    ├── components/           # shared UI
    ├── lib/
    │   ├── session.ts        # sessions, CSRF, request metadata
    │   ├── password.ts       # Argon2id + policy
    │   ├── integrity.ts      # risk engine + nonce
    │   ├── network-intel.ts  # VPN / proxy / ASN intelligence
    │   ├── geo.ts            # haversine, timezone-aware calendar
    │   ├── rate-limit.ts     # sliding window
    │   ├── audit.ts          # redacted audit trail
    │   └── settings.ts       # cached global policy
    └── middleware.ts
```

## Local development

```bash
docker compose up -d db     # database only
npm install
npx prisma generate
npm run db:push
npm run db:seed
npm run dev
```

## Useful commands

```bash
npm run db:studio     # Prisma Studio
npm run typecheck     # tsc --noEmit
docker compose logs -f app
docker compose down -v   # reset, including the database volume
```

---

## Licence

Internal project. Not for redistribution.
