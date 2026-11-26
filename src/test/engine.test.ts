// State Engine and Methodology Rules tests

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";
import { StateEngine, LOOP_FAILURE_THRESHOLD } from "../state/engine";
import { ScoreBreakdown } from "../state/types";
import { getCompleteGuidance } from "../rules/full-guidance";
import { validateSafeguard } from "../rules/safeguards";
import { detectOutcome, detectExitCode } from "../hooks/test-outcome";
import { ensureCommonjsPin } from "../setup";
import { specEntryValue } from "../state/types";
import { CONDITIONAL_LENSES, canonicalLens, UNIVERSAL_LENS_DEFS, CONDITIONAL_LENS_DEFS } from "../rules/lenses";
import { handleGetPhaseState, handleGetDecisions, handleUpdateProjectSpec } from "../mcp/tools/state-tools";
import { handleGetPhaseGuidance } from "../mcp/tools/guidance-tools";
import { handleMarkExitCriterion, handleRecordDecision } from "../mcp/tools/record-tools";
import { handleAdvancePhase } from "../mcp/tools/transition-tools";
import { isTestCommand, writeTargets, loadExtraTestPatterns, stripHeredocs } from "../shell/shell-parse";
import { isAllowedPath, blockedTargets } from "../hooks/phase-gate";
import { buildInjection, INJECT_BUDGET } from "../hooks/inject-context";
import { testRunLocation } from "../shell/shell-parse";
import { VERSUS_VERSION } from "../version";
import { buildOrchestratorHooks } from "../setup";
import { handleExportCycle } from "../mcp/tools/transition-tools";
import { BUNDLE_FILES } from "../mcp/tools/project-tools";

/** Records a complete, valid lens declaration for the current critique iteration.
 *  Activates the given conditional lenses (default: Mechanical Engineering, used by
 *  the MEC- fixtures); the rest are not-activated with a reason. */
function declareLenses(activated: string[] = ["Mechanical Engineering"]): void {
  const notActivated = CONDITIONAL_LENSES
    .filter((l) => !activated.includes(l))
    .map((lens) => ({ lens, reason: "no project signal for this lens in the test fixture" }));
  const r = engine.recordActivatedLenses(activated, notActivated);
  assert.ok(r.ok, "declareLenses must succeed" + (r.ok ? "" : ": " + r.error.message));
}

/** Records the approval decision a gated transition (3→4, 4→5, 6→7, cycle close) needs. */
function approve(phase: number, approvedBy = "user") {
  engine.recordDecision(phase, "approval", `Phase ${phase} reviewed and accepted (test fixture)`, { proposedBy: "Qwen", approvedBy });
}

function createTempWorkspace(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "versus-test-"));
  // Create specs/ for checkSpecsStatus tests
  const specsDirs = ["references", "domain", "technical", "examples", "design", "models", "datasets", "validation", "competitors"];
  for (const dir of specsDirs) {
    fs.mkdirSync(path.join(tmp, "specs", dir), { recursive: true });
    fs.writeFileSync(path.join(tmp, "specs", dir, "README.md"), "# " + dir);
  }
  return tmp;
}

