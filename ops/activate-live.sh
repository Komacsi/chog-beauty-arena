#!/usr/bin/env bash
# Final public cutover, authorized by the owner on 23 October 2026.
# Requires the separately tested live services. Never edits demo state/config.
set -euo pipefail
test "$(id -u)" = 0
systemctl is-active --quiet chog-keeper.service chog-live-web.service chog-web.service
systemctl is-enabled --quiet chog-keeper.service chog-live-web.service
/usr/local/bin/node --input-type=module <<'JS'
const config=await(await fetch('http://127.0.0.1:3001/api/config')).json();
const health=await(await fetch('http://127.0.0.1:3001/api/health')).json();
const demo=await(await fetch('http://127.0.0.1:3000/api/config')).json();
if(config.mode!=='live'||!config.release.realFundsEnabled||config.arenaAddress!=='0xBBEEe440795aCe96F7b6b0D14dc06A5e6A9005d5'||health.status!=='ok'||health.keeper!=='healthy'||demo.mode!=='demo'||demo.arenaAddress)throw Error('Live/demo readiness failed');
JS
systemctl start chog-monitor.service
systemctl enable --now chog-monitor.timer
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/var/backups/chog-live/cutover-$stamp"
install -d -m 700 "$backup"
cp -a /etc/caddy/Caddyfile "$backup/Caddyfile"
python3 - "$backup/Caddyfile" "$backup/Caddyfile.live" <<'PY'
import sys
from pathlib import Path
s=Path(sys.argv[1]).read_text()
old='handle @api {\n        reverse_proxy 127.0.0.1:3000\n    }'
assert s.count(old)==1, 'Unexpected public Caddy route; refusing cutover'
Path(sys.argv[2]).write_text(s.replace(old,old.replace(':3000',':3001')))
PY
caddy validate --config "$backup/Caddyfile.live" --adapter caddyfile
# The Caddy admin API is disabled; use a service restart, not HTTP reload.
rollback() { install -m 644 "$backup/Caddyfile" /etc/caddy/Caddyfile; systemctl restart caddy; }
trap rollback ERR
install -m 644 "$backup/Caddyfile.live" /etc/caddy/Caddyfile
systemctl restart caddy
curl -fsS --retry 3 --retry-all-errors --max-time 20 https://chog-api.72-56-98-23.sslip.io/api/health -o "$backup/public-health.json"
curl -fsS --retry 3 --retry-all-errors --max-time 20 https://chog-beauty-arena.netlify.app/api/config -o "$backup/netlify-config.json"
/usr/local/bin/node --input-type=module - "$backup" <<'JS'
import {readFile} from 'node:fs/promises';
const read=async name=>JSON.parse(await readFile(process.argv[2]+'/'+name,'utf8'));
const health=await read('public-health.json'),config=await read('netlify-config.json');
if(health.mode!=='live'||health.status!=='ok'||config.mode!=='live'||!config.release.realFundsEnabled||config.arenaAddress!=='0xBBEEe440795aCe96F7b6b0D14dc06A5e6A9005d5')throw Error('Public cutover acceptance failed');
JS
trap - ERR
printf 'Live public API enabled. Rollback snapshot: %s\n' "$backup"
printf '%s\n' 'Demo remains on loopback :3000/SSH staging and original localhost:3104. No trial battle or transaction was created.'
