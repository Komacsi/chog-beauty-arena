# Chog: Beauty Arena

24-hour contests between two Chog Genesis NFTs. One wallet is one vote. Holders choose whether to participate with or without a CHOG bet. Non-holders must place a bet. Only bettors receive token payouts.

## Holder-created battles and profiles

Any positive bet must be at least **5,000 CHOG**, enforced onchain and in demo/API/UI. Holders can still participate without a bet. The fee remains 1% of each gross winning payout, with no fee on refunds. New demo accounts receive 100,000 fictional CHOG; existing accounts receive a one-time 99,000 CHOG top-up without changing historical matches or claims.

Use `npm run start:demo` to run the simulation independently of any future live address in `.env`. Preserve its `ARENA_STATE_DIR` when restarting; use a separate directory and port for a future live instance.

Connect a wallet and open **Profile** to see owned NFTs and create a battle request. The prototype displays only the 10 imported NFTs; it does not fetch all 1969 images. Live ownership is read from the NFT contract, and the arena enforces ownership again in the transaction. Demo mode provides Holder A, Holder B and Non-holder personas with simulated ownership.

The interface uses collection names (for example, CHOG #1760) rather than internal contract token IDs. Token-ID search is available only in the leaderboard. Live participation without a bet automatically uses one of the wallet's imported owned NFTs as its eligibility proof; there is no manual token-ID field. Wallets whose NFTs are outside the ten-item prototype sample can participate with a bet until their NFTs are imported.

- `createChallenge(tokenId)` creates an open request with the caller's NFT. No round, voting or betting starts yet.
- A different holder calls `acceptChallenge(requestId, ownTokenId)` to start the round. Both NFTs must still belong to the respective participants. The 24-hour deadline is calculated from the acceptance block, irrespective of how long the request waited.
- The creator may call `cancelChallenge(requestId)` until acceptance. Acceptance closes the request atomically; it cannot be canceled after that.
- One NFT may be in only one pending request or unsettled battle at a time, across all wallets. Cancellation releases it immediately; settlement releases both battle NFTs. It can then play again.
- NFTs stay in their owners' wallets. Transfers remain possible. A transfer before acceptance makes the request stale; anyone can clear it. A transfer during a battle does not change that battle or bypass its NFT lock.
- Independent pairs can run concurrently. The lobby lists open requests and active battles, each with its own voting page. The keeper processes every unfinished round, including older rounds while newer ones are accepting votes.

The leaderboard records each NFT's total wins, losses and draws, ordered by wins descending (token ID breaks ties). NFTs with no recorded results are hidden; a losses-only or draws-only NFT remains listed. A decisive completed round gives the winner one win and the opponent one loss, including one-sided-bank rounds with refunded bets. A completed draw counts as one draw for both NFTs only when more than one vote was cast in total (for example, 1–1). Empty 0–0 rounds and canceled rounds do not affect records. Existing demo history is backfilled on startup without changing payouts, wins or losses.

## Encrypted choices and automatic opening

Choices are encrypted locally using drand quicknet timelock encryption (`tlock-js`). The browser sends only a salted commitment, bet amount and fixed-size encrypted ballot. The server does not hold a decryption key and does not receive the plaintext side or salt during betting.

1. Another holder accepts an open request with an available NFT they own, starting a fixed NFT pair and a 24-hour betting window.
2. A participant approves CHOG if needed, then submits `commitVote`. Choices with and without bets are encrypted. The commitment binds the chain, arena address, round, voter, token ID, side, amount and random 256-bit salt.
3. Wallet addresses, bet amounts and the total deposited pool are public. Neither side totals nor chosen sides are published during acceptance. Padded plaintext prevents ciphertext-length leaks between token IDs of different lengths.
4. The drand unlock time is at least five minutes after acceptance closes, with a one-hour opening window. This margin reduces wall-clock/block-timestamp boundary risks.
5. A separate keeper fetches a signed drand beacon, verifies it against the pinned production quicknet key, decrypts the onchain ciphertexts and submits `revealVote` transactions. Anyone may relay matching reveals, but rewards always belong to the original participant.
6. No second participant action is required for opening. Once all choices open, anyone can settle. If opening is incomplete at the deadline, the round is cancelled; all bets are refundable in full, no fees or NFT points are awarded. Partial tallies never decide the winner.

After closing, choices become publicly readable. This provides pre-close choice privacy, not anonymous transfers or permanent secrecy. Security depends on the drand threshold network not releasing future beacons early. The frontend must also serve the reviewed encryption code. A participant can voluntarily disclose their own choice.

**Prototype limitation:** the contract bounds ciphertext size but cannot prove at submission time that an encrypted payload is well-formed and matches its commitment. A deliberately invalid payload can therefore cause a round to cancel. The fail-closed refund protects funds but leaves a denial-of-service risk. Verifiable encryption/admission proofs need further work before a public money-bearing release. Splitting deposits among intermediary addresses does not solve this issue.

## Payouts

The contender with more revealed votes wins, regardless of bet amounts. A complete, non-tied winner earns one NFT leaderboard point.

When both sides have bets, calculate each winning participant separately:

```text
gross = ownStake + floor(ownStake * losingPool / winningPool)
fee   = floor(gross * 100 / 10000)
net   = gross - fee
```

Fees accrue only when the participant claims. The treasury withdraws its accrued fees separately. Draws, one-sided pools and cancelled rounds return each bet in full without fees. Refunds for one-sided pools do not erase a valid winning NFT's point. Integer rounding may leave tiny residual amounts; there is no owner function to sweep participant funds.

Example: winning bets 10,000 and 30,000, losing pool 60,000 CHOG. Gross payouts are 25,000 and 75,000; fees are 250 and 750; net payouts are 24,750 and 74,250 CHOG. A winning holder who participated without a bet gets an NFT voting result, but no token payout.

## Run locally

Requires Node.js 24+. Uses built-in SQLite. The ten sample NFT images are already included.

```sh
npm ci
npm run build
npm start
```

Open http://localhost:3000. Demo identities, holder roles and balances are simulated, but the timelock cryptography and beacon verification are real. Demo ciphertexts are automatically opened by the server.

Copy `.env.example` to `.env` for optional settings. Demo rounds default to two minutes, followed by a five-second unlock margin. `DEMO_FAST_ROUNDS=0` simulates the 24-hour window instead; the live contract always uses 24 hours and a five-minute margin. A future beacon cannot be fast-forwarded. An accepted battle cannot be manually canceled; incomplete automatic opening triggers the protocol's full refund at its deadline. `ARENA_STATE_DIR` optionally selects an isolated SQLite state directory.

```sh
npm run check
npm test
npm run import:nfts           # Only the selected 10 images
npm run import:nfts -- --full # Explicitly import all 1969
```

Previously settled demo records retain their recorded payouts. On migration to holder matchmaking, unfinished auto-generated demo pairs are canceled with full refunds; no new random pairs are generated. The initial demo identity remains Holder A so its existing claims remain accessible. Runtime databases, local secrets, compiled artifacts and browser bundles are ignored by Git.

## Live deployment and keeper

**Security review: real-funds launch is blocked.** See [SECURITY_REVIEW.md](SECURITY_REVIEW.md). Invalid-ciphertext sabotage, keeper operational readiness and external-asset validation remain release conditions. Multi-wallet vote manipulation (SEC-02) is explicitly accepted by the creator and is not a launch blocker. The official server, keeper and setup page reject real-token deployment while the release guard is active. The guard is not an onchain defense and does not stop a third party from deploying source. No live deployment or real token transactions have been performed by the agent. This revision requires a newly deployed contract with the holder-matchmaking ABI; older deployments are not compatible.

1. Review and test the prototype, including its cancellation/invalid-ciphertext limitation.
2. Open `/setup`, connect a Monad wallet and deploy the encrypted arena. Deployment costs MON gas. Save the address and deployment block shown in the interface.
3. Set `ARENA_CONTRACT_ADDRESS` and `KEEPER_FROM_BLOCK` in local `.env`.
4. Configure `KEEPER_PRIVATE_KEY` locally for a separate wallet funded with MON for gas. Never send keys in chat, commit them, or put them in browser code. This wallet has no authority to redirect rewards or withdraw the escrow.
5. Run `npm start` and, as a separate continuously running process, `npm run keeper`. The keeper scans onchain commitment events and pays opening/settlement gas. It retries unavailable RPC/beacon services. It does not have to receive participants' private secrets beforehand.
6. Holders create and accept battle requests through their profiles and the lobby. After automatic opening/settlement, participants claim rewards or refunds. The treasury claims fees separately.

The keeper source is implemented, but no funded production keeper is running. Event queries use ranges of at most 100 blocks, RPC calls time out after 15 seconds and receipt waits after 30 seconds. A timeout does not cancel a broadcast transaction. Hosting, monitoring, durable event/transaction indexing, pending nonce recovery and deployment remain required. API scans coalesce concurrent requests, including fresh requests, with a minimum refresh interval. One-wallet voting is not proof of one human; multiple-wallet manipulation is outside the choice-privacy guarantee.

Opt-in security checks: node scripts/security-assets.mjs inventories public asset bytecode/proxy slots; node scripts/security-fork.mjs runs a disposable local EVM integration against a current Monad snapshot. Upstream RPC is restricted to read methods; all fork transactions stay local. See security/ for the recorded snapshots and the report for limitations. These network-dependent scripts are outside ordinary CI.

## Addresses and NFT IDs

- Monad mainnet: chain ID 143
- Collection: `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`
- CHOG: `0x350035555e10d9afaf1566aaebfced5ba6c27777`
- Treasury: `0x1bED50dC4d93C8b110589Ae55d25eC8e3872bB0D`

Display numbers can differ from token IDs: contract token 1090 is named CHOG #582. The importer reads each tokenURI instead of guessing image filenames. The ten optimized sample images come from their corresponding OpenSea item pages; original IPFS references remain in `data/collection.json`.

## Source

- `contracts/BeautyArena.sol`: holder requests, NFT locks, commitments, relayed reveals, escrow, records and claims
- `lib/timelock.mjs`: fixed-size browser encryption, pinned quicknet configuration and verified decryption
- `lib/keeper.mjs`, `scripts/keeper.mjs`: automatic onchain opening process
- `server.mjs`, `lib/demo.mjs`: persistent demo with the same protocol and payout rules
- `public/`: profiles, request lobby, concurrent battles, sealed side totals, win/loss leaderboard and gross/fee/net rewards
- `test/`: cryptographic fixtures, privacy boundaries, contract and payout tests

Maintained in https://github.com/Komacsi/chog-beauty-arena.
