// State Engine and Methodology Rules tests

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { StateEngine } from "../state/engine";
import { ScoreBreakdown } from "../state/types";
import { getCompactGuidance } from "../rules/compact-guidance";

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
  engine.advancePhase(2);

  assert.strictEqual(engine.getPhaseState()!.currentPhase, 2);

  // Phase 2 → 3
  for (const c of engine.getExitCriteriaWithDefs(2)) engine.markExitCriterion(2, c.criterion, true);
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

  const spec = engine.getProjectSpec();
  assert.ok(spec.stack.includes("TypeScript"), "stack must contain TypeScript after recovery");
  assert.ok(spec.stack.includes("Node 18"), "stack must contain Node 18 after recovery");
  assert.ok(!spec.stack.includes("T"), "stack must NOT contain individual characters");
});

// --- Compact Guidance Content (sync guard) ---
// These tests enforce that compact guidance contains key terms from the full guidance.
// If a full guidance change breaks a compact line, these tests will catch it.
// RULE: whenever you update full guidance, run `npm test` to detect sync drift.

console.log("\n=== Compact Guidance Sync Tests ===\n");

function compact(phase: number): string {
  return getCompactGuidance(phase).join(" ");
}

function assertContains(phase: number, term: string, reason: string) {
  assert.ok(
    compact(phase).includes(term),
    `P${phase} compact missing "${term}" — ${reason}`
  );
}

test("P0 compact: HSA levels + score chain", () => {
  assertContains(0, "HSA",               "core exploration method must be named");
  assertContains(0, "teach-back",        "mandatory display — full: VALIDATION section");
  assertContains(0, "FLOW",              "intra-phase flow instruction — prevents stopping between recording answers and presenting synthesis");
  assertContains(0, "AFTER SCORE",       "trigger point for phase transition");
  assertContains(0, "advance_phase",     "exit action for score ≥90");
  assertContains(0, "get_phase_guidance","must chain to P1 guidance after advancing");
  assertContains(0, "start_iteration",   "retry action for score <90");
});

test("P1 compact: architecture questions + exit chain", () => {
  assertContains(1, "Decomposition",       "first of the 4 mandatory architecture questions");
  assertContains(1, "FLOW",               "intra-phase flow instruction — prevents stopping after recording architecture answers");
  assertContains(1, "WHEN DONE",          "trigger point for exit to P2");
  assertContains(1, "update_project_spec","must persist structured spec before advancing — primary enforcement mechanism across sessions");
  assertContains(1, "advance_phase",      "exit action after architecture confirmed");
  assertContains(1, "get_phase_guidance", "must chain to P2 guidance after advancing");
});

test("P2 compact: all 7 universal lens names + exit chain", () => {
  // Full guidance: Universal Lenses table (PHASE_2_GUIDANCE)
  for (const lens of ["Assumptions", "Architectural", "Implementability", "Scientific", "Security", "Performance", "Regulatory"]) {
    assertContains(2, lens, `universal lens "${lens}" must be named explicitly — prevents AI invention`);
  }
  assertContains(2, "MODULE BOUNDARY",   "prevents AI from inventing new module boundaries outside P1 decomposition");
  assertContains(2, "negative scope",    "P1 negative scope items must be flagged OOB in P2 — not silently promoted");
  assertContains(2, "FLOW",              "intra-phase flow instruction — prevents stopping after recording lenses");
  assertContains(2, "AFTER GATE",        "trigger point for exit to P3");
  assertContains(2, "NEXT TOOL CALL",    "imperative tool-call language prevents model from writing transition as text");
  assertContains(2, "advance_phase",     "exit action after gate");
  assertContains(2, "get_phase_guidance","must chain to P3 guidance after advancing");
});

test("P3 compact: simplification + exit chain (both paths)", () => {
  assertContains(3, "ANTI-SCOPE-CREEP", "must display checklist to prevent scope drift, including P1 negative scope guard");
  assertContains(3, "FLOW",              "intra-phase flow instruction — prevents stopping before computing %");
  assertContains(3, "AFTER CONFIRMATION","trigger point for post-cycle decision");
  assertContains(3, "NEXT TOOL CALL",    "imperative tool-call language prevents model from writing transition as text");
  assertContains(3, "advance_phase",     "exit action to P4");
  assertContains(3, "get_phase_guidance","must chain to guidance after advancing");
  assertContains(3, "start_iteration",   "loop action for more iterations");
});

