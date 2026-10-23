#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
backup=/var/backups/chog-v2/cutover-20261023
cd /opt/chog-v2
case "${1:-}" in
keeper)
  test ! -e "$backup"
  test ! -e /etc/systemd/system/chog-keeper.service.d/v2.conf
  node scripts/check-v1-empty.mjs
  systemctl is-active --quiet chog-v2-web.service
  install -d -m 700 "$backup"
  cp -a /etc/caddy/Caddyfile "$backup/Caddyfile"
  systemctl stop chog-monitor.timer chog-monitor.service
  systemctl stop chog-keeper.service
  node scripts/backup-sqlite.mjs /var/lib/chog-live-web/arena.sqlite "$backup/v1-web.sqlite"
  node scripts/backup-sqlite.mjs /var/lib/chog-live-web/chain-index.sqlite "$backup/v1-web-index.sqlite"
  node scripts/backup-sqlite.mjs /var/lib/chog-keeper/events.sqlite "$backup/v1-keeper-index.sqlite"
  node scripts/backup-sqlite.mjs /var/lib/chog-keeper/transactions.sqlite "$backup/v1-transactions.sqlite"
  python3 - <<'PY'
import sqlite3
db=sqlite3.connect('file:/var/lib/chog-keeper/transactions.sqlite?mode=ro',uri=True)
if db.execute("SELECT count(*) FROM transactions WHERE status='pending'").fetchone()[0]:
    raise RuntimeError('Pending V1 keeper transaction; do not change journals')
db.close()
PY
  cat > /etc/systemd/system/chog-keeper.service.d/v2.conf <<'EOF'
[Service]
WorkingDirectory=/opt/chog-v2
EnvironmentFile=
EnvironmentFile=/etc/chog-arena/v2.env
StateDirectory=
StateDirectory=chog-keeper chog-v2-keeper
StateDirectoryMode=0700
Environment=KEEPER_STATE_DIR=/var/lib/chog-v2-keeper
EOF
  cat > /etc/systemd/system/chog-monitor.service.d/v2.conf <<'EOF'
[Service]
WorkingDirectory=/opt/chog-v2
EnvironmentFile=
EnvironmentFile=/etc/chog-arena/v2.env
Environment=MONITOR_BATTLES=0
EOF
  systemctl daemon-reload
  systemctl start chog-keeper.service
  printf 'Keeper started on V2 with a new journal. Verify fresh ready heartbeat before public cutover.\n'
  ;;
public)
  test -f "$backup/v1-transactions.sqlite"
  systemctl is-active --quiet chog-keeper.service chog-v2-web.service
  node scripts/check-v1-empty.mjs
  python3 - <<'PY'
import json,time,urllib.request
from pathlib import Path
h=json.loads(Path('/run/chog-keeper-health/status.json').read_text())
if h.get('phase')!='ready' or h.get('backlogBlocks')!=0 or time.time()*1000-h['checkedAt']>60000:
    raise RuntimeError('V2 keeper is not freshly ready')
c=json.load(urllib.request.urlopen('http://127.0.0.1:3002/api/config'))
if c['arenaAddress'].lower()!='0x8cd36066717ff98d86febc3294a98ac2f0095d05' or c['release']['rulesVersion']!=8:
    raise RuntimeError('Unexpected V2 API configuration')
path=Path('/etc/caddy/Caddyfile');old=path.read_text()
if old.count('reverse_proxy 127.0.0.1:3001')!=1: raise RuntimeError('Unexpected current API route')
path.write_text(old.replace('reverse_proxy 127.0.0.1:3001','reverse_proxy 127.0.0.1:3002'))
PY
  if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
    install -m 644 "$backup/Caddyfile" /etc/caddy/Caddyfile
    exit 1
  fi
  systemctl restart caddy
  systemctl enable chog-v2-web.service
  systemctl start chog-monitor.timer
  printf 'Public API now routes to V2 on loopback 3002. Run public acceptance.\n'
  ;;
rollback)
  test -f "$backup/Caddyfile"
  systemctl stop chog-monitor.timer chog-monitor.service chog-keeper.service
  for name in chog-keeper chog-monitor; do
    if test -f "/etc/systemd/system/$name.service.d/v2.conf"; then
      mv "/etc/systemd/system/$name.service.d/v2.conf" "$backup/$name-v2.conf.failed"
    fi
  done
  install -m 644 "$backup/Caddyfile" /etc/caddy/Caddyfile
  systemctl daemon-reload
  systemctl start chog-keeper.service
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl restart caddy
  systemctl start chog-monitor.timer
  printf 'V1 services/routing restored; V2 state preserved for diagnosis.\n'
  ;;
*) printf 'Use keeper, public or rollback.\n' >&2; exit 2 ;;
esac
