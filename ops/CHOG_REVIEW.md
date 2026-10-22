# CHOG token review — 22 October 2026

The bounded bytecode and local fork review passed at Monad block **115693565**.
No incompatibility or additional transfer fee was found in the checked paths.
Matching Solidity source and compiler verification remain unavailable. The owner
explicitly accepted this residual risk for the exact reviewed implementation on
22 October 2026, after reviewing the bytecode/fork evidence and the new preflight.
This closes the narrow CHOG source-provenance launch condition by risk acceptance,
not by source verification. SEC-04's deployment rehearsal remains open and real
funds stay disabled. See security/chog-release-decision.json.

## Identity and scope

- Token: `0x350035555e10d9afaf1566aaebfced5ba6c27777` (Monad 143).
- Fixed EIP-1167 implementation: `0x7f64ccfeb3e3afd7691ea0ef404e947786cefae8`.
- Implementation keccak256: `0x6dda419a8059dd56106bc3bc80bb22ffbe6e5a6f37bf42bf3a655a843e341c26`.
- Runtime: 7417 bytes, including 53 bytes of compiler metadata.
- Controller slot: `0xa7283d07812a02afb7c09b60f8896bcea3f90ace`.
- Pool: `0x116e7d070f1888b81e1e0324f56d6746b2d7d8f1`.
- Initialized and graduated flags were both set at the pinned block.

The 20 dispatcher selectors match the 18 functions in the [official Nad.fun v3
ABI](https://github.com/Naddotfun/contract-v3-abi/blob/35ca13bd26bb2a5418698b13ddcd07008eecc30a/IToken.json)
plus standard `increaseAllowance` and `decreaseAllowance`. An ABI match is not
proof that any published Solidity source compiled to this runtime. Older Nad.fun
constructor-based token source was not treated as matching source.

## Findings

The proxy delegates to a fixed address. The implementation's decoded executable
instructions contain no CALL, CALLCODE, DELEGATECALL, CREATE, CREATE2 or
SELFDESTRUCT; its single STATICCALL is the ecrecover precompile. The observed
permit trace contained exactly the fixed proxy delegate call and that precompile.

Manual inspection of the dispatcher and storage writes found a one-time
initializer (guard at 0x04ac), one-time initial mint, and controller-only
`setIsGraduated` (0x09db). The latter sets the graduated byte to one; no public
clear path was found. The token was already graduated. Before graduation,
transfers to the pool are restricted; after graduation that branch is bypassed.
The transfer core at 0x119f debits and credits the same amount, with no tax branch.
Unknown selectors reach a revert at 0x016c. These are bounded manual findings,
not a formal proof of all reachable control flow.

## Executed checks

All state-changing operations ran on a disposable, loopback-only Anvil fork
(chain 1337), behind a read-only upstream gateway. No mainnet transaction or
operator private key was used.

- Reinitialization failed for outsider, controller and pool. Outsider graduation
  failed; authorized graduation preserved the already-set packed storage value.
- Candidate mint, pause, tax, blacklist, upgrade and ownership selectors reverted
  for both outsider and controller; all 20 dispatcher entries were accounted for.
- Transfers of zero, one base unit, 5000 CHOG plus one base unit and a fractional
  amount preserved exact sender/recipient amounts without extra fees.
- Zero-address, overspending and unauthorized transfer/burn attempts failed.
  Allowance changes, delegated transfer/burn and unlimited allowance behaved as
  expected; authorized burns reduced supply without crediting another account.
- A recipient with a reverting fallback received tokens without a callback.
- EIP-2612 permit accepted a valid disposable signature, rejected altered value
  and replay, and enforced the nonce and approved transfer.
- A **local diagnostic storage override** exercised the pre-graduation branch;
  authorized graduation restored pool transfers while preserving other packed
  fields. That override is not an exploit available on Monad.
- Proxy/implementation code, metadata and role fields remained unchanged.

Evidence: [machine-readable result](../security/chog-bytecode-review.json).
Reproduce after `npm ci --ignore-scripts` using a new output path:

```sh
node scripts/security-chog.mjs artifacts/chog-review-NEW.json 115693565
```

This single-state fork does not establish future chain behavior, mainnet consensus,
issuer economics or undiscovered paths. Original metadata/source retrieval remains
unresolved as recorded in [source status](../security/chog-source-status.json).
Do not label this token source-verified or bypass `lib/release.mjs` based on this
report. Recheck code hashes and relevant state before a real deployment.

## Follow-up and concrete release choice

On 22 October a second bounded retrieval attempt also checked the creating Curve
contract on MonadScan and Sourcify. Its source was not verified either. Four IPFS
gateways from the VPS returned 403 or timed out. Other public branches of
Naddotfun/contracts contained older constructor-based tokens with a different
interface; they cannot verify this runtime. A [Beosin report](https://beosin.com/audits/Nad.fun_202507081815.pdf)
references Naddotfun/contract-v2 and named commits, but that repository/source
returned 404 through the available GitHub access. The report has not been matched
to this deployed implementation and is not counted as its audit. Retrieval
results are in security/chog-source-followup.json. None of these failures proves
that the original author cannot provide the matching source.

The project now provides `validateChogAsset` in lib/chog-asset.mjs. The deployment
preflight calls it **before** constructing/estimating the deployment. It pins the
exact 45-byte proxy and implementation hash above, chain 143, controller/pool,
initialized/graduated bytes and decimals=18. All asset reads use one block number;
uncached header reads reject an observed hash change around the snapshot. Missing
or malformed data fails the check. RPC honesty and changes after this snapshot
remain assumptions; this is a preflight, not continuous battle monitoring or an
onchain guarantee. No environment-variable hash override was added.

The real read-only check passed at block 115700747. A fresh local full-game fork
at block 115700762 passed deposits, repeated bets, NFT votes, a 3–2 result,
aggregate claims, exact excluded-entry refund and fee withdrawal with zero arena
balance. Sources: security/chog-pinned-preflight.json and
security/chog-fork-followup.json. Local regressions reject changed code, token,
network, controller, pool/flags, decimals, missing evidence and observed reorgs.

To repeat the identity check with a new report path:

```sh
node scripts/check-chog-asset.mjs artifacts/chog-preflight-NEW.json
```

The owner chose to accept the documented residual risk of using this exact
bytecode-reviewed token without source verification. Acceptance is recorded as
`CHOG-SOURCE` in RELEASE_STATUS, with the identity/state preflight retained. This
decision concerns only CHOG source provenance: it does not authorize a real
deployment, waive other operational conditions, change SEC-03, or mark SEC-04's
real deployment rehearsal complete. `sourceVerified` stays false. The release
guard stays closed pending the other launch requirements. Obtaining/reproducing
matching source later can strengthen the evidence without rewriting this history.
