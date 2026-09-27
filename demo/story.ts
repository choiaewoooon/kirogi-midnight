// The Kirogi story, end to end, on the compiled contract. Run: npm run demo
// Three views of the same events: what the chain shows everyone, what the school knows, what an auditor can check.

import { webcrypto } from "node:crypto";
import { KirogiSimulator } from "../contract/src/test/kirogi-simulator.js";
import { Purpose, pureCircuits, type Remittance } from "../contract/src/managed/kirogi/contract/index.js";

const rand = () => webcrypto.getRandomValues(new Uint8Array(32));
const hex = (b: Uint8Array, n = 8) => Buffer.from(b).toString("hex").slice(0, n) + "…";
const usd = (m: bigint) => (Number(m) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2 }) + " USDC";
const PURPOSE = ["tuition", "dormitory", "books", "exam fee"];

const step = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const pub = (t: string) => console.log(`  \x1b[36mchain  \x1b[0m ${t}`);
const priv = (who: string, t: string) => console.log(`  \x1b[33m${who.padEnd(7)}\x1b[0m ${t}`);
const no = (t: string) => console.log(`  \x1b[31mrefused\x1b[0m ${t}`);

const operator = rand(), parent = rand(), hanbitKey = rand(), rogueKey = rand();
const sim = await KirogiSimulator.deploy(operator);
const hanbit = sim.publicId(hanbitKey);

step("1. The operator registers a school and what it accepts");
await sim.as(operator).registerSchool(hanbit, { tuition: true, dormitory: true, books: true, examFee: false });
pub(`school ${hex(hanbit)} accepts tuition, dormitory, books (public: a school's policy is not a secret)`);

step("2. A parent abroad seals three remittances");
const drafts: Remittance[] = [
  { school: hanbit, purpose: Purpose.TUITION, amount: 1_200_000_000n, nonce: rand() },
  { school: hanbit, purpose: Purpose.BOOKS, amount: 45_500_000n, nonce: rand() },
  { school: hanbit, purpose: Purpose.EXAM_FEE, amount: 80_000_000n, nonce: rand() },
];
for (const r of drafts) {
  await sim.as(parent, r).seal();
  priv("parent", `${PURPOSE[r.purpose]}, ${usd(r.amount)} to ${hex(r.school)}`);
  pub(`commitment ${hex(pureCircuits.commitmentOf(r), 16)}  (amount proven > 0 and ≤ 10,000; nothing else)`);
}

step("3. The school settles what is addressed to it");
for (const r of drafts) {
  try {
    await sim.as(hanbitKey, r).settle();
    priv("school", `settled ${PURPOSE[r.purpose]}, ${usd(r.amount)}`);
    pub(`school ${hex(r.school)} settled one remittance, nullifier ${hex(pureCircuits.nullifierOf(r), 16)} (which one, from whom, how much: not on the chain)`);
  } catch (e) {
    no(`${PURPOSE[r.purpose]}: ${(e as Error).message.replace(/^.*failed assert: /, "")}`);
  }
}

step("4. Attempts the contract refuses");
for (const [label, run] of [
  ["settle the tuition again", () => sim.as(hanbitKey, drafts[0]).settle()],
  ["a school claims a remittance meant for another", () => sim.as(rogueKey, drafts[1]).settle()],
  ["the school inflates the amount it settles", () => sim.as(hanbitKey, { ...drafts[1], amount: 9_000_000_000n }).settle()],
  ["seal 12,000 USDC, over the cap", () => sim.as(parent, { ...drafts[0], amount: 12_000_000_000n, nonce: rand() }).seal()],
] as const) {
  try { await run(); console.log("  UNEXPECTED: accepted", label); process.exitCode = 1; }
  catch (e) { no(`${label}: ${(e as Error).message.replace(/^.*failed assert: /, "")}`); }
}

step("5. What the chain holds");
const l = sim.getLedger();
pub(`${l.sealedCount} sealed, ${l.settledCount} settled, ${l.schools.size()} school registered`);
pub(`no sender, no amount, no purpose, no link between a sealing and a settlement`);
  pub(`visible by design: which registered school settled, and when`);

step("6. An auditor checks one remittance, with the family's consent");
const opened = drafts[0];
priv("auditor", `given the opening of one remittance: ${PURPOSE[opened.purpose]}, ${usd(opened.amount)}`);
priv("auditor", `sealed:  ${l.remittances.findPathForLeaf(pureCircuits.commitmentOf(opened)) ? "yes" : "no"}`);
priv("auditor", `settled: ${l.settled.member(pureCircuits.nullifierOf(opened)) ? "yes" : "no"}`);
priv("auditor", `the other two remittances stay hashes`);
console.log();
