#!/usr/bin/env node
// Independent GVC derivation implementation (JavaScript — shares no code
// with the spec's Python reference runner) projected over the canonical
// derivation fixtures. Implements spec/graded-verdict-custody.md section 5
// (derivation and rank operations), section 6 (producer-mint prohibition),
// and section 7 (counted populations). The grade vocabulary and its order
// are read from the vendored registration artifact — the ladder is never
// restated here.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const registration = JSON.parse(
  readFileSync(join(HERE, "vendored", "verdict-grade-registration.json"), "utf8"),
);
const fixtures = JSON.parse(
  readFileSync(join(HERE, "vendored", "derivation-cases.json"), "utf8"),
);

const ORDERED = registration.ordered_grades;
const UNVERIFIED = "unverified";
const PROOF = "proof";
const CONSTRUCTED_CHECK = "constructed_check";

// Ordinal strength; unknown values rank 0, below every member.
function rank(grade) {
  const idx = ORDERED.indexOf(grade);
  return idx === -1 ? 0 : ORDERED.length - idx;
}

function oneTierBelow(grade) {
  const r = rank(grade);
  if (r <= 1) return UNVERIFIED;
  return ORDERED[ORDERED.length - (r - 1)];
}

const chain = (role) => ((role?.chain_id ?? "").trim());

function sameChainAgentAuthored(author, producer) {
  if (author?.kind !== "agent") return false;
  return chain(author) !== "" && chain(author) === chain(producer);
}

function sameChainIndeterminate(author, producer) {
  if (author?.kind !== "agent") return false;
  return chain(author) === "" || chain(producer) === "";
}

function derive(input) {
  const counters = {
    unverified_from_unrun_declared: 0,
    degraded: 0,
    producer_mint_rejected: 0,
    unbindable_content_identity: 0,
    same_chain_indeterminate: 0,
  };
  const producer = input.work_producer;
  const currentIdentity = (input.current_content_identity ?? "").trim();

  // Step 1: base = highest tier among declared oracles that ran and passed.
  let base = UNVERIFIED;
  let baseAuthor = {};
  let baseContent = "";
  let unrun = 0;
  for (const oracle of input.declared ?? []) {
    if (!oracle.ran) {
      unrun += 1;
      continue;
    }
    if (oracle.passed && rank(oracle.tier ?? "") > rank(base)) {
      base = oracle.tier;
      baseAuthor = oracle.author ?? {};
      baseContent = (oracle.content_identity ?? "").trim();
    }
  }

  const record = {
    effective_grade: base,
    evidence_kind: base,
    applied_rank_ops: [],
    conflicting_evidence: false,
  };

  // Step 2: unrun-declared cap.
  if (unrun > 0 && rank(record.effective_grade) > rank(UNVERIFIED)) {
    record.effective_grade = UNVERIFIED;
    record.applied_rank_ops.push("unrun_declared_cap");
    counters.unverified_from_unrun_declared += 1;
  }

  // Step 3.1: same-chain cap (proof exempt; indeterminate counted).
  const aboveConstructed = () =>
    record.effective_grade !== PROOF &&
    rank(record.effective_grade) > rank(CONSTRUCTED_CHECK);
  if (sameChainAgentAuthored(baseAuthor, producer) && aboveConstructed()) {
    record.effective_grade = CONSTRUCTED_CHECK;
    record.applied_rank_ops.push("same_chain_cap");
    counters.degraded += 1;
  } else if (sameChainIndeterminate(baseAuthor, producer) && aboveConstructed()) {
    counters.same_chain_indeterminate += 1;
  }

  // Step 3.2: same-tier conflict demotion (ordinal, kind retained).
  if (input.same_tier_conflict) {
    record.conflicting_evidence = true;
    const demoted = oneTierBelow(record.effective_grade);
    if (demoted !== record.effective_grade) {
      record.effective_grade = demoted;
      record.applied_rank_ops.push("conflict_demotion");
      counters.degraded += 1;
    }
  }

  // Step 3.3: staleness reversion; unbindable counted.
  if (
    baseContent !== "" &&
    currentIdentity !== "" &&
    baseContent !== currentIdentity &&
    rank(record.effective_grade) > rank(UNVERIFIED)
  ) {
    record.effective_grade = UNVERIFIED;
    record.applied_rank_ops.push("staleness_reversion");
    counters.degraded += 1;
  } else if (
    (baseContent === "" || currentIdentity === "") &&
    rank(record.effective_grade) > rank(UNVERIFIED)
  ) {
    counters.unbindable_content_identity += 1;
  }

  // Section 6: producer-mint prohibition — derived governs.
  const supplied = input.producer_supplied_grade;
  if (supplied !== undefined && supplied !== null && supplied !== record.effective_grade) {
    counters.producer_mint_rejected += 1;
  }

  return { record, counters };
}

function deepEqual(a, b) {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

const cases = fixtures.cases;
if (!cases || cases.length === 0) {
  console.log("FAIL: no fixture cases — the conformer cannot discriminate");
  process.exit(2);
}
let failures = 0;
for (const testCase of cases) {
  const { record, counters } = derive(testCase.input);
  const got = { ...record, counters };
  if (deepEqual(got, testCase.expect)) {
    console.log(`  OK ${testCase.name}`);
    continue;
  }
  failures += 1;
  console.log(`  FAIL ${testCase.name}`);
  for (const key of Object.keys(testCase.expect)) {
    if (!deepEqual(testCase.expect[key], got[key])) {
      console.log(
        `    ${key}: expected ${JSON.stringify(testCase.expect[key])}, got ${JSON.stringify(got[key])}`,
      );
    }
  }
}
if (failures > 0) {
  console.log(`conformance: ${failures} of ${cases.length} case(s) failed`);
  process.exit(1);
}
console.log(`conformance: all ${cases.length} case(s) passed (independent JS implementation)`);
