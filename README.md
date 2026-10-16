# Chog: Beauty Arena

24-hour beauty contests between two randomly selected Chog Genesis NFTs. One wallet is one vote. NFT holders can vote free or stake CHOG; non-holders must stake. The winning NFT gets one leaderboard point.

## Current version

- Ten real NFT images stored locally, with metadata read from the Monad contract.
- Arena, leaderboard, name/token-ID search, contest history and reward claims.
- Persistent local demo with simulated holder/non-holder roles and fictional balances.
- Compiled Solidity contract, wallet integration and browser deployment screen.
- No mainnet deployment or real transactions have been performed by the agent.

## Run

Requires Node.js 24 or later. SQLite uses the Node built-in module.

```sh
npm ci
npm run build
npm start
```

Open http://localhost:3000. Demo mode requires no wallet. Use **Finish demo round** to test settlement without waiting 24 hours. Open a different browser profile to simulate another participant. Demo identities and roles are simulated; they are not wallet authentication.

```sh
npm run check
npm test
npm run import:nfts          # Refresh only the selected 10 NFTs
npm run import:nfts -- --full # Explicitly opt into importing all 1969
```

The default binds to loopback. Store `.env` locally; copy `.env.example` if configuration is needed. Runtime database and secrets are ignored by Git. Back up `data/arena.sqlite` to preserve demo history.

## Exact rules

1. A round closes 24 hours after its onchain start timestamp.
2. One vote per wallet per round; a vote and optional stake are submitted together. Votes cannot switch sides or be topped up.
3. A free vote proves ownership of a specified NFT. That NFT cannot be reused for another free vote in the same round after a transfer.
4. The contender with more votes wins, independently of stake sizes.
5. A 1% fee applies to the entire pool (stake plus winnings) only when one side wins and both sides have CHOG stakes.
6. Winners receive `ownStake / totalWinningStake * (totalPool - fee)`. This includes their principal. Losing stakers receive zero in a normal result.
7. Ties return every stake in full, without a fee; neither NFT earns a point.
8. If either side has no stakes, all stakers receive their own stake back in full, without a fee, regardless of which NFT wins. The winning NFT still earns one point.
9. Claimants withdraw individually. The treasury withdraws its accrued fees separately. Integer rounding can leave tiny amounts in the contract; there is no admin sweep of participant funds.

Example: A has stakes of 10 and 30 CHOG and two votes, B has a stake of 60 CHOG and one vote. Pool=100, fee=1, distributable=99. A's participants receive 24.75 and 74.25 CHOG. If B instead has no stakes, A's participants receive exactly 10 and 30 CHOG back and the fee is zero.

New rules apply to newly settled rounds. Previously settled demo records retain their recorded payouts.

## Addresses / data

- Network: Monad mainnet, chain ID 143
- NFT: `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`
- CHOG: `0x350035555e10d9afaf1566aaebfced5ba6c27777`
- Treasury: `0x1bED50dC4d93C8b110589Ae55d25eC8e3872bB0D`

**NFT display numbers differ from contract token IDs.** For example token ID 1090 is named CHOG #582. The importer obtains each token's tokenURI rather than assuming the image filename is the contract ID. The UI shows both fields. The ten optimized sample images are sourced from the corresponding OpenSea item pages; their original IPFS references remain in `data/collection.json`.

## Enable real CHOG mode

1. Complete local review and contract testing first.
2. Visit http://localhost:3000/setup, connect your wallet on Monad, and deploy with **Deploy contract with wallet**. You approve and pay for this transaction yourself. The constructor fixes the collection, CHOG token and treasury addresses.
3. Set the returned address as `ARENA_CONTRACT_ADDRESS` in `.env`, then restart the server.
4. Connect the deploying wallet and choose **Start next random pair**.
5. Wallet holders enter an NFT contract token ID for a zero-stake vote. Stakers approve only their exact stake, then submit the voting transaction.
6. After 24 hours, anyone can settle the round. The owner starts the next randomly suggested pair. Winners use **Claim reward**; the treasury uses **Withdraw developer fees**.

The prototype uses owner-triggered starts and client/server suggested randomness, not verifiable onchain randomness. It does not run an automatic transaction keeper. Votes/stakes are visible before the deadline, and one-wallet voting does not prevent someone using multiple wallets. Gas is paid even for zero-stake votes. These are known product decisions to revisit before a public money-bearing launch.

The server reads live results from the contract; it does not decide winners or hold participant private keys. Live round history is read directly and cached; a production-scale indexer is a future improvement. Local setup does not include internet hosting, monitoring or transaction automation.

## Project structure

- `contracts/BeautyArena.sol`: escrow, voting, settlement, fee and payout logic
- `server.mjs`: local HTTP API, demo persistence and live chain reads
- `public/`: responsive interface and the ten sample images
- `scripts/import-nfts.mjs`: resumable collection import
- `test/`: demo arithmetic and local-EVM contract tests

Source is maintained in https://github.com/Komacsi/chog-beauty-arena.
