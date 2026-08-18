#!/usr/bin/env node
// Independent GVC derivation implementation (JavaScript — shares no code
// with the spec's Python reference runner) projected over the canonical
// derivation fixtures. Implements spec/graded-verdict-custody.md section 5
// (derivation, tied-set MAX, tie selection, rank operations), section 6
// (producer-mint prohibition), section 7 (counted populations), and
// section 8 (fail-closed admission). Fixture comparison follows the
// section 9.2 posture: counted populations compare per canonical
// population through a declared injective total mapping, never by
// whole-structure equality. The grade vocabulary and its order are read
// from the vendored registration artifact — the ladder is never restated
// here.

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

// Section 9.2: canonical population identifiers — one per population named
// in section 7. This implementation uses the canonical spellings directly,
// so its declared mapping is the identity map: static, total over the
// canonical identifiers, injective, declared once per implementation.
const CANONICAL_POPULATIONS = [
  "unverified_from_unrun_declared",
  "degraded",
  "producer_mint_rejected",
  "unbindable_content_identity",
  "same_chain_indeterminate",
  "author_chain_unbound",
  "failed_declared",
  "proof_kernel_exempt",
  "tied_uncap",
];
const POPULATION_MAPPING = Object.fromEntries(
  CANONICAL_POPULATIONS.map((name) => [name, name]),
);

// Section 9.2 mapping obligations, asserted before any case runs: a
// mapping that folds two canonical populations (non-injective) or leaves
// one uncovered (non-total) is non-conformance by rule.
function validateMapping() {
  const problems = [];
  const targets = Object.values(POPULATION_MAPPING);
  const seen = new Set();
  const folded = new Set();
  for (const target of targets) {
    if (seen.has(target)) folded.add(target);
    seen.add(target);
  }
  if (folded.size > 0) {
    problems.push(
      `mapping folds canonical population(s) ${[...folded].sort().join(", ")} — not injective`,
    );
  }
  const uncovered = CANONICAL_POPULATIONS.filter((name) => !seen.has(name));
  if (uncovered.length > 0) {
    problems.push(
      `mapping does not cover canonical population(s) ${uncovered.join(", ")} — not total`,
    );
  }
  return problems;
}

// Ordinal strength derived from the registration; unknown values rank 0,
// strictly below every vocabulary member (section 2).
function rank(grade) {
  const idx = ORDERED.indexOf(grade);
  return idx === -1 ? 0 : ORDERED.length - idx;
}

function oneTierBelow(grade) {
  const r = rank(grade);
  if (r <= 1) return UNVERIFIED;
  return ORDERED[ORDERED.length - (r - 1)];
}

const trimmed = (value) => (value ?? "").trim();

// Section 5 step 3.1 chain classification — kind-free (the cap keys on
// chain identity, not the author's kind): "same" when both chains are
// non-empty and byte-equal; "unbound" when the author's chain is empty
// (the normal chainless case, counted distinctly); "indeterminate" when
// the admission-populated producer chain is empty; "different" otherwise.
function chainRelation(author, producer) {
  const authorChain = trimmed(author?.chain_id);
  const producerChain = trimmed(producer?.chain_id);
  if (authorChain === "") return "unbound";
  if (producerChain === "") return "indeterminate";
  return authorChain === producerChain ? "same" : "different";
}

// Sections 2.1 and 5 step 3.1: proof escapes the same-chain cap only when
// the base oracle's author kind is kernel.
function kernelProofExempt(grade, author) {
  return grade === PROOF && author?.kind === "kernel";
}

function newCounters() {
  return Object.fromEntries(CANONICAL_POPULATIONS.map((name) => [name, 0]));
}