function cleanTempWorkspace(tmp: string): void {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function makeFullBreakdown(total: number): ScoreBreakdown {
  // Distributes the score proportionally to the weights
  const factor = total / 100;
  return {
    clarezaProblema: Math.round(10 * factor),
    casosDeUso: Math.round(15 * factor),
    vocabulario: Math.round(10 * factor),
    ambiguidades: Math.round(15 * factor),
    foraDeEscopo: Math.round(10 * factor),
    criteriosSucesso: Math.round(10 * factor),
    premissas: Math.round(10 * factor),
    documentacao: Math.round(5 * factor),
    usuarioConfirmou: Math.round(10 * factor),
    iaConfiante: Math.round(5 * factor),
  };
}

/** Writes a valid coverage findings table (per-finding ids) so Phase 2 can advance. */
function writeCoverageMatrix(ws: string): void {
  const content =
    "# Coverage Matrix\n\n" +
    "| id | module | lens | severity | description |\n" +
    "|------|--------|------|----------|-------------|\n" +
    "| P-01 | auth | Security | 🔴 | login builds SQL by string concat → injection |\n" +
    "| A-03 | auth | Architectural | 🟡 | auth imports ui for its toast → cycle |\n" +
    "| P-02 | ui   | Security | 🔴 | stored XSS via unescaped comment body |\n";
  fs.writeFileSync(path.join(ws, "specs", "design", "coverage-matrix.md"), content);
}

/** Traces the criticals of writeCoverageMatrix (P-01, P-02) for the 6→7 gate. */
function writeCriticalCoverage(ws: string): void {
  fs.writeFileSync(path.join(ws, "specs", "validation", "critical-coverage.md"),
    "# Critical finding coverage\n\n" +
    "| finding | test that would catch a regression |\n|---|---|\n" +
    "| P-01 | auth.injection.test.ts asserts parameterised queries reject a tautology payload |\n" +
    "| P-02 | ui.xss.test.ts asserts the comment body is html-escaped before rendering |\n");
}

/** A severity-only grid: non-trivial, but no per-finding ids — must NOT satisfy the gate. */
function writeSeverityGrid(ws: string): void {
  const content =
    "# Coverage Matrix\n\n" +
    "| module | correctness | security | performance |\n" +
    "|---|---|---|---|\n" +
    "| auth | 🟢 | 🔴 sql-injection in login | 🟢 |\n" +
    "| ui   | 🟡 missing input validation | 🟢 | 🟢 |\n";
  fs.writeFileSync(path.join(ws, "specs", "design", "coverage-matrix.md"), content);
}

/** Writes a non-trivial architecture doc (module table with M-ids) so Phase 1 can advance. */
function writeArchitectureDoc(ws: string): void {
  const content =
    "# Architecture\n\n" +
    "| id | module | responsibility | interface | depends-on |\n" +
    "|------|--------|----------------|-----------|------------|\n" +
    "| M-01 | auth | authenticate users | login(user, pass) -> Session | db |\n" +
    "| M-02 | ui   | render views | render(state) -> DOM | auth |\n\n" +
    "## Assumptions\n- single-threaded runtime\n\n" +
    "## Desvios\nnenhum\n";   // 6→7 requires the deviations record (Claude 0.19.0)
  fs.writeFileSync(path.join(ws, "specs", "technical", "architecture.md"), content);
}

/** A prose architecture: non-trivial, but no module-id rows — must NOT satisfy the gate. */
function writeProseArchitecture(ws: string): void {
  const content =
    "# Architecture\n\n" +
    "## auth\nResponsibility: authenticate users. Interface: login(user, pass) -> Session. Depends on: db.\n\n" +
    "## ui\nResponsibility: render views. Interface: render(state) -> DOM. Depends on: auth.\n\n" +
    "## Assumptions\n- single-threaded runtime\n";
  fs.writeFileSync(path.join(ws, "specs", "technical", "architecture.md"), content);
}

// ===== Tests =====

let workspace: string;
let engine: StateEngine;

function setup() {
  workspace = createTempWorkspace();
  engine = new StateEngine(workspace);
}

function teardown() {
  cleanTempWorkspace(workspace);
}

function test(name: string, fn: () => void) {
  setup();
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err}`);
    process.exitCode = 1;
  } finally {
    teardown();
  }
}

console.log("\n=== State Engine Tests ===\n");

// --- Project ---

test("initProject creates state.json", () => {
  const state = engine.initProject("Test", "Desc");
  assert.strictEqual(state.projectName, "Test");
  assert.strictEqual(state.currentPhase, 0);
  assert.strictEqual(state.currentIteration, 1);
  assert.strictEqual(state.phase0Score, null);
  assert.strictEqual(state.decisions.length, 0);
  assert.strictEqual(state.safeguards.length, 8);

  // Verify persistence
  const statePath = path.join(workspace, ".versus", "state.json");
  assert.ok(fs.existsSync(statePath));
});

test("initProject default agent is qwen", () => {
  const state = engine.initProject("Test", "Desc");
  assert.strictEqual(state.agent, "qwen");
});

test("initProject rejects if already exists", () => {
  engine.initProject("Test", "Desc");
  const loaded = engine.getPhaseState();
  assert.ok(loaded !== null);
  // Second init should not overwrite (tested via MCP tool)
});

test("getPhaseState returns null without project", () => {
  const state = engine.getPhaseState();
  assert.strictEqual(state, null);
});

test("load recovers state from disk", () => {
  engine.initProject("Persist", "Test");
  const engine2 = new StateEngine(workspace);
  const state = engine2.getPhaseState();
  assert.ok(state !== null);
  assert.strictEqual(state!.projectName, "Persist");
});

// --- Decisions ---

test("recordDecision persists and is queryable", () => {
  engine.initProject("Test", "Desc");
  const d = engine.recordDecision(0, "scope", "Out of scope: i18n");
  assert.ok(d.id);
  assert.strictEqual(d.phase, 0);
  assert.strictEqual(d.category, "scope");

  const decisions = engine.getDecisions(0);
  assert.strictEqual(decisions.length, 1);
  assert.strictEqual(decisions[0].content, "Out of scope: i18n");
});

test("getDecisions filters by phase", () => {
  engine.initProject("Test", "Desc");
  engine.recordDecision(0, "scope", "D1");
  engine.recordDecision(1, "arch", "D2");
  engine.recordDecision(0, "req", "D3");

  assert.strictEqual(engine.getDecisions(0).length, 2);
  assert.strictEqual(engine.getDecisions(1).length, 1);
  assert.strictEqual(engine.getDecisions().length, 3);
});

// --- Score ---

test("updateScore saves and is queryable", () => {
  engine.initProject("Test", "Desc");
  engine.updateScore(85, makeFullBreakdown(85));

  const state = engine.getPhaseState()!;
  assert.strictEqual(state.phase0Score, 85);
  assert.ok(state.phase0Breakdown !== null);
});

// --- Exit Criteria ---

test("markExitCriterion creates and updates", () => {
  engine.initProject("Test", "Desc");
  engine.markExitCriterion(0, "score_90", true, "Score 92");

  const criteria = engine.getExitCriteriaState(0);
  assert.strictEqual(criteria.length, 1);
  assert.strictEqual(criteria[0].met, true);

  // Update existing
  engine.markExitCriterion(0, "score_90", false, "Re-evaluated");
  const updated = engine.getExitCriteriaState(0);
  assert.strictEqual(updated[0].met, false);
});

test("getExitCriteriaWithDefs shows defs and state", () => {
  engine.initProject("Test", "Desc");
  engine.markExitCriterion(0, "score_90", true);

  const criteria = engine.getExitCriteriaWithDefs(0);
  assert.ok(criteria.length > 0);
  const score = criteria.find((c) => c.criterion === "score_90");
  assert.ok(score);
  assert.strictEqual(score!.met, true);

  const other = criteria.find((c) => c.criterion === "user_confirmed");
  assert.ok(other);
  assert.strictEqual(other!.met, false);
});

// --- Transitions ---

test("advancePhase blocks without exit criteria", () => {
  engine.initProject("Test", "Desc");
  const result = engine.advancePhase(1);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error.missingCriteria.length > 0);
  }
});

test("advancePhase blocks without score 90", () => {
  engine.initProject("Test", "Desc");
  engine.updateScore(75, makeFullBreakdown(75));
  // Mark all exit criteria
  const criteria = engine.getExitCriteriaWithDefs(0);
  for (const c of criteria) {
    engine.markExitCriterion(0, c.criterion, true);
  }
  const result = engine.advancePhase(1);
  assert.strictEqual(result.ok, false);
});

test("advancePhase allows with score >= 90 and criteria", () => {
  engine.initProject("Test", "Desc");
  engine.updateScore(92, makeFullBreakdown(92));
  const criteria = engine.getExitCriteriaWithDefs(0);
  for (const c of criteria) {
    engine.markExitCriterion(0, c.criterion, true);
  }
  const result = engine.advancePhase(1);
  assert.strictEqual(result.ok, true);

  const state = engine.getPhaseState()!;
  assert.strictEqual(state.currentPhase, 1);
  assert.strictEqual(state.currentIteration, 1);
  assert.strictEqual(state.history.length, 1);
});

test("advancePhase blocks invalid transition (0→2)", () => {
  engine.initProject("Test", "Desc");
  const result = engine.advancePhase(2);
  assert.strictEqual(result.ok, false);
});

test("loop Phase 2↔3 allowed", () => {
  engine.initProject("Test", "Desc");
  // Fast-forward to Phase 2
  engine.updateScore(95, makeFullBreakdown(95));
  for (const c of engine.getExitCriteriaWithDefs(0)) engine.markExitCriterion(0, c.criterion, true);
  engine.advancePhase(1);
  for (const c of engine.getExitCriteriaWithDefs(1)) engine.markExitCriterion(1, c.criterion, true);
  writeArchitectureDoc(workspace);
  engine.advancePhase(2);

  assert.strictEqual(engine.getPhaseState()!.currentPhase, 2);

  // Phase 2 → 3
  for (const c of engine.getExitCriteriaWithDefs(2)) engine.markExitCriterion(2, c.criterion, true);
  writeCoverageMatrix(workspace);
  declareLenses();
  const to3 = engine.advancePhase(3);
  assert.strictEqual(to3.ok, true);

  // Phase 3 → 2 (loop)
  for (const c of engine.getExitCriteriaWithDefs(3)) engine.markExitCriterion(3, c.criterion, true);
  const to2 = engine.advancePhase(2);
  assert.strictEqual(to2.ok, true);
  assert.strictEqual(engine.getPhaseState()!.currentPhase, 2);
});

// --- Iterations ---

test("startIteration increments counter", () => {
  engine.initProject("Test", "Desc");
  assert.strictEqual(engine.getPhaseState()!.currentIteration, 1);

  const r = engine.startIteration(0);
  assert.strictEqual(r.ok, true);
  if (r.ok) {
    assert.strictEqual(r.value.iterationNumber, 2);
  }
  assert.strictEqual(engine.getPhaseState()!.currentIteration, 2);
});

test("startIteration rejects wrong phase", () => {
  engine.initProject("Test", "Desc");
  const r = engine.startIteration(1); // currently on phase 0
  assert.strictEqual(r.ok, false);
});

// --- Safeguards ---

test("checkSafeguard S0 ok when on Phase 0", () => {
  engine.initProject("Test", "Desc");
  const r = engine.checkSafeguard("S0");
  assert.strictEqual(r.status, "ok");
});

test("checkAllSafeguards returns applicable", () => {
  engine.initProject("Test", "Desc");
  const results = engine.checkAllSafeguards();
  assert.ok(results.length > 0);
});

// --- Specs ---

test("checkSpecsStatus detects empty and populated dirs", () => {
  engine.initProject("Test", "Desc");

  // All empty (only README.md)
  let status = engine.checkSpecsStatus();
  assert.strictEqual(status["domain"].populated, false);

  // Populate domain/
  fs.writeFileSync(path.join(workspace, "specs", "domain", "glossario.md"), "# Glossary");
  status = engine.checkSpecsStatus();
  assert.strictEqual(status["domain"].populated, true);
  assert.strictEqual(status["domain"].fileCount, 1);
});

// --- MCP Type Coercion (Qwen-specific regression guards) ---
// These tests protect the toNum/toBool/toStringArray fixes that prevent
// silent failures when MCP parameters arrive as strings instead of native types.

console.log("\n=== MCP Type Coercion Tests ===\n");

test("advancePhase accepts string target_phase", () => {
  engine.initProject("Test", "Desc");
  engine.updateScore(95, makeFullBreakdown(95));
  for (const c of engine.getExitCriteriaWithDefs(0)) engine.markExitCriterion(0, c.criterion, true);

  // MCP may deliver "1" as string — must coerce to 1
  const result = engine.advancePhase("1" as unknown as number);
  assert.strictEqual(result.ok, true, "advancePhase must coerce string target_phase to number");
  assert.strictEqual(engine.getPhaseState()!.currentPhase, 1);
});

test("markExitCriterion matches against string-typed phase in state", () => {
  engine.initProject("Test", "Desc");

  // Simulate corrupted state where phase is string (as it may occur via MCP writes)
  engine.markExitCriterion("0" as unknown as number, "score_90", "true" as unknown as boolean);

  // Should find the entry even though phase was stored as string "0"
  const criteria = engine.getExitCriteriaState(0);
  assert.strictEqual(criteria.length, 1, "must match numeric query against string-stored phase");
  assert.strictEqual(criteria[0].met, true, "string 'true' must coerce to boolean true");

  // Second call with numeric phase should update (not duplicate) the existing entry
  engine.markExitCriterion(0, "score_90", false);
  const after = engine.getExitCriteriaState(0);
  assert.strictEqual(after.length, 1, "must not duplicate when phase types differ");
  assert.strictEqual(after[0].met, false);
});

test("updateProjectSpec recovers from character-split arrays", () => {
  engine.initProject("Test", "Desc");

  // Simulate MCP bug where JSON array string gets split into characters.
  // toStringArray should detect and rebuild the array.
  const split = "[\"TypeScript\",\"Node 18\"]".split("") as unknown as string[];
  engine.updateProjectSpec({ stack: split });

  const values = engine.getProjectSpec().stack.map(specEntryValue);
  assert.ok(values.includes("TypeScript"), "stack must contain TypeScript after recovery");
  assert.ok(values.includes("Node 18"), "stack must contain Node 18 after recovery");
  assert.ok(!values.includes("T"), "stack must NOT contain individual characters");
});

// --- Complete Guidance Presence Tests ---
// Inject-context now injects the COMPLETE methodology guidance every turn
// (instead of a curated compact summary). These tests guard against accidental
// removal of critical methodology terms from full-guidance.ts.

console.log("\n=== Complete Guidance Presence Tests ===\n");

const completeGuidanceText = getCompleteGuidance();

function assertPresent(term: string, reason: string) {
  assert.ok(
    completeGuidanceText.includes(term),
    `Complete guidance missing "${term}" — ${reason}`
  );
}

test("global rules + antipatterns present", () => {
  assertPresent("R2:",  "R2 (AskUserQuestion) is a core rule");
  assertPresent("R5:",  "R5 (Mandatory Display) is a core rule");
  assertPresent("AP1",  "AP1 (Validation theater) defines generation mode");
  assertPresent("AP10", "AP10 (Silent scope deferral) is the latest antipattern");
});

test("P0 critical terms present", () => {
  assertPresent("HIERARCHICAL SEMANTIC ANALYSIS", "P0 core method");
  assertPresent("Delivery Target", "P0 mandatory first question");
  assertPresent("Production Capacity Check", "P0 capacity check (added v0.6.1)");
  assertPresent("Tier 1", "P0 feasibility tier");
});

test("P1 critical terms present", () => {
  assertPresent("UI module", "UI must be explicit module in P1 decomposition");
  assertPresent("update_project_spec", "P1 must persist structured spec");
});

test("P2 critical terms present", () => {
  for (const lens of ["Assumptions", "Architectural", "Implementability", "Scientific", "Security", "Performance", "Regulatory"]) {
    assertPresent(lens, `universal lens "${lens}" must be named`);
  }
});

test("P5 critical terms present", () => {
  assertPresent("adversarial micro-check", "S7 per-module divergence check");
  assertPresent("Original Scope Adversarial Review", "AP10 prevention via explicit scope review");
  assertPresent("Renegotiate scope", "user option to renegotiate scope");
  assertPresent("ACCEPTED GAPS", "user option to accept gaps as documented debt");
  assertPresent("ui_runnable", "P5 exit criterion");
});

test("P6 critical terms present", () => {
  assertPresent("Session Renewal", "P6 Step 0 session renewal");
  assertPresent("Playwright", "primary UI tool recommendation for web SPA");
  assertPresent("Detox", "primary UI tool recommendation for React Native");
});

test("P7 critical terms present", () => {
  assertPresent("start_new_cycle", "meta-iteration tool");
  assertPresent("init_project", "prohibition against init_project for v2 must be present");
});

test("LLM switch + retomar Versus terms present", () => {
  assertPresent("LLM Switch Point", "P4→P5 model switch notification");
  assertPresent("retomar Versus", "anchor phrase for context recovery");
});

// --- S6 Loop Detection ---

console.log("\n=== S6 Loop Detection Tests ===\n");

/** Fast-forward a fresh project to Phase 5 (where S6 loop detection is active). */
function toPhase5() {
  engine.initProject("Test", "Desc");
  engine.updateScore(95, makeFullBreakdown(95));
  writeArchitectureDoc(workspace); // Phase 1→2 gate requires the persisted artifact
  writeCoverageMatrix(workspace);  // Phase 2→3 gate requires the persisted artifact
  declareLenses();                 // Phase 2→3 gate requires structured lens activation
  for (let p = 0; p <= 4; p++) {
    for (const c of engine.getExitCriteriaWithDefs(p)) engine.markExitCriterion(p, c.criterion, true);
    if (p === 3 || p === 4) approve(p);  // 3→4 and 4→5 need a recorded approval
    engine.advancePhase(p + 1);
  }
  assert.strictEqual(engine.getPhaseState()!.currentPhase, 5, "should be in Phase 5");
}

test("passing runs never accumulate — final verification is never blocked", () => {
  toPhase5();
  for (let i = 0; i < 10; i++) {
    engine.recordTestOutcome("npm test", "pass");
  }
  assert.strictEqual(engine.getLoopCounter().count, 0);
  assert.strictEqual(engine.isLoopBlocked(), false);
});

test("a passing run clears failures accumulated before it", () => {
  toPhase5();
  engine.recordTestOutcome("npm test", "fail");
  engine.recordTestOutcome("npm test", "fail");
  assert.strictEqual(engine.getLoopCounter().count, 2);

  engine.recordTestOutcome("npm test", "pass");
  assert.strictEqual(engine.getLoopCounter().count, 0);
  assert.strictEqual(engine.isLoopBlocked(), false);
});

test("blind loop: consecutive failures with no diagnosis block", () => {
  toPhase5();
  for (let i = 0; i < LOOP_FAILURE_THRESHOLD; i++) {
    assert.strictEqual(engine.isLoopBlocked(), false, `should not block before failure ${i + 1}`);
    engine.recordTestOutcome("npm test", "fail");
  }
  assert.strictEqual(engine.getLoopCounter().count, LOOP_FAILURE_THRESHOLD);
  assert.strictEqual(engine.isLoopBlocked(), true, "blocked after threshold undiagnosed failures");
});

test("named diagnosis clears the counter and unblocks", () => {
  toPhase5();
  for (let i = 0; i < LOOP_FAILURE_THRESHOLD; i++) engine.recordTestOutcome("npm test", "fail");
  assert.strictEqual(engine.isLoopBlocked(), true);

  engine.recordDecision(5, "diagnosis", "Duplicate const in card.ts shadowed the export.");
  assert.strictEqual(engine.getLoopCounter().count, 0);
  assert.strictEqual(engine.isLoopBlocked(), false, "diagnosis is the escape hatch the block promises");
  assert.ok(engine.getLoopCounter().lastDiagnosis, "diagnosis timestamp recorded");
});

test("real session: 4 failures, 4 named causes — never blocked", () => {
  toPhase5();
  // The case this rule exists for: each round has its own diagnosis and fix.
  const rounds = [
    { cmd: "npm test -- consent", cause: "consent test asserts old card copy; rewrote the card text" },
    { cmd: "npm test -- link", cause: "link test used a view id that does not exist" },
    { cmd: "npm test", cause: "app crashed on a duplicate const" },
    { cmd: "npm test -- ui_smoke", cause: "dev DB carried leftover rows from an earlier run" },
  ];
  for (const r of rounds) {
    assert.strictEqual(engine.isLoopBlocked(), false, `blocked before running ${r.cmd} — regression`);
    engine.recordTestOutcome(r.cmd, "fail");
    engine.recordDecision(5, "diagnosis", r.cause);
  }
  assert.strictEqual(engine.isLoopBlocked(), false, "four diagnosed failures are the normal cycle, not a loop");

  // And the green verification run goes through.
  engine.recordTestOutcome("npm test", "pass");
  assert.strictEqual(engine.getLoopCounter().count, 0);
});

test("non-diagnosis decisions do NOT clear the counter", () => {
  toPhase5();
  for (let i = 0; i < LOOP_FAILURE_THRESHOLD; i++) engine.recordTestOutcome("npm test", "fail");
  engine.recordDecision(5, "testing", "ran the suite again");
  assert.strictEqual(engine.isLoopBlocked(), true, "only a named diagnosis clears S6");
});

test("different suites are different patterns (S6 speaks of modules)", () => {
  toPhase5();
  engine.recordTestOutcome("npm test -- consent", "fail");
  engine.recordTestOutcome("npm test -- link", "fail");
  // Second suite starts its own count instead of compounding the first.
  assert.strictEqual(engine.getLoopCounter().count, 1);
  assert.ok(engine.getLoopCounter().pattern.includes("link"));
});

test("a blocked S6 vetoes the phase transition, and says why", () => {
  toPhase5();
  for (const c of engine.getExitCriteriaWithDefs(5)) engine.markExitCriterion(5, c.criterion, true);
  engine.recordDecision(5, "scope-inventory", "modules ✅ validation ✅ UI ✅ (fixture)");
  for (let i = 0; i < LOOP_FAILURE_THRESHOLD; i++) engine.recordTestOutcome("npm test", "fail");

  // Advancing must not be an escape from a blind loop — but the refusal must be legible.
  const blocked = engine.advancePhase(6);
  assert.strictEqual(blocked.ok, false);
  if (blocked.ok) return;
  assert.strictEqual(blocked.error.missingCriteria.length, 0, "criteria are all met — S6 is the only blocker");
  assert.ok(blocked.error.safeguardViolations?.length, "the reason must not be an empty error");
  assert.ok(blocked.error.safeguardViolations![0].includes("S6"));
});

test("advancePhase clears the counter (after the loop is diagnosed)", () => {
  toPhase5();
  for (const c of engine.getExitCriteriaWithDefs(5)) engine.markExitCriterion(5, c.criterion, true);
  engine.recordDecision(5, "scope-inventory", "modules ✅ validation ✅ UI ✅ (fixture)");
  for (let i = 0; i < LOOP_FAILURE_THRESHOLD; i++) engine.recordTestOutcome("npm test", "fail");

  engine.recordDecision(5, "diagnosis", "Named the cause.");
  const r = engine.advancePhase(6);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(engine.getLoopCounter().count, 0);
  assert.strictEqual(engine.isLoopBlocked(), false);
});

test("S6 safeguard reports violated when blocked", () => {
  toPhase5();
  for (let i = 0; i < LOOP_FAILURE_THRESHOLD; i++) engine.recordTestOutcome("npm test", "fail");
  const s6 = validateSafeguard("S6", engine.getPhaseState()!);
  assert.strictEqual(s6.status, "violated");
  assert.ok(s6.details.includes("diagnosis"), "must point at the escape hatch");
});

test("detectOutcome: green run is not a failure", () => {
  assert.strictEqual(detectOutcome("Tests: 12 passed, 12 total"), "pass");
  assert.strictEqual(detectOutcome("test result: ok. 8 passed; 0 failed"), "pass");
  assert.strictEqual(detectOutcome("=== 5 passed in 0.42s ==="), "pass");
});

test("detectOutcome: red run is a failure", () => {
  assert.strictEqual(detectOutcome("Tests: 1 failed, 11 passed"), "fail");
  assert.strictEqual(detectOutcome("FAIL src/consent.test.ts"), "fail");
  assert.strictEqual(detectOutcome("SyntaxError: Identifier 'x' has already been declared"), "fail");
  assert.strictEqual(detectOutcome("exit code: 1"), "fail");
});

test("detectOutcome: ambiguous output records nothing", () => {
  assert.strictEqual(detectOutcome("Running tests..."), "unknown");
  assert.strictEqual(detectOutcome(""), "unknown");
});

test("ensureCommonjsPin immunizes deploy dir against project type:module", () => {
  const ws = createTempWorkspace();
  try {
    // Project declares ESM at its root — makes every .js below it an ES module.
    fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ type: "module" }));
    const deployDir = path.join(ws, ".versus", "qwen");
    fs.mkdirSync(deployDir, { recursive: true });
    // A CommonJS bundle (uses require), like the real server + hooks.
    const probe = path.join(deployDir, "probe.js");
    fs.writeFileSync(probe, "const p = require('path'); process.stdout.write('OK:' + typeof p.join);\n");

    // Without the pin: Node treats probe.js as ESM -> require is not defined.
    const before = spawnSync("node", [probe], { encoding: "utf-8" });
    assert.ok(/require is not defined/i.test(before.stderr || ""), "expected ESM failure before pin");

    // With the pin: CommonJS is restored for the deploy dir only.
    ensureCommonjsPin(deployDir);
    const pkg = JSON.parse(fs.readFileSync(path.join(deployDir, "package.json"), "utf-8"));
    assert.strictEqual(pkg.type, "commonjs");
    const after = spawnSync("node", [probe], { encoding: "utf-8" });
    assert.strictEqual((after.stderr || "").trim(), "", "expected no error after pin");
    assert.ok(after.stdout.includes("OK:function"), "expected CommonJS require to work after pin");
  } finally {
    cleanTempWorkspace(ws);
  }
});

test("ensureCommonjsPin is idempotent", () => {
  const ws = createTempWorkspace();
  try {
    const dir = path.join(ws, ".versus", "qwen");
    fs.mkdirSync(dir, { recursive: true });
    ensureCommonjsPin(dir);
    const first = fs.readFileSync(path.join(dir, "package.json"), "utf-8");
    ensureCommonjsPin(dir);
    const second = fs.readFileSync(path.join(dir, "package.json"), "utf-8");
    assert.strictEqual(first, second);
  } finally {
    cleanTempWorkspace(ws);
  }
});

console.log("\n=== Artifact / Evidence Gate Tests ===\n");

/** Fast-forward to Phase 2 with all P2 criteria marked met (no coverage artifact yet). */
function toPhase2Stamped() {
  engine.initProject("Test", "Desc");
  engine.updateScore(95, makeFullBreakdown(95));
  for (const c of engine.getExitCriteriaWithDefs(0)) engine.markExitCriterion(0, c.criterion, true);
  engine.advancePhase(1);
  for (const c of engine.getExitCriteriaWithDefs(1)) engine.markExitCriterion(1, c.criterion, true);
  writeArchitectureDoc(workspace);
  engine.advancePhase(2);
  declareLenses();
  for (const c of engine.getExitCriteriaWithDefs(2)) engine.markExitCriterion(2, c.criterion, true);
  assert.strictEqual(engine.getPhaseState()!.currentPhase, 2);
}

test("coverage_matrix stamped but not persisted BLOCKS advance", () => {
  toPhase2Stamped();
  const r = engine.advancePhase(3);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.error.missingCriteria.length, 1);
  assert.ok(r.error.missingCriteria[0].includes("coverage-matrix.md"));
  assert.ok(r.error.missingCriteria[0].includes("marking the criterion met is not enough"));
});

test("persisted matrix unblocks the advance", () => {
  toPhase2Stamped();
  assert.strictEqual(engine.advancePhase(3).ok, false, "blocked without the file");
  writeCoverageMatrix(workspace);
  const r = engine.advancePhase(3);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(engine.getPhaseState()!.currentPhase, 3);
});

test("a trivial artifact does not count as persisted", () => {
  toPhase2Stamped();
  fs.writeFileSync(path.join(workspace, "specs", "design", "coverage-matrix.md"), "| |\n");
  const r = engine.advancePhase(3);
  assert.strictEqual(r.ok, false, "empty/near-empty file must not satisfy the gate");
  if (r.ok) return;
  assert.ok(r.error.missingCriteria.some((m) => m.includes("coverage-matrix.md") && m.includes("missing or empty")), "block must name the artifact and the reason");
});

test("a severity-only grid (no per-finding ids) BLOCKS advance", () => {
  toPhase2Stamped();
  writeSeverityGrid(workspace); // non-trivial, but no P-01/A-03 ids
  const r = engine.advancePhase(3);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.ok(r.error.missingCriteria[0].includes("structured form"));
  assert.ok(r.error.missingCriteria[0].includes("P-01 | auth | Security"), "must show the coverage-matrix example, not another artifact's");

  writeCoverageMatrix(workspace); // proper findings table
  assert.strictEqual(engine.advancePhase(3).ok, true);
});

test("a matrix that only echoes module ids (M-) has no findings, BLOCKS", () => {
  toPhase2Stamped();
  // Echo of the Phase-1 module table: M- rows only, no real findings.
  fs.writeFileSync(
    path.join(workspace, "specs", "design", "coverage-matrix.md"),
    "# Coverage Matrix\n\n| id | module | lens | severity | description |\n|--|--|--|--|--|\n" +
    "| M-01 | auth | — | — | echoed from architecture, not a finding |\n" +
    "| M-02 | ui | — | — | echoed from architecture, not a finding |\n"
  );
  const rEcho = engine.advancePhase(3);
  assert.strictEqual(rEcho.ok, false, "a module-echo matrix has zero findings and must block");
  if (!rEcho.ok) assert.ok(rEcho.error.missingCriteria.some((m) => m.includes("structured form")), "block must explain the missing findings form");

  // A real finding with a non-M prefix (incl. Mechanical Engineering's MEC-) unblocks.
  // Module must exist in the architecture (auth) — the cross-gate checks that too.
  fs.writeFileSync(
    path.join(workspace, "specs", "design", "coverage-matrix.md"),
    "# Coverage Matrix\n\n| id | module | lens | severity | description |\n|--|--|--|--|--|\n" +
    "| MEC-01 | auth | Mechanical Engineering | 🔴 | rigid coupling to db version breaks on minor upgrades |\n"
  );
  assert.strictEqual(engine.advancePhase(3).ok, true, "MEC- is a finding id, not a module — must count");
});

test("2→3 BLOCKS when a finding cites a module absent from every architecture version (drift)", () => {
  toPhase2Stamped(); // architecture declares auth, ui
  fs.writeFileSync(
    path.join(workspace, "specs", "design", "coverage-matrix.md"),
    "# CM\n\n## Iteração 1 — V(1)\n\n| id | module | lens | severity | description |\n|--|--|--|--|--|\n" +
    "| P-01 | phantom | Security | 🔴 | drift: this module is not in the architecture table at all |\n"
  );
  const r = engine.advancePhase(3);
  assert.strictEqual(r.ok, false, "a finding on an invented module must block");
  if (r.ok) return;
  assert.ok(r.error.missingCriteria.some((m) => m.includes("phantom")), "drift error must name the invented module");
});

test("2→3 TOLERATES a finding on a module removed in a later architecture version (union)", () => {
  toPhase2Stamped();
  // V(1) has quota-limiter; V(2) removed it. Both versions kept in the file.
  fs.writeFileSync(
    path.join(workspace, "specs", "technical", "architecture.md"),
    "# Architecture\n\n## V(1)\n\n| id | module | responsibility | interface | depends |\n|--|--|--|--|--|\n" +
    "| M-01 | quota-limiter | enforce quota | allow(key) | store |\n| M-02 | store | persist counters | incr(key) | — |\n\n" +
    "## V(2)\n\n| id | module | responsibility | interface | depends |\n|--|--|--|--|--|\n" +
    "| M-02 | store | persist counters | incr(key) | — |\n"
  );
  // Iteration-1 finding legitimately names quota-limiter (present in V(1)).
  fs.writeFileSync(
    path.join(workspace, "specs", "design", "coverage-matrix.md"),
    "# CM\n\n## Iteração 1 — V(1)\n\n| id | module | lens | severity | description |\n|--|--|--|--|--|\n" +
    "| P-01 | quota-limiter | Security | 🔴 | unbounded window lets a key bypass its quota here |\n"
  );
  assert.strictEqual(engine.advancePhase(3).ok, true, "a module present in SOME architecture version must be tolerated");
});

test("countArtifactRows counts finding rows, not grid rows", () => {
  engine.initProject("Test", "Desc");
  const pat = "\\|\\s*[A-Za-z]{1,4}-\\d+\\s*\\|";
  writeSeverityGrid(workspace);
  assert.strictEqual(engine.countArtifactRows("design/coverage-matrix.md", pat), 0);
  writeCoverageMatrix(workspace);
  assert.strictEqual(engine.countArtifactRows("design/coverage-matrix.md", pat), 3);
});

test("artifactPresent: existence + non-trivial content", () => {
  engine.initProject("Test", "Desc");
  assert.strictEqual(engine.artifactPresent("design/coverage-matrix.md"), false);
  writeCoverageMatrix(workspace);
  assert.strictEqual(engine.artifactPresent("design/coverage-matrix.md"), true);
});

test("architecture_doc stamped but not persisted BLOCKS P1→P2", () => {
  engine.initProject("Test", "Desc");
  engine.updateScore(95, makeFullBreakdown(95));
  for (const c of engine.getExitCriteriaWithDefs(0)) engine.markExitCriterion(0, c.criterion, true);
  engine.advancePhase(1);
  for (const c of engine.getExitCriteriaWithDefs(1)) engine.markExitCriterion(1, c.criterion, true);
  const blocked = engine.advancePhase(2);
  assert.strictEqual(blocked.ok, false);
  if (blocked.ok) return;
  assert.ok(blocked.error.missingCriteria.some((m) => m.includes("technical/architecture.md")));
  writeArchitectureDoc(workspace);
  const r = engine.advancePhase(2);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(engine.getPhaseState()!.currentPhase, 2);
});

test("a prose architecture (no module table) BLOCKS P1→P2", () => {
  engine.initProject("Test", "Desc");
  engine.updateScore(95, makeFullBreakdown(95));
  for (const c of engine.getExitCriteriaWithDefs(0)) engine.markExitCriterion(0, c.criterion, true);
  engine.advancePhase(1);
  for (const c of engine.getExitCriteriaWithDefs(1)) engine.markExitCriterion(1, c.criterion, true);
  writeProseArchitecture(workspace); // non-trivial prose, but no | M-01 | rows
  const blocked = engine.advancePhase(2);
  assert.strictEqual(blocked.ok, false, "prose must not satisfy the module-table gate");
  if (blocked.ok) return;
  const msg = blocked.error.missingCriteria.find((m) => m.includes("architecture.md"))!;
  assert.ok(msg.includes("M-01 | rate-limiter"), "architecture failure must show the module-table example");
  assert.ok(!msg.includes("P-01 | auth"), "must NOT show the coverage-matrix example for an architecture failure");

  writeArchitectureDoc(workspace); // proper module table
  assert.strictEqual(engine.advancePhase(2).ok, true);
});

/** Fast-forward to Phase 6 with all earlier gates satisfied. */
function toPhase6() {
  toPhase5();
  for (const c of engine.getExitCriteriaWithDefs(5)) engine.markExitCriterion(5, c.criterion, true);
  engine.recordDecision(5, "scope-inventory", "P1 modules ✅ · specs/validation ✅ · UI runnable ✅ (fixture)");
  engine.advancePhase(6);
  assert.strictEqual(engine.getPhaseState()!.currentPhase, 6);
  writeCriticalCoverage(workspace); // 6→7 cross-gate: matrix criticals must be traced
  approve(6);                       // 6→7 needs a recorded test sign-off
}

test("tests_passing stamped but no witnessed green run BLOCKS P6→P7", () => {
  toPhase6();
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true);
  const blocked = engine.advancePhase(7);
  assert.strictEqual(blocked.ok, false);
  if (blocked.ok) return;
  assert.ok(blocked.error.missingCriteria.some((m) => m.includes("witnessed passing test run")));
});

test("a witnessed green run in Phase 6 unblocks P6→P7", () => {
  toPhase6();
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true);
  engine.recordTestOutcome("npm test", "pass"); // the hook witnesses a pass in phase 6
  const r = engine.advancePhase(7);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(engine.getPhaseState()!.currentPhase, 7);
});

test("a witnessed FAIL does not satisfy tests_passing", () => {
  toPhase6();
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true);
  engine.recordTestOutcome("npm test", "fail"); // red run
  const r = engine.advancePhase(7);
  assert.strictEqual(r.ok, false);
  if (!r.ok) assert.ok(r.error.missingCriteria.some((m) => m.includes("witnessed passing test run")), "block must name the missing green run");
});

test("a pass witnessed in an EARLIER phase does not satisfy Phase 6", () => {
  toPhase5();
  engine.recordTestOutcome("npm test", "pass"); // green run, but in phase 5
  for (const c of engine.getExitCriteriaWithDefs(5)) engine.markExitCriterion(5, c.criterion, true);
  engine.recordDecision(5, "scope-inventory", "P1 modules ✅ (fixture)");
  engine.advancePhase(6);
  approve(6);
  writeCriticalCoverage(workspace);
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true);
  const rEarlier = engine.advancePhase(7);
  assert.strictEqual(rEarlier.ok, false, "the pass must be witnessed IN phase 6");
  if (!rEarlier.ok) assert.ok(rEarlier.error.missingCriteria.some((m) => m.includes("witnessed passing test run")), "block must name the missing green run");
});

test("start_new_cycle BLOCKED until lessons.md is persisted", () => {
  toPhase6();
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true);
  engine.recordTestOutcome("npm test", "pass");
  assert.strictEqual(engine.advancePhase(7).ok, true, "6→7 should pass with critical coverage + green run");
  for (const c of engine.getExitCriteriaWithDefs(7)) engine.markExitCriterion(7, c.criterion, true);
  approve(7);

  const blocked = engine.startNewCycle();
  assert.strictEqual(blocked.ok, false);
  if (blocked.ok) return;
  assert.ok(String(blocked.error).includes("references/lessons.md"));

  fs.writeFileSync(
    path.join(workspace, "specs", "references", "lessons.md"),
    "# Lessons\n\n- The auth module's session TTL assumption from P0 was wrong; refreshed tokens broke it.\n  guard: T-07\n- The chosen approach lacked batch upsert; had to hand-roll it.\n  guard: none\n"
  );
  const r = engine.startNewCycle();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(engine.getPhaseState()!.currentPhase, 0);
});

console.log("\n=== RO3 Contract Tests (per-iteration lenses + timestamped spec) ===\n");

test("Phase 2↔3 loop-back resets activated_lenses_recorded and bumps the iteration", () => {
  engine.initProject("Test", "Desc");
  engine.updateScore(95, makeFullBreakdown(95));
  writeArchitectureDoc(workspace);
  writeCoverageMatrix(workspace);
  for (const c of engine.getExitCriteriaWithDefs(0)) engine.markExitCriterion(0, c.criterion, true);
  engine.advancePhase(1);
  for (const c of engine.getExitCriteriaWithDefs(1)) engine.markExitCriterion(1, c.criterion, true);
  engine.advancePhase(2);
  // Iteration 1: declare lenses (structured), advance to Phase 3.
  declareLenses();
  for (const c of engine.getExitCriteriaWithDefs(2)) engine.markExitCriterion(2, c.criterion, true);
  const lensMet = () => engine.getExitCriteriaWithDefs(2).find((c) => c.criterion === "activated_lenses_recorded")!.met;
  assert.strictEqual(lensMet(), true);
  engine.advancePhase(3);
  // Answer Phase 3 (iteration 1) too, then loop back.
  for (const c of engine.getExitCriteriaWithDefs(3)) engine.markExitCriterion(3, c.criterion, true);
  const back = engine.advancePhase(2);
  assert.strictEqual(back.ok, true);
  assert.strictEqual(engine.getPhaseState()!.currentPhase, 2);
  assert.strictEqual(lensMet(), false, "loop-back must re-demand the lens declaration for the new round");
  // ALL Phase 2 AND Phase 3 criteria reset — symmetric redo of the new round.
  assert.ok(
    engine.getExitCriteriaWithDefs(2).every((c) => !c.met),
    "loop-back resets every Phase 2 exit criterion, not just lenses"
  );
  assert.ok(
    engine.getExitCriteriaWithDefs(3).every((c) => !c.met),
    "loop-back also resets Phase 3 (its iteration-1 stamp answered the old critique)"
  );
  assert.ok(engine.getPhaseState()!.currentIteration > 1, "loop-back bumps the iteration counter");
});

test("2→3·3→2·2→3 then 3→4 BLOCKS until Phase 3 is re-answered", () => {
  engine.initProject("Test", "Desc");
  engine.updateScore(95, makeFullBreakdown(95));
  writeArchitectureDoc(workspace);
  writeCoverageMatrix(workspace);
  for (const c of engine.getExitCriteriaWithDefs(0)) engine.markExitCriterion(0, c.criterion, true);
  engine.advancePhase(1);
  for (const c of engine.getExitCriteriaWithDefs(1)) engine.markExitCriterion(1, c.criterion, true);
  engine.advancePhase(2);
  declareLenses();                               // iteration 1
  for (const c of engine.getExitCriteriaWithDefs(2)) engine.markExitCriterion(2, c.criterion, true);
  engine.advancePhase(3);                       // 2→3
  for (const c of engine.getExitCriteriaWithDefs(3)) engine.markExitCriterion(3, c.criterion, true);
  engine.advancePhase(2);                        // 3→2 — resets Phase 2 AND Phase 3
  declareLenses();                               // iteration 2 — re-declare against the new round
  for (const c of engine.getExitCriteriaWithDefs(2)) engine.markExitCriterion(2, c.criterion, true);
  engine.advancePhase(3);                        // 2→3 again
  // Phase 3 NOT re-answered for this round → the gate to Phase 4 must block.
  const r34 = engine.advancePhase(4);
  assert.strictEqual(r34.ok, false, "3→4 blocked until Phase 3 is re-answered for the new round");
  if (!r34.ok) assert.ok(r34.error.missingCriteria.some((m) => m.includes("Phase 3")), "block must name the unmet Phase 3 criteria");
  for (const c of engine.getExitCriteriaWithDefs(3)) engine.markExitCriterion(3, c.criterion, true);
  approve(3);
  assert.strictEqual(engine.advancePhase(4).ok, true, "re-answering Phase 3 unblocks 3→4");
});

test("updateProjectSpec stores plain strings and preserves legacy (string and stamped) entries", () => {
  engine.initProject("Test", "Desc");
  // A legacy plain-string entry (old projects) already in state.
  engine.getPhaseState()!.projectSpec.stack.push("LegacyTech");
  engine.updateProjectSpec({ stack: ["TypeScript", "Node 18+"] });

  const stack = engine.getProjectSpec().stack;
  assert.ok(stack.includes("LegacyTech"), "legacy string entry preserved as-is");
  assert.ok(stack.includes("TypeScript"), "new entry is a plain string: the {value, phase, at} stamp was instrumentation no gate read");
  // A legacy STAMPED entry (projects from 0.6.x–0.12.0) is still read by value.
  engine.getPhaseState()!.projectSpec.stack.push({ value: "Stamped", phase: 1, at: "2026-01-01T00:00:00Z" });
  engine.updateProjectSpec({ stack: ["Stamped"] });
  assert.strictEqual(engine.getProjectSpec().stack.filter((e) => specEntryValue(e) === "Stamped").length, 1, "a stamped entry dedups against its value");

  // Dedup is by value across both forms.
  engine.updateProjectSpec({ stack: ["TypeScript"] });
  const count = engine.getProjectSpec().stack.filter((e) => specEntryValue(e) === "TypeScript").length;
  assert.strictEqual(count, 1, "dedup by value, no duplicate");

  // Value extraction works uniformly on the mixed array (what inject-context renders).
  const values = engine.getProjectSpec().stack.map(specEntryValue);
  assert.ok(values.includes("LegacyTech") && values.includes("TypeScript") && values.includes("Node 18+"));
});

console.log("\n=== Structured Lenses + Lens-Column Gate Tests (v0.10.0) ===\n");

function allNotActivated(except: string[] = []): { lens: string; reason: string }[] {
  return CONDITIONAL_LENSES.filter((l) => !except.includes(l)).map((lens) => ({ lens, reason: "no project signal" }));
}

/** Reach Phase 2 with criteria stamped but NO structured lens declaration. */
function toPhase2NoLenses() {
  engine.initProject("Test", "Desc");
  engine.updateScore(95, makeFullBreakdown(95));
  writeArchitectureDoc(workspace);
  for (const c of engine.getExitCriteriaWithDefs(0)) engine.markExitCriterion(0, c.criterion, true);
  engine.advancePhase(1);
  for (const c of engine.getExitCriteriaWithDefs(1)) engine.markExitCriterion(1, c.criterion, true);
  engine.advancePhase(2);
  for (const c of engine.getExitCriteriaWithDefs(2)) engine.markExitCriterion(2, c.criterion, true);
}

// --- Block 1: record_activated_lenses validation ---

test("record_activated_lenses rejects a translation (Segurança)", () => {
  engine.initProject("T", "D");
  const r = engine.recordActivatedLenses(["Segurança"], allNotActivated());
  assert.strictEqual(r.ok, false);
  if (!r.ok) assert.ok(/not one of the 12/.test(r.error.message), "rejection must explain it is not a canonical conditional lens");
});

test("record_activated_lenses rejects a universal lens passed as conditional", () => {
  engine.initProject("T", "D");
  const r = engine.recordActivatedLenses(["Security"], allNotActivated());
  assert.strictEqual(r.ok, false);
  assert.ok(!r.ok && /UNIVERSAL/.test(r.error.message));
});

test("record_activated_lenses rejects an unaccounted-for conditional lens", () => {
  engine.initProject("T", "D");
  const r = engine.recordActivatedLenses([], allNotActivated(["Resilience"]));
  assert.strictEqual(r.ok, false);
  assert.ok(!r.ok && /unaccounted/.test(r.error.message));
});

test("record_activated_lenses rejects not-activated without a reason", () => {
  engine.initProject("T", "D");
  const notAct = CONDITIONAL_LENSES.map((lens, i) => ({ lens, reason: i === 0 ? "" : "no signal" }));
  const r = engine.recordActivatedLenses([], notAct);
  assert.strictEqual(r.ok, false);
  assert.ok(!r.ok && /without a reason/.test(r.error.message));
});

test("record_activated_lenses rejects a lens both activated and not-activated", () => {
  engine.initProject("T", "D");
  const r = engine.recordActivatedLenses(["Resilience"], allNotActivated());  // notActivated also has Resilience
  assert.strictEqual(r.ok, false);
  assert.ok(!r.ok && /BOTH activated and not-activated/.test(r.error.message));
});

test("record_activated_lenses rejects a duplicate in conditional", () => {
  engine.initProject("T", "D");
  const r = engine.recordActivatedLenses(["Resilience", "Resilience"], allNotActivated(["Resilience"]));
  assert.strictEqual(r.ok, false);
  assert.ok(!r.ok && /twice as activated/.test(r.error.message));
});

test("record_activated_lenses persists as an array with iteration and againstVersion", () => {
  engine.initProject("T", "D");
  const r = engine.recordActivatedLenses(["Resilience"], allNotActivated(["Resilience"]));
  assert.ok(r.ok);
  const acts = engine.getPhaseState()!.activatedLenses!;
  assert.strictEqual(acts.length, 1);
  assert.strictEqual(acts[0].iteration, 1);
  assert.ok(acts[0].againstVersion >= 1);
  assert.deepStrictEqual(acts[0].conditional, ["Resilience"]);
  assert.strictEqual(acts[0].notActivated.length, 11);
});

test("legacy free-text lenses honoured only when stateVersion is absent", () => {
  engine.initProject("T", "D");                       // stateVersion = 1
  engine.recordDecision(2, "architecture", "ACTIVATED LENSES: Resilience");
  assert.strictEqual(engine.lensesRecorded(), false, "new project: prose does NOT satisfy the structured gate");
  delete (engine.getPhaseState() as unknown as { stateVersion?: number }).stateVersion;
  assert.strictEqual(engine.lensesRecorded(), true, "legacy project (no stateVersion): prose is honoured");
});

// --- Block 2: coverage-matrix lens-column gate (2→3) ---

test("2→3 BLOCKS on the lenses-recorded gate when nothing is declared", () => {
  toPhase2NoLenses();
  writeCoverageMatrix(workspace);                     // universal-lens findings
  const r = engine.advancePhase(3);
  assert.strictEqual(r.ok, false);
  assert.ok(!r.ok && r.error.missingCriteria.some((m) => m.includes("lens activation is not on record")));
});

test("2→3 lens gate: a truncated canonical name (Sustainability) BLOCKS — the T21 case", () => {
  toPhase2NoLenses();
  declareLenses(["Sustainability / Proportionality"]);
  fs.writeFileSync(path.join(workspace, "specs", "design", "coverage-matrix.md"),
    "# CM\n\n## Iteração 1 — V(1)\n\n| id | module | lens | severity | description |\n|--|--|--|--|--|\n" +
    "| S-01 | auth | Sustainability | 🟡 | truncated lens name, not the canonical one |\n");
  const r = engine.advancePhase(3);
  assert.strictEqual(r.ok, false);
  assert.ok(!r.ok && r.error.missingCriteria.some((m) => m.includes("S-01") && m.includes("not one of the 19")));
});

test("2→3 lens gate: full canonical name passes; 'UI / UX' == 'UI/UX'; NENHUMA passes", () => {
  toPhase2NoLenses();
  declareLenses(["Sustainability / Proportionality", "UI/UX"]);
  fs.writeFileSync(path.join(workspace, "specs", "design", "coverage-matrix.md"),
    "# CM\n\n## Iteração 1 — V(1)\n\n| id | module | lens | severity | description |\n|--|--|--|--|--|\n" +
    "| S-01 | auth | Sustainability / Proportionality | 🟡 | proportionate resource use question |\n" +
    "| U-02 | auth | UI / UX | 🟡 | spacing around the slash is tolerated |\n" +
    "| N-03 | auth | NENHUMA | 🟢 | a finding that fit no lens |\n");
  assert.strictEqual(engine.advancePhase(3).ok, true);
});

test("2→3 lens gate (T14): a conditional lens is anachronistic in a round that did not declare it", () => {
  toPhase2NoLenses();
  declareLenses([]);                                  // iteration 1 activates nothing
  fs.writeFileSync(path.join(workspace, "specs", "design", "coverage-matrix.md"),
    "# CM\n\n## Iteração 1 — V(1)\n\n| id | module | lens | severity | description |\n|--|--|--|--|--|\n" +
    "| MEC-01 | auth | Mechanical Engineering | 🟡 | MEC not declared for iteration 1 |\n");
  const r = engine.advancePhase(3);
  assert.strictEqual(r.ok, false, "MEC in iteration 1 is anachronistic — it wasn't declared for that round");
  assert.ok(!r.ok && r.error.missingCriteria.some((m) => m.includes("MEC-01") && m.includes("not among the conditional lenses declared")));
});

test("2→3 lens gate (T14): a conditional lens is legitimate in the round that declared it", () => {
  toPhase2NoLenses();
  declareLenses(["Mechanical Engineering"]);          // iteration 1 declares MEC
  fs.writeFileSync(path.join(workspace, "specs", "design", "coverage-matrix.md"),
    "# CM\n\n## Iteração 1 — V(1)\n\n| id | module | lens | severity | description |\n|--|--|--|--|--|\n" +
    "| MEC-01 | auth | Mechanical Engineering | 🟡 | MEC declared for iteration 1 |\n");
  assert.strictEqual(engine.advancePhase(3).ok, true);
});

test("P2 lens table renders from lenses.ts (all names + v0.12.9 triggers)", () => {
  const g = getCompleteGuidance();
  for (const l of [...UNIVERSAL_LENS_DEFS, ...CONDITIONAL_LENS_DEFS]) {
    assert.ok(g.includes(`| ${l.name} |`), `lens table must render ${l.name}`);
  }
  assert.ok(g.includes("including a CLI or operational tooling"), "UI/UX v0.12.9 trigger present");
  assert.ok(g.includes("resource whose cost grows with use"), "Sustainability v0.12.9 trigger present");
  assert.ok(g.includes("a single-operator project activates it"), "Governance v0.12.9 trigger present");
  assert.ok(g.includes("| Lens | Central Question | Exclusive Failure Class | Activate when... |"), "conditional table header present");
});

// --- Severity-column gate (2→3) ---

const MATRIX = () => path.join(workspace, "specs", "design", "coverage-matrix.md");
function writeMatrixRows(rows: string): void {
  fs.writeFileSync(MATRIX(),
    "# CM\n\n## Iteração 1 — V(1)\n\n| id | module | lens | severity | description |\n|--|--|--|--|--|\n" + rows);
}

test("2→3 severity gate: a word ('high') blocks", () => {
  toPhase2NoLenses();
  declareLenses([]);
  writeMatrixRows("| P-01 | auth | Security | high | textual severity, not a glyph here now |\n");
  const r = engine.advancePhase(3);
  assert.strictEqual(r.ok, false);
  assert.ok(!r.ok && r.error.missingCriteria.some((m) => m.includes("P-01") && m.includes("must be exactly one of")));
});

test("2→3 severity gate: an empty severity cell blocks", () => {
  toPhase2NoLenses();
  declareLenses([]);
  writeMatrixRows("| P-01 | auth | Security |  | empty severity cell should block here |\n");
  const r = engine.advancePhase(3);
  assert.strictEqual(r.ok, false);
  assert.ok(!r.ok && r.error.missingCriteria.some((m) => m.includes("P-01") && m.includes("(empty)")));
});

test("2→3 severity gate: two glyphs (ambiguous) blocks", () => {
  toPhase2NoLenses();
  declareLenses([]);
  writeMatrixRows("| P-01 | auth | Security | 🔴🟡 | two glyphs are ambiguous and must block |\n");
  const r = engine.advancePhase(3);
  assert.strictEqual(r.ok, false);
  assert.ok(!r.ok && r.error.missingCriteria.some((m) => m.includes("P-01") && m.includes("must be exactly one of")));
});

test("2→3 severity gate: the three glyphs pass", () => {
  toPhase2NoLenses();
  declareLenses([]);
  writeMatrixRows(
    "| P-01 | auth | Security | 🔴 | a critical finding on auth login path |\n" +
    "| P-02 | auth | Security | 🟡 | an important finding on the session ttl |\n" +
    "| P-03 | auth | Security | 🟢 | a suggestion about the error messages here |\n");
  assert.strictEqual(engine.advancePhase(3).ok, true);
});

test("2→3 severity gate: a glyph with a trailing word (🔴 Critical) passes", () => {
  toPhase2NoLenses();
  declareLenses([]);
  writeMatrixRows("| P-01 | auth | Security | 🔴 Critical | glyph plus a decorating word is fine |\n");
  assert.strictEqual(engine.advancePhase(3).ok, true);
});

console.log("\n=== Post-batch: test-outcome integrity + F6 re-verification + provenance ===\n");

/** Phase 6, all P6 criteria marked, a green run witnessed in Phase 6, critical coverage written. */
function atPhase6Green() {
  toPhase6();
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true);
  engine.recordTestOutcome("npm test", "pass");
}

test("recordTestOutcome('unknown') records the run, does not count S6, does not satisfy the gate", () => {
  toPhase5();
  engine.recordTestOutcome("npm test", "fail");
  assert.strictEqual(engine.getLoopCounter().count, 1);
  engine.recordTestOutcome("npm test", "unknown");   // unclassifiable — must not add to the S6 count
  assert.strictEqual(engine.getLoopCounter().count, 1, "unknown does not increment the S6 counter");
  const t = engine.getPhaseState()!.lastTestOutcome!;
  assert.strictEqual(t.outcome, "unknown", "unknown overwrites the stale fail, not frozen");
  assert.strictEqual(engine.witnessedTestPass(5), false, "unknown is not a pass");
});

test("verify:test-pass message distinguishes 'no run' from 'observed non-pass'", () => {
  toPhase6();
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true);
  const noRun = engine.advancePhase(7);
  assert.ok(!noRun.ok && noRun.error.missingCriteria.some((m) => m.includes("NO test run")), "no run → says nothing recorded");
  engine.recordTestOutcome("npm test", "unknown");
  const unknown = engine.advancePhase(7);
  assert.ok(!unknown.ok && unknown.error.missingCriteria.some((m) => m.includes('outcome="unknown"')), "unknown run → surfaces the recorded outcome");
});

test("6→7 BLOCKS when a critical finding is not traced in critical-coverage.md (drift), names it", () => {
  atPhase6Green();
  // Cover only P-01, not the other critical P-02.
  fs.writeFileSync(path.join(workspace, "specs", "validation", "critical-coverage.md"),
    "# Critical coverage\n\n| finding | test |\n|---|---|\n| P-01 | auth.injection.test asserts the query rejects a tautology payload here |\n");
  const r = engine.advancePhase(7);
  assert.strictEqual(r.ok, false);
  assert.ok(!r.ok && r.error.missingCriteria.some((m) => m.includes("P-02") && m.includes("critical-coverage.md")), "block must name the uncovered critical");
});

test("6→7 BLOCKS when there are criticals but critical-coverage.md is missing", () => {
  atPhase6Green();
  fs.rmSync(path.join(workspace, "specs", "validation", "critical-coverage.md"));
  const r = engine.advancePhase(7);
  assert.strictEqual(r.ok, false);
  assert.ok(!r.ok && r.error.missingCriteria.some((m) => m.includes("critical (🔴) finding") && m.includes("missing or empty")));
});

test("6→7 skips the critical gate when the matrix has no criticals", () => {
  atPhase6Green();
  fs.rmSync(path.join(workspace, "specs", "validation", "critical-coverage.md"));
  // A matrix with no 🔴 — the critical gate does not engage.
  fs.writeFileSync(path.join(workspace, "specs", "design", "coverage-matrix.md"),
    "# CM\n\n## Iteração 1 — V(1)\n\n| id | module | lens | severity | description |\n|--|--|--|--|--|\n| P-01 | auth | Security | 🟡 | an important but non-critical finding here now |\n");
  assert.strictEqual(engine.advancePhase(7).ok, true, "no criticals → no critical-coverage required");
});

test("6→7 premise gate: a numbered premise not traced blocks; prose premises do not engage", () => {
  atPhase6Green();
  // Baseline architecture has no numbered premises → premise gate skips → passes.
  assert.strictEqual(engine.advancePhase(7).ok, true, "prose premises: gate does not engage");

  // Now number a premise in the architecture and provide no premise-coverage → blocks.
  toPhase6(); // fresh — re-reach phase 6 in a clean workspace segment
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true);
  engine.recordTestOutcome("npm test", "pass");
  fs.appendFileSync(path.join(workspace, "specs", "technical", "architecture.md"),
    "\n\n## Premises\n- A-1: the store is single-threaded and never accessed concurrently.\n");
  const r = engine.advancePhase(7);
  assert.strictEqual(r.ok, false, "a numbered premise with no premise-coverage must block");
  assert.ok(!r.ok && r.error.missingCriteria.some((m) => m.includes("premise") && m.includes("A-1")));
});

test("verifiedBy: lenses-recorded stamped nominal when the structured record exists", () => {
  toPhase2Stamped();
  writeCoverageMatrix(workspace);
  assert.strictEqual(engine.advancePhase(3).ok, true);
  const ec = engine.getPhaseState()!.exitCriteria.find((c) => c.phase === 2 && c.criterion === "activated_lenses_recorded");
  assert.ok(ec?.verifiedBy && ec.verifiedBy.path === "lenses-recorded" && ec.verifiedBy.nominal === true, "structured lens record → nominal provenance");
});

test("verifiedBy: test-pass stamped non-nominal when the pass lacked a harness exit_code=0", () => {
  atPhase6Green(); // recorded a "pass" without harness provenance
  assert.strictEqual(engine.advancePhase(7).ok, true);
  const ec = engine.getPhaseState()!.exitCriteria.find((c) => c.phase === 6 && c.criterion === "tests_passing");
  assert.ok(ec?.verifiedBy && ec.verifiedBy.path === "test-pass" && ec.verifiedBy.nominal === false && !!ec.verifiedBy.note, "non-harness pass → degraded path recorded");
});

test("detectExitCode: reads the VERSUS_TEST_EXIT token, last occurrence, undefined when absent", () => {
  assert.strictEqual(detectExitCode("some output\nVERSUS_TEST_EXIT=0\n"), 0);
  assert.strictEqual(detectExitCode("VERSUS_TEST_EXIT=1"), 1);
  // Two runs echoed: the LAST (final run) wins.
  assert.strictEqual(detectExitCode("VERSUS_TEST_EXIT=1\n...retry...\nVERSUS_TEST_EXIT=0"), 0);
  assert.strictEqual(detectExitCode("Testes: 5 aprovados, 0 falharam"), undefined);
});

test("language-agnostic classification: non-English output is unknown, but the echo gives the number", () => {
  // The hook's composition: markers first fail on non-English, the echo token decides.
  const ptOutput = "Executando a suíte...\nTestes: 5 aprovados, 0 falharam";
  assert.strictEqual(detectOutcome(ptOutput), "unknown", "no English markers → unknown");
  assert.strictEqual(detectExitCode(ptOutput + '\nVERSUS_TEST_EXIT=0'), 0, "echo token classifies it green regardless of language");
  assert.strictEqual(detectExitCode(ptOutput + '\nVERSUS_TEST_EXIT=1'), 1);
});

test("verifiedBy nominal is TRUE when an exit status was observed (echo or harness), 0", () => {
  atPhase6Green();
  // Re-record the green run WITH an observed exit status (as the echo path would).
  engine.recordTestOutcome("npm test; echo \"VERSUS_TEST_EXIT=$?\"", "pass", { source: "harness", exitCode: 0, exitSource: "echo" });
  assert.strictEqual(engine.advancePhase(7).ok, true);
  const ec = engine.getPhaseState()!.exitCriteria.find((c) => c.phase === 6 && c.criterion === "tests_passing");
  assert.ok(ec?.verifiedBy && ec.verifiedBy.nominal === true, "observed exit_code=0 (echo) → nominal");
});

test("a dependency cell holding a module id does not hide the next module (tableColumn2)", () => {
  engine.initProject("Test", "Desc");
  engine.updateScore(95, makeFullBreakdown(95));
  // Architecture where depends-on cells hold module ids — the bug trigger.
  fs.writeFileSync(path.join(workspace, "specs", "technical", "architecture.md"),
    "# Architecture\n\n| id | module | responsibility | interface | depends-on |\n|--|--|--|--|--|\n" +
    "| M-01 | board | holds the board state for the round | get()->State | — |\n" +
    "| M-02 | ui | renders the board to the screen here | render()->DOM | M-01 |\n" +
    "| M-03 | game | the game loop and rules engine now | tick()->void | M-01, M-02 |\n");
  for (const c of engine.getExitCriteriaWithDefs(0)) engine.markExitCriterion(0, c.criterion, true);
  engine.advancePhase(1);
  for (const c of engine.getExitCriteriaWithDefs(1)) engine.markExitCriterion(1, c.criterion, true);
  engine.advancePhase(2);
  declareLenses([]);
  for (const c of engine.getExitCriteriaWithDefs(2)) engine.markExitCriterion(2, c.criterion, true);
  // A finding on `game` — the module the old global regex dropped from the arch set.
  fs.writeFileSync(path.join(workspace, "specs", "design", "coverage-matrix.md"),
    "# CM\n\n## Iteração 1 — V(1)\n\n| id | module | lens | severity | description |\n|--|--|--|--|--|\n" +
    "| P-01 | game | Security | 🔴 | the game loop trusts client-sent moves without validation |\n");
  assert.strictEqual(engine.advancePhase(3).ok, true, "game is in the architecture — a depends-on cell must not hide it");
});

test("get_phase_state reports safeguards LIVE, not the cached (stale) status", () => {
  toPhase5();
  for (let i = 0; i < LOOP_FAILURE_THRESHOLD; i++) engine.recordTestOutcome("npm test", "fail");
  const cached = engine.getPhaseState()!.safeguards.find((s) => s.id === "S6")!;
  assert.strictEqual(cached.status, "ok", "the cached field is stale (only check_all_safeguards writes it)");
  const out = JSON.parse(handleGetPhaseState(engine));
  const s6 = out.safeguards.find((s: { id: string; status: string }) => s.id === "S6");
  assert.strictEqual(s6.status, "violated", "get_phase_state reflects the live S6 block");
});

const SPILL_CAP = 5691;

test("get_phase_state stays under the host spill cap with a large state", () => {
  engine.initProject("Big", "Desc");
  const bigList = Array.from({ length: 200 }, (_, i) => `tech-${i}-${"x".repeat(60)}`);
  engine.updateProjectSpec({ stack: bigList, constraints: bigList.map((s) => "c-" + s) });
  for (let i = 0; i < 100; i++) engine.recordDecision(0, "scope", `decision ${i} ${"y".repeat(500)}`);
  const out = handleGetPhaseState(engine);
  assert.ok(out.length < SPILL_CAP, `get_phase_state must stay under ${SPILL_CAP}, got ${out.length}`);
  const o = JSON.parse(out);
  assert.strictEqual(o.projectSpec.stack.length, 6, "newest 6 per list");
  assert.strictEqual(typeof o.projectSpec.stack[0], "string", "spec normalized to strings (stamp dropped)");
  assert.ok(o._specNote && o._specNote.includes("omitted"), "note counts the omitted spec entries");
  assert.strictEqual(o.decisionsCount, 100, "full count preserved");
  assert.ok(o._decisionsNote && o._decisionsNote.includes("of 100"));
});

test("get_decisions stays under the cap and notes the budget", () => {
  engine.initProject("Big", "Desc");
  for (let i = 0; i < 100; i++) engine.recordDecision(0, "scope", `decision ${i} ${"y".repeat(500)}`);
  const out = handleGetDecisions(engine, {});
  assert.ok(out.length < SPILL_CAP, `got ${out.length}`);
  const o = JSON.parse(out);
  assert.strictEqual(o.count, 100);
  assert.ok(o.shown < 100 && o.shown > 0);
  assert.ok(o._note && o._note.includes("of 100"));
});

test("get_decisions truncates a single decision larger than the whole budget, does not spill", () => {
  engine.initProject("Big", "Desc");
  engine.recordDecision(0, "scope", "Z".repeat(20000));
  const out = handleGetDecisions(engine, {});
  assert.ok(out.length < SPILL_CAP, `got ${out.length}`);
  const o = JSON.parse(out);
  assert.strictEqual(o.shown, 1);
  assert.ok(o.decisions[0].content.includes("[truncated"), "the oversized decision is truncated inline, not spilled");
});

/** Qwen Code inlines a tool result up to this many chars (truncateToolOutputThreshold default,
 *  Qwen Code 0.28.4); past it the result goes to a file with a preview. */
const QWEN_TOOL_RESULT_CAP = 25_000;

test("get_phase_guidance returns the real phase text, under Qwen's 25,000-char tool-result cap", () => {
  engine.initProject("Big", "Desc");
  const out = handleGetPhaseGuidance(engine, { phase: 2 });
  const o = JSON.parse(out);
  // 0.11.4 returned a pointer to guidance injected every message; that injection is now state
  // only, so the text is delivered here.
  assert.ok(typeof o.guidance === "string" && o.guidance.includes("## Phase 2"), "carries the Phase 2 section");
  assert.ok(o.guidance.includes("ANTI-PATTERNS"), "and the cross-cutting rules");
  assert.ok(!o.guidance.includes("## Phase 3 "), "but not the other phases");
  for (let p = 0; p <= 7; p++) {
    const n = handleGetPhaseGuidance(engine, { phase: p }).length;
    assert.ok(n < QWEN_TOOL_RESULT_CAP, `Phase ${p} guidance must stay inline (got ${n})`);
  }
});

// --- 0.12.0 (tracks Versus Claude 0.17.0): fixes from the first external study (ESJUD, Versus 0.16.4, macOS/Xcode) ---

console.log("\n=== External-study fixes (ESJUD) ===\n");

test("a heredoc that MENTIONS npm test is a write, not a test run", () => {
  const cmd = 'cat >> research/GATES.md <<\'EOF\'\nRodado: npm test; echo "VERSUS_TEST_EXIT=$?" → VERSUS_TEST_EXIT=0\nEOF';
  assert.strictEqual(isTestCommand(cmd), false, "the exact shape that overwrote a green lastTestOutcome in the study");
  assert.ok(!stripHeredocs(cmd).includes("npm test"), "heredoc body is data");
});

test("text that merely mentions a runner is not a run (grep / echo / quoted)", () => {
  assert.strictEqual(isTestCommand('grep -n "npm test" research/LOG.md'), false);
  assert.strictEqual(isTestCommand('grep VERSUS_TEST_EXIT research/LOG.md'), false, "would have forged a pass from logged text");
  assert.strictEqual(isTestCommand('echo "next: npm test; pytest" >> notes.md'), false);
  assert.strictEqual(isTestCommand("git commit -m 'make npm test green'"), false);
});

test("real runs are recognized behind cd/env/time and inside bash -c", () => {
  assert.ok(isTestCommand('npm test; echo "VERSUS_TEST_EXIT=$?"'));
  assert.ok(isTestCommand('cd "aplicativo ios" && xcodebuild test -scheme ESJUD -destination "platform=iOS Simulator,name=iPhone 17"; echo "VERSUS_TEST_EXIT=$?"'));
  assert.ok(isTestCommand("CI=1 time pytest -q"));
  assert.ok(isTestCommand("bash -c 'cargo test --all'"));
  assert.ok(isTestCommand("node ./out/test/engine.test.js"));
});

test("non-npm runners are recognized (the study had to wrap xcodebuild in package.json)", () => {
  for (const c of [
    "xcodebuild -scheme App test", "xcodebuild test-without-building -scheme App", "swift test",
    "./gradlew testDebugUnitTest", "./gradlew connectedAndroidTest", "gradle check", "mvn -q test",
    "./mvnw verify", "dotnet test", "flutter test", "dart test", "make test", "ctest --output-on-failure",
    "bundle exec rspec", "vendor/bin/phpunit", "mix test", "go test ./...", "yarn test", "pnpm run test",
    "bun test", "deno test", "npx vitest run", "python3 -m pytest", "uv run pytest", "tox",
  ]) assert.ok(isTestCommand(c), `should recognize: ${c}`);
  for (const c of ["xcodebuild build -scheme App", "swift build", "./gradlew assembleDebug", "make", "npm install", "go build ./..."]) {
    assert.strictEqual(isTestCommand(c), false, `a build is not a test run: ${c}`);
  }
});

test(".versus/test-commands adds project-specific runners", () => {
  fs.mkdirSync(path.join(workspace, ".versus"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".versus", "test-commands"), "# custom\n^./run-suite\\b\n(\n");
  const extra = loadExtraTestPatterns(workspace);
  assert.strictEqual(extra.length, 1, "comments and invalid regexes are skipped");
  assert.ok(isTestCommand("./run-suite --all", extra));
  assert.strictEqual(isTestCommand("./run-suite --all"), false);
});

test("phase-gate: paths are anchored at the project root; outside the project is allowed", () => {
  const ws = workspace;
  assert.ok(isAllowedPath(path.join(ws, "specs/technical/architecture.md"), ws));
  assert.ok(isAllowedPath("specs/domain/x.json", ws));
  assert.strictEqual(isAllowedPath(path.join(ws, "src/specs/Impl.swift"), ws), false, "a nested specs/ dir is code — the old substring match let it through");
  assert.ok(isAllowedPath(path.join(os.tmpdir(), "scratch", "notes.ts"), ws), "the study's scratchpad (outside the workspace) was blocked");
  assert.ok(isAllowedPath(path.join(ws, "research/RESEARCH_LOG.md"), ws), "documentation files are not code");
  assert.ok(isAllowedPath(path.join(ws, "research/METRICS/findings.csv"), ws));
  assert.ok(isAllowedPath(path.join(ws, "package.json"), ws));
  assert.strictEqual(isAllowedPath(path.join(ws, "app/package.json"), ws), false, "root config only");
  assert.strictEqual(isAllowedPath(path.join(ws, "src/App.swift"), ws), false);
});

test("phase-gate: run_shell_command writes to code are gated like edit/write_file", () => {
  const ws = workspace;
  const bash = (command: string) => blockedTargets({ tool_name: "run_shell_command", tool_input: { command }, cwd: ws }, ws);
  assert.deepStrictEqual(bash("cat > src/App.swift <<'EOF'\nimport SwiftUI\nEOF"), ["src/App.swift"]);
  assert.deepStrictEqual(bash("echo x | tee -a src/a.ts"), ["src/a.ts"]);
  assert.deepStrictEqual(bash("sed -i 's/a/b/' src/a.py"), ["src/a.py"]);
  assert.deepStrictEqual(bash("cp /tmp/gen.kt app/src/Gen.kt"), ["app/src/Gen.kt"]);
  assert.deepStrictEqual(bash("cat >> research/RESEARCH_LOG.md <<'EOF'\nP0001 > src/x.ts\nEOF"), [], "doc write allowed; heredoc text is not a redirect");
  assert.deepStrictEqual(bash("npm test 2>&1 > /dev/null; ls > /tmp/out.txt"), []);
  assert.deepStrictEqual(bash('echo "a > src/x.ts"'), [], "a quoted > is not a redirection");
  assert.deepStrictEqual(bash("grep -rn foo src/"), [], "reads are never gated");
  assert.deepStrictEqual(writeTargets("cmd > \"$OUT\""), [], "unresolvable targets are skipped, not guessed");
  const edit = blockedTargets({ tool_name: "write_file", tool_input: { file_path: path.join(ws, "src/main.ts") } }, ws);
  assert.strictEqual(edit.length, 1);
});

test("mark_exit_criterion refuses a criterion of another phase", () => {
  engine.initProject("Test", "Desc");
  const future = JSON.parse(handleMarkExitCriterion(engine, { phase: 1, criterion: "user_confirmed", met: true }));
  assert.strictEqual(future.success, false, "pre-stamping a future phase is what made G2/G3 land in the same second");
  assert.ok(String(future.error).includes("current phase is 0"));
  const crit = engine.getExitCriteriaWithDefs(0)[0].criterion;
  const now = JSON.parse(handleMarkExitCriterion(engine, { phase: 0, criterion: crit, met: true }));
  assert.strictEqual(now.success, true);
  assert.ok(!engine.getPhaseState()!.exitCriteria.some((c) => c.phase === 1), "the refused mark left nothing behind");
});

test("advance_phase without target_phase says what to pass, never 'Phase undefined'", () => {
  engine.initProject("Test", "Desc");
  const r = JSON.parse(handleAdvancePhase(engine, {} as { target_phase: number }));
  assert.strictEqual(r.success, false);
  assert.ok(String(r.error).includes("requires target_phase") && String(r.error).includes("next sequential phase is 1"));
  assert.ok(!String(r.error).includes("undefined"));
});

test("Phase 4 checks S1-S5, matching its 'Safeguards S1-S5 met' criterion", () => {
  toPhase5();
  // walk back the view: validate as if in Phase 4
  const st = engine.getPhaseState()!;
  const ids = (["S1", "S2", "S3", "S4", "S5"] as const).map((id) => validateSafeguard(id, { ...st, currentPhase: 4 }));
  assert.ok(ids.every((r) => r.details.length > 0));
  assert.strictEqual(ids[0].status, "warning", "S1 in Phase 4 is an active review of Phase 3");
  assert.ok(ids[0].details.includes("Phase 4 review"));
  assert.ok(ids[4].details.includes("Phase 4 review"));
  const { getSafeguardsForPhase } = require("../rules/safeguards");
  assert.deepStrictEqual(getSafeguardsForPhase(4).map((s: { id: string }) => s.id), ["S1", "S2", "S3", "S4", "S5"]);
});

test("S6 is ok (not warning) at 0 undiagnosed failures, warning once they accumulate; S7 is behavioral", () => {
  toPhase5();
  const st = () => engine.getPhaseState()!;
  assert.strictEqual(validateSafeguard("S6", st()).status, "ok", "'warning 0/3' all through Phases 5-6 carried no information");
  engine.recordTestOutcome("npm test", "fail");
  assert.strictEqual(validateSafeguard("S6", st()).status, "warning");
  assert.strictEqual(validateSafeguard("S7", st()).status, "ok");
});
test("phase-gate: a relative shell write resolves against run_shell_command's directory", () => {
  const ws = workspace;
  const r = (command: string, directory: string) =>
    blockedTargets({ tool_name: "run_shell_command", tool_input: { command, directory }, cwd: ws }, ws);
  assert.deepStrictEqual(r("cat > App.swift <<'EOF'\nx\nEOF", path.join(ws, "src")), ["App.swift"], "src/App.swift is code");
  assert.deepStrictEqual(r("cat > arch.ts <<'EOF'\nx\nEOF", path.join(ws, "specs")), [], "specs/arch.ts is allowed");
  assert.deepStrictEqual(r("echo x > notes.ts", os.tmpdir()), [], "outside the project");
});

// --- 0.13.0 (tracks Versus Claude 0.18.0–0.19.0): cycle archive, approvals, provenance, delivery ---

console.log("\n=== Claude 0.18.0 — cycle archive, approvals, provenance, delivery ===\n");

/** Phase 7 with every gate satisfied, ready for start_new_cycle. */
function toPhase7Closable() {
  toPhase6();
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true, `P6 ${c.criterion} details`);
  engine.recordTestOutcome("npm test; echo VERSUS_TEST_EXIT=$?", "pass", { source: "harness", exitCode: 0, exitSource: "echo", cwd: workspace, runDir: workspace });
  assert.ok(engine.advancePhase(7).ok, "6→7");
  for (const c of engine.getExitCriteriaWithDefs(7)) engine.markExitCriterion(7, c.criterion, true, `P7 ${c.criterion} details`);
  fs.writeFileSync(path.join(workspace, "specs", "references", "lessons.md"),
    "# Lessons\n\n- The session TTL assumption from P0 was wrong; refreshed tokens broke it. guard: T-07\n- ORM lacked batch upsert. guard: none\n");
  approve(7);
}

test("closing a cycle ARCHIVES its exit criteria (with details) instead of wiping them", () => {
  toPhase7Closable();
  const r = engine.startNewCycle();
  assert.ok(r.ok, r.ok ? "" : String(r.error));
  if (!r.ok) return;
  assert.strictEqual(r.value.archived, 1);
  assert.strictEqual(r.value.cycle, 2, "closing cycle 1 opens cycle 2");
  const st = engine.getPhaseState()!;
  assert.strictEqual(st.exitCriteria.length, 0, "the live criteria still reset for the new cycle");
  const rec = st.cycles![0];
  assert.strictEqual(rec.cycle, 1);
  assert.ok(rec.exitCriteria.some((c) => c.phase === 6 && c.criterion === "tests_passing" && c.details === "P6 tests_passing details"));
  assert.ok(rec.exitCriteria.find((c) => c.criterion === "tests_passing")!.verifiedBy, "engine provenance survives too");
  assert.ok(rec.transitions.some((t) => t.from === 6 && t.to === 7));
  assert.ok(rec.transitions.some((t) => t.from === 7 && t.to === 0));
  assert.strictEqual(rec.lastTestOutcome?.outcome, "pass");
  assert.ok(rec.decisionCount >= 3, "the cycle's decisions are counted (approvals at 3, 6, 7)");
  assert.strictEqual(engine.currentCycle(), 2);
});

test("the closed cycle is exported to readable Markdown", () => {
  toPhase7Closable();
  const r = engine.startNewCycle();
  assert.ok(r.ok && r.value.exportPath);
  if (!r.ok) return;
  const md = fs.readFileSync(path.join(workspace, r.value.exportPath!), "utf-8");
  assert.ok(md.includes("— Cycle 1"));
  assert.ok(md.includes("**tests_passing** — P6 tests_passing details"), "criteria with details");
  assert.ok(md.includes("approved by user"), "decision provenance");
  assert.ok(md.includes("verified by engine"), "engine provenance");
  assert.ok(md.includes("## Last witnessed test run"));
});

test("export_cycle writes the cycle in progress; refuses an unknown cycle with a reason", () => {
  toPhase5();
  const ok = JSON.parse(handleExportCycle(engine, {}));
  assert.strictEqual(ok.success, true);
  assert.strictEqual(ok.inProgress, true);
  assert.ok(fs.existsSync(path.join(workspace, ok.path)) && ok.path.endsWith("cycle-1-in-progress.md"));
  const bad = JSON.parse(handleExportCycle(engine, { cycle: 4 }));
  assert.strictEqual(bad.success, false);
  assert.ok(String(bad.error).includes("cycle 1"));
});

test("3→4 needs an approval decision naming the approver", () => {
  engine.initProject("Test", "Desc");
  engine.updateScore(95, makeFullBreakdown(95));
  writeArchitectureDoc(workspace);
  writeCoverageMatrix(workspace);
  for (let p = 0; p <= 2; p++) {
    for (const c of engine.getExitCriteriaWithDefs(p)) engine.markExitCriterion(p, c.criterion, true);
    if (p === 2) declareLenses();
    engine.advancePhase(p + 1);
  }
  for (const c of engine.getExitCriteriaWithDefs(3)) engine.markExitCriterion(3, c.criterion, true);
  const r = engine.advancePhase(4);
  assert.strictEqual(r.ok, false, "stamped criteria alone no longer cross the convergence gate");
  if (r.ok) return;
  assert.ok(r.error.missingCriteria.some((m) => m.includes("approval") && m.includes("approvedBy")));
  engine.recordDecision(3, "approval", "converged", {});            // no approver → still refused
  assert.strictEqual(engine.advancePhase(4).ok, false, "an approval without approvedBy is not an approval");
  approve(3);
  assert.strictEqual(engine.advancePhase(4).ok, true);
});

test("an approval recorded in an EARLIER pass of Phase 3 does not carry over the 2↔3 loop", () => {
  engine.initProject("Test", "Desc");
  engine.updateScore(95, makeFullBreakdown(95));
  writeArchitectureDoc(workspace);
  writeCoverageMatrix(workspace);
  for (let p = 0; p <= 2; p++) {
    for (const c of engine.getExitCriteriaWithDefs(p)) engine.markExitCriterion(p, c.criterion, true);
    if (p === 2) declareLenses();
    engine.advancePhase(p + 1);
  }
  approve(3);                                                     // pass 1 of Phase 3 approved…
  assert.ok(engine.advancePhase(2).ok, "…but the user loops back for another critique round");
  for (const c of engine.getExitCriteriaWithDefs(2)) engine.markExitCriterion(2, c.criterion, true);
  declareLenses();
  assert.ok(engine.advancePhase(3).ok);
  for (const c of engine.getExitCriteriaWithDefs(3)) engine.markExitCriterion(3, c.criterion, true);
  assert.strictEqual(engine.advancePhase(4).ok, false, "the pass-1 approval answered the OLD design");
  approve(3);
  assert.strictEqual(engine.advancePhase(4).ok, true);
});

test("the cycle close needs a Phase 7 approval decision", () => {
  toPhase6();
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true);
  engine.recordTestOutcome("npm test", "pass");
  engine.advancePhase(7);
  for (const c of engine.getExitCriteriaWithDefs(7)) engine.markExitCriterion(7, c.criterion, true);
  fs.writeFileSync(path.join(workspace, "specs", "references", "lessons.md"), "# Lessons\n\n" + "- a real lesson about the domain that is long enough. ".repeat(3) + "\n  guard: none\n");
  const r = engine.startNewCycle();
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.ok(String(r.error).includes("[Phase 7] approval"));
});

test("a green run OUTSIDE the project does not satisfy tests_passing", () => {
  toPhase6();
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true);
  engine.recordTestOutcome("node test.js", "pass", { source: "harness", cwd: "/tmp/scratch", runDir: "/tmp/scratch", outsideWorkspace: true });
  const r = engine.advancePhase(7);
  assert.strictEqual(r.ok, false, "a '24/24' from the scratchpad is not evidence about this project");
  if (r.ok) return;
  assert.ok(r.error.missingCriteria.some((m) => m.includes("OUTSIDE the project")));
});

test("testRunLocation follows cd and flags runs/scripts outside the workspace", () => {
  const ws = workspace;
  const at = (cmd: string, cwd = ws) => testRunLocation(cmd, cwd, ws);
  assert.strictEqual(at("npm test")!.outsideWorkspace, false);
  assert.strictEqual(at('cd "aplicativo ios" && xcodebuild test -scheme A')!.runDir, path.join(ws, "aplicativo ios"));
  assert.strictEqual(at('cd "aplicativo ios" && xcodebuild test -scheme A')!.outsideWorkspace, false);
  assert.strictEqual(at("cd /tmp/scratch && node test.js")!.outsideWorkspace, true, "cd out of the project");
  assert.strictEqual(at("npm test", "/tmp/elsewhere")!.outsideWorkspace, true, "session cwd outside");
  assert.strictEqual(at("node /tmp/scratch/check.test.js")!.outsideWorkspace, true, "script invoked by an outside path");
  assert.strictEqual(at("xcodebuild test -derivedDataPath /tmp/dd -scheme A")!.outsideWorkspace, false, "an outside build dir is not a test script");
  assert.strictEqual(at("ls -la"), undefined);
});

test("each transition fingerprints architecture.md (design existed, in that content, before the code)", () => {
  toPhase5();
  const t45 = engine.getPhaseState()!.history.find((h) => h.from === 4 && h.to === 5)!;
  const a = t45.artifacts!.find((x) => x.path === "specs/technical/architecture.md")!;
  const buf = fs.readFileSync(path.join(workspace, "specs", "technical", "architecture.md"));
  assert.strictEqual(a.bytes, buf.length);
  assert.strictEqual(a.sha256, require("crypto").createHash("sha256").update(buf).digest("hex"));
});

test("decisions carry proposedBy/approvedBy and the cycle", () => {
  engine.initProject("Test", "Desc");
  const d = engine.recordDecision(0, "scope", "x", { proposedBy: " Qwen ", approvedBy: "" });
  assert.strictEqual(d.proposedBy, "Qwen");
  assert.ok(!("approvedBy" in d), "an empty approver is not recorded as one");
  assert.strictEqual(d.cycle, 1);
});

test("version notice: once, for a project last opened by an older Versus, listing what is missing", () => {
  toPhase7Closable();
  fs.rmSync(path.join(workspace, "specs", "references", "lessons.md"));
  const st = engine.getPhaseState()!;
  delete st.versusVersion;                                   // simulate a project last opened before 0.13.0
  const n = engine.noteVersion()!;
  assert.strictEqual(n.from, null);
  assert.ok(n.pending.some((p) => p.includes("references/lessons.md")), "the report's case: lessons.md missing at the close");
  assert.ok(n.pending.some((p) => p.includes("approvedBy")));
  assert.strictEqual(engine.getPhaseState()!.versusVersion, VERSUS_VERSION);
  assert.strictEqual(engine.getPhaseState()!.migrations!.length, 1, "the migration is recorded");
  assert.strictEqual(engine.noteVersion(), null, "and announced only once");
});

test("a new project carries the running version (no spurious notice)", () => {
  engine.initProject("Test", "Desc");
  assert.strictEqual(engine.getPhaseState()!.versusVersion, VERSUS_VERSION);
  assert.strictEqual(engine.noteVersion(), null);
});

test("VERSUS_VERSION matches package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf-8"));
  assert.strictEqual(pkg.version, VERSUS_VERSION);
});

test("the per-message injection stays within its budget even on a huge project", () => {
  toPhase5();
  // 2 earlier cycles worth of decisions + 150 big ones in this one, a big spec, an S6 warning
  const st = engine.getPhaseState()!;
  const old = new Date(Date.parse(st.createdAt) - 86_400_000).toISOString();
  for (let i = 0; i < 60; i++) st.decisions.unshift({ id: `old-${i}`, phase: 2, category: "architecture", content: "OLD CYCLE " + "x".repeat(4000), timestamp: old });
  for (let i = 0; i < 150; i++) engine.recordDecision(5, "implementation", `decision ${i} ` + "y".repeat(5000));
  engine.updateProjectSpec({ stack: Array.from({ length: 80 }, (_, i) => `lib-${i}-with-a-long-name`) });
  engine.recordTestOutcome("npm test", "fail");
  engine.recordTestOutcome("npm test", "fail");
  const text = buildInjection(engine)!;
  assert.ok(text.length <= INJECT_BUDGET + 200, `injection must stay within INJECT_BUDGET; got ${text.length}`);
  assert.ok(text.includes("⚠ S6:"), "the S6 warning is never trimmed away (it used to come after 73K of guidance)");
  assert.ok(text.includes("get_phase_guidance()"), "points at where the methodology text is");
  assert.ok(text.includes("decision 149"), "newest decision of the cycle shown");
  assert.ok(!text.includes("OLD CYCLE"), "earlier cycles are not injected");
  assert.ok(text.includes("export_cycle"), "but the way to reach them is");
});

// --- Delivery channels: what each hook emits must be a shape Qwen Code honours ---
// Contract read from the Qwen Code 0.28.4 CLI (bundled in the VS Code companion):
//  - context reaches the model ONLY via hookSpecificOutput.additionalContext, or as plain
//    stdout for SessionStart / UserPromptSubmit (PLAIN_TEXT_CONTEXT_EVENTS); a top-level
//    {additionalContext} is ignored — test-outcome, truncation-check and stop-verify used it
//    before 0.13.0;
//  - PreCompact context is cut at 4,000 chars and plain stdout is NOT read for it;
//  - Stop: systemMessage is shown to the user; {decision:"block", reason} blocks.
// These run each BUNDLED hook as a process (what deployServer copies into projects) and check
// its output against that contract.

console.log("\n=== Delivery channels (Qwen hook contracts) ===\n");

/** Versus's own per-field budget (hook-output.ts HOOK_TEXT_CAP). Qwen itself caps hook stdout
 *  at 1 MiB; the real limits are per channel (PreCompact 4,000; tool result 25,000). */
const HOOK_CAP = 10_000;
const QWEN_PRECOMPACT_CAP = 4_000;
// DefaultHookOutput's fields (Qwen Code 0.28.4).
const TOP_LEVEL_KEYS = new Set(["continue", "stopReason", "suppressOutput", "systemMessage", "terminalSequence", "decision", "reason", "hookSpecificOutput"]);

function runHook(name: string, stdin: unknown): { stdout: string; status: number | null } {
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "bundle", `${name}.js`)], {
    input: JSON.stringify(stdin),
    env: { ...process.env, QWEN_PROJECT_DIR: workspace },
    encoding: "utf-8",
    timeout: 20_000,
  });
  return { stdout: r.stdout ?? "", status: r.status };
}

function assertJsonContract(out: string, event: string, cap = HOOK_CAP) {
  const o = JSON.parse(out);
  for (const k of Object.keys(o)) assert.ok(TOP_LEVEL_KEYS.has(k), `${event}: top-level key "${k}" is not read by Qwen (a top-level additionalContext reaches nobody)`);
  if (o.hookSpecificOutput) assert.strictEqual(o.hookSpecificOutput.hookEventName, event, "hookEventName must name the event");
  for (const v of [o.hookSpecificOutput?.additionalContext, o.systemMessage, o.reason, o.hookSpecificOutput?.permissionDecisionReason]) {
    if (typeof v === "string") assert.ok(v.length <= cap, `${event}: a text field over ${cap} chars`);
  }
  return o;
}

test("every registered hook is a command hook, bundled AND deployed by both deploy paths", () => {
  const hooks = buildOrchestratorHooks(workspace);
  const bundle = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "bundle.mjs"), "utf-8");
  const ext = fs.readFileSync(path.join(__dirname, "..", "..", "src", "extension.ts"), "utf-8");
  for (const [event, entries] of Object.entries(hooks)) {
    for (const e of entries as { hooks: { type: string; command?: string }[] }[]) {
      for (const h of e.hooks) {
        assert.strictEqual(h.type, "command", `${event}: only command hooks are used`);
        const script = /([\w-]+)\.js/.exec(h.command ?? "")![1];
        assert.ok(bundle.includes(`out: "${script}"`), `${script} must be bundled (scripts/bundle.mjs)`);
        assert.ok(ext.includes(`"${script}.js"`), `${script}.js must be in deployServer()'s file list`);
        assert.ok(BUNDLE_FILES.includes(`${script}.js`), `${script}.js must be in init_project's BUNDLE_FILES (it lacked test-outcome.js before 0.13.0)`);
      }
    }
  }
  assert.ok(hooks.SessionStart && hooks.PreCompact, "session recovery hooks are registered");
});

