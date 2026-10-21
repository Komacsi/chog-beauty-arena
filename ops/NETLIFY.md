# Netlify frontend with the existing VPS

The Free Netlify plan hosts only browser assets. The existing VPS keeps the
Node API, SQLite index/cache and eventual keeper. No Netlify Functions or second
paid server are needed. The Free plan has monthly usage limits; exhausting them
can pause the website. Monitor Netlify usage, especially polling and artwork traffic.

## Build and upload

- Use Node 24 and `npm ci --ignore-scripts`, then `npm run build:netlify`.
- `dist/netlify` contains only an explicit allowlist of browser files. Do not upload
  the repository, runtime directory, `.env`, SQLite files or keeper credentials.
- `netlify.toml` selects that build command and publish directory for Git imports.
  Import the existing `implementation/arena-mvp` branch, not the unfinished main
  branch. Alternatively upload the generated browser directory as a manual deploy.
- The actual production URL must be recorded in `ARENA_WEB_ORIGINS` on the API
  server. No wildcard Netlify or Deploy Preview origin is accepted for POSTs.
- Browser requests stay same-origin (`/api/*`). Netlify rewrites them to the fixed
  HTTPS backend, retaining API paths/query strings. The server returns no-store on
  JSON so wallet/state responses must not be shared between visitors.

## Public API

Prepared origin: `https://chog-api.72-56-98-23.sslip.io`. The free DNS service maps
the embedded IP to the VPS, without account registration or a purchased domain.
Caddy obtains/renews a public certificate over ports 80/443. This introduces a
dependency on third-party DNS and CA availability; changing the VPS IP requires
a new hostname, certificate and Netlify build. It provides no DNS ownership or SLA.

`ops/Caddyfile.netlify` exposes only `/api/*` on the public host; other paths return
404. The app/database remain on loopback and the previous SSH staging endpoint
stays on 127.0.0.1:8080. No CORS wildcard, forwarded-origin trust or release-guard
override is introduced. Origin checks limit browser requests, not direct clients;
contract validation remains authoritative for real funds.

After explicit approval to publish the API and obtaining the production site URL,
upload the three files described in `ops/configure-netlify.sh` and run that script
with the exact URL. It snapshots SQLite/config, copies a new immutable release,
changes the symlink and restarts web/Caddy, with rollback on command failure.
Keeper/monitor credentials and service activation are separate launch steps.

## Acceptance

Verify HTTPS without certificate bypass; profile/leaderboard direct links; sample
images and bundle; `/api/config` demo/release guard; state response no-store;
cookies on the Netlify host; request create/cancel and persona switch via Netlify;
unknown Origin rejected; arbitrary/static backend paths return 404; oversized
bodies rejected. Preserve localhost:3104 and its database. Publishing this build
is fictional staging, not an approval to accept real CHOG bets.

Docs: https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/ ,
https://nip.io/ , https://caddyserver.com/docs/automatic-https .
