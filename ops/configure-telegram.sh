#!/usr/bin/env bash
# Install the reviewed notification patch; never enable/start monitor or keeper.
# Stage monitor.mjs, telegram-alerts.mjs and chog-monitor.service under
# /root/chog-telegram-code, using the exact committed files.
set -euo pipefail
test "$(id -u)" = 0
current="$(realpath -e /opt/chog-arena)"
test "$(dirname -- "$current")" = /opt/chog-releases
test ! -L /etc/chog-arena/telegram.json
test "$(stat -c '%U:%G:%a' /etc/chog-arena/telegram.json)" = root:root:600
require_inactive() {
  if systemctl is-active --quiet "$1"; then
    printf 'Refusing to modify an active %s\n' "$1" >&2
    return 1
  fi
}
require_inactive chog-keeper.service
require_inactive chog-monitor.service
test "$(systemctl is-enabled chog-monitor.timer)" = disabled
node --input-type=module - "$current" <<'JS'
import {pathToFileURL} from 'node:url';
const {RELEASE_STATUS}=await import(pathToFileURL(process.argv[2]+'/lib/release.mjs'));
if(RELEASE_STATUS.realFundsEnabled!==false)throw Error('Notification staging must not enable real funds');
JS
for file in monitor.mjs telegram-alerts.mjs chog-monitor.service; do
  test -f "/root/chog-telegram-code/$file"
done
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/var/backups/chog-telegram/$stamp"
release="/opt/chog-releases/telegram-$stamp"
test ! -e "$backup"
test ! -e "$release"
test ! -e /opt/chog-arena.telegram-next
install -d -m 700 "$backup"
cp -a /etc/systemd/system/chog-monitor.service "$backup/chog-monitor.service"
printf '%s\n' "$current" > "$backup/previous-release.txt"
node "$current/scripts/backup-sqlite.mjs" /var/lib/chog-web/arena.sqlite "$backup/arena.sqlite"
cp -a "$current" "$release"
install -m 644 /root/chog-telegram-code/monitor.mjs "$release/scripts/monitor.mjs"
install -m 644 /root/chog-telegram-code/telegram-alerts.mjs "$release/lib/telegram-alerts.mjs"
node --check "$release/scripts/monitor.mjs"
node --check "$release/lib/telegram-alerts.mjs"
# The official Node tarball on this VPS uses /usr/local/bin/node.
# Substitute the discovered path, as in configure-staging.sh.
node_path="$(command -v node)"
sed "s|/usr/bin/node|$node_path|g" /root/chog-telegram-code/chog-monitor.service > "$backup/next-monitor.service"
systemd-analyze verify "$backup/next-monitor.service"
sha256sum "$release/scripts/monitor.mjs" "$release/lib/telegram-alerts.mjs" > "$backup/patch.sha256"
rollback() {
  cp -a "$backup/chog-monitor.service" /etc/systemd/system/chog-monitor.service
  ln -sfnT "$current" /opt/chog-arena
  systemctl daemon-reload
  systemctl restart chog-web.service
  if test -L /opt/chog-arena.telegram-next; then unlink /opt/chog-arena.telegram-next; fi
}
trap rollback ERR
install -m 644 "$backup/next-monitor.service" /etc/systemd/system/chog-monitor.service
ln -s "$release" /opt/chog-arena.telegram-next
mv -T /opt/chog-arena.telegram-next /opt/chog-arena
systemctl daemon-reload
systemctl restart chog-web.service
systemctl is-active --quiet chog-web.service
curl -fsS --retry 3 --retry-connrefused --max-time 10 http://127.0.0.1:3000/api/config -o /dev/null
require_inactive chog-keeper.service
require_inactive chog-monitor.service
test "$(systemctl is-enabled chog-monitor.timer)" = disabled
trap - ERR
printf 'Notification patch installed. Release: %s\nBackup: %s\n' "$release" "$backup"
printf '%s\n' 'Monitor/keeper remain inactive; real funds remain disabled. Credentials were not read.'
