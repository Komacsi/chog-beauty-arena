# Owner-reviewed arena deployment

## Actual owner-signed deployment

On 22 October 2026 the owner sent transaction
`0x705c50b552a7e132bf44eff7a5f345cad7ea5bc7bb748e092eddb0103cfb158a`.
The verified arena is `0xBBEEe440795aCe96F7b6b0D14dc06A5e6A9005d5`, created at
block **115710675**. This address is now confirmed by the mainnet receipt, not just
the previous prediction. Creation input and nonce, deployed runtime/immutables,
governance, revealer and initial game rules/counters passed the read-only verifier.
Evidence: security/arena-deployment.json. Actual gas fee: **0.742794903 MON**.

The final wallet-signed gas limit/fees differ from the preparer's draft; constructor
data, sender, nonce, chain and zero value match. The record preserves actual signed
gas fields. Wallet review is authoritative for the final gas cost limit: the draft
quote is not a guarantee that wallet software will preserve its gas fields.

Do not repeat contract creation. Preserve the prepared source bundle at
artifacts/deployment-review-final-20261022 for subsequent verification. Keep
the original demo configuration and data separate. Normal web/keeper guards remain
closed; source publication and controlled operational rehearsal are separate next
steps. The VPS demo still uses its blank arena/from-block fields and keeper is
inactive. The address and block above are the values to use when preparing the
separate controlled keeper/runtime configuration.

## Preparation history and reproduction

The confirmed deployer/immutable treasury is
`0x1bED50dC4d93C8b110589Ae55d25eC8e3872bB0D` (Monad 143). Safe governance is
`0xa94995D21B5e02eED9472651fe6c4B2a8d6fD47d`; keeper is the separate
`0x8e9Ec0de3f9113B5d41e5721B6C0A61d2feE9908`. Confirmation of these addresses
and CHOG source-risk acceptance is recorded separately in security/. Neither is
an automatic signature or a real-funds release.

## Prepare and review

```sh
npm ci --ignore-scripts
npm run compile
node scripts/prepare-deployment.mjs artifacts/deployment-review-NEW
node scripts/serve-deployment.mjs artifacts/deployment-review-NEW
```

Use a new output directory; the preparer refuses overwriting an earlier bundle.
It compiles with pinned solc 0.8.30, optimizer 200, Shanghai, gathers the exact
15-source self-contained standard JSON input, recompiles that bundle and compares
creation bytecode/ABI with the reviewed artifact. A hardcoded creation hash
rejects an unreviewed contract build. It verifies the owner's recorded addresses,
CHOG identity/state, Safe owners/threshold, balance, nonce, fees and constructor
gas using public read-only RPC. There is no signer or credential access.

The directory contains deployment.json (unsigned EIP-1559 request), manifest.json,
source-input.json, artifact.json, runtime-template.json and the local review UI.
No keystore, password, .env or demo database is read/copied. The source bundle is
for subsequent arena source verification; it does not verify CHOG's source.

Open **http://127.0.0.1:3110/** in the owner's ordinary browser with Rabby.
The Codex in-app browser has no Rabby extension. Select the confirmed deployer,
connect, review all addresses and the displayed maximum gas cost, then choose
whether to open the request in Rabby and sign/send it yourself. Deployment value
is zero MON, gas is paid in real MON. The nonce-2 draft predicts
`0xBBEEe440795aCe96F7b6b0D14dc06A5e6A9005d5`; this is **not evidence of an
existing deployment** and changes if the nonce changes.

Before the human-triggered request the page again checks account, chain, exact
CHOG, Safe, latest/pending nonce, gas estimate, base fee and balance. The request
is zero-value contract creation with the exact constructor; no arbitrary target,
value, additional fields or replacement build is accepted. Accounts/network
changes invalidate the review. No wallet request runs on page load, and no
automatic retry is made after a wallet request. After an ambiguous wallet error,
inspect Rabby's pending/history before trying again. Changed nonce or fee cap
requires a new reviewed draft, not silently changing the transaction.

The static server binds only 127.0.0.1, validates Host/Origin, rejects cross-site
requests, exposes a fixed file allowlist and accepts no POST/deployment endpoint.
Only the owner's explicit browser click can invoke Rabby's eth_sendTransaction.
The server never broadcasts. It is separate from both demo server/state and the
Netlify deployment. Do not publish this operator page on the public game site.

## Simulation evidence

```sh
node scripts/check-deployment-fork.mjs artifacts/deployment-review-NEW artifacts/deployment-fork-NEW.json
```

This opt-in tool deploys the exact request on loopback-only Anvil through the
read-only upstream gateway, with fake MON and impersonation. Its local chain ID
is deliberately 143 to exercise the exact request; no real private key or
mainnet broadcast is involved. It runs the post-deployment verifier against the
local node, checks runtime outside compiler immutable placeholders, all immutable
addresses, initial owner/revealer, fee/minimum/duration rules and empty counters.
The saved local report explicitly says mainnetArenaDeployed=false. This is not a
Monad consensus/gas guarantee or a completed real-game rehearsal.

## After the owner sends

Copy the public transaction hash from the page/Rabby. Then run:

```sh
node scripts/verify-deployment.mjs artifacts/deployment-review-NEW PUBLIC_TX_HASH artifacts/mainnet-verified-NEW.json
```

The verifier uses the configured MONAD_RPC_URL (default fixed public Monad RPC),
has no signer and requires two block observations. It verifies successful
creation, sender/nonce/zero value/exact initcode, predicted receipt address,
canonical block, compiled runtime including checked immutable values, initial
rules/counters and current CHOG/Safe. Localhost RPC results are labeled simulation
only and never reported as a verified mainnet deployment. A trusted RPC remains
an assumption. No repeat transaction is sent by this command.

If the owner authorizes public source publication, verify the arena using
source-input.json, exact compiler version and constructor parameters. Local
source/bytecode matching has already passed; Sourcify publication is a separate
transparency step, not required by the game or keeper. Record the arena address and deployment block
only after checking the actual receipt; never configure the prediction as if it
were deployed. Separately prepare the runtime, start the keeper in controlled
rehearsal, check automatic opening/payout/refund/recovery, then review the public
release decision. The normal web/keeper guard stays false for SEC-03 and the
remaining deployment/rehearsal portion of SEC-04. Existing demo/history stays
separate and no battle-monitoring expansion is introduced.

## Owner steering, 23 October 2026

The owner explicitly declined the real trial battle. Remove that battle and the
request for two NFT-holder wallet addresses from the plan. Do not substitute it
with an unrequested real-money test, or describe the unperformed battle as passed.
Existing fork/EVM evidence and actual mainnet creation/bytecode checks stand as
recorded. Continue runtime/keeper startup, RPC and heartbeat checks without a real
battle, then make the code-reviewed live-release decision separately. The owner's
question about Sourcify's purpose is not publication consent. See
security/launch-owner-decisions.json; source submission remains unperformed.
