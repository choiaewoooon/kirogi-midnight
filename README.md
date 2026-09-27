# Kirogi on Midnight

**A remittance a school can settle, and nobody else can read.**

A parent abroad pays tuition. The school gets paid for what the money was sent for, and nothing
else. On Midnight, the chain enforces that without ever learning who sent it, how much it was, or
what it was for. An auditor can check a single remittance when the family hands over its opening,
and still sees nothing about the others.

**[Demo page](https://choiaewoooon.github.io/kirogi-midnight/)** · **[Demo video, 1:39 narrated](https://choiaewoooon.github.io/kirogi-midnight/kirogi-midnight-demo.mp4)**

> 기러기(*kirogi*, wild goose) is what Korea calls a parent who works abroad while the family lives
> on the other side of a border. Roughly $900B a year crosses borders this way.

---

## The problem: purpose-bound money leaks everything on a public chain

Money sent for a child's education is the textbook case for *purpose-bound* payments: the sender
wants it spent on tuition, dormitory or books, and the school only accepts those purposes.

On a transparent chain, enforcing that rule means publishing it. Every transfer shows the family's
wallet, the school, the amount and the purpose. Anyone can reconstruct which family pays which
school, how much they earn, and when the child enrolled. Hiding everything instead (a mixer, a
privacy coin) makes the rule unenforceable and the payment unauditable.

Midnight lets the contract **check the rule on data it never sees**.

## What each party sees

| | Sender | Amount | Purpose | Which remittance | School |
|---|---|---|---|---|---|
| **Public chain** | no | no (only *0 < amount ≤ 10,000*) | no | no (sealing and settling are unlinkable) | yes, when it settles |
| **The school** | its own records | yes | yes | yes | itself |
| **An auditor, given one opening** | that one | that one | that one | that one | yes |

Schools are a public registry on purpose: a school's accepted purposes are not a secret, a family's
payment is.

## How Midnight is used

The contract is [`contract/src/kirogi.compact`](contract/src/kirogi.compact). Every private value
comes in through a **witness** and stays on the device; `disclose()` marks the only four things
that reach the public ledger.

| Circuit | Who calls it | Proves in zero knowledge | Discloses |
|---|---|---|---|
| `registerSchool(school, policy)` | operator | caller holds the operator key | school id, accepted purposes |
| `seal()` | parent | amount is positive and under the per-remittance cap | a commitment `H(school, purpose, amount, nonce)` |
| `settle()` | school | (1) the caller *is* the school named inside a sealed remittance, (2) the school is registered, (3) its policy accepts the hidden purpose, (4) the commitment is a leaf of the remittance Merkle tree, (5) it was not settled before | the school id, a Merkle root, a nullifier `H(nonce)` |

Midnight features this depends on, and what breaks without each one:

- **Witnesses + `disclose()`**: without them, school, purpose and amount would be transaction arguments, visible to everyone.
- **`HistoricMerkleTree` membership (`merkleTreePathRoot` + `checkRoot`)**: proves "one of the sealed remittances" without saying which one. Without it, settling would point at the sealing and link sender to school.
- **Nullifiers in a `Set`**: settle-once without revealing which remittance was settled. A plain "settled" flag on the commitment would re-link the two.
- **In-circuit policy check (`accepts`)**: the purpose is compared to the school's public policy inside the proof. The exam-fee refusal happens without the chain learning that the purpose was an exam fee.
- **Range assertion on a private amount**: `0 < amount ≤ cap` is enforced at sealing while the amount stays hidden, the hook a compliance threshold needs.
- **Exported `pure circuit`s** (`commitmentOf`, `nullifierOf`, `publicId`, `accepts`): the app, the tests and an auditor recompute exactly what the proof checked, from the same compiled code.

## Run it

Prerequisites: **Node.js 22+** and the **Compact compiler 0.34.0**.

```bash
# Compact compiler (skip if `compact compile --version` prints 0.34.0)
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.34.0

npm install
npm run compact     # compiles kirogi.compact: 3 circuits, prover and verifier keys, TypeScript bindings
npm test            # 13 tests on the compiled circuits
npm run demo        # the story below, printed as what the chain sees vs. what each party knows
```

`npm test` and `npm run demo` execute the compiled circuits in memory with
`@midnight-ntwrk/compact-runtime`, the same circuit code the proof server proves. No wallet,
faucet or network is needed.

## It ran on a Midnight network

The same `kirogi.compact` was deployed to a **local Midnight devnet** (node, indexer and proof
server in Docker) and driven through the story with real zero-knowledge proofs from the proof
server. Full log: [`evidence/devnet-run.txt`](evidence/devnet-run.txt).

Contract `786b19edb3acefe6ba0763417d0a35550ebf15d9d3d0d8217b9370500969ebc1`

| Step | Transaction id | Block |
|---|---|---|
| Deploy (operator) | `006a62cc2725e8d5d1e01b279e30396bcf089cba4dd23aeb7659be798dd03a3065` | 17 |
| Register a school that accepts tuition only | `004275518a7b15ff610b76b50888ec71a3243e451dbf8154ff60fef6a1afbeacdf` | 21 |
| Seal tuition, 1,200 USDC | `009371b49b73bdec47bb48bbd36095a9e15f3bbac72c3baa7f120a14af7110c80f` | 25 |
| Seal exam fee, 80 USDC | `0050b2397d8b24ab5dce953e0d6980ff3334f4822967e5cfcde8d7fcede7f26706` | 29 |
| Settle tuition (school) | `00d9c99eae584cdc87bf25eae5c7b69cf0b3921d651f612b49768f18d469a39167` | 35 |
| Settle exam fee | refused before a transaction is built: `failed assert: Purpose not accepted by this school` | |

Read back from the indexer afterwards: `sealedCount=2`, `settledCount=1`, one nullifier, one school.

To reproduce (needs Docker with `docker compose`): see [`devnet/README.md`](devnet/README.md), then
`cd devnet && npm install && npm run devnet`. The devnet package pins the stable Midnight JS 4.1.1
stack, which pairs with Compact compiler 0.31.1; it compiles the same contract source with that
compiler (`compact update 0.31.1 --no-set-default`). The tests and demo above use 0.34.0.

## Demo flow

`npm run demo` runs this story against the compiled contract:

1. **The operator registers a school** that accepts tuition, dormitory and books, but not exam fees.
2. **A parent seals three remittances**: tuition 1,200 USDC, books 45.50 USDC, exam fee 80 USDC. The chain gets three commitments and the fact that each amount is under the cap.
3. **The school settles what is addressed to it.** Tuition and books settle. The exam fee is **refused** (`Purpose not accepted by this school`). The chain never learned it was an exam fee.
4. **The contract refuses four attacks**: settling the tuition twice, another school claiming the remittance, the school inflating the amount (`Remittance was never sealed`, since the commitment no longer matches), and sealing 12,000 USDC over the cap.
5. **What the chain holds**: 3 sealed, 2 settled, 1 school. No sender, no amount, no purpose, no link between a sealing and its settlement.
6. **An auditor checks one remittance** from the opening the family hands over: it was sealed and settled. The other two stay hashes.

## What the tests check

[`contract/src/test/kirogi.test.ts`](contract/src/test/kirogi.test.ts), 13 tests, each attack with its own refusal:

| Attempt | Result |
|---|---|
| Anyone but the operator registers a school | `Only the operator registers schools` |
| Settle a purpose the school does not accept | `Purpose not accepted by this school` |
| Settle the same remittance twice | `Remittance already settled` |
| A school settles a remittance addressed to another school | `This remittance is addressed to another school` |
| Settle a remittance that was never sealed | `Remittance was never sealed` |
| Change the amount when settling | `Remittance was never sealed` |
| An unregistered school settles a valid remittance | `School is not registered` |
| Seal over the cap, or zero | `Amount is over the per-remittance cap`, `Amount must be positive` |
| Sealing publishes sender, nonce or amount | checked against the raw public state: none of them appear |

## What this does not claim

- **Money does not move in this version.** `settle()` authorises a payout; the settlement asset is
  not wired to shielded tokens yet. Paying out from the contract with Midnight's shielded coins
  (`receiveShielded` / `sendShielded`) is the next step.
- **The school is visible when it settles.** Institutions are public here by design. Settlement
  timing could hint at enrolment periods.
- **Purpose is self-declared by the sender.** The proof shows the declared purpose is one the
  school accepts, not that the money was spent on it.
- **The operator is trusted to register real schools.** Restricting settlement to registered
  schools limits where money goes, not collusion.
- **The auditor sees what the family discloses.** Selective disclosure here is voluntary, by
  handing over an opening. A mandatory regulator view key is not implemented.

## Where this comes from

Kirogi started as a remittance-settlement project for BUIDL CTC 2026 Fall on Creditcoin
([choiaewoooon/kirogi](https://github.com/choiaewoooon/kirogi)), where an Ethereum deposit was
proven on Creditcoin. That version made every remittance public. This repository is a
**new implementation on Midnight** written for the Midnight Korea Hackathon 2026: the same
purpose-bound rule, enforced on data the chain never sees. All Compact code, tests and the demo
here were written for this hackathon.

## Layout

```
contract/src/kirogi.compact        the contract
contract/src/witnesses.ts          private state and witnesses (secret key, remittance, Merkle path)
contract/src/test/                 in-memory simulator and 13 tests
demo/story.ts                      the demo flow
devnet/                            deploy and run the story on a local Midnight devnet
evidence/devnet-run.txt            the log of that run
docs/                              the demo page and video (GitHub Pages)
video/                             scene sources and build script for the video
```

Built with the Compact compiler 0.34.0 (language 0.26), `@midnight-ntwrk/compact-runtime` 0.19.0.
Contract scaffolding adapted from [midnightntwrk/example-bboard](https://github.com/midnightntwrk/example-bboard) (Apache-2.0).
