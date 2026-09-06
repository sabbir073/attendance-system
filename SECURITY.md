# Security Policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately to the
repository owner, including reproduction steps and the affected component.

## Handling secrets

- `.env` is git-ignored. Only `.env.example` is committed, and it contains no
  real values.
- `SESSION_SECRET` must be at least 32 characters. The application refuses to
  start in production without it. Generate one with:

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```

- Rotating `SESSION_SECRET` invalidates every active session, because session
  tokens are stored as HMACs keyed with that value. This is the intended
  emergency logout mechanism.
- Seeded demo passwords in `prisma/seed.ts` are for local development only.
  Change every account before the system handles real employee data.

## If a secret is committed by accident

Rotating the value is mandatory — deleting the commit is not sufficient, since
the value remains in the repository history and in any existing clone or fork.

1. Rotate the credential at its source (database password, API key, session
   secret).
2. Purge the history with `git filter-repo` or the BFG Repo-Cleaner.
3. Force-push and notify everyone holding a clone.

## Known limitations

Browser-based geolocation and VPN detection are heuristic, not absolute. See
the *Honest limitations* section of the README before relying on either for
anything with disciplinary or payroll consequences.