test("UserPromptSubmit: plain text within the budget, even on a huge project", () => {
  toPhase5();
  for (let i = 0; i < 120; i++) engine.recordDecision(5, "implementation", `d${i} ` + "z".repeat(6000));
  const r = runHook("inject-context", { prompt: "hi" });
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.length > 0 && r.stdout.length <= INJECT_BUDGET + 200, `got ${r.stdout.length}`);
  assert.ok(r.stdout.startsWith("[Versus] Phase 5"));
  assert.ok(!r.stdout.includes("ANTI-PATTERNS"), "the guidance is no longer appended to every message");
});

test("SessionStart (startup and compact): context for the model + the banner for the user", () => {
  toPhase5();
  for (let i = 0; i < 80; i++) engine.recordDecision(5, "implementation", `d${i} ` + "z".repeat(6000));
  for (const source of ["startup", "compact"]) {
    const r = runHook("session-start", { source, hook_event_name: "SessionStart" });
    assert.strictEqual(r.status, 0);
    const o = assertJsonContract(r.stdout, "SessionStart");
    const ctx = String(o.hookSpecificOutput.additionalContext);
    assert.ok(ctx.includes("mcp__versus-qwen__get_phase_guidance()"), `${source}: names this build's MCP tool`);
    assert.ok(!ctx.includes("versus-claude"), `${source}: no Claude tool names`);
    assert.ok(ctx.includes("[Versus] Phase 5"), `${source}: carries the state itself`);
    assert.ok(/^📍 Versus \d+\.\d+\.\d+ /.test(String(o.systemMessage)), `${source}: the banner goes to the USER mechanically`);
  }
  const c = JSON.parse(runHook("session-start", { source: "compact" }).stdout);
  assert.ok(String(c.hookSpecificOutput.additionalContext).includes("compacted"));
  assert.ok(String(c.systemMessage).includes("retomado"));
});

