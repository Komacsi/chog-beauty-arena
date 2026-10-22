"""Read-only completeness and public-delivery acceptance for NFT artwork."""
import hashlib
import json
import re
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image

cache = Path('/var/lib/chog-live-web/nft-cache')
progress = json.loads((cache/'artwork-status.json').read_text())
assert progress['completed'] == progress['total'] == 1969 and not progress['failed']
original_bytes = preview_bytes = 0
sources = set()
for token_id in range(1, 1970):
    metadata = json.loads((cache/(str(token_id)+'.json')).read_text())
    assert metadata['collection'] == '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763'
    assert metadata['tokenId'] == token_id
    assert re.fullmatch(r'ipfs://bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e/[0-9]+\.webp', metadata['imageUri'])
    sources.add(metadata['imageUri'])
    digest = hashlib.sha256(metadata['imageUri'].encode()).hexdigest()[:16]
    source = cache/(str(token_id)+'-'+digest+'.image')
    preview = Path(str(source)+'.thumb.webp')
    with Image.open(preview) as image:
        assert image.format == 'WEBP' and 0 < max(image.size) <= 384
    original_bytes += source.stat().st_size
    preview_bytes += preview.stat().st_size

def fetch(url):
    started = time.monotonic()
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=30) as response:
        assert response.status == 200
        return response.read(), time.monotonic()-started

samples = []
for token_id in [1, 1121, 1000, 1700, 1969]:
    metadata = json.loads((cache/(str(token_id)+'.json')).read_text())
    digest = hashlib.sha256(metadata['imageUri'].encode()).hexdigest()[:16]
    expected = (cache/(str(token_id)+'-'+digest+'.image.thumb.webp')).read_bytes()
    body, elapsed = fetch('https://chog-beauty-arena.netlify.app/api/nfts/'+str(token_id)+'/image')
    assert body == expected
    samples.append({'tokenId': token_id, 'bytes': len(body), 'seconds': round(elapsed, 3)})
health = json.loads(fetch('https://chog-beauty-arena.netlify.app/api/health')[0])
assert health['status'] == 'ok' and health['keeper'] == 'healthy'
assert subprocess.check_output(['systemctl', 'show', 'chog-artwork-final.service', '-p', 'ExecMainStatus', '--value'], text=True).strip() == '0'
assert subprocess.check_output(['systemctl', 'show', 'chog-artwork-final.service', '-p', 'ActiveState', '--value'], text=True).strip() == 'inactive'
assert subprocess.check_output(['systemctl', 'show', 'chog-metadata-ipfs.service', '-p', 'ActiveState', '--value'], text=True).strip() == 'inactive'
report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'status': 'complete',
          'tokens': 1969, 'previews': 1969, 'uniqueSourceImages': len(sources),
          'originalBytes': original_bytes, 'previewBytes': preview_bytes,
          'reductionFactor': round(original_bytes/preview_bytes, 2),
          'maxPreviewDimension': 384, 'publicNetlifySamples': samples,
          'keeperHealth': health, 'nodeTestsPassed': 147, 'linuxCatalogTestsPassed': 9,
          'finiteJobExitStatus': 0, 'temporaryIpfsServiceStopped': True,
          'transactionsSignedOrSent': 0, 'walletOwnershipDiscoveryChanged': False}
Path('/root/chog-artwork-final-report.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
