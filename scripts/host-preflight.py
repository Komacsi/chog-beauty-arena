#!/usr/bin/env python3
"""Read-only network checks from the deployment host; no keys or transactions."""
import concurrent.futures
import json
import platform
import time
import urllib.error
import urllib.request

DRAND_HASH = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
DRAND_KEY = "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a"
NFT_PATH = "bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/1760.json"


def fetch(url, payload=None):
    request = urllib.request.Request(url, data=None if payload is None else json.dumps(payload).encode(),
                                     headers={"User-Agent": "ChogArena-readonly-preflight/1", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=12) as response:
        data = response.read(512 * 1024 + 1)
        if len(data) > 512 * 1024:
            raise ValueError("Response exceeds limit")
        return json.loads(data)


def check(name, url, kind):
    started = time.monotonic()
    try:
        if kind == "rpc":
            data = fetch(url, {"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []})
            if data.get("result") != "0x8f":
                raise ValueError("Wrong Monad chain ID or RPC error")
        elif kind == "drand":
            data = fetch(url)
            if data.get("hash") != DRAND_HASH or data.get("public_key") != DRAND_KEY:
                raise ValueError("Drand parameters differ from pinned quicknet")
        else:
            data = fetch(url)
            if not isinstance(data.get("name"), str) or not isinstance(data.get("image"), str):
                raise ValueError("Invalid NFT metadata")
        return {"service": name, "ok": True, "elapsedMs": round((time.monotonic() - started) * 1000)}
    except (urllib.error.URLError, ValueError, TimeoutError, OSError) as error:
        return {"service": name, "ok": False, "elapsedMs": round((time.monotonic() - started) * 1000),
                "error": str(error)[:180]}


if __name__ == "__main__":
    jobs = [("Monad RPC", "https://rpc.monad.xyz", "rpc"),
            ("drand quicknet", "https://api.drand.sh/" + DRAND_HASH + "/info", "drand"),
            ("IPFS Filebase", "https://ipfs.filebase.io/ipfs/" + NFT_PATH, "nft"),
            ("IPFS Pinata", "https://gateway.pinata.cloud/ipfs/" + NFT_PATH, "nft")]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda job: check(*job), jobs))
    print(json.dumps({"checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                      "architecture": platform.machine(), "services": results,
                      "transactionsSent": 0}, indent=2))
    raise SystemExit(0 if all(item["ok"] for item in results[:2]) and any(item["ok"] for item in results[2:]) else 2)
