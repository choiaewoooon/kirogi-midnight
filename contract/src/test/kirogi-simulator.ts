// Runs the compiled Kirogi circuits in memory: the same code the proof server proves, no network.

import {
  type CircuitContext,
  type ChargedState,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, type Ledger, type Policy, type Remittance, ledger, pureCircuits } from "../managed/kirogi/contract/index.js";
import { type KirogiPrivateState, witnesses } from "../witnesses.js";

const COIN_PK = "0".repeat(64);

export class KirogiSimulator {
  readonly contract = new Contract<KirogiPrivateState>(witnesses);
  readonly address = sampleContractAddress();
  private state!: ChargedState;
  private privateState!: KirogiPrivateState;

  private constructor() {}

  static async deploy(operatorKey: Uint8Array): Promise<KirogiSimulator> {
    const sim = new KirogiSimulator();
    const { currentContractState, currentPrivateState } = await sim.contract.initialState(
      createConstructorContext({ secretKey: operatorKey }, COIN_PK),
    );
    sim.state = currentContractState.data;
    sim.privateState = currentPrivateState;
    return sim;
  }

  /** Act as someone else: a parent, a school, the operator. */
  as(secretKey: Uint8Array, draft?: Remittance): this {
    this.privateState = { secretKey, draft };
    return this;
  }

  getLedger(): Ledger {
    return ledger(this.state);
  }

  /** The raw public state, as anyone watching the chain would hold it. */
  publicStateDump(): string {
    return this.state.toString();
  }

  private context(circuit: string): CircuitContext<KirogiPrivateState> {
    return createCircuitContext(circuit, this.address, COIN_PK, this.state, this.privateState);
  }

  private commit(ctx: CircuitContext<KirogiPrivateState>): Ledger {
    this.state = ctx.queryContexts[this.address].state;
    return this.getLedger();
  }

  async registerSchool(school: Uint8Array, policy: Policy): Promise<Ledger> {
    const r = await this.contract.impureCircuits.registerSchool(this.context("registerSchool"), school, policy);
    return this.commit(r.context);
  }

  async seal(): Promise<Ledger> {
    const r = await this.contract.impureCircuits.seal(this.context("seal"));
    return this.commit(r.context);
  }

  async settle(): Promise<Ledger> {
    const r = await this.contract.impureCircuits.settle(this.context("settle"));
    return this.commit(r.context);
  }

  publicId = (sk: Uint8Array): Uint8Array => pureCircuits.publicId(sk);
  commitmentOf = (r: Remittance): Uint8Array => pureCircuits.commitmentOf(r);
}
