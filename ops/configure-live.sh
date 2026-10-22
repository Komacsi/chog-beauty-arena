#!/usr/bin/env bash
# Stage live services on loopback. Public cutover is a separate final operation.
set -euo pipefail
test "$(id -u)" = 0
release="$(realpath -e -- "${1:?Pass the unpacked runtime directory}")"
test "$(dirname -- "$release")" = /opt/chog-releases
test ! -e /opt/chog-live
test ! -e /etc/chog-arena/live.env
test ! -e /etc/systemd/system/chog-live-web.service
test ! -e /etc/systemd/system/chog-keeper.service.d/live.conf
test ! -e /etc/systemd/system/chog-monitor.service.d/live.conf
test -f "$release/server.mjs"
test -f "$release/artifacts/BeautyArena.json"
for unit in chog-keeper.service chog-monitor.timer; do
  if systemctl is-active --quiet "$unit"; then printf 'Refusing active %s\n' "$unit" >&2; exit 1; fi
done
for credential in keeper.keystore.json keeper.password telegram.json; do
  test "$(stat -c '%a:%U' "/etc/chog-arena/$credential")" = 600:root
done
/usr/local/bin/node --input-type=module - "$release" <<'JS'
import {pathToFileURL} from 'node:url';
const {RELEASE_STATUS}=await import(pathToFileURL(process.argv[2]+'/lib/release.mjs'));
if(!RELEASE_STATUS.realFundsEnabled || RELEASE_STATUS.arenaAddress!=='0xBBEEe440795aCe96F7b6b0D14dc06A5e6A9005d5' || RELEASE_STATUS.deploymentBlock!==115710675)throw Error('Unexpected release decision');
JS
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/var/backups/chog-live/$stamp"
install -d -m 700 "$backup"
cp -a /etc/caddy/Caddyfile /etc/chog-arena/public.env "$backup/"
readlink -f /opt/chog-arena > "$backup/demo-release.txt"
/usr/local/bin/node /opt/chog-arena/scripts/backup-sqlite.mjs /var/lib/chog-web/arena.sqlite "$backup/demo.sqlite"
chown -R root:root "$release"
chmod -R go-w "$release"
ln -s "$release" /opt/chog-live
install -m 644 /root/chog-live-code/live.env.example /etc/chog-arena/live.env
install -m 644 /root/chog-live-code/chog-live-web.service /etc/systemd/system/chog-live-web.service
install -d -m 755 /etc/systemd/system/chog-keeper.service.d /etc/systemd/system/chog-monitor.service.d
install -m 644 /root/chog-live-code/chog-keeper.live.conf /etc/systemd/system/chog-keeper.service.d/live.conf
install -m 644 /root/chog-live-code/chog-monitor.live.conf /etc/systemd/system/chog-monitor.service.d/live.conf
systemctl daemon-reload
systemd-analyze verify chog-live-web.service chog-keeper.service chog-monitor.service
printf 'Live services staged. Runtime: %s\nBackup: %s\n' "$release" "$backup"
printf '%s\n' 'No service started and public API routing is unchanged. Demo configuration/database preserved.'
