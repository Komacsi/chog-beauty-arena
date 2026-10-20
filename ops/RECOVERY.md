# Keeper governance and recovery

Service templates only: no production keeper service, key or arena has been configured.
The user-created Safe and funded keeper have been verified read-only; see
security/launch-wallets.json and the public addresses in .env.example.
The live release guard remains enabled. Keep demo on its existing state directory
and port; deploy production as a separate instance.

## Control from outside the game

Governance is a verified **Safe 1.5.0** proxy using the official Safe or SafeL2
singleton, at least two owner confirmations and no enabled modules. Runtime
hashes are pinned in the contract and checked again for privileged calls.
Older Safe versions or a lookalike contract are rejected. Configure the public
address in ARENA_GOVERNANCE_ADDRESS before a future deployment. A 2-of-3 Safe
should use independent signing devices and owners; the keeper must not hold
the owner credentials. The selected owners are recorded in security/launch-wallets.json;
all three addresses matched onchain and the threshold was two at the recorded block.

Operate the Safe from its own trusted interface or compatible wallet; it sends
the governance transaction directly to the arena on Monad chain 143. This
does not depend on the arena website or keeper being available. Confirm Safe
1.5.0 support in the chosen interface on Monad during staging. Keep the chain,
Safe, arena, token, treasury and deployment-block addresses in an offline record.
Do not rely on an arena-hosted button as the sole emergency access.

From a clean admin workstation with the repository and public configuration,
export a transaction for Safe Transaction Builder:

    npm run governance -- revoke --output revoke.json
    npm run governance -- replace 0xNEW_KEEPER --output replace.json
    npm run governance -- cancel 12 --output cancel-round-12.json

The tool validates the network and Safe and simulates the arena call. It only
writes JSON; it does not hold keys, sign or broadcast. Generation alone changes
nothing. Import the JSON into Safe Transaction Builder, verify chain 143, the
recorded arena address, method, arguments and zero MON value on an independent
display. Collect the required owner approvals and execute. If the workstation
is unavailable, the same public arena ABI exposes revokeRevealer(),
setRevealer(address), and emergencyCancelRound(uint256) to a compatible Safe
transaction interface. No special server token is required.

## Suspected compromised keeper

1. Confirm and execute **revokeRevealer() first**, using the independent Safe.
   The old key loses reveal permission when this transaction is included.
   New battles and deposits pause. Every currently unfinished round is marked
   for cancellation/refund via an ID watermark without an unbounded loop.
2. Stop the old service and isolate/rebuild its host. Do not put a replacement
   key on a host still suspected compromised.
3. Anyone can call settle(roundId) for an interrupted round immediately,
   including before its former deadline. The arena UI offers Finalize refunds.
   This releases NFT locks and makes each participant's original deposit
   claimable without fees. Participants call claim themselves; tokens are not
   pushed automatically to every wallet. Interrupted rounds affect no records.
4. Create a fresh, separate gas-funded keeper wallet on the rebuilt host.
   Execute setRevealer(newPublicAddress) through Safe and start the new service.
   Old interrupted rounds cannot resume even after replacement. New round IDs
   use the replacement. Existing open requests can be accepted again.
5. Check completed claims, fees, interrupted refunds, service logs and all
   Safe/arena role events. Completed rounds are not undone or confiscated.

For planned maintenance with no compromise, setRevealer(newAddress) rotates
the service without invalidating active rounds; the new keeper continues their
reveals. For a single unfinished round, emergencyCancelRound(id) makes all its
deposits refundable immediately. Neither action can rewrite completed results.
Governance transfer is two-step: transfer-governance NEW_SAFE, then
accept-governance using the new Safe. Renouncing governance is disabled.

## Service isolation and credentials

Use a separate non-login OS user for the keeper, read-only reviewed source and
runtime dependencies, and a separate monitor user with no access to credentials.
Review and adapt the supplied systemd examples before installing them. They are
not installed automatically and must be tested on the selected Linux host.

Store an encrypted Ethereum JSON keystore and its password outside the checkout,
root-owned 0600, under /etc/chog-arena. LoadCredential passes private copies to
the keeper; raw KEEPER_PRIVATE_KEY is rejected. The public.env file contains only
ARENA_CONTRACT_ADDRESS, MONAD_RPC_URL and KEEPER_FROM_BLOCK (and public alert
thresholds), not credential paths/passwords. Unit credential environment paths
must not be overridden by a local .env file. Prefer no .env in the deployment
checkout. The Node runtime must be /usr/bin/node 24+ or update ExecStart.

On Windows, enforce equivalent file ACLs: the POSIX 0600 check is Linux-only.
Use a wallet's encrypted keystore export; never paste production keys into a
shell command, source, chat or browser frontend. The keystore is unlocked in
the keeper's memory. This is encrypted storage, **not HSM/non-exportable signing**:
host root or process compromise can still steal credentials or misuse signing.
LoadCredential cannot protect a running process from a fully compromised host.

The monitor needs only public RPC access. npm run monitor emits one JSON health
record and exits 2 for alerts or a failed check. Timer/service failures and logs
must be connected to the operator's chosen alerting destination independently
of this host. No external alerts have been configured or sent by this change.
It detects low keeper MON (default 0.1, configurable KEEPER_MIN_MON), revoked
authorization, stale/failed RPC, invalid governance configuration, unfinished
emergency refunds, near reveal deadlines and overdue settlement. It checks at
most MONITOR_MAX_ROUNDS recent rounds (default 200, maximum 1000) and explicitly
alerts COVERAGE_LIMIT when older history is not checked. It is a bounded health
check, not the missing durable event/nonce index or an uptime guarantee.

The keeper stops when it observes a different authorized address. Contract
authorization is the security boundary even if a malicious old process keeps
running. Receipt timeouts do not cancel broadcasts; pending nonce recovery and
durable indexing remain release requirements in SECURITY_REVIEW.md.

## Remaining trust

As requested, no independent keeper quorum or pre-detection censorship defense
is added. A compromised keeper can omit valid reveals before revocation and
change an outcome. A malicious/compromised governance quorum can cancel
unfinished legitimate matches or appoint an untrustworthy keeper, but cannot
directly withdraw participant banks, change the fixed treasury/fee, upgrade the
arena or redirect claims. Two signatures only help when those signing devices
and their decision process remain independent and secure. Changing Safe
thresholds/modules must be governed and monitored; a blocked configuration must
be repaired within Safe before arena governance calls work again.
