# Changelog

## [0.11.4] - 2026-09-03

### Fixed
- **Read tools no longer spill to disk on a large project (display/transport integrity; tracks Versus Claude post-v0.16.5).** The host paginates a tool result over ~5700 chars to disk, and `get_phase_state` is the gateway guard the model is told to call FIRST — when it spilled, the model operated without seeing the state. Measured on a real 761 KB `state.json`: `get_phase_state` returned **50 KB** (projectSpec 39 KB, recentDecisions 11 KB) and `get_decisions` **601 KB**. The three read tools now budget their unbounded fields, staying well under the cap while the full data is injected before every message anyway:
  - **`get_phase_state`** — `projectSpec` normalized to values (the `{value,phase,at}` stamp is analysis metadata the model never reads) with the newest 6 per list kept *independently* (a 200-entry stack cannot evict constraints), older ones dropped whole and counted (`_specNote`); `recentDecisions` content-capped at 200 chars up to a 2.2 KB budget, newest first (`_decisionsNote`); `lastTestOutcome.command` capped (heredocs). 50 KB → ~4.9 KB.
  - **`get_decisions`** — newest first up to a 5 KB budget; a single decision larger than the whole budget is truncated inline (not spilled) with a "narrow by phase" hint. 601 KB → ~4.3 KB.
  - **`get_phase_guidance`** — returns a POINTER to the phase's section in the already-injected context instead of repeating the ~8 KB text inline (pure redundancy — `inject-context` injects the whole methodology every message). ~8 KB → ~0.3 KB; side effect: the MCP server bundle no longer pulls `full-guidance.ts`.
  Final sweep: all read handlers (`get_phase_state`, `get_decisions`, `get_exit_criteria`, `get_phase_guidance`, `check_all_safeguards`, `check_specs_status`) verified < 5691 over the real state.json. No gate or measurement change. 4 new tests (101 total).

### Notes
- The live-safeguard fix (Class A of this round) already shipped in 0.11.3; the cross-gate newline-walk fix in 0.11.2 — both excluded here as already done.

## [0.11.3] - 2026-08-09

### Fixed
- **Live safeguard panel (display only; tracks Versus Claude v0.16.5).** The sidebar and `get_phase_state` read the cached `state.safeguards[].status`, which starts all `ok` and is only ever updated when the agent calls `check_all_safeguards` (guidance fires it once, in Phase 4). But `advance_phase` validates safeguards to decide a block without writing the statuses, and `recordTestOutcome`/the loop-detector do not either — so the panel was a frozen snapshot: S6 could be blocking runs while the display stayed green. Enforcement was always real; only the display lagged. Both surfaces now derive status at read time via `validateSafeguard(id, state)` instead of the cached field. No engine or gate change. Regression test: after S6 reaches its failure threshold, the cached field is still `ok` while `get_phase_state` reports `violated`.

### Notes
- By design only S0 and S6 ever reach `violated`; S1/S5/S7 are `warning`; S2/S3/S4 are behavioural (always `ok`). A mostly-green panel is legitimate — the fix is that the two that can turn red now show it when they do.

## [0.11.2] - 2026-08-09

