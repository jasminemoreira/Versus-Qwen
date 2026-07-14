# Changelog

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