test("SessionStart without a project gives the init protocol", () => {
  const r = runHook("session-start", { source: "startup" });
  const o = assertJsonContract(r.stdout, "SessionStart");
  assert.ok(String(o.hookSpecificOutput.additionalContext).includes("init_project"));
  assert.ok(!("systemMessage" in o), "no banner without a project");
});

test("PreCompact: hookSpecificOutput (plain stdout is not read for it), under Qwen's 4,000-char cut", () => {
  toPhase5();
  for (let i = 0; i < 30; i++) engine.recordDecision(5, "implementation", `d${i} ` + "z".repeat(3000));
  const r = runHook("pre-compact", { trigger: "auto" });
  assert.strictEqual(r.status, 0);
  const o = assertJsonContract(r.stdout, "PreCompact", QWEN_PRECOMPACT_CAP);
  const ctx = String(o.hookSpecificOutput.additionalContext);
  assert.ok(ctx.includes("Phase 5") && ctx.includes("get_phase_guidance()"));
});

test("PostToolUse test-outcome: the S6 escalation uses hookSpecificOutput (the top-level form reached nobody)", () => {
  toPhase5();
  const cmd = 'npm test; echo "VERSUS_TEST_EXIT=$?"';
  engine.recordTestOutcome(cmd, "fail");          // same command: S6 counts failures per suite
  const r = runHook("test-outcome", {
    tool_name: "run_shell_command", tool_input: { command: cmd },
    tool_response: { stdout: "boom\nVERSUS_TEST_EXIT=1", stderr: "" }, cwd: workspace,
  });
  const o = assertJsonContract(r.stdout, "PostToolUse");
  assert.ok(String(o.hookSpecificOutput.additionalContext).includes("S6"));
});

