# Mutation ledger — independent JS derivation

Each entry records an executed mutation run against `conformer.mjs`: the
rule deliberately broken, the exact fixtures that failed (and only those),
and the restored-green run. A mutation that fails nothing would mean the
fixtures do not guard the rule; every entry below failed non-vacuously and
exited 1, and green (all 27 cases, exit 0) was restored and re-run after
each.

## 2026-08-18 — spec v1 amended-semantics update (27-case corpus)

| # | Rule mutated | Mutation applied | Failing fixtures (exactly) | Exit |
| - | --- | --- | --- | - |
| 1 | Tie selection (spec §5 "Tie selection": lexicographically least `(author.identity, content_identity)` among equally-surviving tied members) | Tie comparator returns 0 after the surviving-grade key, so ties fall back to declaration (array) order | `tied_top_tier_all_capped_folds_once` | 1 |
| 2 | Ran-and-failed observability (spec §5 "Ran-and-failed declared oracles": `failed_declared` counted once per ran-and-failed oracle; record flag set when nonzero) | `counters.failed_declared += failed.length` replaced with `+= 0` | `conflict_demotion_fires_one_ordinal_tier`, `conflict_demotion_unverified_demotes_to_itself`, `failed_declared_counted_and_flagged`, `composed_ops_retained_in_application_order` | 1 |
| 3 | Kind-free chain classification (spec §5 step 3.1: the same-chain cap keys on chain identity regardless of author kind; empty chains counted, kernel-kind proof exempt and counted) | `chainRelation` short-circuits to `"different"` for any non-`agent` author kind (the pre-amendment kind-gated behavior) | `same_chain_cap_exempts_kernel_proof`, `author_chain_unbound_counted_distinctly`, `human_author_same_chain_caps` | 1 |

Notes:

- Mutation 1's failure surface is the fixture in which both tied members
  survive identically capped, so only the lexicographic selection rule —
  not the favorable-outcome preference — decides the record's attribution.
  The order-independence pair (`…_order_ab` / `…_order_ba`) still passes
  under this mutation because each of those cases has a unique uncapped
  survivor; the all-capped case is the one that pins the tie-break itself.
- Mutation 2's four failures are exactly the fixture cases whose expected
  `failed_declared` population or `failed_declared_evidence` flag is
  nonzero/true.
- Mutation 3 removes the cap for human authors (fails
  `human_author_same_chain_caps`), reclassifies a chainless human author
  away from the `author_chain_unbound` population (fails
  `author_chain_unbound_counted_distinctly`), and stops counting the
  kernel-kind proof exemption because the kernel author no longer
  classifies as same-chain (fails `same_chain_cap_exempts_kernel_proof`).
