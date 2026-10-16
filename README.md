# Chog: Beauty Arena

24-hour contests between two Chog Genesis NFTs. One wallet is one vote. Holders choose whether to participate with or without a CHOG stake. Non-holders must stake. Only stakers receive token payouts.

## Encrypted choices and automatic opening

Choices are encrypted locally using drand quicknet timelock encryption (`tlock-js`). The browser sends only a salted commitment, stake amount and fixed-size encrypted ballot. The server does not hold a decryption key and does not receive the plaintext side or salt during betting.

1. The owner starts a round with a fixed NFT pair and a 24-hour acceptance window.
2. A participant approves CHOG if needed, then submits `commitVote`. Both staked and unstaked choices are encrypted. The commitment binds the chain, arena address, round, voter, token ID, side, amount and random 256-bit salt.
3. Wallet addresses, stake amounts and the total deposited pool are public. Neither side totals nor chosen sides are published during acceptance. Padded plaintext prevents ciphertext-length leaks between token IDs of different lengths.
4. The drand unlock time is at least five minutes after acceptance closes, with a one-hour opening window. This margin reduces wall-clock/block-timestamp boundary risks.
5. A separate keeper fetches a signed drand beacon, verifies it against the pinned production quicknet key, decrypts the onchain ciphertexts and submits `revealVote` transactions. Anyone may relay matching reveals, but rewards always belong to the original participant.
6. No second participant action is required for opening. Once all choices open, anyone can settle. If opening is incomplete at the deadline, the round is cancelled; all stakes are refundable in full, no fees or NFT points are awarded. Partial tallies never decide the winner.

After closing, choices become publicly readable. This provides pre-close choice privacy, not anonymous transfers or permanent secrecy. Security depends on the drand threshold network not releasing future beacons early. The frontend must also serve the reviewed encryption code. A participant can voluntarily disclose their own choice.

**Prototype limitation:** the contract bounds ciphertext size but cannot prove at submission time that an encrypted payload is well-formed and matches its commitment. A deliberately invalid payload can therefore cause a round to cancel. The fail-closed refund protects funds but leaves a denial-of-service risk. Verifiable encryption/admission proofs need further work before a public money-bearing release. Splitting deposits among intermediary addresses does not solve this issue.

## Payouts

The contender with more revealed votes wins, regardless of stake sizes. A complete, non-tied winner earns one NFT leaderboard point.

When both sides have stakes, calculate each winning participant separately:

```text
gross = ownStake + floor(ownStake * losingPool / winningPool)
fee   = floor(gross * 100 / 10000)
net   = gross - fee
```

Fees accrue only when the participant claims. The treasury withdraws its accrued fees separately. Ties, one-sided pools and cancelled rounds return each stake in full without fees. Refunds for one-sided pools do not erase a valid winning NFT's point. Integer rounding may leave tiny residual amounts; there is no owner function to sweep participant funds.

Example: winning stakes 10 and 30, losing pool 60 CHOG. Gross payouts are 25 and 75; fees are 0.25 and 0.75; net payouts are 24.75 and 74.25 CHOG. A winning holder who participated without a stake gets an NFT voting result, but no token payout.

## Run locally

Requires Node.js 24+. Uses built-in SQLite. The ten sample NFT images are already included.

```sh
npm ci
npm run build
npm start
```

Open http://localhost:3000. Demo identities, holder roles and balances are simulated, but the timelock cryptography and beacon verification are real. Demo ciphertexts are automatically opened by the server.

Copy `.env.example` to `.env` for optional settings. `DEMO_FAST_ROUNDS=1` makes acceptance last 30 seconds with a five-second unlock margin for local testing; the live contract always uses 24 hours and a five-minute margin. A future beacon cannot be fast-forwarded. **Cancel demo & refund** cancels a demo round; it never pretends to decrypt a future beacon. `ARENA_STATE_DIR` optionally selects an isolated SQLite state directory.

```sh
npm run check
npm test
npm run import:nfts           # Only the selected 10 images
npm run import:nfts -- --full # Explicitly import all 1969
```

Previously settled demo records retain their recorded payouts. Runtime databases, local secrets, compiled artifacts and browser bundles are ignored by Git.

## Live deployment and keeper

No live deployment or real token transactions have been performed by the agent. This revision requires a newly deployed contract; it is incompatible with the original plaintext-voting ABI.

1. Review and test the prototype, including its cancellation/invalid-ciphertext limitation.
2. Open `/setup`, connect a Monad wallet and deploy the encrypted arena. Deployment costs MON gas. Save the address and deployment block shown in the interface.
3. Set `ARENA_CONTRACT_ADDRESS` and `KEEPER_FROM_BLOCK` in local `.env`.
4. Configure `KEEPER_PRIVATE_KEY` locally for a separate wallet funded with MON for gas. Never send keys in chat, commit them, or put them in browser code. This wallet has no authority to redirect rewards or withdraw the escrow.
5. Run `npm start` and, as a separate continuously running process, `npm run keeper`. The keeper scans onchain commitment events and pays opening/settlement gas. It retries unavailable RPC/beacon services. It does not have to receive participants' private secrets beforehand.
6. The owner starts rounds through the interface. After automatic opening/settlement, participants claim rewards or refunds. The treasury claims fees separately.

The keeper source is implemented, but no funded production keeper is running. Hosting, monitoring, durable transaction retries and deployment are separate operational steps. One-wallet voting is not proof of one human; multiple-wallet manipulation is outside the choice-privacy guarantee.

## Addresses and NFT IDs

- Monad mainnet: chain ID 143
- Collection: `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`
- CHOG: `0x350035555e10d9afaf1566aaebfced5ba6c27777`
- Treasury: `0x1bED50dC4d93C8b110589Ae55d25eC8e3872bB0D`

Display numbers can differ from token IDs: contract token 1090 is named CHOG #582. The importer reads each tokenURI instead of guessing image filenames. The ten optimized sample images come from their corresponding OpenSea item pages; original IPFS references remain in `data/collection.json`.

## Source

- `contracts/BeautyArena.sol`: commitments, relayed reveals, escrow, settlement and claims
- `lib/timelock.mjs`: fixed-size browser encryption, pinned quicknet configuration and verified decryption
- `lib/keeper.mjs`, `scripts/keeper.mjs`: automatic onchain opening process
- `server.mjs`, `lib/demo.mjs`: persistent demo with the same protocol and payout rules
- `public/`: interface with sealed side totals, leaderboard and gross/fee/net reward display
- `test/`: cryptographic fixtures, privacy boundaries, contract and payout tests

Maintained in https://github.com/Komacsi/chog-beauty-arena.