// Section 5 "Tied top tier": evaluate steps 2 through 3.3 for one tied-set
// member as though it were the base oracle. Returns the member's surviving
// grade, its applied operations, and the observability counts its path
// produced.
function evaluateMember(oracle, producer, unrunCount, conflict, currentIdentity) {
  const counts = newCounters();
  let grade = oracle.tier;
  const author = oracle.author ?? {};
  const content = trimmed(oracle.content_identity);
  const ops = [];

  // Step 2: unrun-declared cap — recorded and counted only when it lowers
  // the grade; counted solely in its own population, never in degraded.
  if (unrunCount > 0 && rank(grade) > rank(UNVERIFIED)) {
    grade = UNVERIFIED;
    ops.push("unrun_declared_cap");
    counts.unverified_from_unrun_declared += 1;
  }

  // Step 3.1: chain-keyed same-chain cap; kernel-only proof exemption;
  // empty chains counted (never guessed), and only when the cap would
  // otherwise be in range.
  const relation = chainRelation(author, producer);
  const exempt = kernelProofExempt(grade, author);
  const capInRange = rank(grade) > rank(CONSTRUCTED_CHECK) && !exempt;
  if (capInRange) {
    if (relation === "same") {
      grade = CONSTRUCTED_CHECK;
      ops.push("same_chain_cap");
      counts.degraded += 1;
    } else if (relation === "indeterminate") {
      counts.same_chain_indeterminate += 1;
    } else if (relation === "unbound") {
      counts.author_chain_unbound += 1;
    }
  } else if (exempt && relation === "same") {
    // Each kernel-kind proof exemption is counted so a relocated kind lie
    // stays observable.
    counts.proof_kernel_exempt += 1;
  }

  // Step 3.2: conflict demotion — ordinal, evidence kind retained;
  // recorded and counted only when the demotion changed the grade.
  if (conflict) {
    const demoted = oneTierBelow(grade);
    if (demoted !== grade) {
      grade = demoted;
      ops.push("conflict_demotion");
      counts.degraded += 1;
    }
  }

  // Step 3.3: staleness reversion; the unbindable population is counted
  // only while the surviving grade still ranks above unverified.
  if (
    content !== "" &&
    currentIdentity !== "" &&
    content !== currentIdentity &&
    rank(grade) > rank(UNVERIFIED)
  ) {
    grade = UNVERIFIED;
    ops.push("staleness_reversion");
    counts.degraded += 1;
  } else if (
    (content === "" || currentIdentity === "") &&
    rank(grade) > rank(UNVERIFIED)
  ) {
    counts.unbindable_content_identity += 1;
  }

  return { grade, ops, counts };
}