test("PostToolUse truncation-check: hookSpecificOutput too", () => {
  const r = runHook("truncation-check", { tool_name: "run_shell_command", tool_input: {}, tool_response: { stdout: "Output too large (204KB). Full output saved to: /x" } });
  const o = assertJsonContract(r.stdout, "PostToolUse");
  assert.ok(String(o.hookSpecificOutput.additionalContext).includes("truncated"));
});

test("PreToolUse phase-gate and loop-detector: deny via hookSpecificOutput.permissionDecision", () => {
  engine.initProject("Test", "Desc");
  const g = runHook("phase-gate", { tool_name: "write_file", tool_input: { file_path: path.join(workspace, "src", "a.ts") }, cwd: workspace });
  const go = assertJsonContract(g.stdout, "PreToolUse");
  assert.strictEqual(go.hookSpecificOutput.permissionDecision, "deny");
  teardown(); setup();
  toPhase5();
  for (let i = 0; i < LOOP_FAILURE_THRESHOLD; i++) engine.recordTestOutcome("npm test", "fail");
  const l = runHook("loop-detector", { tool_name: "run_shell_command", tool_input: { command: "npm test" } });
  const lo = assertJsonContract(l.stdout, "PreToolUse");
  assert.strictEqual(lo.hookSpecificOutput.permissionDecision, "deny");
});