### Fixed
- **Module cross-gate no longer loses a module whose predecessor row declares a dependency.** `tableColumn2` (the 2→3 module traceability gate, from v0.9.0's Part B) ran one global regex over the whole file. Nothing stopped it crossing a newline: on a row whose last cell is itself a module id — a `depends-on` holding `M-01` — it matched `| M-01 |` + newline + `|` and consumed the pipe that OPENS the next row, so that row was never recognised and its module dropped from the extracted set. The gate then refused `advance_phase(2→3)` naming a module that IS in the architecture table (the RestaUm case: `game` cited by the matrix, present in the file, reported as drift) — an impossible-to-diagnose-from-outside failure, since editing the (correct) `architecture.md` never helps. Fixed by matching **line by line, anchored (`^`), without the `g` flag** — a markdown row never spans a newline, so nothing legitimate is lost. `countArtifactRows` had the same exposure (a global match walking past a newline undercounts rows) and now counts per line, as its doc-comment always said. Regression test: a `depends-on` cell holding a module id must not hide the next module. Corpus scan (110 files, old vs new): exactly one differed — RestaUm's architecture dropping `game` (false block, visible/safe); no coverage-matrix ended a finding row in a lone id, so no silent false-negatives.

### Notes
- **Method:** the case closed not by re-reading the project file a fifth time but by running the gate's own regex and printing the match indices — the match capturing a bare newline was the evidence. When a gate refuses something visibly present, instrument the parser, not the artifact.

## [0.11.1] - 2026-08-09

### Fixed
- **tests_passing classification is now language-agnostic (tracks Versus Claude v0.16.3).** The v0.11.0 exit-code check (I.4) rested on a false assumption: this harness does **not** put a numeric exit code in the Bash `tool_response` — confirmed by reading real `lastTestOutcome` records (34 live projects, `source:"harness"` with sha/bytes/ids but **no `exitCode`**). So I.4 was inert and the batch passed only because jest/pytest print English that the output markers happened to match — a Portuguese or custom-format runner would have gone `unknown`. Adding per-language markers is a losing game; the only agnostic signal is the exit status. Fix: the hook now reads a sanctioned echo token, `detectExitCode()` parsing `VERSUS_TEST_EXIT=<n>` (last occurrence = final run), with precedence harness-exit → echo-token → English markers → unknown, and records `exitSource: "harness" | "echo"` in provenance. Phase 6 guidance makes the standard invocation `<test command>; echo "VERSUS_TEST_EXIT=$?"` (the shell's `$?`, language-proof; do NOT modify the runner), and the `verify:test-pass` refusal teaches it. II `nominal` is redefined to `exitCode` observed (echo or harness) and `=== 0` — otherwise it would be permanently false on this harness. 3 new tests + an end-to-end check through the bundled hook (Portuguese output + `VERSUS_TEST_EXIT=0` → pass) (95 total).

### Notes
- **Lesson recorded:** I.4 was verified against a hand-built payload, never a real one. It was caught by reading the persisted `lastTestOutcome`. Verify the real harness payload before assuming a field arrives.

## [0.11.0] - 2026-08-09

### Added / Changed (post-batch corrections, tracks Versus Claude v0.15.0 → v0.16.2)
- **Test-outcome integrity (Part I).** `recordTestOutcome(command, outcome, provenance?)` now takes `"pass"|"fail"|"unknown"` instead of a boolean: an `unknown` run is *recorded* (so a stale `fail` cannot stay frozen) but does not satisfy the gate and does not count toward S6. The `test-outcome` hook classifies by the process **exit code** when the harness supplies one (0 = pass), falling back to output markers only otherwise, and stamps provenance (`source, toolUseId, sessionId, outputSha256, outputBytes, exitCode`) — which does not prevent forgery but makes a workaround legible in a post-mortem. The hook records `unknown` on a malformed payload for a known test command. The `verify:"test-pass"` refusal now distinguishes "no run recorded in this phase" from an observed `unknown`/`fail`, quoting the recorded outcome. `get_phase_state` exposes `lastTestOutcome`.
- **Verification provenance on the criteria (Part II).** The two `verify:`-gated criteria gain an engine-authored `verifiedBy { path, nominal, at, note?, snapshot? }`, stamped when the transition passes. `nominal:false` marks a degraded path — a pass not confirmed by a harness `exit_code=0`, or a lens record satisfied via the legacy prose fallback — so a post-mortem sees the bypass in the criterion itself.
- **Phase 6 re-verifies what earlier phases decided (Part III).** Two new 6→7 cross-gates: `specs/validation/critical-coverage.md` must reference every 🔴 critical finding of the matrix (blocks only when there are criticals), and `specs/validation/premise-coverage.md` must reference every **numbered** architecture premise (`A-1`, `P-A8`) — conditional, engaging only when the architecture numbers its premises, so a prose project is never over-blocked. Phase 6 guidance adds detection-power (mutation) and four batch practices; Phase 1 guidance requires a complete module table per `## V(N)` and numbered premises.
- **Lens triggers rewritten (Part V; guidance).** Nine of the twelve conditional-lens triggers reworded so the trigger is the condition the central question implies (examples demoted, substantively restrictive), correcting a measured read-error where estimators cited a narrow trigger. SUS/UI-UX/GOV keep their v0.12.9 form. This changes the lens taxonomy the paper measured (X, frozen at DOI 10.5281/zenodo.21908907); Y is the derived correction and testing it is future work — a protocol note, not a new verdict.

### Notes
- **Considered and NOT gated (Part VI):** intra-lens `duplica` (recognising duplication is the human oracle — four judges disagreed widely), fixing the lens set across iterations (activation is a function of the architecture; mandatory re-evaluation already exists), and dangling/pointer-only `duplica`, unique finding ids, iteration headers, per-lens prefixes (zero corpus occurrences). Declared limitations, not code.
- **No batch discard.** This is instrument reinforcement + a taxonomy correction for future work; the frozen results (X) are unaffected.

## [0.10.2] - 2026-08-09

### Added
- **Severity-column gate on the coverage matrix (2→3; tracks Versus Claude v0.14.2).** Same family as the lens-column gate: the guidance fixed three levels (🔴/🟡/🟢) but nothing validated the column, and the analysis counts criticals vs important on it — a non-countable value (a word, a code like `P1`, an empty cell) is a silently wrong count. Each finding's 4th cell must now contain **exactly one** of the three glyphs. Tolerant of decoration, strict on the signal: `🔴 Critical` and a bare `🔴` pass; `high`, `P1`, an empty cell (0 glyphs) and `🔴🟡` (2 glyphs, ambiguous) block and name the row. Runs inside the same `2→3` finding loop as the lens gate. Evidence: a scan of this build's corpus found only the three glyphs (🟡 523 / 🟢 222 / 🔴 154), zero variation — the strict gate blocks no existing project. Guidance gained one line; 5 new tests (84 total).

### Notes
- **Declared limitation (no gate):** the same audit considered gating the *duplicate-finding description* (§3 asks that a `duplica` still describe the defect). It did NOT become a gate — the "describes it well" part is the human oracle, and the mechanizable forms (pointer-only description, a dangling `duplica:`) occur zero times in the corpus, so a gate would guard nothing and only risk a false block. It stays a protocol limitation, not code. (No duplicate-description gate added, matching Claude.)

## [0.10.1] - 2026-08-09

### Changed (non-behavioral — injected guidance and gates are byte-identical)
- **Lenses are a single source in `src/rules/lenses.ts` (tracks Versus Claude v0.14.1).** The central question, failure class, and activation trigger of each lens lived as hand-written markdown in the Phase 2 guidance table — a second copy of names `lenses.ts` already owned, exactly where a trigger edit could drift a name from what the gate validates. `lenses.ts` now holds the full definition of each lens (`LensDef`: name, question, failureClass, trigger); the guidance table is RENDERED from those defs (`renderLensTable`), and `UNIVERSAL_LENSES`/`CONDITIONAL_LENSES`/`ALL_LENSES` are DERIVED from them. The rendered tables are byte-identical to the previous hardcoded ones (verified by diff). New test `P2 lens table renders from lenses.ts`.
- **Retired the Portuguese→English criterion-id migration map.** The `CRITERION_ID_MIGRATION` shim (v0.3.5→v0.3.6) and its three consumers (`engine.migrateCriterionIds()` in `load()`, the map in `phases.ts`, the sidebar lookup predicates) are removed. Evidence-gated: a scan of this build's 43 live `.versus/state.json` files found PT ids in 5, all under `INDT/lixo/jogos/` (disposable) — no project that matters. A pre-rename project reopened after this would show its criteria as unmet; none in that situation is live here.

## [0.10.0] - 2026-08-09

### Added
- **Structured lens activation + coverage-matrix lens-column gate (tracks Versus Claude v0.14.0).** The 19 lenses were prose inside the Phase 2 guidance table, so nothing validated a lens name — a session could write `Segurança`, `SEG` or `Security` and every one passed (v0.12.1 only *instructed* the canonical name). In T21, four findings carried `Sustainability` instead of the canonical `Sustainability / Proportionality` and nothing caught it. Two composing blocks:
  - **Block 1 — declaration as validated state.** New `src/rules/lenses.ts` holds the 19 lenses as data (`UNIVERSAL_LENSES` ×7, `CONDITIONAL_LENSES` ×12, `canonicalLens()` — tolerant of case and spacing around `/`, but not translations or abbreviations). New MCP tool `record_activated_lenses(conditional, notActivated)` replaces the free-text declaration: its enum accepts only the 12 conditional names, all 12 must be accounted for (activated, or not-activated with a non-empty reason), and it rejects — at the call — a universal passed as conditional, a duplicate, a lens both activated and not-activated, and a not-activated lens with no reason. Stored in `state.activatedLenses` as **one `LensActivation` entry per critique iteration** (array, not accumulated), stamped with `iteration` (derived from `history` entries into Phase 2, not the phase-resetting `currentIteration`) and `againstVersion` (count of `## V(N)` sections). The `activated_lenses_recorded` criterion gained `verify: "lenses-recorded"`: `2→3` blocks until a record exists **for the current iteration**, so each loop-back re-declares. Legacy free-text (`ACTIVATED LENSES`/`LENTES ATIVADAS`) is honoured only when `state.stateVersion` is absent — `init_project` now stamps `stateVersion: 1`, so on new projects the structured record is mandatory.
  - **Block 2 — lens-column gate (2→3).** Every finding's `lens` (3rd cell) must be a canonical name or the literal `NENHUMA`; a conditional lens must have been declared for that finding's iteration (from its `## Iteração N` header), matched against **that round's** declared set — never the current-only set, and degrading to the union only when the iteration can't be resolved (the v0.13.0 module-gate lesson). `Sustainability` blocks and names the row (the T21 fix); `Sustainability / Proportionality` and `UI / UX`≡`UI/UX` pass. Runs alongside the module cross-gate; skips (2.2) when nothing is declared.
- Phase 2 guidance rewritten to STEP 1 (`record_activated_lenses`, re-declare each round) and the lens-column gate; the `inject-context` P2 warning points at the structured tool. 13 new tests (78 total).

### Notes
- **Data consequence (batch side):** the T21 slot, which ran the motivating case under the old un-validated behavior, is discarded (as on Claude). Protocol note, not extension behavior.

## [0.9.1] - 2026-08-06

### Fixed
- **The 2↔3 loop-back now resets Phase 3 criteria too, not just Phase 2** (tracks Versus Claude v0.13.1). The 0.8.2 reset cleared only Phase 2 on a 3→2 transition; the four Phase 3 criteria (`criticals_addressed`, `important_decided`, `scope_preserved`, `architecture_simplified`) survived from the first pass. A project that looped (`2→3 · 3→2 · 2→3 · 3→4`) then cleared the `3→4` gate with iteration-1 stamps that answered iteration-1's findings — `criticals_addressed` from iteration 1 means nobody confirmed iteration 2's criticals. The reset is now general and symmetric: any backward transition (only 3→2 today) clears `met` on every criterion in `[targetPhase, from]` — Phase 2 AND Phase 3 — so each redone phase must be re-answered against the new design. `start_iteration` only bumps the counter and is unaffected. Test extended to assert Phase 3 also resets, plus a full `2→3·3→2·2→3` scenario asserting `3→4` blocks until Phase 3 is re-answered.

### Notes
- **Data consequence (batch side):** any already-run project that looped and cleared `3→4` under the old behavior carries iteration-1 stamps on Phase 3 — decide whether to discard it (as with T21 on Claude). Protocol note, not extension behavior.

## [0.9.0] - 2026-08-06

### Added
- **Cross-gate: matrix modules must exist in the architecture (RO3 item 6, previously deferred; tracks Versus Claude v0.13.0).** Advancing 2→3 now checks that every module a finding cites (the `module` column of a finding-id row in `coverage-matrix.md`) appears in `architecture.md`'s module table — validated against the **union of all `## V(N)` versions**, so a module removed between versions is tolerated (iteration-1 findings on it stay legitimate — the T13 `quota-limiter` case) while a name that appears in no version at all blocks and is named. This catches module-name drift with the session still open, instead of the analysis finding it later (the discarded batch had 11 findings silently pointing at nonexistent modules). New `engine` helpers `tableColumn2` / `moduleTraceabilityErrors`; skips harmlessly if either artifact is absent; only the 2→3 transition is affected. Added drift-blocks and version-union-tolerance tests.

### Changed
- **Three conditional-lens triggers widened (RO3 R2; guidance only, tracks Versus Claude v0.12.9).** Each was activating in ~0/7 projects or measuring something narrower than the lens's own central question:
  - **UI/UX** now triggers on any surface a *person* operates — including a CLI or operational tooling, not only graphical end-user interfaces.
  - **Sustainability / Proportionality** now triggers when the system decides, allocates, or consumes a resource whose cost grows with use (AI/ML and high-volume data are examples, not the whole set) — apply the central question, don't just match examples.
  - **Governance / Accountability** now triggers when the system records or decides something someone will later audit, attribute, or answer for — a *system* property that a single-operator project can have, not only multi-team / compliance contexts.

### Notes
- **Protocol/paper caveat (Governance):** widening the Governance trigger changes the lens taxonomy the paper defends — the study batch now measures the corrected taxonomy, not the published one. Recorded here so the trail is honest; it is a protocol note, not an extension behavior.

## [0.8.2] - 2026-08-06

### Fixed
- **Re-entering Phase 2 through the 2↔3 loop now resets ALL Phase 2 exit criteria, not just lenses** (tracks Versus Claude v0.12.8). The item-1 loop-back (0.8.0) reset only `activated_lenses_recorded`, leaving the other four (`lenses_applied`, `coverage_matrix`, `criticals_identified`, `concentration_analyzed`) marked from iteration 1 — so the gate let iteration 1's critique of V(1) stand for the new V(N+1), and the sidebar showed Phase 2 as "4/5 done" on re-entry. Coming back to Phase 2 is a FRESH critique of the new architecture version (new matrix section, criticals and concentration re-analysed), so `advancePhase` now clears `met` on every `phase === 2` criterion on a 3→2 transition; the iteration counter still bumps. Only Phase 2 criteria are touched; the matrix artifact gate still requires the persisted file. Test strengthened to assert all five reset.

## [0.8.1] - 2026-08-06

### Added
- **RO3 item 7 completed: `duplica` within the same lens.** The 0.8.0 pass carried item 7 only as an inline clause; it is now the explicit standalone rule the contract asked for. Phase 2's findings-table rules, right after the cross-lens `duplica` sentence, now state: when one lens records the same defect twice under two ids, mark the second `duplica: <first id>` — a lens double-counting one defect inflates its own exclusive contribution, which is exactly the quantity the study measures. Guidance only; no code, gate, or test change (still 62 tests). Items 6 (cross-gate) and the `record_activated_lenses` tool remain deferred by design.

## [0.8.0] - 2026-08-06

### Added
- **RO3 study contract: per-iteration lens declarations + timestamped projectSpec.** Six of the seven items from the RO3 `CORRECOES-EXTENSAO.md` contract (item 6, the per-version cross-gate `matrix.module ⊆ architecture.modules`, is deferred — see Notes):
  - **Lenses re-declared each Phase 2↔3 round (item 1).** On a 3→2 loop-back `advancePhase` now reverts `activated_lenses_recorded` to unmet and bumps `currentIteration`, so the gate re-demands a fresh declaration — one decision *per iteration*, not one accumulated. The `inject-context` P2 warning keys on the criterion (not "any ACTIVATED LENSES decision ever"), so it re-fires on loop-back.
  - **Declaration names its iteration and architecture version (items 1+2).** Phase 2 guidance requires the `architecture` decision to state `iteração N` and `V(N)`.
  - **No skipping a lens for redundancy (item 3).** The old "selection principle" that dropped a lens deemed redundant with another is replaced: activation is by *project signal only*; overlap is the conclusion an analysis measures, not a premise; absence of findings is a valid result. Per-lens justification for each non-activated lens stays mandatory.
  - **`projectSpec` entries carry a timestamp (item 4).** `stack`/`outOfScope`/`patterns`/`constraints` are now `SpecEntry[]` — each new entry is `{ value, phase, at }` (ISO). Readers accept both forms; legacy plain strings are preserved; dedup is by value. Answers "which entries existed when Phase 2 declared lenses in iteration N?".
  - **Matrix carries an iteration section header (item 5).** Guidance requires `## Iteração N — V(N)` above each round's findings table — a section, never a new column (a column before the id would break the `artifactRows` gate and the frozen finding format); appended on each loop-back.
  - **`duplica` also within the same lens (item 7).** Guidance: mark `duplica: <id>` when one lens files two ids for one defect, not only across lenses.

### Notes
- **Item 6 (cross-gate `matrix.module ⊆ architecture.modules`) deferred.** It must validate per-iteration (a finding from iteration 1 legitimately names a module a later architecture version removed — the T13 `quota-limiter` case), which a naive gate would turn into a block on every normally-evolving project. The RO3 parser already validates this externally, so it is redundant for now; mechanizing it safely (per-iteration matrix + per-version module table parsing) is a separate change.
- The `update_project_spec` MCP interface is unchanged (still accepts string arrays); only the stored form gained timestamps.

## [0.7.6] - 2026-08-05

### Changed
- **Phase 3 now appends a new `## V(N+1)` architecture section instead of overwriting the previous one** (tracks Versus Claude v0.12.5; guidance only — no code, gate, or test change). The Phase 2↔3 loop critiques a different architecture each round: if V(2) removes a module, overwriting `specs/technical/architecture.md` erases the table where iteration 1's findings named it, so a finding ends up pointing at a module no artifact records — the per-module traceability the coverage matrix exists for breaks exactly where the design changed most (seen for real in the T01 pilot, `quota-limiter`). Phase 3 guidance now instructs keeping every version, appending `## V(N+1)` with its own module table; the last section is the current one.

## [0.7.5] - 2026-08-05

### Fixed
- **The coverage-matrix gate no longer accepts an echo of the module table as findings** (tracks Versus Claude v0.12.4; found by the Kimi build). The architecture patch made Phase 1 write module ids `M-01`, and the matrix gate's pattern `[A-Za-z]{1,4}-\d+` matched `M-01` (M fits in `{1,4}`). With `count: 1`, a `coverage-matrix.md` that was just the Phase-1 module table copied over — zero actual findings — passed the Phase 2 gate. The pattern now carries a negative lookahead, `(?!M-)[A-Za-z]{1,4}-\d+`, so `M-\d+` module ids do not count while `P-01`, `A-03` and — importantly — the Mechanical Engineering lens's `MEC-01` still do. Guidance reserves the prefix: `M-` is for modules only; Mechanical Engineering uses `MEC-`, never `M-`. Added a test that a module-echo matrix blocks and a `MEC-01` finding unblocks.

## [0.7.4] - 2026-08-05

### Fixed
- **The structural-gate message now shows the failing artifact's own example** (tracks Versus Claude v0.12.3; found by the Kimi build during porting). The `artifactRows` rejection message was hardcoded with the coverage-matrix example (`P-01 | auth | Security | …`). Since the same message serves every criterion with `artifactRows`, a failing `architecture_doc` told the model to write a *finding* row into `architecture.md` — the wrong file. `artifactRows` gained an optional `example`, each criterion carries the example for its own artifact (`M-01 | rate-limiter | …` for architecture, `P-01 | auth | Security | …` for the coverage matrix), and the engine message is now generic ("structured form", "table row(s) with an id") with the per-criterion example appended. Tests assert the architecture failure shows `M-01` (not `P-01`) and vice versa.

## [0.7.3] - 2026-08-05

### Changed
- **The P1 architecture document must now be a module table, gated on that form** (tracks Versus Claude v0.12.2). `specs/technical/architecture.md` must contain a **module table** — one row per module, `M-01 | module | responsibility | interface | depends-on` — so the canonical module list is machine-readable. `advance_phase()` to Phase 2 is BLOCKED until the file contains at least one `M-\d+` row; a prose doc no longer passes. Reuses the existing `artifactRows` mechanism: `architecture_doc` gets `artifactRows: { pattern: "\\|\\s*M-\\d+\\s*\\|", count: 1 }` (its own token — `M-\d+` for module ids, vs `[A-Za-z]{1,4}-\d+` for coverage findings). Phase 1 exit guidance rewritten to require the table (with the stable `module`-name key that Phase 2's matrix and Phase 5 must reuse). The engine checks the form only, not that later phases actually reused the names (that cross-check is not mechanized). `writeArchitectureDoc` test helper now emits a module table; added a "prose architecture BLOCKS P1→P2" test (59 pass).

## [0.7.2] - 2026-08-05

### Changed
- **Coverage-matrix gate threshold lowered to 1 finding row, and P2/P3 guidance refined** (tracks Versus Claude v0.12.0). The 0.7.1 gate required ≥3 finding-id rows; that inflates the finding count in a study whose metric *is* the number of findings. The gate now only needs to reject a grid with no ids at all, so `coverage_matrix.artifactRows.count` is **1**: a severity-only grid (0 id rows) still blocks, any real findings table passes. Guidance also aligned to the reference: the `lens` column must use the **exact canonical lens name** (Security, Architectural, … — never an abbreviation or translation, so cross-project data stays aggregatable); the stale "Table of modules × lenses … with severities" line (which contradicted the findings-table format) was removed; and the Phase 2 exit no longer offers the invalid "skip to Phase 4" — zero findings is flagged as a red flag and the only valid transition from Phase 2 is to Phase 3.

## [0.7.1] - 2026-08-05

### Changed
- **The P2 coverage-matrix gate now checks structure, not just existence** (ported from Versus Claude v0.12.0). A file that merely existed satisfied the 0.7.0 gate — so a severity-per-cell grid (module × lens) passed, even though it cannot be analysed for overlap vs orthogonality. `coverage_matrix` now requires a **findings table**: one row per finding, `id | module | lens | severity | description`, each with a unique in-project id (P-01, A-03, …) and `duplica: <id>` when it is the same defect another lens found. `advance_phase()` to Phase 3 is BLOCKED until the file contains at least 3 finding-id rows; a severity-only grid is rejected with a message pointing at the required format. New `ExitCriterionDef.artifactRows` (pattern + count) and `engine.countArtifactRows()` back the check — form only, never whether a finding is real or a `duplica` honest (that stays the operator's judgment). Phase 2/3 guidance updated to the findings-table format and to address findings by id.

## [0.7.0] - 2026-08-05

### Changed
- **Exit gates now require persisted/witnessed evidence, not just a boolean** (ported from Versus Claude v0.11.0). Marking a criterion `met=true` was enough to advance — so the structured work (architecture, coverage matrix, lessons) could die in the chat, and "tests passing" could be asserted without a run. Four criteria now demand real evidence the engine can check:
  - **P1 `architecture_doc`** → `specs/technical/architecture.md` must exist and be non-trivial before `advance_phase()` to P2.
  - **P2 `coverage_matrix`** → `specs/design/coverage-matrix.md` must exist and be non-trivial before advancing to P3.
  - **P6 `tests_passing`** → the `test-outcome` hook must have witnessed a GREEN run *in Phase 6* before advancing to P7 (S4: never assume tests passed). A fail, or a pass witnessed in an earlier phase, does not satisfy it.
  - **P7 `lessons_documented`** → `specs/references/lessons.md` must exist and be non-trivial before `start_new_cycle()`.
  The engine checks existence/non-triviality and the witnessed run — never quality; that stays the operator's judgment. New `PhaseState.lastTestOutcome` records the witnessed run; `artifactPresent()` / `witnessedTestPass()` / `missingEvidence()` back the gates. Phase guidance (P1/P2/P3/P5/P6/P7) now instructs writing each artifact to its path and reading it back instead of working from chat recall.

### Fixed
- **MCP server re-reads `state.json` on every tool call.** The server loaded state once at startup, but the hooks write state from a separate process (`lastTestOutcome`, the loop counter). Without re-reading, the `tests_passing` gate would never see the witnessed pass. Disk is authoritative (the engine saves after each mutation), so the handler now calls `engine.load()` first — also fixes general staleness across the two processes.

## [0.6.1] - 2026-08-03

### Fixed
- **Methodology no longer silently disabled in projects with `"type":"module"`** (ported from Versus Claude v0.10.1). If the project's own `package.json` declares `"type":"module"`, Node treats every `.js` under the project tree as an ES module — including the Versus CommonJS bundles — so the MCP server and hooks crashed with `ReferenceError: require is not defined in ES module scope`, and the whole methodology went dead for that project with no visible error. The deploy now writes a `package.json` of `{"type":"commonjs"}` into the bundle directory (`.versus/qwen/`), which pins CommonJS for that folder (Node resolves module type from the nearest `package.json`). Applied to both deploy paths (`deployServer` in the extension, `deployBundles` in `init_project`) via the shared `ensureCommonjsPin` helper; idempotent, never overwritten on reactivation. Existing broken projects self-heal on reopen.

## [0.6.0] - 2026-07-17

### Changed
- **LLM Switch Points are now a decision, not a notice** (ported from Versus Claude v0.10.0). Both switch points — Forward (P4→P5) and Reverse (Phase 7 → new cycle) — previously told the model to *display a notification and proceed*, which put the burden of interrupting on the user at the exact moment the choice is cheapest (before any Phase 5 code exists / before the new cycle's design begins). Now the model must **ask the user to decide in chat** (R2 format):
  - **Forward (P4→P5):** "Continue here" (default) vs "Switch model". On "Switch model" it records `record_decision(category='process', ...)` and stops; on "Continue here" it advances and starts implementing. `advance_phase()` is called in both cases — Phase 4's gate is already satisfied, so a fresh session resumes at Phase 5 rather than re-running convergence.
  - **Reverse (new cycle):** "Switch model" (default, since Phase 0 design wants the most capable Qwen variant) vs "Continue here", surfaced when `start_new_cycle` returns `_modelSwitchAction`.
- **New `record_decision` category `'process'`** for methodology/session decisions (LLM switch, session renewal).

### Fixed
- Guidance and `_modelSwitchAction` text no longer reference the removed `SessionStart` hook (dropped in 0.5.2). The `retomar Versus` mechanic now correctly attributes recovery to the `inject-context` (UserPromptSubmit) hook, which fires on that message.

## [0.5.3] - 2026-07-17

### Changed
- **Bundles now deploy to `.versus/qwen/` instead of `.versus/`.** All three Versus extensions (Claude, Qwen, Copilot) deployed their server + hooks to the same `.versus/` directory with the same filenames, and each registered an MCP server pointing at the same `.versus/server.js`. With two installed, whichever activated last overwrote the other's build, so `versus-qwen` could end up running the Claude server (and Claude's hooks running Qwen's), while each agent still correctly loaded only its own MCP entry (Claude reads `.mcp.json`/`.claude`, Qwen reads `.qwen/settings.json`). Qwen now installs its runtime into its own `.versus/qwen/` subfolder and points `.qwen/settings.json` there, so it can no longer collide with the sibling extensions — fixing this from the Qwen side alone, without touching the published Claude extension.
- **`.versus/state.json` stays shared and unmoved.** The methodology state remains at `.versus/state.json` so a project stays interchangeable between Claude Code and Qwen Code: run the design phases in one, hand off to the other, same state. Only the runtime code (server + hooks) is namespaced per tool.

### Notes
- No state migration: existing projects keep `.versus/state.json` exactly where it is. On upgrade, the extension redeploys bundles into `.versus/qwen/` and repoints `.qwen/settings.json` (MCP server path + hook paths). The old Qwen `.versus/*.js` files are left untouched (they may belong to a co-installed Claude/Copilot extension) and are simply orphaned for Qwen-only users — harmless.

## [0.5.2] - 2026-07-17

### Fixed
- **Removed `type: "prompt"` hooks — invalid in Qwen and surfaced as scary settings.json warnings.** `PreCompact` and both `SessionStart` hooks were registered with `type: "prompt"`, a Claude Code hook type. Qwen Code's `validateHookConfig` only accepts `"command" | "http" | "function"`, so it silently skipped these three hooks **and** flagged each with a schema warning in the user's `.qwen/settings.json` ("Value is not accepted. Valid values: 'command', 'http'"). A user reported the three warnings and reasonably suspected they were breaking the MCP server — they were not (Qwen loads hooks and MCP servers independently, and invalid hooks are dropped, never fatal), but they were dead config and a support magnet. Removed. Session-start and post-compact recovery is already provided by the `UserPromptSubmit` `inject-context` hook (`type: "command"`, works in Qwen), which re-injects full state + guidance on the first message of any session.

### Notes
- No functional change in Qwen: these three hooks never executed there. This only removes the invalid entries and the warnings they produced.
- Same porting root cause as 0.5.1: Claude Code hook conventions (`prompt` type, `bash` matcher) carried into the Qwen extension.

## [0.5.1] - 2026-07-15

### Fixed
- **Shell-tool hooks never fired in Qwen — wrong matcher name.** The `PreToolUse`/`PostToolUse` hooks that gate on shell commands were registered with `matcher: "bash"`, a Claude Code / generic tool name. Qwen Code's shell tool is named `run_shell_command` (per its `ToolNames` map: `SHELL: "run_shell_command"`), and Qwen applies matchers as `new RegExp(matcher).test(toolName)` — so `bash` matched nothing and `loop-detector`, `block-destructive` and `test-outcome` were silent no-ops. This surfaced in v0.5.0, which finally deployed those bundles (dead since v0.1.x). Matchers corrected to `run_shell_command` (and `grep_search|bash` → `grep_search|run_shell_command`). The already-correct matchers `edit|write_file` (phase-gate) and `grep_search` (truncation-check) were left unchanged, and all hook payload reads (`tool_name`, `tool_input.command`, `tool_response`, `file_path`) were verified against Qwen's actual hook input shape.
- **`truncation-check` grep heuristic checked the Claude tool name.** The low-result-count branch tested `tool_name === "Grep"`; Qwen's grep tool is `grep_search`. Corrected.

### Notes
- Root of both defects: v0.5.0 was ported from the Versus Claude codebase, which carried Claude Code tool names into the Qwen hook matchers. No change to the MCP server, tools, or state format — a clean v0.5.0 install already registered and served all 15 MCP tools correctly.

## [0.5.0] - 2026-07-14

### Changed
- **S6 loop detection now counts understanding, not commands.** The detector counted *executions* of a test command: 4 runs in a phase = blocked. But a blind loop runs the tests N times for the same unknown reason, while normal debugging runs them N times for N *named* reasons — and the old rule could not tell them apart, because it counted `bash` calls rather than diagnoses. Worse, being a `PreToolUse` hook it could not see the result of a run, so it blocked the final **green** run — the one moment where running tests is most legitimate, and the one S4 (`NEVER assume tests passed — execute and verify`) explicitly requires. In practice S6 made S4 impossible to satisfy. The new rule:
  - Only a **FAILED** run accumulates. A passing run clears the counter — verification is never blockable.
  - **3 consecutive failures with no diagnosis recorded between them** block the next test run (`LOOP_FAILURE_THRESHOLD` in `rules/safeguards.ts`).
  - `record_decision(category='diagnosis' | 'bugfix' | 'root-cause')` clears the counter immediately — the escape hatch the block message always promised and never honored.
  - Counting moved to a new `test-outcome` hook (`PostToolUse`/bash), the only place a run's result is visible; `loop-detector` (`PreToolUse`) now only blocks. Ambiguous output records nothing.
- **`normalizeCommandPattern` no longer collapses every JS test into one pattern.** `npm test`, `npx jest`, `npm test -- consent` and `npm test -- link` all normalized to `"test:js"`, so failures in four different suites compounded into a single counter — though the S6 clause it implements speaks of iterations *on the same module*. The suite/target argument is now part of the pattern.

### Fixed
- **A blocked phase transition no longer reports an empty reason.** `validatePhaseTransition` vetoes a transition when any safeguard for the phase is `violated`, but `TransitionError` had no field for safeguard violations — they were computed and discarded. `TransitionError.safeguardViolations` added and surfaced through `advance_phase`.
- **Three hooks had never been deployed.** `deployServer` copied only 4 of the 7 bundles while `settings.json` registered hooks pointing at `.versus/stop-verify.js`, `.versus/truncation-check.js` and `.versus/block-destructive.js` — files never written to any workspace. Dead since v0.1.x. The deploy list now covers every bundle referenced by `buildOrchestratorHooks()`.
- `resetLoopCounter()` was dead code (the reset was inlined in `advancePhase` and `startNewCycle`); it is now the single reset path.

### Notes
- Existing `.versus/state.json` files are compatible: `LoopCounter` gained an optional `lastDiagnosis` field and `count` changed meaning (failures, not executions). A stale count clears on the first passing run, the first recorded diagnosis, or the next phase change.
- Ported from Versus Claude v0.9.0 — same defect, same fix.

## [0.4.0] - 2026-05-02

### Added
- **Brownfield bootstrap mode in `init_project`.** Versus now supports projects in progress that need to grow under methodology — the most common real-world scenario. `init_project` accepts an optional `bootstrap_data` parameter with: `stack`, `patterns`, `constraints`, `apparent_use_cases`, `domain_vocabulary`, `module_map`. When present, the handler populates `projectSpec`, records AS-IS decisions in P0/P1 for traceability, and pre-populates `specs/technical/AS-IS-stack.md`, `specs/references/AS-IS-modules.md`, `specs/domain/AS-IS-vocabulary.md`. The init_project tool description carries the full BOOTSTRAP PROTOCOL the AI must follow before calling: (1) detect existing code via surface files, (2) read README + configs + dir structure (NOT implementations), (3) infer stack/modules/use-cases/vocabulary, (4) present Bootstrap Proposal in chat, (5) wait for user confirmation in single turn, (6) call init_project with bootstrap_data populated.
- **DELTA MODE in Phase 0** when bootstrap was applied. The first action of P0 is now MODE DETECTION: if get_decisions(phase=0) returns AS-IS decisions, P0 runs in delta mode — skips HSA Level 1 (Domain, already captured), focuses Levels 2-5 on the new change/feature, Capacity Check asks about modification capacity (not greenfield production), Out of Scope explicitly excludes "everything in the existing system not touched by this delta". Eliminates the failure mode where brownfield projects ran greenfield HSA and produced fictional context.
- **SessionStart hook updated** to point the LLM at the bootstrap protocol when get_phase_state returns "not initialized" and the workspace has existing code.

### Changed
- **`init_project` response includes `mode: "greenfield" | "brownfield"`** and a brownfield-specific instruction block when bootstrap_data was applied.

## [0.3.1] - 2026-05-02

### Added
- **Reverse LLM Switch on `start_new_cycle()`.** Closes the asymmetry: the methodology has a P4→P5 LLM Switch Point but had no equivalent for the Pn→P0_v2 transition (when starting a new cycle). Users typically switched to a smaller Qwen variant in cycle 1 and never returned to the design-grade model — cycle 2 then started Phase 0 (design) on the wrong model. Now `start_new_cycle()` returns `_modelSwitchAction` with the same close+reopen+retomar Versus mechanic, and P7 Meta-iteration guidance instructs the LLM to display this notification when starting a new cycle.

## [0.3.0] - 2026-05-02

### Changed
- **Complete guidance now injected on every UserPromptSubmit (replaces compact-guidance).** The previous strategy curated a compact summary of full-guidance and injected only that. Audit revealed potential precision loss: the compact omits details from full (score weights table, HSA sub-areas, Tier 1/2/3 criteria, lens central questions, etc.) — the LLM operating only with compact for many turns could drift from the full methodology. The new strategy injects the entire full-guidance content (cross-cutting rules + antipatterns + all 8 phase blocks) on every UserPromptSubmit, guaranteeing the LLM has the complete methodology in context regardless of session length. Token cost is bounded by prompt caching (the content is static and cache-hit after first injection per session). Single source of truth: drift between compact and full is now structurally impossible.

### Removed
- **`compact-guidance.ts` deleted.** No longer used. The 8 compact-sync tests are replaced with 8 presence tests over the complete guidance text (assertPresent for critical terms in full-guidance.ts).

## [0.2.4] - 2026-05-02

### Changed
- **Model switch mechanic added to LLM Switch Point (P4→P5)**: previously the notification told the user "you can switch to a faster/cheaper model" without explaining how. Switching models mid-conversation in the same chat causes the new (smaller-context) model to attempt compaction of the previous session, which destroys the structured context Versus preserves via MCP. The notification now instructs the user to: (1) close the current chat, (2) open a new chat with the target model, (3) type `retomar Versus` so the SessionStart hook recovers state cleanly via MCP. The new model starts with fresh context but full methodology state.
- **P6 Step 0 (Session Renewal) clarified for model switching**: the "New session" option now mentions explicitly that this is also the right moment to switch models if desired (e.g., test execution does not need the most capable Qwen variant), reinforcing the same close+reopen+retomar mechanic.

## [0.2.3] - 2026-05-02

### Added
- **Original Scope Adversarial Review** as a mandatory step at end of Phase 5, before the existing Scope Inventory. Forces the LLM to compare P0 commitments (Delivery Target, Success Criteria, Capacity Check inventory) against actual delivery, build a "Promise vs Delivered" table in adversarial mode (find every gap, no charity), and ask the user via AskUserQuestion how to proceed: (1) Continue Phase 5 to complete missing items, (2) Renegotiate scope via `record_decision(category='scope', content='SCOPE REVISION...')`, or (3) Accept gaps as known debt via `record_decision(category='constraint', content='ACCEPTED GAPS...')`. No default, no silent path. Eliminates silent scope deferral (AP10) by making every deferral explicit, recorded, and consented by the user.
- **3-layer ready-to-advance enforcement** for the failure pattern where the LLM marks all exit criteria met but stops with a phase-end summary instead of calling `advance_phase()`:
  - **Layer 1:** `mark_exit_criterion` returns `_nextAction` field with imperative language when the marked criterion completes the phase
  - **Layer 2:** `get_phase_state` returns `_nextAction` whenever state shows "all met but currentPhase unchanged" — catches the LLM on any context recovery
  - **Layer 3:** `inject-context` hook adds a `⚠️ READY TO ADVANCE` banner at the top of every UserPromptSubmit while in this state — three independent reminders in three different points

## [0.2.2] - 2026-05-02

### Changed
- **`ui_runnable` description shortened to "Smoke test: user runs P0 end-to-end"** for sidebar readability. The full rules (AP10, literal user confirmation in details, primary P0 use case) remain in `full-guidance.ts` and `compact-guidance.ts` where the LLM consumes them — sidebar is for human glance.

## [0.2.1] - 2026-05-01

### Added
- **A — Production Capacity Check in Phase 0** (mandatory when Delivery Target is "Complete product"). After Level 5, the LLM must DISPLAY an asset inventory table (authoring / visual / audio / data / integrations × quantity × production source) and ask the user via AskUserQuestion whether capacity to produce them exists. Capacity gap → reduce scope or record_decision(constraint, CAPACITY GAP). Closes the failure mode where P0 design score reaches 90+ while the actual production of content/assets has no plan.
- **B — AP10: Silent Scope Deferral** as a new antipattern. The inverse of AP9 (silent scope creep): marking an exit criterion as met=true while textually noting "will be done in next cycle / out of scope / pending content". The criterion is NOT met. Resolution: either reduce Delivery Target via record_decision OR return to the appropriate phase and complete before advancing. Cross-referenced from P0 capacity check and P5 scope inventory.

### Changed
- **C — `ui_runnable` exit criterion now requires empirical user confirmation.** Description changed from "UI implemented and accessible" to "Human user has executed AT LEAST ONE Phase 0 use case end-to-end and confirmed it works". Without explicit user confirmation captured in the `details` field of mark_exit_criterion, the criterion stays pending. P5 Scope Inventory updated accordingly: it now requires the LLM to ask the user via AskUserQuestion to execute one P0 use case and report back, with literal confirmation stored as evidence. Eliminates the failure mode where placeholder UI passed ui_runnable through prose ressalva.

## [0.2.0] - 2026-04-30

### Added
- **References section in README** — link to source methodology (https://github.com/jasminemoreira/Versus) and academic paper (arxiv:2604.16399).
- **P6 Step 0 — Session Renewal (RECOMMENDED).** Before testing, P6 now suggests the user start a fresh chat session via AskUserQuestion (options: "New session" / "Continue here"). Decouples implementer from tester to reduce confirmation bias — the LLM that wrote the code carries an implicit "of course it works" prior. Automated form of S4 (anti-validador). If user picks "New session", a SESSION RENEWAL decision is recorded and the LLM stops; user resumes in a fresh chat with `retomar Versus`.
- **P6 Step 2 — UI Testing Tooling proposal (only if P1 declared a UI module).** When a UI module exists, P6 detects the project stack and proposes 2-3 stack-appropriate browser/automation tools via AskUserQuestion (with a recommended option marked + "Other" for free choice). Stack→tools mapping: Web SPA → Playwright (rec) / Puppeteer / Cypress; React Native → Detox (rec) / Maestro; Electron → Playwright; CLI → bats / expect; Mobile → Maestro / Appium. The chosen tool is installed and a single smoke test of the primary user flow is implemented before regular spec-driven tests. The choice is recorded as a P6 decision and treated as the BINDING-CONSTRAINTS exception (additive, not a P1 violation).

### Changed
- **P6 step numbering.** Existing steps renumbered to fit new structure: Step 0 (renewal) → Step 1 (Spec-Driven Test Protocol) → Step 2 (UI Tooling) → Step 3 (Write and Execute) → Step 4 (Record Spec Coverage) → Step 5 (Manual Exploratory Testing). Compact guidance and tests updated accordingly.

## [0.1.4] - 2026-04-08

### Added
- **specs/README.md generated on init_project.** Contains: (1) a mini operation manual — "retomar Versus" anchor phrase and MCP discovery behavior, (2) description of each of the 9 subdirectories (domain, references, technical, examples, design, models, datasets, validation, competitors), (3) mapping of which subdirectory feeds which phase. Written idempotently (never overwrites user edits). Reduces onboarding friction — users no longer need to guess what goes in each folder.

## [0.1.3] - 2026-04-08

### Fixed
- **Prerequisites dialog button targets the right destination.** Previously, when Node.js was missing, the error dialog offered a single "Open Marketplace" button that searched the VSCode Marketplace — but Node.js is not a VSCode extension. Now the dialog shows context-aware buttons: "Download Node.js" opens https://nodejs.org/en/download in the browser, "Open Marketplace" opens the marketplace only when Qwen Code Companion is missing. If both are missing, both buttons appear.

## [0.1.2] - 2026-04-08

### Added
- **Visible methodology banner on session start/resume.** SessionStart hooks (both default and compact matcher) now instruct the LLM to START its first response with a one-line banner (e.g., "📍 Versus ativo — Fase X, iteração Y. Próximo passo: ..."). The user now sees when methodology context was loaded; previously the LLM could load state silently and the user wouldn't know.
- **"Retomar Versus" as user-facing anchor phrase.** The init_project message (both MCP and VSCode notification) now tells the user they can type "retomar Versus" in chat at any time to force the LLM to recover methodology context (get_phase_state + get_phase_guidance + get_decisions). Empirically validated as the phrase that reliably triggers context recovery across sessions.

## [0.1.1] - 2026-04-08

### Changed
- **P7 refocused on project-level review.** Removed "Methodology Self-Improvement" 5-step ceremony and "Double-loop evaluation of the PROCESS" — these only benefit the methodology maintainer (who has access to SKILL.md) and risk methodology degradation when applied by end users. P7 now has 3 steps: (1) update specs/ with actual results, (2) product evaluation via AskUserQuestion (does the software meet P0 requirements?), (3) capture 3-5 project-level lessons (domain insights, stack pitfalls, patterns, wrong P0/P1 assumptions) and deposit in specs/. Meta-iteration v1→v2 via `start_new_cycle()` is unchanged. Applied to full-guidance.ts, compact-guidance.ts, and the MUST DISPLAY artifacts list.

## [0.1.0] - 2026-04-07

### Added
- **Initial release** — Port of Versus for Claude (v0.5.1) to Qwen Code Companion.
- **MCP server** (`versus-qwen`) with 15 tools for methodology orchestration via stdio transport.
- **8 sequential phases** with verifiable exit criteria (identical IACDM methodology).
- **8 safeguards (S0-S7)** preventing common AI agent errors.
- **Convergence score** (0-100) with weighted breakdown gating Phase 0 → Phase 1.
- **Persistent decision registry** surviving context switches across sessions.
- **Gateway guard** detecting when models skip loading context (>30min staleness).
- **VS Code sidebar** (TreeView) showing methodology state in real time with phase transition notifications.
- **6 Qwen Code hooks:**
  - `inject-context` (UserPromptSubmit) — injects phase, score, decisions, and compact guidance into every prompt.
  - `phase-gate` (PreToolUse: edit/write_file) — blocks code editing in Phases 0-4.
  - `loop-detector` (PreToolUse: bash) — detects repetitive test executions (>3x), safeguard S7.
  - `block-destructive` (PreToolUse: bash) — blocks destructive commands (rm -rf, DROP TABLE, force push, .env reads).
  - `truncation-check` (PostToolUse: grep_search/bash) — detects truncated tool output and injects warnings.
  - `stop-verify` (Stop) — blocks task completion until project compiles, lints, and tests pass.
- **Project initialization** via Command Palette (`Versus Qwen: Initialize Project`) creating `.versus/state.json`, `specs/` (9 subdirs), MCP registration, and hook configuration.
- **MCP registration** in `.qwen/settings.json` (project-level) using read-merge-write to preserve existing user config.
- **Hook configuration** in `.qwen/settings.json` with Qwen-native tool name matchers.
- **Global permissions** written to `~/.qwen/settings.json` on activation for all 15 MCP tools.
- **Meta-iteration** support via `start_new_cycle` tool (v1→v2 preserving decisions, specs/, history).
- **Adversarial critique** (Phase 2) with 7 universal + 12 conditional specialized lenses.

### Changed (vs. Versus for Claude)
- **Agent identifier:** `state.json` uses `agent: "qwen"` (supports coexistence with Claude/Copilot versions).
- **Config paths:** `.claude/` → `.qwen/` for all settings, hooks, and permissions.
- **MCP registration:** `.mcp.json` → `mcpServers` section in `.qwen/settings.json` (Qwen-native format).
- **Tool name matchers:** `Edit|Write` → `edit|write_file`, `Bash` → `bash`, `Grep|Bash` → `grep_search|bash`.
- **Prerequisite check:** Detects `qwenlm.qwen-code-vscode-ide-companion` extension instead of `anthropic.claude-code`.
- **Extension identifiers:** `versus-claude` → `versus-qwen` across all view IDs, commands, MCP server name, and tool prefixes.
- **Workspace env var:** `CLAUDE_PROJECT_DIR` → `QWEN_PROJECT_DIR` in all hook scripts.
- **Permission patterns:** Qwen-native tool names (`ReadFileTool`, `WriteFileTool`, `ShellTool`, etc.).

### Fixed (inherited from Claude v0.5.1, applied during port)
- **MCP args type coercion.** All numeric MCP parameters (`phase`, `target_phase`, `score`) coerced via `Number()`. Boolean params (`met`) coerced via dedicated `toBool()`. Array params (`stack`, `outOfScope`, `patterns`, `constraints`) handled by `toStringArray()` which accepts both arrays and JSON-encoded strings. Prevents silent failures when LLMs send `"2"` (string) instead of `2` (number) — strict equality comparisons in the engine would fail without coercion.
- **Exit criteria phase matching.** `toNum()` applied to `c.phase` comparisons in `advancePhase()`, `markExitCriterion()`, `markExitCriteria()`, `getExitCriteriaState()`, `getDecisions()`, and `startNewCycle()`. Previously, string-typed phases from `state.json` failed strict equality against numeric parameters.
- **`updateProjectSpec` character splitting.** `toStringArray()` detects and recovers from the MCP parameter parsing bug where arrays are split into individual characters.
