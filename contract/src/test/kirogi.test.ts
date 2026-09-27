import { KirogiSimulator } from "./kirogi-simulator.js";

import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes } from "./utils.js";
import { Purpose, type Policy, type Remittance, pureCircuits } from "../managed/kirogi/contract/index.js";



const USDC = (n: number) => BigInt(Math.round(n * 1_000_000));
const SCHOOL_POLICY: Policy = { tuition: true, dormitory: true, books: true, examFee: false };

describe("Kirogi on Midnight", () => {
  const operator = randomBytes(32);
  const schoolKey = randomBytes(32);
  const otherSchoolKey = randomBytes(32);
  const parent = randomBytes(32);
  let sim: KirogiSimulator;
  let school: Uint8Array;
  let otherSchool: Uint8Array;

  const draft = (to: Uint8Array, purpose: Purpose, amount: bigint): Remittance => ({
    school: to,
    purpose,
    amount,
    nonce: randomBytes(32),
  });

  beforeEach(async () => {
    sim = await KirogiSimulator.deploy(operator);
    school = sim.publicId(schoolKey);
    otherSchool = sim.publicId(otherSchoolKey);
    await sim.as(operator).registerSchool(school, SCHOOL_POLICY);
    await sim.as(operator).registerSchool(otherSchool, SCHOOL_POLICY);
  });

  it("sets the operator and the cap at deployment", async () => {
    const l = sim.getLedger();
    expect(l.operator).toEqual(sim.publicId(operator));
    expect(l.cap).toEqual(USDC(10_000));
    expect(l.schools.size()).toEqual(2n);
  });

  it("refuses school registration from anyone but the operator", async () => {
    await expect(sim.as(parent).registerSchool(randomBytes(32), SCHOOL_POLICY)).rejects.toThrow(/Only the operator/);
  });

  it("seals a remittance as a bare commitment: no school, purpose, amount or sender on the ledger", async () => {
    const r = draft(school, Purpose.TUITION, USDC(1200));
    const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
    const before = sim.getLedger();
    const l = await sim.as(parent, r).seal();
    expect(l.sealedCount).toEqual(1n);
    expect(l.remittances.findPathForLeaf(sim.commitmentOf(r))).toBeDefined();
    // Schools are a public registry by design, so the school id was already on the ledger.
    // Sealing must not add anything that names the school, the sender, the nonce or the amount.
    expect(l.schools.size()).toEqual(before.schools.size());
    const publicState = sim.publicStateDump();
    for (const secret of [r.nonce, sim.publicId(parent)]) {
      expect(publicState.includes(hex(secret))).toBe(false);
    }
    expect(publicState.includes(r.amount.toString())).toBe(false);
  });

  it("settles a tuition payment to the school it names", async () => {
    const r = draft(school, Purpose.TUITION, USDC(1200));
    await sim.as(parent, r).seal();
    const l = await sim.as(schoolKey, r).settle();
    expect(l.settledCount).toEqual(1n);
    expect(l.settled.member(pureCircuits.nullifierOf(r))).toBe(true);
  });

  it("refuses a purpose the school does not accept (exam fee)", async () => {
    const r = draft(school, Purpose.EXAM_FEE, USDC(80));
    await sim.as(parent, r).seal();
    await expect(sim.as(schoolKey, r).settle()).rejects.toThrow(/Purpose not accepted/);
    expect(sim.getLedger().settledCount).toEqual(0n);
  });

  it("refuses to settle the same remittance twice", async () => {
    const r = draft(school, Purpose.BOOKS, USDC(45));
    await sim.as(parent, r).seal();
    await sim.as(schoolKey, r).settle();
    await expect(sim.as(schoolKey, r).settle()).rejects.toThrow(/already settled/);
  });

  it("refuses a school claiming a remittance addressed to another school", async () => {
    const r = draft(school, Purpose.TUITION, USDC(1200));
    await sim.as(parent, r).seal();
    await expect(sim.as(otherSchoolKey, r).settle()).rejects.toThrow(/addressed to another school/);
  });

  it("refuses a remittance that was never sealed", async () => {
    const r = draft(school, Purpose.TUITION, USDC(1200));
    await expect(sim.as(schoolKey, r).settle()).rejects.toThrow(/never sealed/);
  });

  it("refuses a forged opening: changing the amount breaks the commitment", async () => {
    const r = draft(school, Purpose.TUITION, USDC(100));
    await sim.as(parent, r).seal();
    await expect(sim.as(schoolKey, { ...r, amount: USDC(9000) }).settle()).rejects.toThrow(/never sealed/);
  });

  it("refuses an unregistered school, even with a valid remittance", async () => {
    const rogueKey = randomBytes(32);
    const r = draft(sim.publicId(rogueKey), Purpose.TUITION, USDC(1200));
    await sim.as(parent, r).seal();
    await expect(sim.as(rogueKey, r).settle()).rejects.toThrow(/not registered/);
  });

  it("refuses an amount over the cap, and a zero amount", async () => {
    await expect(sim.as(parent, draft(school, Purpose.TUITION, USDC(10_000.000001))).seal()).rejects.toThrow(/over the per-remittance cap/);
    await expect(sim.as(parent, draft(school, Purpose.TUITION, 0n)).seal()).rejects.toThrow(/positive/);
    expect((await sim.as(parent, draft(school, Purpose.TUITION, USDC(10_000))).seal()).sealedCount).toEqual(1n);
  });

  it("lets an auditor verify one remittance from its opening, and nothing else", async () => {
    const r1 = draft(school, Purpose.TUITION, USDC(1200));
    const r2 = draft(otherSchool, Purpose.DORMITORY, USDC(300));
    await sim.as(parent, r1).seal();
    await sim.as(parent, r2).seal();
    await sim.as(schoolKey, r1).settle();
    // The family hands the auditor r1's opening. The auditor recomputes with the same pure circuits.
    const l = sim.getLedger();
    expect(l.remittances.findPathForLeaf(pureCircuits.commitmentOf(r1))).toBeDefined();
    expect(l.settled.member(pureCircuits.nullifierOf(r1))).toBe(true);
    // r2 is sealed but unsettled, and without its opening it is just a hash among hashes.
    expect(l.settled.member(pureCircuits.nullifierOf(r2))).toBe(false);
  });

  it("keeps settlements unlinkable to sealings: the nullifier is not the commitment", async () => {
    const r = draft(school, Purpose.TUITION, USDC(1200));
    expect(pureCircuits.nullifierOf(r)).not.toEqual(pureCircuits.commitmentOf(r));
  });
});