test("Stop stop-verify: block = decision/reason with exit 0; a warning goes to the USER as systemMessage", () => {
  toPhase5();
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node -e process.exit(1)" } }));
  const b = runHook("stop-verify", { stop_hook_active: false });
  assert.strictEqual(b.status, 0, "exit 2 would make Qwen read the reason from stderr");
  const bo = assertJsonContract(b.stdout, "Stop");
  assert.strictEqual(bo.decision, "block");
  assert.ok(String(bo.reason).includes("TESTS FAILED"));
  fs.rmSync(path.join(workspace, "package.json"));
  const w = runHook("stop-verify", { stop_hook_active: false });
  const wo = assertJsonContract(w.stdout, "Stop");
  assert.ok(typeof wo.systemMessage === "string" && !("additionalContext" in wo));
});


test("update_project_spec returns the delta and counts, not the whole (ever-growing) spec", () => {
  engine.initProject("Test", "Desc");
  engine.updateProjectSpec({ constraints: Array.from({ length: 300 }, (_, i) => `constraint ${i} ` + "c".repeat(120)) });
  const out = handleUpdateProjectSpec(engine, { stack: ["Swift 6"] });
  const o = JSON.parse(out);
  assert.ok(out.length < 1000, `the Claude build measured 40,764 chars on a real project; got ${out.length}`);
  assert.deepStrictEqual(o.added, { stack: ["Swift 6"] });
  assert.strictEqual(o.counts.constraints, 300);
});

