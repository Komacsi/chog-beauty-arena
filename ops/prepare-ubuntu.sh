#!/usr/bin/env bash
# Run on a fresh operator-owned Ubuntu 24.04/26.04 x86-64 host. No wallet keys.
set -euo pipefail
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
. /etc/os-release
test "$ID" = ubuntu
case "$VERSION_ID" in 24.04|26.04) ;; *) echo 'Unsupported staging OS'; exit 1;; esac
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg xz-utils python3 util-linux debian-keyring debian-archive-keyring apt-transport-https
cache=/var/cache/chog-arena-install
install -d -m 755 "$cache"

if ! command -v node >/dev/null; then
  # Select an official Node 24 release available on the host's current UTC date.
  version="$(python3 - <<'PY'
import datetime, json, urllib.request
with urllib.request.urlopen('https://nodejs.org/dist/index.json', timeout=20) as r:
    releases = json.load(r)
today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
print(next(r['version'] for r in releases if r['version'].startswith('v24.') and r.get('lts') and r['date'] <= today))
PY
)"
  [[ "$version" =~ ^v24\.[0-9]+\.[0-9]+$ ]]
  archive="node-$version-linux-x64.tar.xz"
  curl -fLsS --connect-timeout 10 --max-time 120 "https://nodejs.org/dist/$version/$archive" -o "$cache/$archive"
  curl -fLsS --connect-timeout 10 --max-time 30 "https://nodejs.org/dist/$version/SHASUMS256.txt" -o "$cache/SHASUMS256-$version.txt"
  (cd "$cache"; grep "  $archive$" "SHASUMS256-$version.txt" | sha256sum --check --strict -)
  test ! -e "/opt/node-$version-linux-x64"
  tar -xJf "$cache/$archive" -C /opt
  for binary in node npm npx; do
    test ! -e "/usr/local/bin/$binary"
    ln -s "/opt/node-$version-linux-x64/bin/$binary" "/usr/local/bin/$binary"
  done
fi
node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'

if ! command -v caddy >/dev/null; then
  # Prevent the package's default public listener from starting before configuration.
  systemctl mask caddy.service
  curl -fLsS --connect-timeout 10 --max-time 30 https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o /var/cache/chog-arena-install/caddy-key.asc
  gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg /var/cache/chog-arena-install/caddy-key.asc
  curl -fLsS --connect-timeout 10 --max-time 30 https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y --no-install-recommends caddy
fi
node --version
npm --version
caddy version
echo 'Dependencies ready. Configure the loopback-only site before unmasking Caddy.'
