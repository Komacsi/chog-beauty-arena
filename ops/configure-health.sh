#!/usr/bin/env bash
# Reviewed health-only patch. No credential reads, real-funds decision or keeper start.
# Stage server.mjs, service-health.mjs, keeper-health.mjs and telegram-alerts.mjs
# under /root/chog-health-code before invoking.
set -euo pipefail
test "$(id -u)" = 0
current="$(realpath -e /opt/chog-arena)"
test "$(dirname -- "$current")" = /opt/chog-releases
for unit in chog-keeper.service chog-monitor.service chog-monitor.timer; do
  if systemctl is-active --quiet "$unit"; then printf 'Refusing active %s\n' "$unit" >&2; exit 1; fi
done
node --input-type=module - "$current" <<'JS'
import {pathToFileURL} from 'node:url';
const {RELEASE_STATUS}=await import(pathToFileURL(process.argv[2]+'/lib/release.mjs'));
if(RELEASE_STATUS.realFundsEnabled!==false)throw Error('Health staging must not enable real funds');
JS
for file in server.mjs service-health.mjs keeper-health.mjs telegram-alerts.mjs; do test -f "/root/chog-health-code/$file"; done
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/var/backups/chog-health/$stamp"
release="/opt/chog-releases/health-$stamp"
test ! -e "$backup"
test ! -e "$release"
test ! -e /opt/chog-arena.health-next
install -d -m 700 "$backup"
printf '%s\n' "$current" > "$backup/previous-release.txt"
node "$current/scripts/backup-sqlite.mjs" /var/lib/chog-web/arena.sqlite "$backup/arena.sqlite"
cp -a "$current" "$release"
install -m 644 /root/chog-health-code/server.mjs "$release/server.mjs"
for file in service-health.mjs keeper-health.mjs telegram-alerts.mjs; do
  install -m 644 "/root/chog-health-code/$file" "$release/lib/$file"
  node --check "$release/lib/$file"
done
node --check "$release/server.mjs"
sha256sum "$release/server.mjs" "$release/lib/service-health.mjs" "$release/lib/keeper-health.mjs" "$release/lib/telegram-alerts.mjs" > "$backup/patch.sha256"
rollback() {
  ln -sfnT "$current" /opt/chog-arena
  systemctl restart chog-web.service
  if test -L /opt/chog-arena.health-next; then unlink /opt/chog-arena.health-next; fi
}
trap rollback ERR
ln -s "$release" /opt/chog-arena.health-next
mv -T /opt/chog-arena.health-next /opt/chog-arena
systemctl restart chog-web.service
curl -fsS --retry 3 --retry-connrefused --max-time 10 http://127.0.0.1:3000/api/health -o "$backup/health.json"
node --input-type=module - "$backup/health.json" <<'JS'
import {readFile} from 'node:fs/promises';
const health=JSON.parse(await readFile(process.argv[2],'utf8'));
if(health.status!=='ok'||health.mode!=='demo')throw Error('Unexpected staging health');
const response=await fetch('http://127.0.0.1:3000/api/config'),config=await response.json();
if(config.mode!=='demo'||config.release.realFundsEnabled!==false||config.arenaAddress)throw Error('Release state changed');
JS
systemctl is-active --quiet chog-web.service
trap - ERR
printf 'Health patch installed. Release: %s\nBackup: %s\n' "$release" "$backup"
printf '%s\n' 'Keeper and monitor were not started; real funds remain disabled.'
