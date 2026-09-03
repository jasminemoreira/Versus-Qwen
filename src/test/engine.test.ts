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
import { handleGetPhaseState, handleGetDecisions } from "../mcp/tools/state-tools";
import { handleGetPhaseGuidance } from "../mcp/tools/guidance-tools";

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
    "## Assumptions\n- single-threaded runtime\n";
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
  engine.advancePhase(6);
  assert.strictEqual(engine.getPhaseState()!.currentPhase, 6);
  writeCriticalCoverage(workspace); // 6→7 cross-gate: matrix criticals must be traced
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
  engine.advancePhase(6);
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

  const blocked = engine.startNewCycle();
  assert.strictEqual(blocked.ok, false);
  if (blocked.ok) return;
  assert.ok(String(blocked.error).includes("references/lessons.md"));

  fs.writeFileSync(
    path.join(workspace, "specs", "references", "lessons.md"),
    "# Lessons\n\n- The auth module's session TTL assumption from P0 was wrong; refreshed tokens broke it.\n- The chosen approach lacked batch upsert; had to hand-roll it.\n"
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
  assert.strictEqual(engine.advancePhase(4).ok, true, "re-answering Phase 3 unblocks 3→4");
});

test("updateProjectSpec timestamps new entries and preserves legacy strings", () => {
  engine.initProject("Test", "Desc");
  // A legacy plain-string entry (old projects) already in state.
  engine.getPhaseState()!.projectSpec.stack.push("LegacyTech");
  engine.updateProjectSpec({ stack: ["TypeScript", "Node 18+"] });

  const stack = engine.getProjectSpec().stack;
  assert.ok(stack.includes("LegacyTech"), "legacy string entry preserved as-is");
  const ts = stack.find((e) => typeof e === "object" && e.value === "TypeScript");
  assert.ok(ts && typeof ts === "object" && typeof ts.at === "string" && ts.at.length > 0, "new entry carries an ISO timestamp");
  assert.strictEqual((ts as { phase?: number }).phase, 0, "new entry records the phase it was added in");

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

test("get_phase_guidance returns a pointer, not the full inline text", () => {
  engine.initProject("Big", "Desc");
  const out = handleGetPhaseGuidance(engine, { phase: 2 });
  assert.ok(out.length < SPILL_CAP, `got ${out.length}`);
  const o = JSON.parse(out);
  assert.ok(o.guidancePointer && o.guidancePointer.includes("injected"), "points at the injected context");
  assert.ok(!("guidance" in o), "must not return the full guidance inline");
  assert.ok(o.guidancePointer.includes("Phase 2"));
});

console.log("\n=== All tests completed ===\n");
