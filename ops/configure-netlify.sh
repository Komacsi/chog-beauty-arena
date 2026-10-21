#!/usr/bin/env bash
# Run only after approving public API access and obtaining the real Netlify URL.
# Upload server.mjs, lib/web-origin.mjs and ops/Caddyfile.netlify into
# /root/chog-netlify-code as server.mjs, web-origin.mjs and Caddyfile.netlify.
set -euo pipefail
test "$(id -u)" = 0
frontend="${1:?Pass the exact https://SITE.netlify.app origin}"
node --input-type=module - "$frontend" <<'JS'
const value=process.argv[2],url=new URL(value);
if(url.origin!==value || url.protocol!=='https:' || !/^[a-z0-9-]+\.netlify\.app$/.test(url.hostname))throw Error('Expected the exact Netlify production origin');
JS
current="$(realpath -e /opt/chog-arena)"
test "$(dirname -- "$current")" = /opt/chog-releases
node --input-type=module - "$current" <<'JS'
import {pathToFileURL} from 'node:url';
const {RELEASE_STATUS}=await import(pathToFileURL(process.argv[2]+'/lib/release.mjs'));
if(RELEASE_STATUS.realFundsEnabled!==false)throw Error('This publishing step must not enable real funds');
JS
for file in server.mjs web-origin.mjs Caddyfile.netlify; do test -f "/root/chog-netlify-code/$file"; done
caddy validate --config /root/chog-netlify-code/Caddyfile.netlify --adapter caddyfile
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/var/backups/chog-netlify/$stamp"
test ! -e "$backup"
install -d -m 700 "$backup"
cp -a /etc/caddy/Caddyfile "$backup/Caddyfile"
cp -a /etc/chog-arena/public.env "$backup/public.env"
node "$current/scripts/backup-sqlite.mjs" /var/lib/chog-web/arena.sqlite "$backup/arena.sqlite"
release="/opt/chog-releases/netlify-$stamp"
test ! -e "$release"
cp -a "$current" "$release"
install -m 644 /root/chog-netlify-code/server.mjs "$release/server.mjs"
install -m 644 /root/chog-netlify-code/web-origin.mjs "$release/lib/web-origin.mjs"
node --check "$release/server.mjs"
node --check "$release/lib/web-origin.mjs"
test ! -e /opt/chog-arena.netlify-next
rollback() {
    cp -a "$backup/Caddyfile" /etc/caddy/Caddyfile
    cp -a "$backup/public.env" /etc/chog-arena/public.env
    ln -sfnT "$current" /opt/chog-arena
    systemctl restart chog-web caddy
}
trap rollback ERR
python3 - "$frontend" <<'PY'
import pathlib,sys
p=pathlib.Path('/etc/chog-arena/public.env')
lines=[line for line in p.read_text().splitlines() if not line.startswith('ARENA_WEB_ORIGINS=')]
p.write_text('\n'.join(lines)+f'\nARENA_WEB_ORIGINS={sys.argv[1]}\n')
PY
ln -s "$release" /opt/chog-arena.netlify-next
mv -T /opt/chog-arena.netlify-next /opt/chog-arena
install -m 644 /root/chog-netlify-code/Caddyfile.netlify /etc/caddy/Caddyfile
systemctl restart chog-web caddy
systemctl is-active chog-web caddy
trap - ERR
echo "Published API configuration. Backup: $backup"
echo 'Node/SQLite remain private; keeper is not started and real funds stay disabled.'
