# Live operations, 23 October 2026

Site: https://chog-beauty-arena.netlify.app. Current Netlify Drop deployment:
`6adaa70f153ede1791aa3821`. API: https://chog-api.72-56-98-23.sslip.io.
Live V2 arena: `0x8Cd36066717FF98D86FebC3294A98aC2f0095d05`, Monad 143,
creation block `115749283`, rules version 8. The owner signed deployment tx
`0xf447277e703d26fbf4073acf27e4f23506d823721fca8db8109cb25dd3f0fa33`;
actual network fee was 0.756520434 MON. Both participant wallets may bet but
cannot vote. Use this existing contract; do not deploy another.

V2 was verified and activated after the owner reported completion. Exact runtime,
constructor, Safe 2-of-3, keeper, CHOG, loopback/public Netlify checks and keeper
restart persistence passed. V1 had zero rounds, requests and CHOG bank before and
after switching. See `../security/participant-voting-v2.json`,
`../security/arena-v2-deployment.json` and `PARTICIPANT_RULES.md`.

## Separate services and data

| Component | Runtime / configuration | Persistent state / listener |
| --- | --- | --- |
| Live V2 API, chog-v2-web.service | /opt/chog-v2, /etc/chog-arena/v2.env | /var/lib/chog-v2-web, 127.0.0.1:3002 |
| Keeper, chog-keeper.service | /opt/chog-v2, v2.env, original systemd credentials | /var/lib/chog-v2-keeper, private 0700; original global flock retained |
| Health alerts, chog-monitor.timer | /opt/chog-v2, v2.env, MONITOR_BATTLES=0 | /var/lib/chog-monitor; no battle scans |
| Preserved V1 API, chog-live-web.service | /opt/chog-live, /etc/chog-arena/live.env | /var/lib/chog-live-web, internal 127.0.0.1:3001 |
| Original VPS demo, chog-web.service | /opt/chog-arena, public.env unchanged | /var/lib/chog-web, 127.0.0.1:3000, SSH staging :8080 |
| Original local demo | scripts/demo.mjs, existing manual-preview state directory | http://localhost:3104, preserved history |

V2 runtime: `/opt/chog-releases/participant-v2-20261023`. It reuses the exact
locked production dependency set and has new V2 indices/journal. Its artwork
cache is a separate warm copy of all 1,969 originals/metadata/previews. The old
V1 journal `/var/lib/chog-keeper` remains intact and 0700; V2 SQLite files are
0600. The keeper's `v2.conf` explicitly sets StateDirectoryMode=0700 after
resetting its StateDirectory list. No secrets were copied into the runtime.

The initial V1 live symlink targeted `/opt/chog-releases/live-20261023-credentials`.
The subsequent artwork cache improvement uses `/opt/chog-releases/artwork-20261023`;
see [NFT_ARTWORK.md](NFT_ARTWORK.md). Game contract and keeper are unchanged.
Keeper/live API/timer are enabled at boot. The web process cannot read the
keeper's private journal. Only a sanitized 0644 heartbeat is shared at
`/run/chog-keeper-health/status.json`. Source keystore/password files remain
root:root 0600, outside the runtime. systemd loads protected per-service copies.

## Historical initial-launch acceptance

145 Node tests, four Linux credential/monitor tests, installed-runtime demo smoke
and production audit (zero known findings) passed. Actual keeper credential unlock,
RPC/drand access, initial index catch-up, persistent cursor and manual restart
passed. After restart it remained ready without automatic restarts. Keeper balance
was 10 MON, latest/pending nonce zero. No transaction or trial battle was created.

The read-only acceptance script passed both loopback live API and public Netlify:

```sh
cd /opt/chog-v2
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
systemctl status chog-keeper chog-v2-web chog-monitor.timer
cat /run/chog-keeper-health/status.json
curl -fsS https://chog-api.72-56-98-23.sslip.io/api/health
systemctl restart chog-keeper.service
```

Wait for a fresh ready heartbeat and zero backlog after restart. Do not start a
second keeper with the same key or use that wallet for unrelated transactions.
Keep journal and index together; do not delete a pending signed transaction.
Never print credentials or export them into a public environment/config file.

## V2 rollback and V1 retirement

Cutover snapshots are in `/var/backups/chog-v2/cutover-20261023`: Caddy config,
four consistent V1 SQLite backups and the V2 acceptance reports. V1 runtime,
environment, original databases and demos were preserved. Public API points to
loopback 3002; admin API remains disabled and Caddy uses validated service restart.

`ops/switch-participant-v2.sh rollback` restores V1 routing/keeper configuration
and preserves V2 state. **Before rollback, inspect both contracts for new rounds,
funds and pending keeper transactions.** Never abandon funded V2 matches or
reuse a journal with a different scope. The automated cutover was allowed only
because V1 had no rounds, requests, funds or pending keeper transactions.

V1 is still an onchain contract and its revealer has not been revoked. An unsigned
and simulated Safe Transaction Builder import is prepared locally as
`ops/retire-v1-safe-20261023.json`. Only the owner/Safe signers can approve
and execute that separate action. New public matches use V2.

## Historical initial-launch rollback

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