test("4→5 needs the convergence confirmation recorded in Phase 4", () => {
  engine.initProject("Test", "Desc");
  engine.updateScore(95, makeFullBreakdown(95));
  writeArchitectureDoc(workspace);
  writeCoverageMatrix(workspace);
  for (let p = 0; p <= 3; p++) {
    for (const c of engine.getExitCriteriaWithDefs(p)) engine.markExitCriterion(p, c.criterion, true);
    if (p === 2) declareLenses();
    if (p === 3) approve(3);
    engine.advancePhase(p + 1);
  }
  for (const c of engine.getExitCriteriaWithDefs(4)) engine.markExitCriterion(4, c.criterion, true);
  const r = engine.advancePhase(5);
  assert.strictEqual(r.ok, false, "the 3→4 'shall we verify?' approval does not confirm the verification's result");
  if (r.ok) return;
  assert.ok(r.error.missingCriteria.some((m) => m.includes("[Phase 4] approval") && m.includes("report")));
  approve(4);
  assert.strictEqual(engine.advancePhase(5).ok, true);
});


// --- Claude 0.18.2: pending items from the first full 0.18 cycle (MoonPatrolClone) ---

console.log("\n=== Claude 0.18.2 — pending items from MoonPatrolClone ===\n");

test("S6 pattern ignores the plumbing: pipes and the exit echo do not restart the count", () => {
  toPhase5();
  engine.recordTestOutcome('npx playwright test; echo "VERSUS_TEST_EXIT=$?"', "fail");
  engine.recordTestOutcome('npx playwright test 2>&1 | grep -E "passed|failed"; echo "VERSUS_TEST_EXIT=${PIPESTATUS[0]}"', "fail");
  assert.strictEqual(engine.getLoopCounter().count, 2, "same suite, different plumbing: one count");
  assert.strictEqual(engine.getLoopCounter().pattern, "npx playwright test");
  engine.recordTestOutcome("cd app && npx playwright test --reporter=line", "fail");
  assert.strictEqual(engine.getLoopCounter().count, 3, "a cd and a flag do not change the suite either");
  assert.ok(engine.isLoopBlocked());
});

