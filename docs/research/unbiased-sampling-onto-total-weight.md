# Unbiased sampling onto the total weight, and its failure bound

Research for [#51](https://github.com/MrSufferer/shroudly/issues/51), a ticket on the wayfinder map in [#49](https://github.com/MrSufferer/shroudly/issues/49). Date: 2026-10-17. Toolchain checked: Compact compiler 0.31.1, language 0.23.0 (`midnight/version-profile.json`).

This note records facts and numbers. It makes no design decision. Items not established from primary sources are listed in "Not established" at the end.

## Question

How can a uniformly random value be reduced onto the total weight `T` without bias, and what bounded failure behaviour results? The canonically combined randomness reveal is taken as a given uniform input of known width (ADR 0003; the randomness mechanism is out of scope per #49).

## Summary

1. Reducing a uniform `W`-bit value modulo `T` is exactly unbiased only when `T` divides `2^W`. Otherwise the distance from uniform is exactly `r(T-r)/(N*T)` with `N = 2^W`, `r = N mod T`, and never more than `T/(4N)`. Each ticket's probability is within a factor `1 ± T/N` of `1/T`.
2. For the baseline (`W = 64`) and the largest realistic per-interval total (`T = 9*10^15`) the bound is about `1.2*10^-4` (`2^-13`). At the issuance cap with no time factor (`T = 10^13`) it is about `1.4*10^-7`. At `W = 128` the same cases are below `7*10^-24` and `7*10^-27`; at `W = 248`, below `5*10^-60` and `6*10^-63`.
3. Rejection sampling (accept `x < floor(N/T)*T`, then output `x mod T`) is exactly unbiased for any `T`. Its failure probability per attempt is `(N mod T)/N < T/N`. With `k` independent attempts it is `< (T/N)^k`. The attempt count is geometric (Lemire, section 3) and unbounded in software, so a circuit has to cap it at `k`.
4. Width is the lever. One 248-bit sample gives failure below `2^-184` for every `T < 2^64`, so a single attempt is enough to put the failure probability far below any realistic threat. One 64-bit sample gives failure up to `3.1*10^-4` at `T = 9*10^15` and up to `0.0084` at `T = 1.58*10^17`.
5. In Compact, the integer widths available are `Uint<N>` for `N <= 248` and `Field` (about 254.86 bits, not a power of two). A 32-byte hash cannot be cast to either in full: the cast is a dynamic error if the value is too large. Division is not an operator; the documented pattern is a witness `divMod` plus an in-circuit check.
6. A failed sample can only map to cancel-and-rollover if the rejection itself is proven in-circuit. An unconstrained "rejected" claim would let any caller cancel a permissionless finalization.

## 1. What `T` is, in the units the contract uses

Source: `midnight/PrizePool.compact` at this commit.

- Weight is `principalBalance * elapsed`, with `elapsed` in the same time unit as `now` (the contract adds `900` for a Preprod draw cutoff and `3600` for the claim window, so the unit is seconds). Balances are six-decimal `tMIX` stored as integers, so the weight unit is micro-`tMIX` x seconds. The unit is inferred from the code, not stated in an ADR.
- `drawWeight` returns `accruedWeight(owner, drawCutoff)`, which is `stored + balance * elapsed`, a running (cumulative) value, not reset per draw.
- `finalize` sums five weights into `totalWeight` and calls `selectionIndex(randomnessAggregate, drawId, totalWeight, selection_bits())`, which reduces a hash modulo `totalWeight` with 64 doubling-and-subtract steps, then `chooseWeighted` walks cumulative weights.
- Contribution bounds are 1 to 1000 `tMIX` (`10^6` to `10^9` micro-units); `principalReserve + amount <= 10^13` (the 10,000,000 `tMIX` issuance cap, `midnight/CONTEXT.md` Test Principal Asset).

Realistic `T` values used below (all derived from those constants):

| Label | `T` | log2 | Basis |
|---|---|---|---|
| A | 36 | 5.2 | probe example in the #22 README |
| B | `5*10^6` | 22.3 | five identities, 1 `tMIX` each, 1 s |
| C | `5*10^9` | 32.2 | five identities, 1000 `tMIX` each, no time factor |
| D | `4.5*10^12` | 42.0 | five identities, 1000 `tMIX`, one 900 s interval |
| E | `10^13` | 43.2 | whole issuance cap, no time factor |
| F | `9*10^15` | 53.0 | whole issuance cap, one 900 s interval |
| G | `1.58*10^17` | 57.1 | five identities, 1000 `tMIX`, one year cumulative |
| H | `3.15*10^20` | 68.1 | whole cap, one year cumulative (exceeds `2^64`) |

Side observation affecting the range: with the cap held by one balance, `balance * elapsed` reaches `2^64` after about 21.35 days (`2^64 / 10^13 = 1.84*10^6 s`). With five identities at 1000 `tMIX` it takes about 117 years. The contract casts the product to `Uint<64>`, and the Compact reference says a cast whose value does not fit is a dynamic error. Row H therefore cannot occur in the current `Uint<64>` representation; it is shown only to bound the wide case.

## 2. Modulo reduction: exact bias and bound

Setup: input uniform on `[0, N)`, `N = 2^W`; target `[0, T)`; write `N = qT + r`, `0 <= r < T`.

- Residues `0..r-1` have `q+1` preimages, the rest have `q`. So the first `r` outcomes have probability `(q+1)/N` and the rest `q/N`.
- Statistical (total variation) distance from uniform: `TV = r(T-r)/(N*T)`. Derivation: `sum over r outcomes of ((q+1)/N - 1/T) = r((q+1)T - N)/(NT) = r(T-r)/(NT)`.
- Maximum over `r`: `r(T-r) <= T^2/4`, so `TV <= T/(4N)`. The L1 distance is `2*TV`.
- For any event `E`, `|P(E) - |E|/T| <= TV`. For any single outcome, the probability is within a factor `1 + (T-r)/N` or `1 - r/N` of `1/T`, so the relative error of any participant's winning probability is at most `T/N`.

This matches the primary sources:

- FIPS 186-5, Appendix A.4.1: "If n - 1 does not divide N, this invariably introduces some bias, no matter the quality of the input distribution, which is easy to determine from N and n." Its acceptance test is `2ρ(1-ρ)(n-1) > ε×N` with `ρ = r/(n-1)` and `ε <= 2^-64`, which is the L1 form of the expression above.
- FIPS 186-5, Appendix A.3.1: the "Extra Random Bits" method requests a bit string "at least 64 bits longer than the bit-size of the requested random integer" so that "statistical bias introduced by the modular reduction step is negligible."
- RFC 9380, Section 5: hash_to_field uses integers "whose length is at least ceil(log2(p)) + k bits"; "Reducing such integers mod p gives bias at most 2^-k for any p". Example given: 255-bit `p`, `k = 128`, `L = 48` bytes. The same section gives a prime near `3/4 * 2^256` where reducing a random 256-bit integer is "statistically far from uniform".
- Lemire, "Fast Random Integer Generation in an Interval" (arXiv 1805.10941; ACM TOMACS 29(1), 2019): the modulo reduction `x mod s` is listed as "a common but biased approach"; the unbiased result is defined as `P(y = z) = 1/s`.

### Distance from uniform (`TV`) for single-sample modulo reduction

Exact `TV` is for the specific `T`; the bound `T/(4N)` is the worst case at that magnitude. Computed with exact integer arithmetic (script in the appendix).

| `T` | `W=64` exact | `W=64` bound | `W=128` bound | `W=192` bound | `W=248` bound |
|---|---|---|---|---|---|
| A, 36 | `4.8*10^-19` | `4.9*10^-19` | `2.6*10^-38` | `1.4*10^-57` | `2.0*10^-74` |
| B, `5*10^6` | `2.2*10^-14` | `6.8*10^-14` | `3.7*10^-33` | `2.0*10^-52` | `2.8*10^-69` |
| C, `5*10^9` | `5.2*10^-11` | `6.8*10^-11` | `3.7*10^-30` | `2.0*10^-49` | `2.8*10^-66` |
| D, `4.5*10^12` | `6.1*10^-8` | `6.1*10^-8` | `3.3*10^-27` | `1.8*10^-46` | `2.5*10^-63` |
| E, `10^13` | `1.3*10^-7` | `1.4*10^-7` | `7.3*10^-27` | `4.0*10^-46` | `5.5*10^-63` |
| F, `9*10^15` | `1.1*10^-4` | `1.2*10^-4` | `6.6*10^-24` | `3.6*10^-43` | `5.0*10^-60` |
| G, `1.58*10^17` | `9.7*10^-5` | `2.1*10^-3` | `1.2*10^-22` | `6.3*10^-42` | `8.7*10^-59` |
| H, `3.15*10^20` | not representable (`T > N`) | n/a | `2.3*10^-19` | `1.3*10^-38` | `1.7*10^-55` |

General rule from the bound: `TV < 2^(t - 2 - W)` where `t = bitlength(T)`. So `TV < 2^-k` needs `W >= t + k - 2`. Against the two standards' thresholds:

- FIPS 186-5 A.4.1 accepts only when `2ρ(1-ρ)T/N <= 2^-64`. Since `2ρ(1-ρ) <= 1/2`, `W = 128` satisfies it for every `T < 2^64`. `W = 64` does not, except for special `T` (for example `T = 2^64 - 1` has `r = 1`, so exact `TV = 2^-64`, though its worst-case bound is 0.25).
- RFC 9380 with `k = 128` needs `W >= t + 128`: 181 bits for `T` up to `2^53`, 192 bits for `T < 2^64`.

Per-participant relative error `<= T/N`: about `4.9*10^-4` (0.05 percent) at `W = 64`, `T = 9*10^15`; about `2^-75` at `W = 128`; about `2^-195` at `W = 248`.

A wide modulo is always biased by a nonzero amount unless `T | N`, so the wide-modulo route trades bias to a stated bound; it never reaches zero (FIPS 186-5 A.4.1, quoted above).

## 3. Rejection sampling

### The method and why it is exact

Accept `x` in `[0, qT)` where `q = floor(N/T)`, then output `x mod T`; reject (draw again, or fail) when `x >= qT`, i.e. in the top `r = N mod T` values. Every residue then has exactly `q` preimages, so the output is exactly uniform given a uniform `x`.

Sources: Lemire section 3 states the rejection method generically ("we generate integers in x in [0, 2^L) but reject the result whenever x < 2^L mod s", the mirror-image formulation that rejects the bottom `2^L mod s` values) and that "if we have a source of unbiased random integers in [0, 2^L), then the result ... is an unbiased random integer in [0, s)". FIPS 186-5 Appendix A.4.2 (Discard Method) is the simpler variant: output INVALID when `x` is outside `[0, n-2]`; it notes the method "is nondeterministic" and that it is "always close" to the input distribution only for `n` in `[N/2, N]`.

### Failure probability

- Per attempt: `p_fail = (N mod T)/N < T/N`. Lemire section 3: the number of random words consumed "follows a geometric distribution, with a success probability p = 1 - (2^L mod s)/2^L".
- With `k` independent attempts capped: `p_fail(k) = (r/N)^k < (T/N)^k`. Worst case over `T` of a given bit length with the simple bit-mask variant (accept `x < T` on a `bitlength(T)`-bit slice) is just under `1/2` per attempt.

Per-attempt failure, one attempt, exact for the listed `T` (upper bound `T/N` in the last row):

| `T` | `W=64` | `W=128` | `W=192` | `W=248` |
|---|---|---|---|---|
| A, 36 | `8.7*10^-19` | `1.2*10^-38` | `4.5*10^-57` | `8.8*10^-75` |
| B, `5*10^6` | `2.5*10^-13` | `9.4*10^-33` | `7.2*10^-52` | `1.5*10^-69` |
| C, `5*10^9` | `2.0*10^-10` | `5.2*10^-30` | `6.4*10^-49` | `2.0*10^-66` |
| D, `4.5*10^12` | `1.1*10^-7` | `4.2*10^-27` | `5.5*10^-46` | `1.2*10^-63` |
| E, `10^13` | `2.2*10^-7` | `2.2*10^-26` | `7.1*10^-46` | `1.7*10^-62` |
| F, `9*10^15` | `3.1*10^-4` | `1.9*10^-23` | `7.1*10^-44` | `4.8*10^-60` |
| G, `1.58*10^17` | `8.4*10^-3` | `4.9*10^-23` | `2.2*10^-41` | `2.5*10^-58` |
| H, `3.15*10^20` | n/a | `8.3*10^-19` | `4.4*10^-38` | `6.8*10^-55` |
| Any `T < 2^64`, bound | `<= 1` | `< 2^-64` | `< 2^-128` | `< 2^-184` |

(For `W = 64` and `T` near `2^63`, `p_fail` approaches 1/2; the "any `T < 2^64`" bound for that column is vacuous.)

### Bounding the loop to a fixed number of circuit iterations

`k` attempts need `k` independent uniform words. Two sources of those words, with different assumptions (stated as facts, not as a choice):

1. Disjoint slices of the single uniform input. Independent and exactly uniform with no extra assumption, but each slice is narrower. For a 248-bit input and the worst case `T` near `2^53`: `k = 1` gives `p_fail ~ 2^-195`; `k = 2` (124-bit slices) gives `(2^-71)^2 = 2^-142`; `k = 4` (62-bit slices) gives `(2^-9)^4 = 2^-36`. So with a fixed 248 bits, splitting into more attempts makes the failure bound worse than one full-width attempt; more attempts only improve it when more uniform bits are available than one attempt needs.
2. Expanding the input with a hash or XOF (counter or domain separation). Gives arbitrarily many words, but uniformity of the expansion is computational (hash behaves as a random oracle), not information-theoretic. RFC 9380 section 5 uses `expand_message` for this purpose in `hash_to_field`; it is cited here only as the standard instance of the technique. The issue treats the reveal as a given uniform input of known width, so what the expansion's security rests on is a separate question.

Other fixed-iteration structure: the existing circuit already unrolls 64 conditional-subtract steps for a 64-bit value (`reduceSelectionStep`, `PrizePool.compact` lines 123 to 263), so an unrolled bound is the style already in use. Compact's `fold` over a fixed-length `Vector` (blog: "Division in Compact", `DivOne`) is the documented unrolled-loop idiom.

### Adversarial cost to force a failure

If a party can choose or grind the sampled value, forcing a rejection costs about `N/r` hash trials, which is `~N/T` up to the factor `r/T`: about 3,200 (`2^11.6`) at `W = 64`, `T = 9*10^15`; about `2^75` at `W = 128`; about `2^197` at `W = 248` (the reciprocals of the row F per-attempt failure above). Whether any party can grind the reveal is a property of the randomness mechanism (out of scope here). The numbers only say how much grinding a failure would take at each width.

## 4. What a sampling failure may and may not do

Constraints stated by the issue and the ADRs, and the Compact facts bearing on them:

- ADR 0003: "If the threshold is not met by the published timeout, the draw is cancelled and its Prize becomes a Prize Rollover; there is no operator seed, block-hash, or previous-seed fallback." and "after the on-ledger deadline anyone may finalize the Prize Draw". #49 adds: liveness failure is cancel-and-rollover only; no fallback to operator computation, equal-weight selection or revealed weights; principal exits and closed-interval weights stay intact.
- ADR 0006 and `midnight/CONTEXT.md` (Prize Rollover): an unselected Prize "never becomes operator property"; Rounding Residue "becomes Prize Rollover". A sampling failure is a new cause of an unselected draw; ADR 0003 names only the missed randomness threshold as a cancellation cause. Whether a sampling failure is added as a cancellation cause is a decision for the maintainer, not recorded here.
- Compact semantics (reference, "Casts of Bytes to and from Field and Uint" and the arithmetic section): a failed `assert`, a failed cast, or a `Uint` underflow is a dynamic error that "halts" the enclosing top-level circuit. A halted circuit yields no transaction. So a failed sample that is expressed as `assert(x < q*T)` does not cancel anything; it makes finalization unprovable for that input until something changes. Only a circuit that returns or branches on the rejection can write a cancel-and-rollover result.
- Because finalization is permissionless, a rejection branch is itself a claim a caller makes. If the circuit accepted an unconstrained "rejected" witness it would let any caller cancel any draw. The rejection condition (`x >= q*T`, with `q` and the quotient proven) must be checked in-circuit like the accepting path. This follows from the structure of the cancel path in ADR 0003 and the witness model in the Compact docs; there is no source that states it for sampling specifically.
- The rejection outcome reveals one bit that depends on `x` and `T`. `T` is disclosed anyway at a draw boundary that meets the Disclosure Cohort (`midnight/CONTEXT.md`, Public Pool State; `finalize` writes `aggregateDisclosure` including `totalWeight`). For a design that hides `T`, the accept/reject bit would be the only extra output; its probability is `~T/N` and is independent of who the winner is (it depends only on `x` and `T`).

## 5. Compact: widths and operators actually available

All from `docs/compact/reference/compact-reference.mdx` (Midnight docs) unless noted; retrieved with `npx ctx7@latest docs /midnightntwrk/midnight-docs ...` (2 queries) and the library resolution call.

- `Field`: maximum value `52435875175126190479447740508185965837690552500527637822603658699938581184512`, "dictated by the scalar field size of the ZK proving system"; also `MAX_FIELD` = "One less than the prime modulus of the proof system's scalar field" (compact-runtime API). That is `~2^254.86`, so a uniform `Field` is uniform on `[0, r)` with `r` not a power of two. Applying the same formula with `N = r`, every `T` row above (up to `3.15*10^20`) gives `TV <= 7.9*10^-58` (about `2^-190`) and per-attempt rejection `<= 1.9*10^-57`; these are exact script outputs, not a general bound.
- `Uint<N>`: maximum `N` is 248 since Compact 0.20.28.0 ("the proof server does not correctly handle unsigned integers larger than this"); maximum value `452312848583266388373324160190187140051835877600158453279131187530910662655` (`256^31 - 1`). `Uint<N>` means `Uint<0..2^N>` (exclusive bound).
- Casts `Bytes<m>` to `Field` or `Uint`: allowed, with a run-time check; "A dynamic error occurs if the result exceeds the maximum value of the `Field` or `Uint` type." Consequence for a uniform 32-byte value (such as `randomnessAggregate: Bytes<32>`): it fits `Field` with probability `r/2^256 = 0.453`, and fits `Uint<248>` with probability `2^-8`. A uniform integer in the circuit from 32 bytes needs the byte-wise route (`Bytes<32>` as `Vector<32, Uint<8>>`, then re-assemble 31 bytes); the Compact release notes (0.17.25.0) warn this "will fully unpack and pack the result" with proving cost proportional to size. Taking 31 bytes gives `W = 248` exactly uniform if the 32-byte value was.
- `persistentHash<T>`: SHA-256, returns `Bytes<32>` (`docs/compact/smart-contract-security.mdx`). `transientHash<T>`: returns `Field`, "not guaranteed to persist between upgrades" (compact-runtime API).
- Arithmetic: binary `+ - *` only; `Uint` results carry a static bound (`Uint<0..m>` times `Uint<0..n>` is `Uint<0..m*n>`); "it is a static error if the result's bound would be greater than the maximum unsigned integer". `Field` arithmetic wraps modulo the field prime. There is no division or modulo operator in the reference's arithmetic section.
- Division idiom (Midnight docs, blog "Division in Compact", and the Calculator example): a witness returns `[quotient, remainder]` and the circuit asserts `remainder < divisor` and `quotient * divisor + remainder == dividend`. The blog describes this as more efficient than a fold-based subtraction loop but relying on external computation with in-circuit verification. The 64-step doubling in `PrizePool.compact` is the in-circuit loop alternative.
- Compile-time check at 0.31.1 (compiler run locally with `compact compile +0.31.1 --skip-zk`; no proof generated):

  ```compact
  witness divMod(x: Uint<248>, t: Uint<64>): [Uint<184>, Uint<64>];
  // assert(r < t); assert(q * t + r == x);   -> compiles
  witness divMod(x: Uint<248>, t: Uint<64>): [Uint<248>, Uint<64>];
  // same asserts                              -> rejected: "resulting value might exceed
  //   largest representable Uint value (for Field semantics, cast either operand to Field)"
  ```

  So at 0.31.1 the declared quotient width plus the divisor width must stay within 248 bits for the product to type-check. The first form compiles but declares `q < 2^184`, which a witness cannot satisfy for a 248-bit `x` and a small `T` (`q` would need up to about 243 bits for `T = 36`). The compiler hint points to `Field` arithmetic for the wider case; there the check wraps modulo the field prime, so soundness would need the operand widths to keep `q*T + r` below `~2^254.86`. That arithmetic is stated here as a consequence of "`Field` arithmetic overflow ... wraps around 0", not tested.
- The accept threshold `q*T` with `q = floor(N/T)` and `N = 2^248` involves `N`, which itself is not a `Uint<248>` value (maximum is `2^248 - 1`). Expressing the acceptance test needs either `floor((N-1)/T)` bookkeeping or a wider type for that one constant. Not tested.

## 6. Observations about the existing baseline (not asked, relevant to the numbers)

- `selectionIndex` computes `persistentHash<[Bytes<32>, Uint<64>]>([randomness, draw]) as Uint<64>`. `persistentHash` returns `Bytes<32>`, and the cast rule above makes the cast a dynamic error unless the value is below `2^64` (probability `2^-192` for a uniform hash). The #22 README calls this a "64-bit hash". The repository snapshot in this worktree has no runtime test or TypeScript witness for `selection_bits`, so I could not check how the existing tests exercise it. I did not run it. Treat as unverified.
- Even if the 64-bit value is obtained, modulo bias applies exactly as in section 2 with `W = 64`.
- `reduceSelectionStep` computes `remainder * 2 + bit` as `Uint<64>`; it can only overflow when `total > 2^63`, which the weight ranges above do not reach.

## Not established from primary sources

- Proving cost, circuit size and proof-server behaviour of any sampling circuit on proof server 8.1.0 (no proofs were generated; only two type-check compiles at 0.31.1).
- That the witness-`divMod` check is sound at 248-bit widths under `Field` semantics: only the wrap-around reasoning above, not run.
- How the existing tests build `selection_bits`, and whether the `Bytes<32> as Uint<64>` cast in `selectionIndex` fails at runtime (not run).
- The weight unit (micro-`tMIX` x seconds) and the realistic `T` rows are derived from `PrizePool.compact` constants, not from a document that fixes them.
- Whether the combined reveal is exactly 256 uniform bits and how it is encoded: taken as a given per #49; no primary source in the repository fixes the width. `finalize` takes `randomnessAggregate: Bytes<32>`.
- How many independent words a hash expansion of the reveal yields, and the security reasoning behind it, are not established here (RFC 9380 is cited only as the standard instance of the technique).
- The original von Neumann (1951) source for the rejection method was not read; Lemire (2019) is cited for the method and its geometric trial count.
- Whether a sampling failure is an admissible cancellation cause under ADR 0003 and the interaction with ADR 0006's public winning ticket: left to the maintainer.

## Sources

- Midnight Compact reference: https://github.com/midnightntwrk/midnight-docs/blob/main/docs/compact/reference/compact-reference.mdx (types, arithmetic, casts, implementation-specific limits).
- Compact 0.20.28.0 release note (Uint maximum reduced to 248 bits): https://github.com/midnightntwrk/midnight-docs/blob/main/docs/relnotes/compact/compact-0-20-28-0.mdx
- Compact 0.17.25.0 release note (Bytes/Vector casts and their cost): https://github.com/midnightntwrk/midnight-docs/blob/main/docs/relnotes/compact/compact-0-17-25-0.mdx
- Compact smart contract security (hash functions): https://github.com/midnightntwrk/midnight-docs/blob/main/docs/compact/smart-contract-security.mdx
- Compact runtime API (`MAX_FIELD`, `persistentHash`, `transientHash`): https://github.com/midnightntwrk/midnight-docs/tree/main/api-reference/compact-runtime
- Midnight docs, "Division in Compact" (2025-04-16) and Calculator example: https://github.com/midnightntwrk/midnight-docs/blob/main/blog/2025-04-16-division-in-compact.mdx
- NIST FIPS 186-5, Digital Signature Standard, Appendices A.2.1, A.3.1, A.4.1, A.4.2 (pages 44 to 52): https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.186-5.pdf
- RFC 9380, Hashing to Elliptic Curves, Section 5 (hash_to_field): https://www.rfc-editor.org/rfc/rfc9380.html
- D. Lemire, "Fast Random Integer Generation in an Interval", ACM TOMACS 29(1), 2019, arXiv:1805.10941, sections 2 to 4.
- Repository: `midnight/CONTEXT.md`, `docs/adr/0003-stage-randomness-trust-by-release.md`, `docs/adr/0006-use-continuous-weight-and-prize-rollover.md`, `midnight/PrizePool.compact` (`selectionIndex`, `reduceSelectionStep`, `drawWeight`, `finalize`), `midnight/version-profile.json`, and the sampling paragraph of `midnight/experiments/offline-participation/README.md` on branch `codex/issue-22-private-offline-integration` (the file is not on the current branch).

## Appendix: reproducing the numbers

Exact rational arithmetic; `TV = r(T-r)/(N*T)` with `r = N mod T`; bound `T/(4N)`; per-attempt rejection `r/N`.

```python
from fractions import Fraction
R = 52435875175126190479447740508185965837690552500527637822603658699938581184513  # MAX_FIELD + 1
def tv(T, N):    r = N % T; return Fraction(r * (T - r), N * T)
def bound(T, N): return Fraction(T, 4 * N)
def reject(T, N): return Fraction(N % T, N)
# example: tv(9 * 10**15, 2**64) ~= 1.127e-4 ; bound ~= 1.22e-4 ; reject ~= 3.11e-4
# example: tv(10**13, 2**128) ~= 5.6e-27 ; reject(10**13, 2**248) ~= 1.67e-62
```
