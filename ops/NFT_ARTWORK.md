# NFT artwork cache

V2 cutover, 23 October 2026: the active cache is a complete separate warm copy at
`/var/lib/chog-v2-web/nft-cache`; all 1,969 previews were counted after copying and
public Netlify artwork acceptance passed. Original V1 cache/state remain intact.
The preparation/history and finite download workflow below remain reproducible.

NFT discovery and eligibility still come directly from the collection contract.
This display-only cache never changes ownership, voting, deposits or payouts.

First access previously needed an onchain tokenURI read, remote metadata and an
original IPFS image of about 300 KB. Slow gateways could delay a picture even
after the wallet's NFT list had been found. Prepared 384-pixel WebP previews now
load from the VPS cache before joining any remote-download queue. Expired display
metadata is served while revalidation runs in the background; RPC/IPFS outages
therefore do not hide already cached pictures. Source-image hashes in filenames
keep previews tied to the correct recorded image URI.

All 1,969 previews and their unique source mappings passed the final completeness
check. Originals total 560,479,762 bytes; previews total 58,350,450 bytes, a 9.61x
reduction. Five public Netlify probes ranged from 0.053 to 0.482 seconds from the
VPS. See ../security/nft-artwork.json. The finite preparation job exited zero.

The initial measured preview for token 1121 shrank from 299,272 to 31,956 bytes.
The public Netlify route returned it in 0.354 seconds from the VPS probe. This is
one measurement, not a guarantee for every visitor's network.

## Prepare the complete collection

1. `ops/download-nft-artwork.sh` downloads the two fixed public IPFS roots as
   archives, caps transfer/member sizes, and extracts only numeric JSON/WebP
   regular files. Links and traversal paths are rejected; extraction is never
   delegated to an unrestricted archive unpack command. The original-image
   archive contains 1,969 files. Public archives are under /var/lib/chog-artwork.
   HTTP gateway archive format is documented at
   https://docs.ipfs.tech/reference/http/gateway/ .
   Rate-limited archives may need a pause with no parallel gateway traffic.
   Preserve incomplete files separately; never count them as the full archive.
2. Install Ubuntu's python3-pil package for the operator encoder. Run
   scripts/cache-nft-artwork.mjs as chogweb with ARENA_STATE_DIR=/var/lib/chog-live-web,
   NFT_ARTWORK_ARCHIVE_DIR=/var/lib/chog-artwork, and 1..8 NFT_CACHE_WORKERS.
   The job reads every tokenURI from the fixed collection, obtains its actual
   metadata/image paths, and creates atomic .image.thumb.webp files. Token IDs
   are not treated as display numbers. Original images are retained.
3. Bound the finite job with systemd MemoryMax/CPUQuota, Nice and a write allowlist
   limited to /var/lib/chog-live-web/nft-cache. Its status is artwork-status.json;
   a zero exit and completed=total with failed=[] establish completion. Failures
   are retried at most four passes, with backoff and no signing/transactions.
   Completed previews survive restarts; rerunning skips them.

The serving runtime is /opt/chog-releases/artwork-20261023. Only the live web
service was restarted to load the catalog change; keeper and demo were preserved.
Reverting the web runtime does not remove the cache or modify the contract.
The original ten bundled sample images retain their existing static routes.

Keep archives and state outside Netlify packages and Git.
Browser/public API checks must confirm actual preview bytes and healthy
keeper after preparation. Never report the entire collection ready from a partial
progress count.

The owner confirmed real Rabby connection and NFT discovery in Profile. All 147
Node tests and nine Linux catalog regressions passed after the cache change.
The temporary direct-IPFS probe was stopped; its loopback listeners are closed.
