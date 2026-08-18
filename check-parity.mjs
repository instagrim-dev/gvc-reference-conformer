#!/usr/bin/env node
// Registration parity assertion (V1 leg B shape, conformer side): the
// vendored registration artifact and derivation fixtures must be
// byte-identical to the spec repository's canonical copies.
//
// Fail-closed: an unreachable canonical artifact is a FAILURE, never a
// pass — a parity check that passes when it cannot see the producer is
// fail-open and certifies nothing. GVC_SPEC_BASE may point at a local
// checkout of the spec repository for offline verification; CI pins the
// public raw URL.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE =
  process.env.GVC_SPEC_BASE ??
  "https://raw.githubusercontent.com/instagrim-dev/graded-verdict-custody/main";

const ARTIFACTS = [
  {
    vendored: "vendored/verdict-grade-registration.json",
    canonical: "registration/verdict-grade-registration.json",
  },
  {
    vendored: "vendored/derivation-cases.json",
    canonical: "conformance/fixtures/derivation-cases.json",
  },
];

async function canonicalBytes(relPath) {
  if (BASE.startsWith("http://") || BASE.startsWith("https://")) {
    const response = await fetch(`${BASE}/${relPath}`);
    if (!response.ok) {
      throw new Error(`canonical artifact unreachable: ${relPath} -> HTTP ${response.status}`);
    }
    return await response.text();
  }
  return readFileSync(join(BASE, relPath), "utf8");
}

let failures = 0;
for (const artifact of ARTIFACTS) {
  const local = readFileSync(join(HERE, artifact.vendored), "utf8");
  let canonical;
  try {
    canonical = await canonicalBytes(artifact.canonical);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${artifact.vendored}: ${err.message}`);
    continue;
  }
  if (local === canonical) {
    console.log(`  OK ${artifact.vendored} == ${artifact.canonical}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${artifact.vendored}: bytes differ from canonical ${artifact.canonical}`);
  }
}
if (failures > 0) {
  console.log(`parity: ${failures} artifact(s) failed against ${BASE}`);
  process.exit(1);
}
console.log(`parity: all ${ARTIFACTS.length} vendored artifact(s) byte-identical to canonical (${BASE})`);
