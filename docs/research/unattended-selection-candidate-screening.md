# Screening candidate families for Unattended Selection against the kill criteria

Research for [#52](https://github.com/MrSufferer/shroudly/issues/52), a research ticket on the wayfinder map in [#49](https://github.com/MrSufferer/shroudly/issues/49). Date: 2026-10-17. Toolchain: Compact compiler 0.31.1, language 0.23.0, runtime 0.16.0 (`midnight/version-profile.json`).

This file screens candidates. It records eliminations with the exact criterion that killed them and names open design questions for survivors. It makes **no recommendation** and sets **no numeric threshold** beyond the map's viability floor. Decisions belong to the maintainer.

Every claim carries one of these tags.

- **Documented**: stated by a primary source (paper, standard, first-party docs or source) that I read; the source is named.
- **Observed**: produced by running the pinned compiler 0.31.1 and its bundled `zkir mock-compile` on a probe in this research (appendix). `mock-compile` reports circuit rows and `k`; no proof was generated, so nothing here is a proof-server result.
- **Derived**: my own reasoning from tagged facts. The reasoning is stated so it can be checked or rejected.
- **Not established**: could not be settled from primary sources (collected in section 7).

## 1. Fixed inputs

### 1.1 The kill criteria (from #52, verbatim in substance)

A candidate is eliminated if it needs any of:

- **K1**: participant openings or secrets supplied at settlement.
- **K2**: operator-visible weights, balances or ownership, including through the three operator-controlled randomness keys. An independent-committee design is tagged "needs independent parties", not accepted and not eliminated by K2 alone.
- **K3**: a per-draw participant action.
- **K4**: a verifier that cannot be expressed as a Compact circuit and proven on the pinned runtime.
- **K5**: no safe-exit guarantee when its extra liveness dependency fails; cancel-and-rollover is the only acceptable failure mode.

Viability floor (#49), applied to survivors only and reported as measurements: capacity above five identities (maximum as measured); steady-state per-draw settlement fits the fifteen-minute cadence; catch-up over N missed Draw Intervals in bounded per-transaction steps (bound reported); a real proof on proof server 8.1.0 and compiler 0.31.1 for anything recommended. ADR 0006's public Winning Commitment is never replaced silently; where a family would need that, it is flagged.

Definition used for "settlement" and "Unattended Selection" (`midnight/CONTEXT.md` on the maintainer's checkout): "Selection that completes with no participant action and no operator-held participant secrets, while keeping balances, weights, and ownership private." ADR 0006 keeps a claim by the selected owner, who "privately proves membership, selection, and ownership". I read the claim as outside "settlement"; section 4.6 shows this reading matters for one survivor.

### 1.2 Facts inherited from #50 and #51 (not re-derived)

From the [#50 findings](https://github.com/MrSufferer/shroudly/blob/research/compact-hidden-state-expressiveness/docs/research/compact-hidden-state-expressiveness.md) (Documented or Observed there):

- Primitives at 0.31.1: SHA-256 and Poseidon hashes/commitments; Jubjub `ecAdd`, `ecMul`, `ecMulGenerator`, `hashToCurve`. No `ecNeg`, `JubjubScalar`, `keccak256`, secp256k1/secp256r1, `/`, `%`. No pairing or proof-verification primitive in the list.
- `MerkleTree`/`HistoricMerkleTree` depth 2 to 32. No sum or aggregate tree. `Set`/`Map`/`List` cannot be iterated in a circuit. A vector cannot be indexed by a hidden value, so hidden selection means scanning every operand (about 185 rows per cumulative-weight step).
- Witnesses are caller-supplied and untrusted. A circuit sees only public ledger state, its own caller's private state and the contract address. Another user's commitment gives a later caller no opening. No cross-contract calls at 0.31.1. The proof server receives the full witness.
- Ledger operation arguments are public; a hidden value needs `disclose` before it reaches a ledger write, and an `assert` is not a disclosure.
- Per-operand costs (rows): `transientCommit` opening about 92; `persistentCommit` opening about 2,587; Pedersen-style opening about 1,555; Merkle level about 31; `ecAdd` about 13.

From the [#51 findings](https://github.com/MrSufferer/shroudly/blob/research/unbiased-sampling/docs/research/unbiased-sampling-onto-total-weight.md): reducing a 248-bit uniform value modulo a public bound below 2^64 has bias below 2^-184 per sample; 64-bit modulo is visibly biased; there is no division operator; a sampling failure needs an explicit in-circuit rejection branch to cancel a draw.

From the #22 report (`origin/codex/issue-22-private-offline-integration`): the eight-slot commitment probe fails because participant witnesses are unavailable to a later caller; "returning participants, giving an operator the openings, or revealing weights are not accepted fallbacks"; the report names FHE, MPC/threshold computation, functional encryption and proof-carrying encrypted computation as unqualified possibilities requiring "explicit output/decryption authority, availability, privacy, bounded-history and measured cost analysis".

Not found: `docs/adr/0028` to `0030` are only on the maintainer's checkout, not on this branch; I read them there. `docs/midnight-stack-review.md` is also only on the maintainer's checkout (third-round decisions 11 to 13 there restate the no-check-in, no-operator-secrets, no-public-weights constraints).

### 1.3 Cross-cutting facts used by several screenings

**X1 (Derived, locality).** A check performed by a circuit can use (a) public ledger state, (b) the caller's own private state. Hidden selection over all participants is therefore expressible in only two ways: (i) a single party holds every participant's operands (all-data holder), or (ii) the selection rule is decided by checks that each involve only one participant's data plus public data (owner-local checks). Basis: #50 sections 6.1 and 6.2. Every family below is an instance of (i) or (ii), or of a way of trying to avoid both.

**X2 (Derived, keys in witnesses).** A decryption key used inside a Compact circuit would be a witness value, and the proof server sees all witness data (Documented, #50 section 6.1, citing the Midnight local-proving guide). Finalization is permissionless, so the caller who proves the circuit would learn the key. Hence decryption of participant data cannot be done inside a permissionless caller's circuit without disclosing it to that caller; hidden decryption has to be done by key holders outside the circuit, with the chain verifying only an attestation or a proof about the result.

**X3 (Documented, attestation verifier is expressible).** The Midnight zk-loan tutorial verifies a Schnorr signature inside a Compact circuit with `transientHash`, `ecMulGenerator`, `ecMul`, `ecAdd`, `jubjubPointX/Y`, plus a witness-supplied reduction of the challenge hash to 248 bits ([smart-contract tutorial](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/tutorials/zk-loan/smart-contract.mdx), retrieved with `npx ctx7@latest docs /midnightntwrk/midnight-docs ...`). **Observed**: that verifier wrapped in an `attest(idx, drawId)` circuit compiles at 0.31.1 and measures **1,645 rows, k=11** (appendix probe A). The tutorial's signing code uses the Jubjub subgroup order `6554484396890773809930967563523245729705921265872317281365359162392183254199` and a 248-bit challenge; I did not independently check the scalar-domain behaviour of `ecMul` (still Not established, as in #50 section 7 item 3).

## 2. Screening matrix

P = passes as stated, F = fails (eliminates), T = passes only with the "needs independent parties" tag, ? = not decided by primary sources, n/a = not reached because an earlier criterion already eliminated the family. Sub-variants are separated where they differ.

| # | Family | K1 openings at settlement | K2 operator-visible | K3 per-draw action | K4 Compact-expressible verifier | K5 safe exit on liveness failure | Verdict |
|---|---|---|---|---|---|---|---|
| 1a | On-chain sum tree or prefix sums with public node values (sortition sum tree style) | P | **F** | P | P | P | **Eliminated, K2** |
| 1b | On-chain hidden-weight structure (homomorphic commitments to sums), claim-time proof by the winner | **F** | P | P | n/a | n/a | **Eliminated, K1** |
| 2a | FHE, one decryption-key holder (or key reachable by a settlement caller) | P | **F** | P | n/a | n/a | **Eliminated, K2** |
| 2b | FHE with a threshold committee, chain verifies the FHE evaluation itself | P | T | P | **F** | n/a | **Eliminated, K4** |
| 2c | FHE with a threshold committee, chain verifies only a committee attestation | P | T | P | P | P (see 4.3) | **Collapses into family 3** |
| 3 | Threshold or MPC committee computation, chain verifies a committee attestation | P | T | P | P (attestation) | P (mechanism exists, see 4.3) | **Survives, tagged "needs independent parties"** |
| 4 | Functional encryption (single authority; decentralised inner-product variants) | P | **F** | P | **F** | n/a | **Eliminated, K2 and K4** |
| 5 | Proof-carrying encrypted computation (verifiable FHE or SNARK over ciphertexts) | P | T/F (decryptor) | P | **F** | n/a | **Eliminated, K4** |
| 6A | Public-index sampling, unit-ticket leaves (one leaf per unit of principal) | P | **F** | P | P | P | **Eliminated, K2** (unpadded) |
| 6B | Public-index sampling, one leaf per note, owner-side acceptance `u < w` at claim | P (reading dependent, see 4.6) | P | P (reading dependent) | P (Observed 8,405 rows) | P | **Survives, with an interpretation question** |
| 7 | Self-evaluated sortition (each participant tests their own VRF or hash against a threshold) | P | P | **F** | P | n/a | **Eliminated, K3** |
| 8 | Randomness-keyed encryption (weights sealed to the combined reveal; time-lock or witness-encryption style) | P | **F** | P | ? | n/a | **Eliminated, K2** |
| 9 | Trusted execution environment computes selection and attests | P | T/F (host and vendor) | P | **F** | n/a | **Eliminated, K4** |
| 10 | Participant-present transitions that pre-commit future weight, then hidden scan at settlement | **F** | P | **F** if horizon is finite | n/a | n/a | **Eliminated, K1** |

Families 1 to 5 are the five named in #52. Families 6 to 10 were surfaced by this research, screened by the same criteria. Families 6B and 3 are the survivors; section 5 names their open design questions.

## 3. Reading guide to the evidence

Sections 4.1 to 4.10 give, per family, what the family is (so the criterion application can be checked), the tagged evidence, and the criterion application with the reasoning. A sub-variant is eliminated only when the criterion is stated in the matrix.

## 4. Per-family screening

### 4.1 Family 1: on-chain hidden-weight sum structure with claim-time proof

Shape: a sum tree (or a running prefix) in ledger state; at settlement a public ticket `t` in `[0, total)` selects the leaf whose interval contains `t`; the winner proves, at claim time, that their leaf's interval contains `t`.

**1a, public node values.**

- Documented: the Kleros `SortitionSumTreeFactory` is a k-ary tree whose leaves hold stake values and whose internal nodes hold sums as plain `uint`, with `draw(tree, drawnNumber)` descending by comparing against child values ([source file](https://github.com/kleros/kleros/blob/master/contracts/data-structures/SortitionSumTreeFactory.sol); the file contains no encrypted or hidden variant).
- Documented: all Compact ledger state is public; `export` does not hide it (#50 section 5, and #22's decoding of an unexported balance map).
- Derived: reproducing that structure in Compact stores each participant's weight (or a prefix difference that equals it) in public ledger state.
- **K2 fails**: weights are operator-visible. Eliminated by K2.

**1b, hidden node values.**

- Documented/Observed: Jubjub `ecAdd` on supplied points costs about 13 rows (#50 section 1.3). Derived: a contract can maintain, with no openings, a commitment to each tree node as the `ecAdd` of its children's commitments, because the additive Pedersen-style commitments combine publicly; the position of an insertion is public (#50 section 2.2: a write position is a public argument), which is acceptable because it is a slot, not an identity.
- Derived: descending the tree needs, at every level, the comparison "ticket minus accumulated left sums is below the left child's value". That comparison needs the left sibling's committed value as an opening. The sibling's value is the sum of other participants' weights; its opening is the sum of their values and blinding factors, which only those participants know. #50 (Documented/Observed) establishes that another user's commitment gives a later caller no opening, and that the prover must supply witnesses itself. So the winner cannot build the proof.
- Derived, the allocator variant: giving each deposit a stable interval `[P_{i-1}, P_i)` on a line needs the depositor to know the hidden running total `P_{i-1}`. The circuit holds only a commitment to it, so the depositor cannot learn it. Making it known by encrypting `P_{i-1}` to a party who can decrypt is the committee family (family 3), not a new family.
- **K1 fails**: the claim-time proof needs other participants' openings. Eliminated by K1. The unaffected criteria are noted in the matrix; no cost is reported because the relation cannot be assembled.
- Reading note: the proof could be assembled if the siblings' sums were published; that is 1a (K2).

### 4.2 Family 2: fully homomorphic encryption (2a, 2b, 2c)

Shape: participants encrypt weights under an FHE key; anyone homomorphically computes the cumulative sums, comparison and selection; a decryption of the result gives the winning index.

- Documented: virtually all FHE schemes assume an honest-but-curious server and FHE has no integrity protection by default; key-recovery attacks via interactive decryption oracles exist (Viand, Knabenhans, Hithnawi, ["Verifiable Fully Homomorphic Encryption"](https://arxiv.org/abs/2301.07041), sections 1 and 3.4, read from the PDF).
- Documented: the same paper states that proving an FHE evaluation in a generic ZKP system "would introduce prohibitively large additional overhead in emulating the complex ring operations used in FHE schemes"; earlier SNARKs for FHE (Fiore et al.; Bois et al.) rely on homomorphic hashing that "limits this approach to simple schemes such as the BV scheme", and the paper's own construction targets BGV. It also says that a universal circuit "will be infeasible in most scenarios".
- Documented: a deployed FHE-on-chain stack, the Zama Protocol, decrypts with a threshold MPC KMS of 13 nodes (9 of 13 needed, robust to one third malicious) and verifies coprocessor computation by redundancy: the Gateway "accepts outputs only when a majority consensus is reached" with more than 50 percent of coprocessors assumed honest; zero-knowledge proofs apply to encrypted inputs, and the pages do not describe a validity proof for computation outputs ([KMS](https://docs.zama.org/protocol/protocol/overview/kms), [coprocessor](https://docs.zama.org/protocol/protocol/overview/coprocessor)). Not established: whether other parts of that protocol add computation proofs; I read only these pages.
- Derived (from X2): a decryption key cannot sit in a permissionless caller's witness.

**2a.** If one party, or a key reachable by the settlement caller, can decrypt the weight ciphertexts, that party sees every weight. With the key in operator hands, K2 fails. Eliminated by K2.

**2b.** Threshold decryption removes the single holder, so K2 becomes "needs independent parties". The chain must then be convinced that the evaluation was done correctly. A self-verifying design would need the Compact circuit to verify an FHE evaluation or a SNARK about it.

- Derived: Compact's native field is the BLS12-381 scalar field (Documented, #50 section 1.2); a lattice scheme's modular and ring arithmetic would have to be emulated with range checks, which the Documented overhead statement above calls prohibitive for generic ZKPs. There is no pairing or proof-verifier primitive and no cross-contract call at 0.31.1 (#50), so a verifier cannot be delegated to another component.
- No primary source gives a circuit size for verifying any FHE evaluation inside a BLS12-381 PLONK circuit (Not established). Nothing is measured here.
- **K4 fails** for the self-verifying form. Eliminated by K4.

**2c.** If the chain does not verify the FHE evaluation but only verifies a committee's signed result, the verifier is the Schnorr-style check of X3, which is expressible. The security then rests on the committee, exactly as in the deployed Zama design above. This is family 3 with FHE as the committee's internal engine; it is screened there. Note for family 3 that FHE would then be an implementation choice for the committee's computation, not a distinct on-chain construction.

### 4.3 Family 3: threshold or MPC committee computation

Shape: at each balance-changing action, the participant encrypts (or secret-shares) their weight data to a committee public key, posts the ciphertext to the contract with whatever well-formedness proof the contract can check, and goes offline. At settlement the committee, holding key shares, runs the cumulative-weight selection (in the clear among enough members, or in MPC, or under FHE) and jointly signs the winning index; the contract verifies the committee signature and records the winner.

Evidence.

- Documented: FROST produces standard Schnorr signatures from a threshold of signers; security holds if the coordinator and at most `MIN_PARTICIPANTS - 1` participants are corrupted; its ciphersuites require a prime-order group and a hash ([RFC 9591](https://www.rfc-editor.org/rfc/rfc9591.html); the last 17,786 characters of the page were not read).
- Documented/Observed: a Schnorr verifier is expressible and measured at 1,645 rows, k=11 in a Compact circuit at 0.31.1 (X3, probe A).
- Documented: ElGamal-style additive homomorphism over Jubjub points exists via `ecAdd`/`ecMul`/`ecMulGenerator` (#50 section 1.3); comparison is not homomorphic, so selection needs the committee computation above (Derived).
- Documented: ADR 0003 already requires, for Mainnet, "either an audited Midnight-native randomness oracle or a separately approved and audited threshold design with independent operators". Derived: the randomness question and this committee are separate mechanisms in this ticket (randomness is out of scope on the map); whether the same independent parties could serve both is a decision, not a fact.
- Documented: ADR 0003's Preprod randomness keys are all controlled by the current Operator. Derived: those three keys cannot be the committee, because the committee decrypts weights (K2).

Criteria.

- **K1 passes**: no participant is needed at settlement; the committee holds the decryptable material. Operator-held participant secrets: not applicable if the committee members are independent of the Operator, which is the tag below.
- **K2 passes only with the tag "needs independent parties"**. Derived: any committee quorum can reconstruct the weights or ownership, so privacy holds only against fewer than the threshold of colluding members. If any quorum is controlled by the Operator, K2 fails and the family is eliminated.
- **K3 passes**: participants act only when their balance changes, which they do anyway.
- **K4 passes for an attestation verifier** (X3). The verifier establishes that the committee key signed `(draw, winning index)`. It does not establish that the index is the correct weighted selection. Whether any correctness proof for the committee's computation can be checked in Compact is Not established (see open questions).
- **K5**: Derived: a missing committee signature leaves the draw unfinalized. The contract can make the draw cancellable by anyone after the on-ledger deadline using the block-time predicates (Documented, #50 section 2.3), as ADR 0003 does for missing reveals. Principal withdrawals and weight updates post new ciphertexts and do not need the committee (Derived from the shape), so exits stay available. This is a property of the mechanism design, not something I observed. Open question below: whether the weights of already-closed intervals remain usable if the committee key is lost.

Verdict: **survives, tagged "needs independent parties"**. The tag is not an acceptance.

### 4.4 Family 4: functional encryption

Shape: participants encrypt weights; a functional key for "select the winner given ticket `t`" reveals only the winning index.

- Documented: multi-input functional encryption for general functions is constructed from indistinguishability obfuscation (Goldwasser, Goyal, Jain, Sahai, ["Multi-Input Functional Encryption"](https://eprint.iacr.org/2013/727); it assumes iO for circuits or differing-inputs obfuscation).
- Documented: decentralised multi-client functional encryption exists for inner-product functionalities, with functional keys generated in a distributed way among the senders (Chotard, Dufour-Sans, Gay, Phan, Pointcheval, ["Decentralized Multi-Client Functional Encryption for Inner Product"](https://eprint.iacr.org/2017/989), ASIACRYPT 2018).
- Documented: ordinary functional encryption does not consider a malicious authority or encryptor (as the authors summarise it); verifiable functional encryption adds output correctness for malicious ciphertexts and setup, using a generic transformation based on NIWI proofs, and simulation-based VFE is impossible (Badrinarayanan, Goyal, Jain, Sahai, ["Verifiable Functional Encryption"](https://eprint.iacr.org/2016/629), ASIACRYPT 2016).
- Derived: an inner-product key reveals `<x, y>` for a chosen `y`. Prefix sums are inner products, but obtaining the prefix sums needed to locate `t` discloses the weight differences, which defeats hiding. Selection needs a comparison the inner-product class does not compute. I found no primary source giving a practical scheme for comparison-and-select over several clients' ciphertexts other than iO-based ones.
- **K2 fails** for any scheme with a single key-generation authority, which can decrypt everything it can issue keys for. Operator-held authority is the default Preprod trust model.
- **K4 fails**: no decryption output of plain FE carries a proof, and the verifiable variant is NIWI- or iO-class, with no Compact-expressible verifier established. Eliminated by K2 and K4.
- Note (not one of the five criteria): the decentralised, independent-parties variant would be tagged, but the primary sources above give no instantiation for the function needed, so there is no tagged survivor to carry forward.

### 4.5 Family 5: proof-carrying encrypted computation

Shape: someone evaluates over ciphertexts and attaches a proof of correct evaluation (and possibly of correct decryption); the contract checks the proof.

- Documented: tailored verifiable-FHE constructions exist, for example a lattice-based SNARK system that proves ring operations and modulus/key-switching steps separately and verifies a three-layer approximate neural-network evaluation over more than 100 ciphertexts "in less than 1 second", with bootstrapping only suggested as a theoretical extension ([Verifiable FHE via Lattice-based SNARKs](https://cic.iacr.org/p/1/1/24)). Also Fiore, Gennaro, Pastro, ["Efficiently Verifiable Computation on Encrypted Data"](https://eprint.iacr.org/2014/202) (CCS 2014), for linear combinations and low-degree polynomials with homomorphic hashing; the Viand et al. paper above states this limits it to simple schemes.
- Derived: the verifier for those systems is a native verifier for that proof system; the contract's verifier is whatever Compact can express and the Midnight network can verify (a PLONK circuit over BLS12-381 proven by the proof server). There is no pairing, no proof-verification primitive, and no cross-contract call at 0.31.1 (#50). A foreign proof system's verifier would have to be written as a Compact circuit; no primary source gives a size for that (Not established). The comparison and selection function also needs non-linear operations beyond the polynomial classes in Fiore et al.
- Derived: proving correct decryption needs the decryption key in the prover (X2), so the decryption step still has an all-data holder (family 3 shape).
- **K4 fails.** Eliminated by K4. The decryptor question (K2 or the independent-parties tag) is carried by family 3 and is not decided here.

### 4.6 Family 6: public-index sampling with owner-side acceptance (new)

Shape. Leaves are insertion-ordered in a Merkle tree, one per participant note (6B) or one per unit of principal (6A). At settlement the contract derives a public leaf index `i` uniformly from `[0, n)` (`n` is the public leaf count at the cutoff) and a public acceptance draw `u` uniformly from `[0, W_max)` (`W_max` is the public maximum weight, the Contribution Bound times the interval length) from the reveal. Leaf `i` is the public Winning Commitment. Its owner, at claim time, proves in zero knowledge that the leaf at index `i` is theirs, that the leaf was valid in the interval, and that `u < w` where `w` is the leaf's committed weight.

- Derived: the probability that leaf `i` is awarded is `(1/n) * (w_i / W_max)`; conditional on an award, the awarded leaf is chosen with probability proportional to `w_i`. The winner learns nothing of other weights; nobody scans anything. This is an application of rejection sampling with the acceptance test evaluated by the only party who can evaluate it (X1, case ii). The unconditional probability that any award occurs is `sum_i w_i / (n * W_max)`; it falls as weights are small relative to `W_max` or as dead leaves accumulate. This is a measurement for the maintainer, not a threshold.
- Documented (#51): `n` and `W_max` are public bounds below 2^64, so a 248-bit-wide reduction gives bias below 2^-184 per sample, and no hidden operand enters the sampling.
- Documented: `HistoricMerkleTree` supports `checkRoot` as membership in past roots; path entries carry a `goes_left` flag per level (#50 section 2.2; I used the field name in probe B and it compiled).
- **Observed** (appendix probe B): a claim circuit that (1) binds a `transientCommit` leaf of weight and secret to the path leaf, (2) computes the leaf index from the path's `goes_left` flags and equals it to the public `selIndex`, (3) checks membership with `checkRoot` at depth 32, (4) asserts `selU < w`, and (5) inserts a `persistentHash` claim nullifier into a `Set`, compiles at 0.31.1 and measures **8,405 rows, k=14**. Without the index binding the same circuit is 6,226 rows, k=13. The cost does not depend on `n` or on the number of participants.
- Derived: the verifier uses only operations expressible in Compact today (Merkle path, commitment, comparison, nullifier insert). The index binding as measured is sound only because the same `goes_left` flags feed the root computation; I did not test an adversarial prover. Binding the root to the cutoff root, rather than any past root, is a plain equality with a stored root and is not measured.
- Derived: the winning index is a public Winning Commitment, as in ADR 0006, so no ADR 0006 amendment is implied.

**6A, unit-ticket leaves.** One leaf per unit of principal makes `W_max` equal one unit and the acceptance test trivial.

- Documented: a Compact call that inserts `m` leaves performs `m` insert operations whose count is visible in the transcript and in the tree's first-free position, which is public ledger state (#50 section 2; first-free is a public cell). Observed (#50): a leaf insert is about 4,267 rows each.
- Derived: the number of leaves inserted by a deposit discloses its size. **K2 fails** (action amounts are Private Participant Data, `midnight/CONTEXT.md`). Padding every action with a fixed number of indistinguishable dummy leaves removes the leak but makes most selected leaves dead; that variant is 6B with a different parameterisation and is not screened separately. Eliminated by K2 in the unpadded form.

**6B, one leaf per note.**

- K1: nothing is supplied by participants when the draw is finalized, because finalization only publishes `(i, u)`. The owner's weight opening is supplied at claim time, as ADR 0006 already requires of the winner. **If "settlement" is read to include learning whether an award occurred, then K1 and K3 fail**, because the chain cannot distinguish "selected leaf rejected" from "selected owner offline" until the claim window ends. I do not resolve that reading. It is the central interpretation question for this survivor.
- K2: leaf commitments are hiding (`transientCommit` annotation "discloses nothing", #50 section 1.1). The public count `n` is a count of leaves, not of weight. A rejected leaf's owner learns privately that their leaf was selected and rejected; the public cannot tell a rejected leaf from an unclaimed one (Derived).
- K3: only the selected owner acts, once, to claim; no other participant acts per draw.
- K4: Observed above.
- K5: the added dependency is the owner's claim within the Claim Window; failure is expiry and Prize Rollover, as in ADR 0006 and ADR 0030 (Documented). No participant's principal exit depends on it (Derived; the exit path is account-state design and is not examined here).

Verdict: **survives K1 to K5 as literally written, with the interpretation question above**. It does not eliminate the question of how often a draw produces an award, which is a viability measurement, not a kill criterion.

### 4.7 Family 7: self-evaluated sortition (new)

Shape: after the reveal is public, each participant privately evaluates a VRF or keyed hash against a threshold proportional to their weight over the total, and publishes a proof if it passes (Algorand's committee selection is the standard instance: per the abstract, users use Verifiable Random Functions to privately determine whether they are selected and prove it in their messages; Gilad, Hemo, Micali, Vlachos, Zeldovich, [Algorand](https://eprint.iacr.org/2017/454)).

- Derived: this satisfies X1 case ii. But each participant's trial is independent and may pass or fail, so the number of passers is random (zero, one or many). To get exactly one winner from several passers, a tiebreak must compare among those who came forward, and the outcome then depends on who shows up. A passer who is offline cannot be known to the chain.
- **K3 fails**: selection requires a per-draw participant action (the evaluation and publication) from every participant who could win. Eliminated by K3. (Family 6B differs: the selected index is fixed publicly before any participant acts, so a single owner is determined without anyone else coming forward.)

### 4.8 Family 8: randomness-keyed encryption (new)

Shape: participants seal weight openings so that the combined randomness reveal, or a value derived from it, opens them (time-lock or witness-encryption style), and the settlement circuit opens everything.

- Derived: the combined reveal is public after the Reveal Window and the contributors' reveals are produced by the three Operator-controlled keys (ADR 0003, Documented). Anything decryptable with the reveal alone is decryptable by every observer, and by the Operator no later than the reveal.
- **K2 fails**, through the operator-controlled randomness keys, which is exactly the case the criterion names. Eliminated by K2. I did not investigate whether witness-encryption constructions exist for the needed relation; the kill does not depend on it.

### 4.9 Family 9: trusted execution environment (new)

Shape: an enclave holds the decryption key, computes the selection, and signs an attested result.

- Documented: Intel SGX ECDSA quotes use ECDSA with the P-256 curve (and P-384) for the quote signature and attestation key ([Intel SGX DCAP ECDSA Quote Library reference](https://download.01.org/intel-sgx/latest/dcap-latest/linux/docs/Intel_SGX_ECDSA_QuoteLibReference_DCAP_API.pdf), read from the PDF text).
- Documented: secp256r1 and similar curves arrive at toolchain 0.35.0, not 0.31.1 (#50 section 1.1, citing the Midnight release notes; compile probes there confirm secp256k1 is unbound).
- Derived: an in-circuit quote verification is not expressible at the pinned version. A cheaper design, where governance registers the enclave's signing key once and the circuit verifies a Schnorr signature (X3), moves the trust to that registration plus the hardware vendor, and the host that runs the enclave is the Operator unless independent parties host it.
- **K4 fails** for in-circuit attestation verification; the registration-only form is a variant of family 3 with a one-party trust root. Eliminated by K4. The host-and-vendor trust question is carried by family 3's tag and not decided here.

### 4.10 Family 10: participant-present transitions that pre-commit future weight (new)

Shape: each participant action also commits to the weight schedule that will hold until their next action (balance times interval length per Draw Interval), so that carry-forward needs no later action; settlement then scans all pre-committed weights.

- Derived: the schedule's commitments are in public state, but the scan at settlement needs each participant's opening; a later caller has none (#50, #22 probe). The pre-commitment adds nothing for the scan circuit: it is the #22 eight-slot probe with more history.
- If the commitments cover a finite horizon of future intervals, then continuing past the horizon needs the participant to act again (a per-draw cadence). **K3 fails** in that form.
- **K1 fails** for the scan form. Eliminated by K1.
- Derived (the useful residue): the only parts of a pre-committed future that can be used without a participant are the statements checkable by one owner alone (family 6B's claim relation) or by the holder of all data (family 3); every other attempt reduces to those two cases (X1).

## 5. Survivors and their open design questions

These are questions, not choices. They are phrased so each can become a design ticket or be dropped.

### 5.1 Family 6B: public-index sampling with owner-side acceptance

1. **Interpretation of "settlement" (K1 and K3).** Does the finalize step publishing a public candidate count as completing Unattended Selection when the award outcome is only known at claim time? If not, this family is eliminated by K1 and K3, and the maintainer must say so.
2. **Probability of an award.** The unconditional award probability is `sum_i w_i / (n * W_max)` and falls with dead leaves, small weights relative to `W_max`, and churn. Which `W_max` is acceptable, and does the maintainer accept that most intervals may roll over? This is for the maintainer to judge; I set no threshold.
3. **Multiple tries.** Deriving `k` candidate pairs from one reveal raises the award probability, but only the owners of earlier tries can say whether those tries were accepted. A later owner's claim therefore cannot be honoured until earlier owners' windows expire. What claim-window sequencing fits the fifteen-minute cadence and the sixty-minute Claim Window of ADR 0030, and does it create a per-draw dependency on specific offline participants?
4. **Time-weighted partial intervals.** `w` must equal balance times overlap with the Draw Interval, which depends on when a note's leaf was created and retired. How does the leaf and its retirement record (a nullifier timestamp) prove that overlap without disclosing timing or linking nullifier to leaf, given Documented caveats that block-time predicates are the only time source?
5. **Dead and replaced leaves.** Every balance change retires a leaf and adds one. What bounds leaf growth against the depth-32 limit (about 4.3 billion leaves, Documented) and how are retired leaves excluded from `n` or accounted for? Does compaction need participant action (K3) or can it be avoided?
6. **Disclosure Cohort.** The "five eligible commitments" rule counts live, eligible commitments. If live and dead leaves are indistinguishable, what does the cohort check count?
7. **Cutoff root and `n`.** A permissionless checkpoint must record the root and `n` at the interval cutoff; the claim binds to that root, not any past root in the `HistoricMerkleTree` history (equality with a stored root; not measured). What are the history-growth consequences (#50 section 7 item 5, Not established)?
8. **Account-state coupling** (map's deferred ticket): identity cap across split notes, stale-state and nullifier rejection, and capacity above five all live in the account-state design, which this family leaves open.

Measurement so far (Observed, mock-compile only): the claim relation is 8,405 rows, k=14, independent of participant count. No real proof, no proving time, no key size.

Floor items touched: capacity is bounded by the 2^32-leaf limit (Documented) and not by circuit size; catch-up is one constant-size finalize per missed interval (Derived); steady-state per-draw settlement is one finalize plus at most one claim (Derived, not measured).

### 5.2 Family 3: threshold or MPC committee (tagged "needs independent parties")

1. **Who are the parties, and who runs them?** The three Operator-controlled keys cannot serve. Preprod has no independent parties today (Documented, ADR 0003). The maintainer has to decide whether to accept the trade-off; this research does not.
2. **What the chain checks.** An attestation signature (1,645 rows, Observed) shows a quorum signed an index, not that the index is the weighted selection of the on-chain ciphertexts. Is there a committee-computation proof (publicly verifiable MPC, or a SNARK about the committee's computation) whose verifier fits in Compact? Not established; no primary source on this was read beyond the verifiable-FHE material in 4.2 and 4.5.
3. **Threshold signing under the Compact verifier.** The documented verifier uses a `transientHash` challenge reduced to 248 bits. RFC 9591 defines ciphersuites with their own hash-to-scalar functions. Is there a threshold Schnorr protocol compatible with the verifier's challenge function? Not found in primary sources.
4. **What participants post.** Encrypted weight data per balance-changing action, with what well-formedness proof (range, cap), and what linkage does the ciphertext add to the public transcript?
5. **Key rotation and key loss.** Closed-interval weights remain valid (`midnight/CONTEXT.md`, Unresolved Interval). If a committee key is lost, rotated or compromised, are old intervals cancellable, and does that satisfy "closed-interval weights stay intact" or only "do not move"? Forward secrecy against a later quorum compromise.
6. **Latency.** Can a committee decrypt-and-compute and the contract accept the attestation inside the Preprod windows (five-minute reveal period, fifteen-minute cadence), and what is the bounded catch-up step per missed interval?
7. **Sampling.** The committee samples the ticket in its own code. The chain cannot check the sampling distribution from an attestation (Derived), so unbiasedness rests on the committee, unlike family 6B where it is public.
8. **ADR 0006.** The attested index maps to a public Winning Commitment, so no amendment is implied (Derived). The owner relation at claim is unchanged.
9. **Cost and liveness of the internal engine.** Whether the committee uses clear-text reconstruction, MPC or FHE is an implementation question; no measurement exists in this research.

## 6. Documented fact versus my reasoning, summarised

| Statement | Basis |
|---|---|
| Public sum trees store plain sums | Documented, Kleros source |
| Hidden homomorphic sum trees cannot be searched by a winner | Derived from Documented #50 facts |
| FHE evaluation proofs in generic ZKPs are prohibitive; tailored schemes are limited to simpler schemes | Documented, Viand et al. |
| Deployed FHE-on-chain relies on committee threshold decryption and coprocessor majority | Documented, Zama docs pages read |
| General multi-input FE needs iO; decentralised FE exists for inner products | Documented, Goldwasser et al.; Chotard et al. |
| Plain FE has no output-correctness guarantee against malicious authority | Documented, Badrinarayanan et al. |
| Schnorr verification is expressible at 0.31.1 (1,645 rows, k=11) | Documented pattern, Observed compile and mock-compile |
| Public-index claim relation is expressible at 0.31.1 (8,405 rows, k=14) | Observed compile and mock-compile |
| Award probability is `(1/n)(w_i/W_max)` per try; conditional selection is proportional | Derived |
| Decryption inside a permissionless caller's circuit discloses the key to the caller | Derived from Documented #50 witness facts |
| SGX quotes use ECDSA P-256; secp256r1 is not available at 0.31.1 | Documented, Intel reference; Documented, #50 |

## 7. Not established from primary sources

1. A real proof, proving time or key size for any survivor: only `compact compile` and `zkir mock-compile` were run. No proof server was run, so the viability floor's "real proof on proof server 8.1.0" is unmet for all families.
2. The Preprod live ledger parameters and any maximum accepted circuit size (inherited from #50 section 7; the stale `indexerGraphql` value still blocks reading them).
3. `ecMul` scalar-domain behaviour against the Jubjub subgroup order (inherited from #50 item 3). The Schnorr pattern relies on it; the tutorial's signing code uses the subgroup order and a 248-bit challenge.
4. Whether any proof system's verifier for FHE evaluation or committee computation fits in a Compact circuit: no primary source gives a size. The K4 elimination of families 2b and 5 rests on the Documented overhead statements plus the absence of pairing, proof-verifier and cross-contract primitives at 0.31.1, not on a measured size.
5. Whether a threshold Schnorr signing protocol compatible with the tutorial verifier's challenge function exists. RFC 9591 was read only up to character 100,000.
6. Whether publicly verifiable MPC for the selection function exists with a Compact-expressible verifier.
7. The adversarial soundness of the index binding in probe B (only compiled and sized).
8. A practical functional-encryption scheme for comparison-and-select: I found none, which is absence of evidence from the sources searched, not a proof of impossibility. The #22 report itself says its result "does not prove impossibility of all cryptographic constructions".
9. For the Zama Protocol, whether the pages not read (host-chain contracts, fraud proof mechanics) add computation proofs.
10. Whether the Operator can in fact avoid being in any quorum on Preprod. That is a topology fact the map places out of scope (#21, #23, #24), not something research can settle.

## 8. Sources

- [#49](https://github.com/MrSufferer/shroudly/issues/49), [#50](https://github.com/MrSufferer/shroudly/issues/50), [#51](https://github.com/MrSufferer/shroudly/issues/51), [#52](https://github.com/MrSufferer/shroudly/issues/52).
- [#50 findings](https://github.com/MrSufferer/shroudly/blob/research/compact-hidden-state-expressiveness/docs/research/compact-hidden-state-expressiveness.md) and [#51 findings](https://github.com/MrSufferer/shroudly/blob/research/unbiased-sampling/docs/research/unbiased-sampling-onto-total-weight.md) (throwaway branches, read via `git show`).
- #22 report: `midnight/experiments/offline-participation/README.md` on `origin/codex/issue-22-private-offline-integration`.
- Repository: `midnight/CONTEXT.md`, `midnight/version-profile.json`, `docs/adr/0003`, `0006`, `0013`, and (maintainer checkout) `0028`, `0029`, `0030`, `docs/midnight-stack-review.md`.
- Midnight docs, zk-loan tutorial Schnorr module: https://github.com/midnightntwrk/midnight-docs/blob/main/docs/tutorials/zk-loan/smart-contract.mdx (via `npx ctx7@latest docs /midnightntwrk/midnight-docs`; one command, library ID taken from #50).
- Pinned compiler 0.31.1 and its `zkir` binary (probes in the appendix).
- Kleros `SortitionSumTreeFactory`: https://github.com/kleros/kleros/blob/master/contracts/data-structures/SortitionSumTreeFactory.sol
- Viand, Knabenhans, Hithnawi, "Verifiable Fully Homomorphic Encryption": https://arxiv.org/abs/2301.07041
- "Verifiable FHE via Lattice-based SNARKs": https://cic.iacr.org/p/1/1/24 (abstract page only)
- Fiore, Gennaro, Pastro, "Efficiently Verifiable Computation on Encrypted Data": https://eprint.iacr.org/2014/202 (abstract and search summary only)
- Goldwasser, Goyal, Jain, Sahai, "Multi-Input Functional Encryption": https://eprint.iacr.org/2013/727
- Chotard, Dufour-Sans, Gay, Phan, Pointcheval, "Decentralized Multi-Client Functional Encryption for Inner Product": https://eprint.iacr.org/2017/989 (abstract via search result)
- Badrinarayanan, Goyal, Jain, Sahai, "Verifiable Functional Encryption": https://eprint.iacr.org/2016/629 (abstract via search result)
- Gilad, Hemo, Micali, Vlachos, Zeldovich, "Algorand: Scaling Byzantine Agreements for Cryptocurrencies": https://eprint.iacr.org/2017/454 (abstract page)
- RFC 9591 (FROST): https://www.rfc-editor.org/rfc/rfc9591.html
- Zama Protocol docs: https://docs.zama.org/protocol/protocol/overview/kms, https://docs.zama.org/protocol/protocol/overview/coprocessor, https://docs.zama.org/protocol/protocol/overview/gateway
- Intel SGX DCAP ECDSA quote reference: https://download.01.org/intel-sgx/latest/dcap-latest/linux/docs/Intel_SGX_ECDSA_QuoteLibReference_DCAP_API.pdf

## Appendix: probes and reproduction

Environment: `compact compile +0.31.1 --skip-zk <src> <outdir>` then `~/.compact/versions/0.31.1/aarch64-darwin/zkir mock-compile-many <outdir>/zkir`. Probes were written outside the repository and are reproduced here. Rows exclude custom gates and lookups (per #50). No keys, proofs or witnesses were generated.

### Probe A: committee attestation verifier (Schnorr, from the documented tutorial pattern)

Result: `attest` k=11, rows=1,645.

```compact
pragma language_version >= 0.23.0;
import CompactStandardLibrary;
export struct SchnorrSignature { announcement: JubjubPoint; response: Field; }
struct SchnorrHashInput<#n> { ann_x: Field; ann_y: Field; pk_x: Field; pk_y: Field; msg: Vector<n, Field>; }
witness getSchnorrReduction(challengeHash: Field): [Uint<7>, Uint<248>];
witness wsig(): SchnorrSignature;
export ledger committeeKey: JubjubPoint;
export ledger winnerIndex: Uint<64>;
circuit schnorrVerify<#n>(msg: Vector<n, Field>, signature: SchnorrSignature, pk: JubjubPoint): [] {
  const {announcement, response} = signature;
  const cFull: Field = transientHash<SchnorrHashInput<n>>(SchnorrHashInput<n>{
    ann_x: jubjubPointX(announcement), ann_y: jubjubPointY(announcement),
    pk_x: jubjubPointX(pk), pk_y: jubjubPointY(pk), msg: msg });
  const TWO_248: Field = 452312848583266388373324160190187140051835877600158453279131187530910662656 as Field;
  const [q, cTruncated] = getSchnorrReduction(cFull);
  assert(disclose(q) < 116, "q range");
  assert(disclose(q) * TWO_248 + (disclose(cTruncated) as Field) == cFull, "reduction");
  const c: Field = disclose(cTruncated) as Field;
  const lhs: JubjubPoint = ecMulGenerator(response);
  const rhs: JubjubPoint = ecAdd(announcement, ecMul(pk, c));
  assert(jubjubPointX(lhs) == jubjubPointX(rhs) && jubjubPointY(lhs) == jubjubPointY(rhs), "sig");
}
export circuit attest(idx: Uint<64>, drawId: Uint<64>): [] {
  const msg: Vector<2, Field> = [idx as Field, drawId as Field];
  schnorrVerify<2>(msg, wsig(), committeeKey);
  winnerIndex = disclose(idx);
}
```

### Probe B: public-index claim relation with owner-side acceptance

Result: `claim` k=14, rows=8,405. Dropping the `pathIndex` binding line (and the helper) gave k=13, rows=6,226.

```compact
pragma language_version >= 0.23.0;
import CompactStandardLibrary;
export ledger leaves: HistoricMerkleTree<32, Bytes<32>>;
export ledger claimed: Set<Bytes<32>>;
export ledger selU: Uint<64>;
export ledger selIndex: Uint<64>;
witness wpath(): MerkleTreePath<32, Bytes<32>>;
witness wweight(): Uint<64>;
witness wsecret(): Bytes<32>;
circuit pathIndex(p: MerkleTreePath<32, Bytes<32>>): Uint<64> {
  const idx = fold((acc: [Uint<64>, Uint<64>], e: MerkleTreePathEntry): [Uint<64>, Uint<64>] =>
      [ (acc[0] + (e.goes_left ? 0 : acc[1])) as Uint<64>, (acc[1] * 2) as Uint<64> ],
      [0 as Uint<64>, 1 as Uint<64>], p.path);
  return idx[0];
}
export circuit claim(): [] {
  const w = wweight();
  const s = wsecret();
  const leaf = transientCommit<Uint<64>>(w, s as Field);
  const p = wpath();
  assert(p.leaf == upgradeFromTransient(leaf), "leaf binds weight and secret");
  assert(pathIndex(p) == selIndex, "selected index");
  assert(leaves.checkRoot(disclose(merkleTreePathRootNoLeafHash<32>(p))), "member");
  assert(selU < w, "accepted");
  const nf = persistentHash<[Bytes<32>, Bytes<32>]>([s, pad(32, "claim")]);
  claimed.insert(disclose(nf));
}
```

Caveats: the circuits omit identity, interval and cap constraints and use a caller-chosen `selIndex`/`selU`; `s as Field` is not checked for the byte-to-field range failure that #51 section 5 describes. These are cost probes of the relation's shape, not designs.
