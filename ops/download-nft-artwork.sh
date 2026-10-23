#!/usr/bin/env bash
# Fixed public IPFS assets only; no wallet/account/credential access.
set -euo pipefail
test "$(id -u)" = 0
install -d -m 700 -o chogweb -g chogweb /var/lib/chog-artwork
base=/var/lib/chog-artwork
images=bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e
metadata=bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu
for cid in "$images" "$metadata"; do
  if test ! -f "$base/$cid.tar"; then
    gateway=https://gateway.pinata.cloud/ipfs
    if test "$cid" = "$metadata"; then gateway=https://ipfs.filebase.io/ipfs; fi
    if ! curl --fail --retry 3 --retry-delay 3 --max-time 600 --max-filesize 1073741824 \
      "$gateway/$cid?format=tar" -o "$base/$cid.tar.partial"; then
      if test "$cid" = "$metadata"; then printf '%s\n' 'Metadata archive unavailable; fetch individual pinned metadata normally.'; continue; fi
      exit 1
    fi
    mv "$base/$cid.tar.partial" "$base/$cid.tar"
  fi
done
python3 - "$base" "$images" "$metadata" <<'PY'
from pathlib import Path
import re, sys, tarfile
base=Path(sys.argv[1])
for cid,extension in [(sys.argv[2],'webp'),(sys.argv[3],'json')]:
    if not (base/(cid+'.tar')).is_file(): continue
    target=base/cid
    target.mkdir(exist_ok=True)
    count=0
    total_bytes=0
    seen=set()
    with tarfile.open(base/(cid+'.tar'),mode='r|') as archive:
        for member in archive:
            if member.isdir(): continue
            path=Path(member.name)
            if not member.isfile() or not re.fullmatch(r'[0-9]{1,5}\.'+extension,path.name) or path.parts[:-1] not in [(),(cid,)]:
                raise ValueError('Unexpected archive member')
            if not 0<member.size<=8*1024*1024 or count>=2500:
                raise ValueError('Archive exceeds artwork limits')
            total_bytes+=member.size
            if path.name in seen or total_bytes>(16*1024*1024 if extension=='json' else 1024*1024*1024):
                raise ValueError('Duplicate or oversized artwork archive')
            seen.add(path.name)
            content=archive.extractfile(member).read(8*1024*1024+1)
            if len(content)!=member.size: raise ValueError('Incomplete member')
            temporary=target/(path.name+'.partial')
            temporary.write_bytes(content)
            temporary.replace(target/path.name)
            count+=1
    if count!=1969: raise ValueError('Incomplete collection archive: '+str(count))
    print(cid+': '+str(count)+' public files extracted safely')
PY
chown -R chogweb:chogweb "$base"
chmod 700 "$base"
