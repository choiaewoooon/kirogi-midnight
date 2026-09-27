# Kirogi on a local Midnight devnet

Deploys the Kirogi contract (`../contract/src/kirogi.compact`, unchanged) to a **real local Midnight network**
(node + indexer + proof server in Docker) and runs the story with **real ZK proofs**:

1. operator deploys Kirogi and registers a school that accepts **tuition only**
2. parent seals two remittances: tuition 1,200 USDC and exam fee 80 USDC
3. school settles the tuition remittance → accepted on-chain
4. school tries to settle the exam fee → refused by the circuit (`Purpose not accepted by this school`)
5. public ledger is read back from the indexer: `sealedCount=2`, `settledCount=1`

Evidence from a real run: [`../evidence/devnet-run.txt`](../evidence/devnet-run.txt).

## Prerequisites

- Node.js ≥ 24.11 (tested on v26) and npm
- Docker with the Compose v2 plugin (`docker compose version` must work). Tested with colima on macOS arm64:
  `colima start --cpu 4 --memory 8`
- Compact toolchain `compact` with compiler **0.31.1** installed side by side:
  `compact update 0.31.1 --no-set-default` (the default compiler can stay on 0.34)
- Images (pulled automatically on first run): `midnightntwrk/midnight-node:0.22.3`,
  `midnightntwrk/indexer-standalone:4.0.1`, `midnightntwrk/proof-server:8.0.3`

## Run

```sh
cd devnet
npm install
# colima only: point testcontainers at the colima socket
export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
export TESTCONTAINERS_RYUK_DISABLED=true
npm run devnet        # compiles the contract if needed, starts the devnet, runs the flow, stops the devnet
```

Output is also written to `devnet/devnet-run.log`. Set `KEEP_DEVNET=1` to leave the containers running.
A full run takes a few minutes (devnet boot + proof generation for 5 transactions).

## Why these versions

The official template stack (`midnightntwrk/example-bboard`: midnight-js 4.1.1, wallet-sdk 1.2.0,
node 0.22.3, indexer 4.0.1, proof server 8.0.3) uses `@midnight-ntwrk/compact-runtime` **0.16.0**.
Compact compiler 0.34.0 emits code for runtime 0.19.0, which that stack does not ship, so this package
compiles the same `kirogi.compact` with compiler **0.31.1** (runtime 0.16.0, language 0.23 — matches the
contract's `pragma language_version >= 0.23`). The simulator tests in `../contract` keep using 0.34 / runtime 0.19.

`contract/witnesses.ts` is a copy of `../contract/src/witnesses.ts` (same logic) that imports the
0.31.1-compiled output in `contract/managed/kirogi`. `src/midnight-wallet-provider.ts` and
`src/wallet-utils.ts` are taken from example-bboard (Apache-2.0); `compose.yml` is its standalone devnet.

The genesis wallet (seed `…0001`) is pre-funded on the local dev chain, so no faucet is involved.