test("P4 compact: convergence gate + LLM switch + exit chain", () => {
  assertContains(4, "FLOW",              "intra-phase flow instruction — prevents stopping between get_exit_criteria and check_all_safeguards");
  assertContains(4, "LLM Switch",        "mandatory notification — full: LLM Switch Point section");
  assertContains(4, "WHEN ALL",          "trigger point for gate passage");
  assertContains(4, "advance_phase",     "exit action to P5");
  assertContains(4, "get_phase_guidance","must chain to P5 guidance after advancing");
});

test("P5 compact: implementation + scope review + exit chain", () => {
  assertContains(5, "FLOW",              "intra-phase flow instruction — prevents stopping between modules");
  assertContains(5, "specs/",            "R4: must consult specs before each module");
  assertContains(5, "Tier 1",            "S6 tiers must be named");
  assertContains(5, "BINDING",           "P1 tech/pattern decisions are hard constraints — prevents framework drift");
  assertContains(5, "Decision history",  "hook injects full history — compact guidance must reference it for constraint enforcement");
  assertContains(5, "NEXT TOOL CALL",    "imperative tool-call language prevents model from stopping between modules");
  assertContains(5, "text between modules", "writing text between modules ends the turn — must be explicitly forbidden");
  assertContains(5, "ADVERSARIAL MICRO-CHECK", "per-module divergence check — adversarial framing prevents AP1 rubber-stamp");
  assertContains(5, "DIVERGE",           "micro-check must seek divergence, not validate — prevents self-assessment bias");
  assertContains(5, "SCOPE INVENTORY",   "final presence/absence check before advance — catches unimplemented modules");
  assertContains(5, "WHEN ALL MODULES DONE", "trigger point for scope inventory before exit to P6");
  assertContains(5, "ui_runnable",       "P5 exit criterion: UI must be implemented or N/A documented before advancing");
  assertContains(5, "UI runnable",       "scope inventory item 3: explicit UI check — prevents backend-only delivery in UI projects");
  assertContains(5, "advance_phase",     "exit action to P6");
  assertContains(5, "get_phase_guidance","must chain to P6 guidance after advancing");
  assertContains(5, "ORIGINAL SCOPE",    "Original Scope Adversarial Review must precede Scope Inventory — AP10 prevention");
  assertContains(5, "Renegotiate",       "user option to renegotiate scope must be present");
  assertContains(5, "ACCEPTED GAPS",     "user option to accept gaps as documented debt must be present");
});

test("P6 compact: session renewal + spec-driven testing + UI tooling + manual handoff + exit chain", () => {
  assertContains(6, "FLOW",              "intra-phase flow instruction — prevents stopping between test steps");
  assertContains(6, "Decision history",  "hook injects all decisions — P6 must reference Decision history to merge P0 use cases + P3 scope revisions");
  assertContains(6, "BINDING CONSTRAINTS", "P1 tech stack must be enforced in test code — prevents unapproved test frameworks");
  assertContains(6, "HUMAN USER",        "manual testing must be restricted to human — full: Step 5");
  assertContains(6, "WAIT",              "must require waiting for user return");
  assertContains(6, "WHEN TESTING COMPLETE", "trigger point for exit to P7");
  assertContains(6, "NEXT TOOL CALL",    "imperative tool-call language prevents model from writing transition as text");
  assertContains(6, "advance_phase",     "exit action to P7");
  assertContains(6, "get_phase_guidance","must chain to P7 guidance after advancing");
  assertContains(6, "Step 0",            "session renewal step must be present");
  assertContains(6, "UI TOOLING",        "UI tooling step must be present");
  assertContains(6, "Playwright",        "primary recommendation for web SPA must appear");
});

test("P7 compact: product evaluation + project lessons + meta-iteration safety", () => {
  assertContains(7, "start_new_cycle",   "meta-iteration tool must be named");
  assertContains(7, "init_project",      "prohibition against init_project for v2 must be present");
  assertContains(7, "project lessons",   "project-focused lessons must be mentioned");
  assertContains(7, "specs/",            "specs/ update step must be present");
});

console.log("\n=== All tests completed ===\n");
