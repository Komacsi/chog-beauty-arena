#!/usr/bin/env bash
# Loopback-only staging on an operator-owned fresh host. Never enables real funds.
set -euo pipefail
test "$(id -u)" = 0
release="${1:?Pass the absolute prepared release directory}"
release="$(realpath -e -- "$release")"
case "$release" in /opt/chog-releases/*) ;; *) echo 'Unexpected release path'; exit 1;; esac
test "$(dirname -- "$release")" = /opt/chog-releases
test -f "$release/server.mjs"
test -f "$release/lib/release.mjs"
test ! -e /opt/chog-arena
test ! -e /etc/chog-arena/public.env
node --input-type=module - "$release" <<'JS'
import {pathToFileURL} from 'node:url';
const {RELEASE_STATUS}=await import(pathToFileURL(process.argv[2]+'/lib/release.mjs'));
if(RELEASE_STATUS.realFundsEnabled!==false)throw Error('Staging requires the live release guard');
JS
getent group chog-config >/dev/null || groupadd --system chog-config
for account in chogweb chogkeeper chogmonitor; do
  id "$account" >/dev/null 2>&1 || useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$account"
  usermod -a -G chog-config "$account"
done
chown -R root:root "$release"
chmod -R go-w "$release"
ln -s "$release" /opt/chog-arena
install -d -o root -g chog-config -m 750 /etc/chog-arena
cat > /etc/chog-arena/public.env <<'ENV'
MONAD_RPC_URL=https://rpc.monad.xyz
IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/
NFT_IPFS_PRIMARY=pinata
ARENA_CONTRACT_ADDRESS=
ARENA_FROM_BLOCK=
KEEPER_FROM_BLOCK=
ARENA_REVEALER_ADDRESS=0x8e9Ec0de3f9113B5d41e5721B6C0A61d2feE9908
ARENA_GOVERNANCE_ADDRESS=0xa94995D21B5e02eED9472651fe6c4B2a8d6fD47d
DEMO_FAST_ROUNDS=1
KEEPER_MIN_MON=0.1
MONITOR_MAX_ROUNDS=200
ENV
chown root:chog-config /etc/chog-arena/public.env
chmod 640 /etc/chog-arena/public.env
node_path="$(command -v node)"
for unit in chog-web.service chog-keeper.service chog-monitor.service chog-monitor.timer; do
  sed "s|/usr/bin/node|$node_path|g" "/root/chog-stage-units/$unit" > "/etc/systemd/system/$unit"
  chmod 644 "/etc/systemd/system/$unit"
done
if test -f /etc/caddy/Caddyfile; then cp -an /etc/caddy/Caddyfile /etc/caddy/Caddyfile.factory; fi
cat > /etc/caddy/Caddyfile <<'CADDY'
{
    admin off
    auto_https off
}
http://:8080 {
    bind 127.0.0.1
    request_body {
        max_size 16KB
    }
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
CADDY
chmod 644 /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/chog-{web,keeper,monitor}.service /etc/systemd/system/chog-monitor.timer
systemctl enable --now chog-web.service
systemctl unmask caddy.service
systemctl enable --now caddy.service
echo 'Staging listeners are loopback-only; keeper and monitor are not enabled.'
