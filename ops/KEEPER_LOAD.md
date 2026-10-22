# Keeper load validation - 22 October 2026

The owner expects at most **50 people** and explicitly does not require optimization for a large influx. This is a traffic forecast, not an enforced admission limit. One wallet may submit repeated CHOG bets and several NFT groups. Capacity is measured in entries needing reveal transactions, not people or individual NFT vote weight. A group of 50 NFT votes takes one reveal transaction; 50 individually submitted groups take 50.

## Results

| Scenario | Valid entries / rounds | Outcome |
| --- | --- | --- |
| Small-audience reference, modeled RPC 250 ms | 100 / 10 | All 100 opened and ten rounds settled/indexed in 11 min 12 sec modeled time; no exclusions. |
| Modeled RPC 32 ms | 1000 / 10 | All opened; completion including settlement/indexing in 29 min 35 sec. |
| 32 ms + 1000 malformed entries, two outages | 1000 / 10 | All valid entries opened by 33 min 12 sec; all rounds settled after the deadline, as required for malformed entries. 32 accepted-but-disconnected sends and 21 journal/index reopens caused no duplicate operations or lost nonce. |
| Modeled RPC 250 ms, high load | 1000 / 10 | 589 opened; 411 valid entries remained unopened at the deadline. All rounds settled and queues drained. This is a demonstrated capacity risk in the model. |
| Actual contract on local Anvil | 128 paid entries + 200 NFT votes in four groups / 4 rounds | Every valid entry opened; five journal/index reopens; four malformed paid entries refunded, all rounds settled, claims and fees conserved all 660,000 mock CHOG; arena final balance zero and NFTs stayed in their wallets. |

The small reference is comparable to 50 participants each submitting two reveal entries. It does not claim that every workload created by 50 people fits: paid bets and NFT group submissions are intentionally uncapped. Under the owner's stated audience forecast, no batching or larger-traffic protocol change was made. Other SEC-03 operational checks and SEC-04 source validation remain separate; the release guard was not changed.

## What was actually measured

On the actual VPS, a low-rate sample made 27 sequential public RPC reads, with no failures. The first connection took 562 ms; subsequent reads took 10-15 ms. Mean including first connection was 32 ms, p95 15 ms. A 64-block timestamp sample spanned 20 integer seconds (312.5 ms/block at that resolution). The model uses 300 ms blocks as an explicit assumption, not an inference of precise block timing from a short sample.

The VPS model uses the unchanged production keeper cycle, SQLite event index, synchronous signed-transaction journal, real timelock encryption/decryption, random disposable signing wallet, one outstanding nonce, three confirmations and the normal one-second pause. RPC/blocks/inclusion are simulated. Per-request latency is charged serially even for reads production may overlap: this conservative timing budget is not an exact parallel-network scheduler. Inclusion at the next block is optimistic. The 1,000 model entries are repeated paid commitments from one wallet across ten rounds, each with a distinct bound round/nonce and ciphertext. Real token and NFT accounting is checked separately in the local EVM, not implemented by the timing model.

All VPS model cases ran under a transient DynamicUser unit with PrivateNetwork, ProtectHome, ProtectSystem=strict, PrivateTmp, one CPU and 768 MiB memory limit. No real wallet or credential file was used. The main run took 384.8 seconds on the host; its reported process maxRSS was 284,164 KiB. Systemd separately recorded 244.2M cgroup memory peak and zero swap; these counters use different accounting. The website's loopback health returned 200 in 0.000990 seconds during load and remained active after it. Production keeper remained inactive; demo state was not touched. Raw evidence and normalized source hashes are in security/keeper-load-summary.json and linked JSON files.

The local EVM runs actual arena bytecode and official Safe with mock ERC20/ERC721. It mines three blocks manually per cycle and accelerates the deadline. Its 67.9-second reveal wall time is **not** mainnet throughput. Measured local EVM gas per reveal was 66,754-140,249 for paid entries, 82,172 for a 50-NFT group and 117,627 per settlement; gas is not converted to a live MON fee quote. All fee/refund transfers were checked against integer balances. Token mocks do not validate CHOG source behavior.

## Reproduction

Use Node 24 and the repository's locked dependencies:

```
npm ci --ignore-scripts
npm run compile
node scripts/sample-keeper-rpc.mjs artifacts/rpc-NEW.json
node scripts/load-keeper.mjs artifacts/load-NEW.json 1000 32
node scripts/load-keeper.mjs artifacts/small-NEW.json 100 32 slow-rpc-250ms
node scripts/load-keeper-evm.mjs artifacts/evm-NEW.json 128
```

All report paths must be new; scripts refuse overwriting them. The first script uses only the fixed public Monad endpoint and bounded reads. The other two run offline (the EVM binds loopback only) and never load operator credentials. Test SQLite directories are disposable and removed at completion. Do not run these tools against the real signing journal or substitute a real keeper key. The historical drand fixture tests crypto correctness, not future-beacon availability.

## Interpreting the limit

The current worker submits one reveal and waits for confirmation before the next nonce. Its one-second loop pause alone gives a ceiling below 3,600 separate reveal transactions per hour before RPC, crypto, confirmation and settlement overhead. This is a ceiling, not supported capacity. Heavy repeated betting or many individually submitted NFT groups can consume it even with few people. Unopened valid deposits are refundable under the existing contract rules, but their votes are excluded and can affect the result. The local EVM verifies exact refunds; the model does not calculate monetary claims.

If the expected workload grows, repeat the test for a concrete entry count and consider bounded batch reveals, fewer redundant reads, persistent decoded work and a properly tested RPC strategy. Those are future changes, not part of this validation or an implicit change to the owner's accepted traffic model. A short read sample and an offline model do not establish transaction propagation, chain gas capacity, public RPC quotas, long outages or full mainnet readiness.
