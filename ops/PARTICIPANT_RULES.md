# Participant voting exclusion (V2, pending activation)

The owner requested that the two wallets entering a battle cannot vote, while
their CHOG bets remain eligible for normal payouts. This is a new rule, not a
retroactive change to already accepted entries.

- `contracts/BeautyArena.sol` and the pinned live arena
  `0xBBEEe440795aCe96F7b6b0D14dc06A5e6A9005d5` remain unchanged.
- `contracts/BeautyArenaV2.sol` fixes `participantA` and `participantB` at request
  acceptance. Either wallet's NFT vote transaction reverts before usage markers
  change. Their first and subsequent CHOG bets contribute money, but no votes.
- The role is scoped to one round and survives transfers of either battle NFT.
  Other wallets retain per-NFT votes and their first-paid-bet vote. The owner's
  previously accepted multi-wallet/Sybil limitation still applies.
- Bank aggregation, exact refunds, fee rules, timelocks, keeper and Safe powers
  retain the V1 behavior. Participants can bet on either contender.
- New demo rounds use protocol 8; existing demo rounds keep their original
  version and results. No existing entries are migrated to the new voting rule.
- The API/frontend understand V2 round roles. Live services still use V1 ABI and
  startup pins until a verified cutover. The site must not claim that V2 rules
  are active for a V1 round.

## Preparation and activation

1. Compile both artifacts with `node scripts/compile.mjs`. The V1 creation
   bytecode must retain hash
   `0x77d268dd2950a9f2e21ffbc60d6ae84c419fa95584ee1ffa7745ea143e10199e`.
   V2 is separately pinned in `lib/deployment-draft.mjs`.
2. Run the test suite and prepare a new unsigned bundle with
   `node scripts/prepare-deployment.mjs artifacts/NEW_DIRECTORY --v2`.
   This performs read-only CHOG, Safe, nonce, gas and balance checks. It cannot
   sign or broadcast a transaction.
3. Exercise that exact request with `scripts/check-deployment-fork.mjs` against
   a disposable local fork through the read-only upstream gateway.
4. Only the owner opens the local review page in Rabby and signs the creation.
   Recheck fresh nonce/gas immediately before the human-triggered request.
5. Verify the real receipt, constructor, `RULES_VERSION=8` and runtime. Do not
   treat the predicted address or a local fork receipt as a real deployment.
6. Before switching, inspect V1 open requests/unfinished rounds and CHOG bank.
   Existing funds/claims stay in V1 and need their own keeper/read access until
   resolved. Never reset its database or move/relabel its banks as V2 deposits.
7. Explicitly install the V2 ABI in live services, pin the verified new address,
   block and runtime, and create separate V2 web/keeper indices and transaction
   journals. Retain V1 state, deployment records and demos. Recheck startup,
   keeper heartbeat/restart and public config before routing new games to V2.

Creation alone does not activate V2. No mainnet deployment or service cutover
has been performed as part of this preparation.
