# Live operations, 23 October 2026

Site: https://chog-beauty-arena.netlify.app. Netlify Drop deployment:
`6ada8399b1fe7abf06164e6b`. API: https://chog-api.72-56-98-23.sslip.io.
Arena: `0xBBEEe440795aCe96F7b6b0D14dc06A5e6A9005d5`, Monad 143,
creation block `115710675`. Use this existing contract; do not deploy another.

## Separate services and data

| Component | Runtime / configuration | Persistent state / listener |
| --- | --- | --- |
| Live API, chog-live-web.service | /opt/chog-live, /etc/chog-arena/live.env | /var/lib/chog-live-web, 127.0.0.1:3001 |
| Keeper, chog-keeper.service | /opt/chog-live, live.env, systemd credentials | /var/lib/chog-keeper, private 0700 |
| Health alerts, chog-monitor.timer | /opt/chog-live, live.env, MONITOR_BATTLES=0 | /var/lib/chog-monitor; no battle scans |
| Original VPS demo, chog-web.service | /opt/chog-arena, public.env unchanged | /var/lib/chog-web, 127.0.0.1:3000, SSH staging :8080 |
| Original local demo | scripts/demo.mjs, existing manual-preview state directory | http://localhost:3104, preserved history |

The initial live symlink targeted `/opt/chog-releases/live-20261023-credentials`.
The subsequent artwork cache improvement uses `/opt/chog-releases/artwork-20261023`;
see [NFT_ARTWORK.md](NFT_ARTWORK.md). Game contract and keeper are unchanged.
Keeper/live API/timer are enabled at boot. The web process cannot read the
keeper's private journal. Only a sanitized 0644 heartbeat is shared at
`/run/chog-keeper-health/status.json`. Source keystore/password files remain
root:root 0600, outside the runtime. systemd loads protected per-service copies.

## Completed acceptance

145 Node tests, four Linux credential/monitor tests, installed-runtime demo smoke
and production audit (zero known findings) passed. Actual keeper credential unlock,
RPC/drand access, initial index catch-up, persistent cursor and manual restart
passed. After restart it remained ready without automatic restarts. Keeper balance
was 10 MON, latest/pending nonce zero. No transaction or trial battle was created.

The read-only acceptance script passed both loopback live API and public Netlify:

```sh
cd /opt/chog-live
node scripts/check-live-runtime.mjs https://chog-beauty-arena.netlify.app NEW_REPORT.json
```

It checks pinned arena/CHOG, Safe, heartbeat, index, MON, nonces, direct onchain
NFT discovery and an on-demand image. The browser showed LIVE · MONAD, 24-hour
battles and the live profile. The owner subsequently confirmed that Rabby connects and NFTs appear in Profile.
The in-app browser has no wallet extension; no mock connection is counted as real.
The owner declined a trial battle and Sourcify; neither is marked passed.

See `../security/live-launch.json` for evidence and limitations. Earlier documents
retain historical prelaunch snapshots. Capacity is bounded evidence for an expected
audience of 50, not an enforced bet limit or a mainnet throughput guarantee.

## Status and restart

```sh
systemctl status chog-keeper chog-live-web chog-monitor.timer
cat /run/chog-keeper-health/status.json
curl -fsS https://chog-api.72-56-98-23.sslip.io/api/health
systemctl restart chog-keeper.service
```

Wait for a fresh ready heartbeat and zero backlog after restart. Do not start a
second keeper with the same key or use that wallet for unrelated transactions.
Keep journal and index together; do not delete a pending signed transaction.
Never print credentials or export them into a public environment/config file.

## Public API rollback

The pre-cutover Caddy snapshot is
`/var/backups/chog-live/cutover-20261022T215604Z/Caddyfile`.
The prelaunch consistent demo backup is
`/var/backups/chog-live/20261022T214536Z/demo.sqlite`.
Caddy admin API stays disabled: use service restart, not HTTP reload.

```sh
install -m 644 /var/backups/chog-live/cutover-20261022T215604Z/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl restart caddy
```

This restores the public demo API only. It does not pause the onchain arena or
stop direct contract calls. If real matches exist, keep their keeper running.
For a compromised keeper, use the independent Safe to revoke it as described in
RECOVERY.md; website rollback is not an emergency onchain revocation.

## Reproduction

Build with `npm run build:runtime -- NEW_DIRECTORY`; choose a fresh target.
Package-runtime installs production dependencies with scripts disabled. The initial
Windows install failed with a cache/network error; the VPS completed a clean
locked `npm ci --omit=dev --ignore-scripts`, audit and runtime smoke successfully.
Do not treat a partially installed local package as deployment evidence.

`configure-live.sh` stages a fresh separate runtime without switching public
routing; `activate-live.sh` requires healthy live/demo services, enables health-only
checks and changes only the public API route with rollback on acceptance failure.
These scripts intentionally refuse unexpected existing configuration; review
existing paths for later upgrades instead of rerunning initial installation.