test("the state header names the running Versus version", () => {
  toPhase5();
  const t = buildInjection(engine)!;
  assert.ok(t.split("\n")[0].endsWith(`| v${VERSUS_VERSION}`), t.split("\n")[0]);
});

test("the Phase 7 approval writes the cycle record even if no new cycle follows", () => {
  toPhase6();
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true, `P6 ${c.criterion}`);
  engine.recordTestOutcome("npm test", "pass");
  assert.ok(engine.advancePhase(7).ok);
  const r = JSON.parse(handleRecordDecision(engine, { phase: 7, category: "approval", content: "Projeto concluído — atende o MVP", approvedBy: "user ('Projeto concluído')" }));
  assert.ok(String(r._export).includes(".versus/cycles/cycle-1.md"), "a project that ENDS at Phase 7 still leaves its record");
  const md = fs.readFileSync(path.join(workspace, ".versus", "cycles", "cycle-1.md"), "utf-8");
  assert.ok(md.includes("**tests_passing** — P6 tests_passing") && md.includes("Projeto concluído"));
  const plain = JSON.parse(handleRecordDecision(engine, { phase: 7, category: "process", content: "note" }));
  assert.ok(!("_export" in plain), "only an approval closes the cycle");
});

// --- Claude 0.19.0: report items 2, 4, 6, 9, 12 + the Phase 5 Scope Inventory record ---

console.log("\n=== Claude 0.19.0 — declared checks, promised tests, deviations, scope inventory, lesson guards ===\n");

/** Phase 6 with everything but the gate under test satisfied. */
function toPhase6Ready() {
  toPhase6();
  for (const c of engine.getExitCriteriaWithDefs(6)) engine.markExitCriterion(6, c.criterion, true);
  engine.recordTestOutcome("npm test", "pass", { source: "harness", exitCode: 0, exitSource: "echo" });
}

test("a declared check is EXECUTED, not attested: blocked until witnessed with the expected result", () => {
  toPhase6Ready();
  const d = JSON.parse(handleMarkExitCriterion(engine, {
    phase: 6, criterion: "edge_cases", met: true, details: "OAuth removed from all 4 services",
    check_command: "grep -rli oauth services/ | wc -l", check_expect: "output:^\\s*0\\s*$",
  }));
  assert.strictEqual(d.success, true);
  assert.ok(String(d._check).includes("run it through the shell (run_shell_command)"));
  let r = engine.advancePhase(7);
  assert.strictEqual(r.ok, false, "the audit's case: 'grep = 0' attested, never run");
  if (r.ok) return;
  assert.ok(r.error.missingCriteria.some((m) => m.includes("has not seen it run")));
  engine.witnessChecks("cd /x && grep -rli oauth services/ | wc -l", "1\n");     // one service still has it
  r = engine.advancePhase(7);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.ok(r.error.missingCriteria.some((m) => m.includes("did NOT give")));
  engine.witnessChecks("grep -rli oauth services/ | wc -l", "0\n");
  assert.strictEqual(engine.advancePhase(7).ok, true);
});

test("an exit-code check uses the VERSUS_EXIT echo; a bad expectation is refused at declaration", () => {
  toPhase6Ready();
  assert.strictEqual(engine.declareCheck(6, "edge_cases", "make lint", "exit:0").ok, true);
  assert.strictEqual(detectExitCode("ok\nVERSUS_EXIT=0"), 0, "the general token is read like the test one");
  engine.witnessChecks('make lint; echo "VERSUS_EXIT=$?"', "lint ok\nVERSUS_EXIT=0", detectExitCode("lint ok\nVERSUS_EXIT=0"));
  assert.strictEqual(engine.advancePhase(7).ok, true);
  assert.strictEqual(engine.declareCheck(6, "x", "true", "zero please").ok, false);
});

test("the hook witnesses a declared check in ANY phase (not only 5+)", () => {
  engine.initProject("Test", "Desc");
  engine.declareCheck(0, "user_confirmed", "ls specs | wc -l", "output:\\d+");
  const r = runHook("test-outcome", {
    tool_name: "run_shell_command", tool_input: { command: "ls specs | wc -l" },
    tool_response: { stdout: "9\n", stderr: "" }, cwd: workspace,
  });
  const o = assertJsonContract(r.stdout, "PostToolUse");
  assert.ok(String(o.hookSpecificOutput.additionalContext).includes("user_confirmed"));
  const ck = new StateEngine(workspace).getPhaseState()!.exitCriteria.find((c) => c.criterion === "user_confirmed")!.check!;
  assert.strictEqual(ck.witnessed?.ok, true);
});

test("6→7: every T-xx promised by the CURRENT architecture version must appear in a test file", () => {
  toPhase6Ready();
  const arch = path.join(workspace, "specs", "technical", "architecture.md");
  fs.writeFileSync(arch,
    "# Architecture\n\n## V(1)\n| id | module | responsibility | interface | depends-on |\n|---|---|---|---|---|\n| M-01 | auth | a | l() | db |\n| M-02 | ui | r | r() | auth |\n" +
    "Promised: T-09 (dropped later)\n\n## V(2)\n| id | module | responsibility | interface | depends-on |\n|---|---|---|---|---|\n| M-01 | auth | a | l() | db |\n| M-02 | ui | r | r() | auth |\n" +
    "Promised tests: T-01 fast double-tap; T-02 ready flag only with hashed run id\n\n## Desvios\nnenhum\n");
  fs.mkdirSync(path.join(workspace, "tests"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "tests", "input.test.js"), "test('T-01 fast double-tap', () => {})\n");
  const r = engine.advancePhase(7);
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  const m = r.error.missingCriteria.find((x) => x.includes("promised tests"))!;
  assert.ok(m.includes("T-02") && !m.includes("T-01") && !m.includes("T-09"), "only the current version's unimplemented promise");
  fs.writeFileSync(path.join(workspace, "tests", "ready.test.js"), "// T-02\ntest('ready', () => {})\n");
  assert.strictEqual(engine.advancePhase(7).ok, true);
});

test("6→7: the current architecture version records its deviations (or 'nenhum')", () => {
  toPhase6Ready();
  const arch = path.join(workspace, "specs", "technical", "architecture.md");
  const base = "# Architecture\n\n## V(1)\n| id | module | responsibility | interface | depends-on |\n|---|---|---|---|---|\n| M-01 | auth | a | l() | db |\n| M-02 | ui | r | r() | auth |\n";
  fs.writeFileSync(arch, base + "\n## Desvios\nV0 note\n\n## V(2)\n| id | module | responsibility | interface | depends-on |\n|---|---|---|---|---|\n| M-01 | auth | a | l() | db |\n| M-02 | ui | r | r() | auth |\n");
  let r = engine.advancePhase(7);
  assert.strictEqual(r.ok, false, "a Desvios section of an OLD version does not cover the current one");
  if (r.ok) return;
  assert.ok(r.error.missingCriteria.some((m) => m.includes("Desvios")));
  fs.appendFileSync(arch, "\n## Desvios\n\n## Notes\nx\n");
  assert.strictEqual(engine.advancePhase(7).ok, false, "an empty Desvios section is not a record");
  fs.writeFileSync(arch, fs.readFileSync(arch, "utf-8").replace("## Desvios\n\n## Notes", "## Desvios\n- iframe removed instead of src=about:blank — leak on reopen\n\n## Notes"));
  assert.strictEqual(engine.advancePhase(7).ok, true);
});

test("5→6: the Scope Inventory leaves a record", () => {
  toPhase5();
  for (const c of engine.getExitCriteriaWithDefs(5)) engine.markExitCriterion(5, c.criterion, true);
  const r = engine.advancePhase(6);
  assert.strictEqual(r.ok, false, "MUST DISPLAY was never a record (ESJUD crossed 5→6 without it)");
  if (r.ok) return;
  assert.ok(r.error.missingCriteria.some((m) => m.includes("scope-inventory")));
  engine.recordDecision(5, "scope-inventory", "all good");
  assert.strictEqual(engine.advancePhase(6).ok, false, "an inventory without ✅/❌ items is not an inventory");
  engine.recordDecision(5, "scope-inventory", "M-01 auth ✅\nM-02 ui ✅\nUC-1 end-to-end ✅");
  assert.strictEqual(engine.advancePhase(6).ok, true);
});

test("lessons: each says whether it became a guard; 'none' ones are listed for the human", () => {
  engine.initProject("Test", "Desc");
  const lp = path.join(workspace, "specs", "references", "lessons.md");
  // heading form (the ESJUD lessons file's shape), with a backlog section that is NOT a lesson
  fs.writeFileSync(lp,
    "# Lições\n\n## 1. Domínio — dependências externas\ntexto\nguard: T-07\n\n## 2. Stack — ViewModel recriado\ntexto\n\n" +
    "## 3. mTLS\ntexto\nguard: none\n\n## Backlog para o ciclo v2.0\n1. item\n");
  const ls = engine.lessons();
  assert.deepStrictEqual(ls.map((l) => l.guard), ["T-07", null, "none"], "3 lessons; the backlog is not one");
  // bullet form
  fs.writeFileSync(lp, "# Lessons\n\n- first lesson\n  guard: T-01\n- second lesson\nguard: none\n");
  assert.deepStrictEqual(engine.lessons().map((l) => l.guard), ["T-01", "none"]);
});

test("start_new_cycle is blocked while a lesson lacks its guard line", () => {
  toPhase6Ready();
  assert.ok(engine.advancePhase(7).ok);
  for (const c of engine.getExitCriteriaWithDefs(7)) engine.markExitCriterion(7, c.criterion, true);
  approve(7);
  const lp = path.join(workspace, "specs", "references", "lessons.md");
  fs.writeFileSync(lp, "# Lessons\n\n- The session TTL assumption from P0 was wrong; refreshed tokens broke it.\n- The ORM lacked batch upsert; had to hand-roll it.\n  guard: none\n");
  const r = engine.startNewCycle();
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.ok(String(r.error).includes("guard") && String(r.error).includes("session TTL"));
  const m = JSON.parse(handleMarkExitCriterion(engine, { phase: 7, criterion: "lessons_documented", met: true }));
  assert.ok(m._lessonsWithoutGuard.lessons.some((t: string) => t.includes("ORM")), "guard: none lessons go to the human");
  assert.ok(m._lessonsMissingGuardLine.lessons.some((t: string) => t.includes("session TTL")));
  fs.writeFileSync(lp, fs.readFileSync(lp, "utf-8").replace("broke it.\n", "broke it.\n  guard: T-07\n"));
  assert.strictEqual(engine.startNewCycle().ok, true);
});

test("guidance teaches the new records before the gates fire (items 4, 6, 9, 12, scope inventory, checks)", () => {
  const g5 = handleGetPhaseGuidance(engine, { phase: 5 });
  engine.initProject("Test", "Desc");
  const get = (p: number) => JSON.parse(handleGetPhaseGuidance(engine, { phase: p })).guidance as string;
  assert.ok(get(1).includes("T-01"), "Phase 1: promised tests get ids");
  assert.ok(get(5).includes("scope-inventory") && get(5).includes("undiscussed-choices"), "Phase 5: inventory record + undiscussed choices");
  assert.ok(get(6).includes("## Desvios") && get(6).includes("check_command"), "Phase 6: deviations + declared checks");
  assert.ok(get(7).includes("guard: <test id>"), "Phase 7: lesson guards");
  void g5;
});

test("lessons accumulated across cycles: only the CURRENT cycle's section is asked for guards", () => {
  engine.initProject("Test", "Desc");
  const st = engine.getPhaseState()!;
  st.history.push({ from: 7, to: 0, timestamp: new Date().toISOString(), criteriaMet: [] });   // now in cycle 2
  fs.writeFileSync(path.join(workspace, "specs", "references", "lessons.md"),
    "# Lições\n\n# Ciclo 1 — MVP\n\n## Lição 1 — antiga, sem guard\ntexto\n\n## Métricas do ciclo\n- 12 testes\n\n" +
    "# Ciclo 2 — v2\n\n## Lição 1 — nova\nguard: T-03\n\n## Referências acumuladas\n- doc X\n");
  const ls = engine.lessons();
  assert.deepStrictEqual(ls.map((l) => l.guard), ["T-03"], "cycle 1's pre-0.19 lessons and the metrics/references sections are not asked");
});

// --- 0.13.1 (tracks Versus Claude 0.19.1): the packaged engine must load ---

console.log("\n=== Packaging ===\n");

test("code that ships in the .vsix imports nothing from a directory the .vsix excludes", () => {
  const root = path.join(__dirname, "..", "..");
  const ignore = fs.readFileSync(path.join(root, ".vscodeignore"), "utf-8").split(/\r?\n/);
  const excluded = new Set(ignore.map((l) => /^out\/([\w-]+)\/\*\*$/.exec(l.trim())?.[1]).filter((x): x is string => !!x));
  assert.ok(excluded.has("hooks"), "sanity: out/hooks is excluded (hooks ship as bundles)");
  const src = path.join(root, "src");
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith(".ts")) continue;
      const rel = path.relative(src, full).split(path.sep);
      if (rel.length > 1 && excluded.has(rel[0])) continue;          // excluded code may import anything
      for (const m of fs.readFileSync(full, "utf-8").matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
        const target = path.relative(src, path.resolve(path.dirname(full), m[1])).split(path.sep);
        if (target.length > 1 && excluded.has(target[0])) bad.push(`${rel.join("/")} → ${m[1]}`);
      }
    }
  };
  walk(src);
  assert.deepStrictEqual(bad, [], "these imports resolve to files that are not in the .vsix");
});

console.log("\n=== All tests completed ===\n");
