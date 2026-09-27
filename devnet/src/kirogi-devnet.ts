// Kirogi on a real local Midnight devnet (node + indexer + proof server in Docker).
// Deploys the Kirogi contract with real ZK proofs and walks the story end to end:
//   operator deploys + registers a school (tuition only) -> parent seals tuition + exam fee
//   -> school settles tuition (accepted) -> school tries exam fee (refused by the circuit).
// Adapted from midnightntwrk/example-bboard (Apache-2.0) standalone launcher.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { getTestEnvironment } from '@midnight-ntwrk/testkit-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import pino from 'pino';
import pinoPretty from 'pino-pretty';

import * as Kirogi from '../contract/managed/kirogi/contract/index.js';
import { witnesses, createKirogiPrivateState, type KirogiPrivateState } from '../contract/witnesses.js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { waitForUnshieldedFunds } from './wallet-utils';

// @ts-expect-error: needed for apollo websocket subscriptions in the indexer client
globalThis.WebSocket = WebSocket;

const here = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(here, '..', 'contract', 'managed', 'kirogi');
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const PRIVATE_STATE_ID = 'kirogiPrivateState';

const logger = pino({ level: process.env.DEBUG_LEVEL || 'info' }, pinoPretty({ colorize: false, sync: true }));
const say = (msg: string) => logger.info(msg);

type Circuits = 'registerSchool' | 'seal' | 'settle';

const CompiledKirogi = CompiledContract.make<Kirogi.Contract<KirogiPrivateState>>(
  'Kirogi',
  Kirogi.Contract<KirogiPrivateState>,
).pipe(CompiledContract.withWitnesses(witnesses as never), CompiledContract.withCompiledFileAssets(zkConfigPath));

const operatorSk = randomBytes(32);
const parentSk = randomBytes(32);
const schoolSk = randomBytes(32);
const schoolId = Kirogi.pureCircuits.publicId(schoolSk);

const tuition: Kirogi.Remittance = {
  school: schoolId,
  purpose: Kirogi.Purpose.TUITION,
  amount: 1_200_000_000n, // 1,200 USDC (6 decimals)
  nonce: randomBytes(32),
};
const examFee: Kirogi.Remittance = {
  school: schoolId,
  purpose: Kirogi.Purpose.EXAM_FEE,
  amount: 80_000_000n, // 80 USDC
  nonce: randomBytes(32),
};

const testEnv = getTestEnvironment(logger);
let wallet: MidnightWalletProvider | undefined;
let exitCode = 0;

try {
  say('=== 1. Starting local Midnight devnet (node + indexer + proof server) ===');
  const env = await testEnv.start();
  say(`devnet endpoints: ${JSON.stringify(env)}`);

  wallet = await MidnightWalletProvider.build(logger, env, GENESIS_MINT_WALLET_SEED);
  await wallet.start();
  const funds = await waitForUnshieldedFunds(logger, wallet.wallet, env, unshieldedToken());
  say(`genesis wallet NIGHT balance: ${funds.balances[unshieldedToken().raw]}`);

  const zkConfigProvider = new NodeZkConfigProvider<Circuits>(zkConfigPath);
  const stamp = Date.now();
  const providers = {
    privateStateProvider: levelPrivateStateProvider<typeof PRIVATE_STATE_ID, KirogiPrivateState>({
      privateStateStoreName: `kirogi-private-state-${stamp}`,
      signingKeyStoreName: `kirogi-signing-keys-${stamp}`,
      privateStoragePasswordProvider: () => 'Kirogi-Devnet-2026!',
      accountId: GENESIS_MINT_WALLET_SEED,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(env.proofServer, zkConfigProvider),
    walletProvider: wallet,
    midnightProvider: wallet,
  };

  // One private-state slot, re-set before each call to act as a different person.
  const actAs = async (who: string, sk: Uint8Array, draft?: Kirogi.Remittance) => {
    say(`-- acting as ${who}`);
    await providers.privateStateProvider.set(PRIVATE_STATE_ID, createKirogiPrivateState(sk, draft));
  };
  const readLedger = async (address: string) => {
    const state = await providers.publicDataProvider.queryContractState(address);
    if (!state) throw new Error('contract state not found on indexer');
    return Kirogi.ledger(state.data);
  };
  const report = (label: string, tx: { public: { txId: unknown; txHash: unknown; blockHeight: unknown } }) =>
    say(`${label}: txId=${String(tx.public.txId)} txHash=${String(tx.public.txHash)} block=${String(tx.public.blockHeight)}`);

  say('=== 2. Operator deploys Kirogi (real ZK keys, real proof server) ===');
  const deployed = await deployContract(providers as never, {
    compiledContract: CompiledKirogi as never,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: createKirogiPrivateState(operatorSk),
  } as never) as any;
  const address: string = deployed.deployTxData.public.contractAddress;
  providers.privateStateProvider.setContractAddress(address as never);
  say(`CONTRACT ADDRESS: ${address}`);
  report('deploy', deployed.deployTxData);

  say('=== 3. Operator registers the school (accepts TUITION only) ===');
  await actAs('operator', operatorSk);
  const policy: Kirogi.Policy = { tuition: true, dormitory: false, books: false, examFee: false };
  report('registerSchool', await deployed.callTx.registerSchool(schoolId, policy));
  say(`school public id: ${toHex(schoolId)}`);

  say('=== 4. Parent seals two remittances (amount/purpose/school stay private) ===');
  await actAs('parent', parentSk, tuition);
  report('seal tuition 1200 USDC', await deployed.callTx.seal());
  await actAs('parent', parentSk, examFee);
  report('seal exam fee 80 USDC', await deployed.callTx.seal());

  say('=== 5. School settles the tuition remittance (must succeed) ===');
  await actAs('school', schoolSk, tuition);
  report('settle tuition', await deployed.callTx.settle());

  say('=== 6. School tries to settle the exam-fee remittance (must be refused) ===');
  await actAs('school', schoolSk, examFee);
  try {
    const tx = await deployed.callTx.settle();
    report('UNEXPECTED settle exam fee', tx);
    say('FAIL: exam-fee settlement was accepted but should have been refused');
    exitCode = 1;
  } catch (e) {
    say(`REFUSED as expected: ${e instanceof Error ? e.message : String(e)}`);
  }

  say('=== 7. Public ledger state read back from the indexer ===');
  const l = await readLedger(address);
  say(`sealedCount=${l.sealedCount} settledCount=${l.settledCount}`);
  say(`remittances tree first free index=${l.remittances.firstFree()} (commitments only)`);
  say(`settled nullifiers=${l.settled.size()} registered schools=${l.schools.size()}`);
  say(`cap=${l.cap} operator=${toHex(l.operator)}`);
  if (l.sealedCount !== 2n || l.settledCount !== 1n) {
    say('FAIL: unexpected counters');
    exitCode = 1;
  } else {
    say('RESULT: OK (sealed 2, settled 1, exam fee refused)');
  }
} catch (e) {
  exitCode = 1;
  logger.error(`ERROR: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`);
} finally {
  try {
    await wallet?.stop();
  } catch {
    /* ignore */
  }
  if (!process.env.KEEP_DEVNET) {
    say('Stopping devnet containers...');
    await testEnv.shutdown();
  }
}
process.exit(exitCode);
