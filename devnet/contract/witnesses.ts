// Private state for Kirogi. Nothing in here ever reaches the ledger:
// the secret key identifies the caller, the draft is the remittance being sealed or settled.

import { Ledger, Remittance } from "./managed/kirogi/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/compact-runtime";

export type KirogiPrivateState = {
  readonly secretKey: Uint8Array;
  readonly draft?: Remittance;
};

export const createKirogiPrivateState = (secretKey: Uint8Array, draft?: Remittance): KirogiPrivateState => ({
  secretKey,
  draft,
});

export const witnesses = {
  localSecretKey: ({ privateState }: WitnessContext<Ledger, KirogiPrivateState>): [KirogiPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],

  remittanceDraft: ({ privateState }: WitnessContext<Ledger, KirogiPrivateState>): [KirogiPrivateState, Remittance] => {
    if (!privateState.draft) throw new Error("No remittance in private state");
    return [privateState, privateState.draft];
  },

  // The path is read from the public tree, found by the commitment the caller computed privately.
  remittancePath: (
    { privateState, ledger }: WitnessContext<Ledger, KirogiPrivateState>,
    commitment: Uint8Array,
  ) => {
    const path = ledger.remittances.findPathForLeaf(commitment);
    if (!path) throw new Error("Remittance was never sealed");
    return [privateState, path] as [KirogiPrivateState, typeof path];
  },
};
