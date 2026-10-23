#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
archive=/opt/chog-uploads/participant-v2-20261023.tar.gz
target=/opt/chog-releases/participant-v2-20261023
test ! -e "$target"
test ! -e /opt/chog-v2
test ! -e /etc/chog-arena/v2.env
test ! -e /etc/systemd/system/chog-v2-web.service
test ! -e /var/lib/chog-v2-web
test ! -e /var/lib/chog-v2-keeper
test "${1:-}" != ''
printf '%s  %s\n' "$1" "$archive" | sha256sum --check --status
install -d -m 755 "$target"
tar -xzf "$archive" -C "$target" --no-same-owner --no-same-permissions
cmp /opt/chog-live/package-lock.json "$target/package-lock.json"
cp -a /opt/chog-live/node_modules "$target/node_modules"
ln -s "$target" /opt/chog-v2
python3 - <<'PY'
from pathlib import Path
old=Path('/etc/chog-arena/live.env').read_text()
changes={'ARENA_CONTRACT_ADDRESS':'0x8Cd36066717FF98D86FebC3294A98aC2f0095d05','ARENA_FROM_BLOCK':'115749283','KEEPER_FROM_BLOCK':'115749283'}
lines=old.splitlines(); seen=set(); out=[]
for line in lines:
    key=line.partition('=')[0]
    if key in changes:
        if key in seen: raise RuntimeError('Duplicate public config key')
        seen.add(key); line=key+'='+changes[key]
    out.append(line)
if seen!=changes.keys(): raise RuntimeError('Missing public config key')
path=Path('/etc/chog-arena/v2.env')
with path.open('x') as f: f.write('\n'.join(out)+'\n')
path.chmod(0o600)
PY
install -d -m 700 -o chogweb -g chogweb /var/lib/chog-v2-web
cp -a --reflink=auto /var/lib/chog-live-web/nft-cache /var/lib/chog-v2-web/nft-cache
install -d -m 700 -o chogkeeper -g chogkeeper /var/lib/chog-v2-keeper
install -m 644 "$target/ops/chog-v2-web.service" /etc/systemd/system/chog-v2-web.service
systemd-analyze verify /etc/systemd/system/chog-v2-web.service
systemctl daemon-reload
systemctl start chog-v2-web.service
printf 'V2 runtime and independent loopback API staged; current public route and keeper unchanged.\n'
