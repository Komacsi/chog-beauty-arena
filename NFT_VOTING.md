# NFT voting revision — backend checkpoint

Status: contract, encrypted-ballot handling, keeper and wallet submission helper
are implemented and tested. The demo API and visible NFT selection interface
are not enabled for this revision yet. Existing demo history remains intact.
No live contract has been deployed.

## Implemented

- Each NFT may authorize one vote without a CHOG bet per round, irrespective of
  transfers between wallets. Ownership is checked during the transaction.
- commitHolderVotes accepts a sorted, unique group of 1..50 owned NFT IDs in
  one transaction. Five selected NFTs produce five votes. Additional unused
  NFTs may be submitted in another group. The limit bounds a single transaction,
  not a wallet's total eligible NFTs.
- Only usage markers are stored: no NFT transfer, approval or NFT escrow.
  No CHOG is debited by an NFT-only submission.
- The encrypted choice is bound to the exact selected NFT set, participant,
  round, chain, arena and contender using a separate commitment domain.
  NFT IDs and usage are public; the chosen contender stays encrypted until close.
- The keeper opens the group automatically and counts its stored weight.
  A malformed group is excluded at the existing opening deadline.
- NFT votes do not receive token payouts. Existing funded payout calculations
  remain separate.
- The wallet helper canonicalizes selection, rejects already-used NFTs,
  simulates the transaction and rechecks account/network before requesting
  a signature. It does not request token or NFT approvals.

All 89 tests in the full run passed after the contract/keeper changes. Two
additional wallet-helper regressions passed in a targeted run. Tests include
five votes in one submission, several groups from one wallet, transfer replay
rejection, reuse in a later round, atomic rollback of invalid groups, token ID
zero, automatic drand opening and correct funded payouts alongside NFT votes.

## Awaiting game-rule clarification

Two questions are pending from the creator:

1. May one wallet use NFT votes and additionally place one CHOG bet in the
   same match, or must it choose one participation method?
2. May different NFT groups from one wallet back different contenders, or
   must all of that wallet's votes use one side?

Do not infer answers from preselected UI options. Before completing the frontend
and demo integration, encode the chosen rules in the contract, remove/migrate
the old zero-bet single-wallet entry path, update the protocol version, and add
the corresponding permission/payout regressions. Existing settled demo records
must keep their original voting and payout rules.