function derive(input) {
  const counters = newCounters();
  const producer = input.work_producer;
  const currentIdentity = trimmed(input.current_content_identity);

  // Section 8: a unit with no admission evidence surfaces as unverified
  // with labeled provenance — never dropped.
  if (input.admission_evidence === false) {
    return {
      record: {
        effective_grade: UNVERIFIED,
        evidence_kind: UNVERIFIED,
        applied_rank_ops: [],
        conflicting_evidence: false,
        failed_declared_evidence: false,
        provenance: "missing_admission_fact",
        oracle_author: {},
        oracle_runner: {},
        work_producer: producer,
      },
      counters,
    };
  }

  const declared = input.declared ?? [];
  const unrunCount = declared.filter((o) => !o.ran).length;

  // Section 5 "Ran-and-failed declared oracles": counted once per oracle
  // that ran and did not pass; the record flag set when nonzero. Failure
  // neither caps nor demotes.
  const failed = declared.filter((o) => o.ran && !o.passed);
  counters.failed_declared += failed.length;

  // Step 1: base = rank-maximum over {unverified} and ran-and-passed
  // tiers; the tied set is every passer at that maximum. Unknown tiers
  // rank 0 and contribute nothing, so the base is always a member.
  const passed = declared.filter((o) => o.ran && o.passed);
  const baseRank = passed.reduce((max, o) => Math.max(max, rank(o.tier ?? "")), 0);
  const tied = baseRank > 0 ? passed.filter((o) => rank(o.tier ?? "") === baseRank) : [];
  const base = tied.length > 0 ? tied[0].tier : UNVERIFIED;

  // Step 3.2 definition, derived here from the declared set (never
  // caller-supplied): among declared oracles at the base tier, at least
  // one ran and passed while at least one ran and did not pass.
  const conflict = base !== UNVERIFIED && failed.some((o) => o.tier === base);

  let grade = UNVERIFIED;
  let ops = [];
  let selected = null;
  if (tied.length > 0) {
    // Tied-set MAX: every step-3 predicate that depends on the base
    // oracle is evaluated against every tied member, and the derivation
    // keeps the most favorable surviving outcome. Tie selection: prefer a
    // member that survives uncapped; among those (or among all, when none
    // survives), the lexicographically least (author.identity,
    // content_identity) pair. Sorting makes the result independent of
    // declaration order.
    const evaluations = tied.map((oracle) => ({
      oracle,
      outcome: evaluateMember(oracle, producer, unrunCount, conflict, currentIdentity),
    }));
    evaluations.sort((a, b) => {
      const byGrade = rank(b.outcome.grade) - rank(a.outcome.grade);
      if (byGrade !== 0) return byGrade;
      const aKey = [trimmed(a.oracle.author?.identity), trimmed(a.oracle.content_identity)];
      const bKey = [trimmed(b.oracle.author?.identity), trimmed(b.oracle.content_identity)];
      if (aKey[0] !== bKey[0]) return aKey[0] < bKey[0] ? -1 : 1;
      if (aKey[1] !== bKey[1]) return aKey[1] < bKey[1] ? -1 : 1;
      return 0;
    });
    const winner = evaluations[0];
    grade = winner.outcome.grade;
    ops = winner.outcome.ops;
    selected = winner.oracle;
    // A capped fold records the capping operation once and an
    // indeterminate question counts once per derivation: only the
    // selected member's operations and counts land on the record.
    for (const name of CANONICAL_POPULATIONS) {
      counters[name] += winner.outcome.counts[name];
    }
    // Tied-uncap observability: the MAX left the record uncapped while at
    // least one tied member would have been capped.
    const anyMemberCapped = evaluations.some((ev) =>
      ev.outcome.ops.includes("same_chain_cap"),
    );
    if (!ops.includes("same_chain_cap") && anyMemberCapped) {
      counters.tied_uncap += 1;
    }
  }

  const record = {
    effective_grade: grade,
    evidence_kind: base,
    applied_rank_ops: ops,
    conflicting_evidence: conflict,
    failed_declared_evidence: failed.length > 0,
    oracle_author: selected ? selected.author ?? {} : {},
    oracle_runner: selected ? selected.runner ?? {} : {},
    work_producer: producer,
  };

  // Section 6: producer-mint prohibition — the derived record governs in
  // all cases; only a disagreeing mint increments the rejection count.
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

// Section 9.2 keyed comparison: record fields compare strictly per
// expected key; counted populations compare per canonical population
// through the declared mapping. A population the expectation does not
// name expects zero — absence is an expectation, not a skip. A canonical
// population the mapping does not cover fails every case, fail-closed.
function compareCase(record, counters, expected) {
  const divergences = [];
  for (const key of Object.keys(expected)) {
    if (key === "counters") continue;
    if (!deepEqual(record[key], expected[key])) {
      divergences.push(
        `${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(record[key])}`,
      );
    }
  }
  const inverse = new Map(
    Object.entries(POPULATION_MAPPING).map(([local, canonical]) => [canonical, local]),
  );
  const expectedCounters = expected.counters ?? {};
  for (const canonical of CANONICAL_POPULATIONS) {
    const want = expectedCounters[canonical] ?? 0;
    const local = inverse.get(canonical);
    if (local === undefined || !(local in counters)) {
      divergences.push(
        `counters[${canonical}]: canonical population unmapped by this implementation — failure, not a skip`,
      );
      continue;
    }
    const got = counters[local];
    if (got !== want) {
      divergences.push(`counters[${canonical}]: expected ${want}, got ${got}`);
    }
  }
  const unknown = Object.keys(expectedCounters).filter(
    (key) => !CANONICAL_POPULATIONS.includes(key),
  );
  if (unknown.length > 0) {
    divergences.push(
      `fixture expects unknown population(s) ${unknown.join(", ")} — not canonical`,
    );
  }
  return divergences;
}

const mappingProblems = validateMapping();
if (mappingProblems.length > 0) {
  for (const problem of mappingProblems) {
    console.log(`FAIL: population mapping: ${problem}`);
  }
  process.exit(2);
}
const cases = fixtures.cases;
if (!cases || cases.length === 0) {
  console.log("FAIL: no fixture cases — the conformer cannot discriminate");
  process.exit(2);
}
let failures = 0;
for (const testCase of cases) {
  const { record, counters } = derive(testCase.input);
  const divergences = compareCase(record, counters, testCase.expect);
  if (divergences.length === 0) {
    console.log(`  OK ${testCase.name}`);
    continue;
  }
  failures += 1;
  console.log(`  FAIL ${testCase.name}`);
  for (const divergence of divergences) {
    console.log(`    ${divergence}`);
  }
}
if (failures > 0) {
  console.log(`conformance: ${failures} of ${cases.length} case(s) failed`);
  process.exit(1);
}
console.log(`conformance: all ${cases.length} case(s) passed (independent JS implementation)`);
