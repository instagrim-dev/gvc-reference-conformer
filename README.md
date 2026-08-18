# GVC reference conformer

A minimal public conformer for the
[Graded Verdict Custody specification](https://github.com/instagrim-dev/graded-verdict-custody).
This repository contains **no product code** — it exists to demonstrate, in
public CI, the two conformance obligations the spec defines:

1. **Registration parity** — the vendored vocabulary registration is
   asserted byte-identical to the spec repository's canonical artifact
   (`check-parity.mjs`). The check fails closed: an unreachable canonical
   artifact is a failure, never a pass.
2. **Fixture projection** — an independent implementation of the derivation
   (JavaScript; shares no code with the spec's Python reference runner)
   executes every canonical derivation fixture and must match every
   expected outcome (`conformer.mjs`). Counted populations are compared
   per canonical population through a declared injective total mapping
   (this implementation uses the canonical spellings, so its mapping is
   the identity), never by whole-structure equality — a canonical
   population the mapping does not cover fails every case, and a
   population a fixture does not name is expected to be zero.

The spec repository is public, so the parity step runs green end to end;
it still fails closed — an unreachable canonical artifact is a failure,
never a pass. Offline verification against a local checkout:
`GVC_SPEC_BASE=/path/to/graded-verdict-custody node check-parity.mjs`.

## Run

```sh
node conformer.mjs      # all derivation fixtures against the independent implementation
node check-parity.mjs   # vendored artifacts byte-identical to canonical (network)
```

## What a grade means

Per the specification's normative anti-claim: a grade states **evidence
strength, never correctness**. Nothing in this repository claims graded work
is correct.

## License

Apache-2.0 (`LICENSE-APACHE-2.0`). The vendored registration and fixtures are
Apache-2.0 artifacts of the spec repository.
