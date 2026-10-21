# VPS launch runbook

Prepared 21 October 2026. No server has been purchased or configured. The live
release guard stays enabled until the remaining application/asset and host checks pass.

## Proposed first host

Use Ubuntu 24.04 LTS on x86-64, 2 vCPU, 4 GB RAM and at least 40 GB SSD, with a
public IP and a domain. This is a starting configuration for measured staging,
not a throughput guarantee. Compile/package locally or in CI, not as the keeper user.
If measurements require more headroom, use 4 vCPU / 8 GB. Keep off-host backups.

One candidate is Hetzner's CX family. The provider currently lists CX23 as
2 vCPU / 4 GB / 40 GB; availability must be checked at purchase. Its June 2026
price table lists EUR 5.49/month in Germany/Finland before VAT and IPv4.
Domain, backups, IPv4 and any paid RPC are additional. This is not a quote or
purchase authorization. Any equivalent provider can use these templates.

Sources: https://www.hetzner.com/cloud/cost-optimized/ and
https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ .

## Separation and installation

1. Create the VPS using an SSH public key. Keep an independent recovery login.
   Allow public HTTP/HTTPS; restrict SSH to the operator's administrative access.
   Do not expose port 3000, SQLite, Caddy administration or a local test EVM.
2. Install Node.js 24+ from its official distribution, Caddy from its official
   repository and util-linux (`flock`). Check binary versions/paths before enabling
   the supplied units. Node is expected at /usr/bin/node in these examples.
3. Create three non-login accounts: chogweb, chogkeeper, chogmonitor. Install the
   reviewed production runtime under /opt/chog-arena, owned by root and read-only
   to those accounts. Never put .env or credentials in the web runtime directory.
4. Put public settings in /etc/chog-arena/public.env (root-owned, readable by the
   three service accounts). Use an empty arena address until a reviewed deployment
   exists. Fill ARENA_CONTRACT_ADDRESS, ARENA_FROM_BLOCK and KEEPER_FROM_BLOCK
   from the deployment receipt; the latter two must be the same actual block.
   Keep the Monad RPC URL public unless a paid endpoint is provisioned separately.
5. Transfer an encrypted keystore for the dedicated keeper through a secure local
   administrative workflow. Store it and its password outside the checkout,
   root-owned 0600, at the paths in chog-keeper.service. Do not paste a private
   key/password into chat, Git, a shell command, public.env or the browser.
6. Copy chog-web.service, chog-keeper.service and chog-monitor.service/timer into
   /etc/systemd/system. Validate with systemd-analyze verify before enabling.
   StateDirectory creates separate persistent private state. The keeper's flock
   prevents duplicate production processes. Never run a second keeper using the
   same wallet on another host or issue unrelated transactions from that wallet.
7. Replace arena.example.com in Caddyfile.example with the selected domain, point
   DNS to the server and validate using caddy validate. Caddy proxies to loopback
   and obtains HTTPS certificates. The request-body limit is not DDoS protection.
   Source: https://caddyserver.com/docs/caddyfile/directives/request_body .

## Staging acceptance, before public launch

- Confirm exact build/commit, chain 143, CHOG/collection/treasury and supplied Safe
  and keeper addresses. Recheck Safe code hashes, owners, threshold and modules.
- Check protected files, process users and absence of credentials in the web
  directory or logs. Ensure free disk space and that the private state survives restart.
- Test simultaneous requests, RPC/drand interruption and recovery, keeper restart
  with an outstanding transaction, fee-cap/low-MON alerts and a restored journal.
  Verify enough reveal throughput for the intended match load within the one-hour
  window. Local bounded-queue tests do not establish mainnet throughput.
- Connect external alerts to monitor exit status 2, failed systemd units and the
  public keeper heartbeat. Separately monitor HTTPS from outside this VPS. A local
  timer alone cannot report total host failure. Choose an alert destination before launch.
- Rehearse Safe revocation/rotation and participant settlement/claims in a suitable
  staging deployment. Emergency access must work without this website.
- Publish/verify the deployed contract source and constructor arguments. A real
  deployment or token transfer requires the operator's wallet action. The current
  release guard must not be bypassed with an environment-variable workaround.

## Backups and restore

Back up SQLite using its consistent backup API, not a raw copy of a live .sqlite
file without its WAL. The provided scripts/backup-sqlite.mjs takes a source and a
new destination path and refuses to overwrite existing files. Protect the backup
directory and encrypt off-host copies; the keeper journal contains signed transactions.
Keep credentials separately backed up with independent access controls.

On restore, stop/disable the old keeper first. Never start both copies. Prefer
preserving the most recent transaction journal: an old backup may omit an already
broadcast nonce. The keeper stops on unknown/external nonce usage; reconcile it
before allowing more signing. Public event indices may be rebuilt from the actual
deployment block without changing funds. A rebuild can take time; monitor its lag.
The demo at localhost:3104 uses its own directory and must not be migrated/reset.

## Operator inputs still needed

VPS provider/account, server creation, domain/DNS, alert destination and secure
on-server keeper credential setup. No password or seed phrase is needed in chat.
Live asset verification and measured host tests remain launch conditions.
