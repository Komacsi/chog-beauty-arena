# NFT votes and repeated CHOG bets — protocol 6

Implemented in the contract, automatic keeper, wallet helpers, demo API and UI.
No live contract is deployed; the release guard remains disabled for real funds.

- Each owned NFT provides one vote without a CHOG bet per battle. Select one
  NFT or any number of eligible NFTs. Different groups may back either contender.
- Ownership is checked at transaction execution. Each selected token ID is marked
  as used for that round across all wallets, so a transfer cannot authorize it
  again. A new battle has independent usage markers. NFTs stay in wallets; no NFT
  approval, transfer or escrow is requested.
- A transaction accepts 1–50 distinct, sorted NFT IDs to bound gas usage. There is
  no five-NFT or per-wallet cap: the frontend splits larger selections into batches.
  Each batch is a separate transaction. Completed batches remain recorded if a
  later transaction fails or is rejected.
- The same wallet may also place multiple CHOG bets, including on different sides.
  Every bet must be at least 5,000 CHOG. Only its first committed paid bet (nonce 0)
  adds one vote. Later bets add money to their chosen side and participate in
  payouts, but add no votes. The amount input explains this rule.
- Each paid bet has an immutable per-wallet, per-round nonce. Commitments bind
  that nonce, account, chain, arena, round, contender, amount and random salt.
  A stale nonce reverts atomically rather than overwriting an earlier bet.
  If the first bet fails to open, later bets do not inherit its voting right.
- NFT batches use a separate commitment domain binding the exact NFT set.
  Padded timelock ciphertext hides the selected side until betting closes.
  Addresses, NFT usage and token amounts remain public. Opening is automatic.
- All submissions must open before early settlement: a repeated bet carrying
  zero votes still contributes to the opening counter and its side's pool.
  Invalid/unopened entries are excluded at the existing opening deadline;
  unopened paid bets are individually refundable without fees.
- Each winning bet receives its own bet plus its proportional share of the
  opposing valid pool; then 1% of that gross payout is deducted. Claims are
  individual and bounded, without loops over a wallet's entire bet history.
  Draws, one-sided pools and emergency cancellations refund without fees.
  NFT-only votes receive no token payout.
- Old saved demo rounds retain their original commitments, rules, payouts and
  claims. Only newly created rounds use protocol 6. The main demo state is not
  reset; integration and browser tests use separate databases.

Validation: 99 tests passed, including 56 NFT votes in two groups, opposite-side
groups, transfer replay prevention, atomic batch rollback, token ID zero, repeat
paid bets, immutable first paid vote, per-bet claims and fees, emergency refunds,
actual timelock automatic opening and HTTP integration. A read-only Monad fork
at block 114860268 also passed with the actual CHOG/NFT contracts: NFT votes plus
repeated paid bets resolve 3–2; winners receive 10,000 gross / 9,900 net each;
an unopened 5,000 CHOG bet is refunded separately; treasury gets 200; bank is zero.
All transactions were local. This is not an independent contract audit.
