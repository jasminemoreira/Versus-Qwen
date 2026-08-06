// State Engine — manages persistent methodology state

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  PhaseState,
  Decision,
  ExitCriterionState,
  ScoreBreakdown,
  SpecsStatus,
  TransitionError,
  IterationInfo,
  Result,
  createDefaultState,
  SafeguardState,
  SpecEntry,
  specEntryValue,
  ProjectSpec,
} from "./types";
import {
  isValidTransition,
  getExitCriteriaForPhase,
  CRITERION_ID_MIGRATION,
} from "../rules/phases";
import {
  SafeguardResult,
  validateSafeguard,
  getSafeguardsForPhase,
  LOOP_FAILURE_THRESHOLD,
  DIAGNOSIS_CATEGORIES,
} from "../rules/safeguards";

export { LOOP_FAILURE_THRESHOLD, DIAGNOSIS_CATEGORIES };

/** Coerce a value that may arrive as string from MCP to a number */
function toNum(val: unknown): number {
  return Number(val);
}

/** Coerce a value that may arrive as string from MCP to a boolean */
function toBool(val: unknown): boolean {
  if (typeof val === "string") return val === "true";
  return Boolean(val);
}

/** Coerce a value that may arrive as a JSON string from MCP to a string array */
function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    // Check if it's a character-split array (MCP bug workaround)
    if (val.length > 0 && val.every((v: unknown) => typeof v === "string" && v.length <= 2)) {
      // Likely character-split — try to join and parse
      const joined = val.join("");
      try {
        const parsed = JSON.parse(joined);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* not JSON, return as-is */ }
    }
    return val.filter((v: unknown): v is string => typeof v === "string");
  }
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* not JSON */ }
    return [val];
  }
  return [];
}

interface ValidationResult {
  valid: boolean;
  missingCriteria: string[];
  safeguardViolations: string[];
}

function validatePhaseTransition(
  from: number,
  to: number,
  state: PhaseState,
  exitCriteriaMet: Map<string, boolean>
): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    missingCriteria: [],
    safeguardViolations: [],
  };

  if (!isValidTransition(from, to)) {
    result.valid = false;
    result.missingCriteria.push(
      `Transition from Phase ${from} to Phase ${to} is not allowed. Valid transitions: sequential or loop 2↔3.`
    );
    return result;
  }

  if (to > from) {
    const criteria = getExitCriteriaForPhase(from);
    for (const criterion of criteria) {
      if (criterion.required && !exitCriteriaMet.get(criterion.criterion)) {
        result.valid = false;
        result.missingCriteria.push(
          `[Phase ${from}] ${criterion.criterion}: ${criterion.description}`
        );
      }
    }
  }

  if (from === 0 && to === 1) {
    if (state.phase0Score === null || toNum(state.phase0Score) < 90) {
      result.valid = false;
      result.missingCriteria.push(
        `Phase 0 score = ${state.phase0Score ?? "null"}. Required >= 90.`
      );
    }
  }

  const safeguards = getSafeguardsForPhase(from);
  for (const safeguard of safeguards) {
    const check = validateSafeguard(safeguard.id, state);
    if (check.status === "violated") {
      result.valid = false;
      result.safeguardViolations.push(`${safeguard.id}: ${check.details}`);
    }
  }

  return result;
}

export class StateEngine {
  private state: PhaseState | null = null;
  private statePath: string;
  private specsPath: string;

  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.statePath = path.join(workspacePath, ".versus", "state.json");
    this.specsPath = path.join(workspacePath, "specs");
  }

  getWorkspace(): string {
    return this.workspacePath;
  }

  // --- Lifecycle ---

  load(): PhaseState | null {
    try {
      if (fs.existsSync(this.statePath)) {
        const raw = fs.readFileSync(this.statePath, "utf-8");
        this.state = JSON.parse(raw) as PhaseState;
        this.migrateCriterionIds();
        return this.state;
      }
    } catch (err) {
      // state.json corrupted — returns null
    }
    return null;
  }

  /** Migrate Portuguese criterion IDs to English (v0.3.5 → v0.3.6) */
  private migrateCriterionIds(): void {
    if (!this.state) return;
    let changed = false;
    for (const c of this.state.exitCriteria) {
      const newId = CRITERION_ID_MIGRATION[c.criterion];
      if (newId) {
        c.criterion = newId;
        changed = true;
      }
    }
    for (const h of this.state.history) {
      if (h.criteriaMet) {
        h.criteriaMet = h.criteriaMet.map((id) => CRITERION_ID_MIGRATION[id] || id);
      }
    }
    if (changed) {
      this.save();
    }
  }

  private save(): void {
    if (!this.state) return;
    this.state.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), "utf-8");
  }

  // --- Project ---

  initProject(name: string, description: string): PhaseState {
    this.state = createDefaultState(name, description);
    this.save();
    return this.state;
  }

  // --- Gateway Guard ---

  touchPhaseStateCheck(): void {
    if (!this.state) return;
    this.state.lastPhaseStateCheck = new Date().toISOString();
    this.save();
  }

  isContextStale(thresholdMinutes = 30): boolean {
    if (!this.state) return true;
    if (!this.state.lastPhaseStateCheck) return true;
    const last = new Date(this.state.lastPhaseStateCheck).getTime();
    return (Date.now() - last) > thresholdMinutes * 60 * 1000;
  }

  // --- Query ---

  getPhaseState(): PhaseState | null {
    if (!this.state) this.load();
    return this.state;
  }

  getDecisions(phase?: number): Decision[] {
    if (!this.state) return [];
    if (phase !== undefined) {
      const p = toNum(phase);
      return this.state.decisions.filter((d) => toNum(d.phase) === p);
    }
    return this.state.decisions;
  }

  getExitCriteriaState(phase: number): ExitCriterionState[] {
    if (!this.state) return [];
    const p = toNum(phase);
    return this.state.exitCriteria.filter((c) => toNum(c.phase) === p);
  }

  getExitCriteriaWithDefs(phase: number): Array<{ criterion: string; description: string; met: boolean; details?: string }> {
    const defs = getExitCriteriaForPhase(phase);
    const states = this.getExitCriteriaState(phase);
    return defs.map((def) => {
      const state = states.find((s) => s.criterion === def.criterion);
      return {
        criterion: def.criterion,
        description: def.description,
        met: state?.met ?? false,
        details: state?.details,
      };
    });
  }

  // --- Transitions ---

  advancePhase(targetPhase: number): Result<void, TransitionError> {
    if (!this.state) {
      return { ok: false, error: { message: "Project not initialized.", missingCriteria: [] } };
    }

    targetPhase = toNum(targetPhase);
    const from = toNum(this.state.currentPhase);
    const exitCriteriaMet = new Map<string, boolean>();
    for (const c of this.state.exitCriteria) {
      if (toNum(c.phase) === from) {
        exitCriteriaMet.set(c.criterion, toBool(c.met));
      }
    }

    const validation = validatePhaseTransition(from, targetPhase, this.state, exitCriteriaMet);

    // Evidence gate: required artifacts must be persisted and required test
    // runs witnessed before leaving `from`. A boolean met=true is not enough.
    const artifactMissing = targetPhase > from ? this.missingEvidence(from) : [];

    // Check specs/ (warning, does not block)
    const specsWarnings: string[] = [];
    if (targetPhase >= 1) {
      const specsStatus = this.checkSpecsStatus();
      const expectedDirs = this.getExpectedSpecsDirs(from);
      for (const dir of expectedDirs) {
        if (specsStatus[dir] && !specsStatus[dir].populated) {
          specsWarnings.push(`specs/${dir}/ is empty (expected before Phase ${targetPhase})`);
        }
      }
    }

    if (!validation.valid || artifactMissing.length > 0) {
      return {
        ok: false,
        error: {
          message: `Cannot advance from Phase ${from} to Phase ${targetPhase}.`,
          missingCriteria: [...validation.missingCriteria, ...artifactMissing],
          safeguardViolations: validation.safeguardViolations,
          specsWarnings,
        },
      };
    }

    // Valid transition
    this.state.history.push({
      from,
      to: targetPhase,
      timestamp: new Date().toISOString(),
      criteriaMet: Array.from(exitCriteriaMet.entries())
        .filter(([, met]) => met)
        .map(([criterion]) => criterion),
    });

    this.state.currentPhase = targetPhase;
    if (from === 3 && targetPhase === 2) {
      // Phase 2↔3 loop-back: a new round critiques a NEW architecture version.
      // Count the loop and force a fresh lens declaration for this iteration —
      // activated_lenses_recorded reverts to unmet so the gate re-demands it.
      this.state.currentIteration += 1;
      const lensCrit = this.state.exitCriteria.find(
        (c) => toNum(c.phase) === 2 && c.criterion === "activated_lenses_recorded"
      );
      if (lensCrit) { lensCrit.met = false; lensCrit.details = undefined; }
    } else {
      this.state.currentIteration = 1;
    }
    this.resetLoopCounter();
    this.save();

    // Returns OK with specs warnings if any
    return { ok: true, value: undefined };
  }

  startIteration(phase: number): Result<IterationInfo, string> {
    if (!this.state) {
      return { ok: false, error: "Project not initialized." };
    }
    phase = toNum(phase);
    if (toNum(this.state.currentPhase) !== phase) {
      return { ok: false, error: `Current phase is ${this.state.currentPhase}, not ${phase}.` };
    }

    this.state.currentIteration += 1;
    this.save();

    return {
      ok: true,
      value: {
        phase,
        iterationNumber: this.state.currentIteration,
      },
    };
  }

  // --- Recording ---

  recordDecision(phase: number, category: string, content: string): Decision {
    if (!this.state) throw new Error("Project not initialized.");

    const decision: Decision = {
      id: randomUUID(),
      phase: toNum(phase),
      category,
      content,
      timestamp: new Date().toISOString(),
    };

    this.state.decisions.push(decision);
    this.save();

    // A named diagnosis clears the S6 counter: the failures are understood.
    if (DIAGNOSIS_CATEGORIES.includes(category.trim().toLowerCase())) {
      this.clearLoopCredit();
    }

    return decision;
  }

  updateProjectSpec(spec: Partial<{ stack: string[]; outOfScope: string[]; patterns: string[]; constraints: string[] }>): void {
    if (!this.state) throw new Error("Project not initialized.");
    if (!this.state.projectSpec) {
      this.state.projectSpec = { stack: [], outOfScope: [], patterns: [], constraints: [] };
    }
    const ps = this.state.projectSpec;
    const at = new Date().toISOString();
    const phase = toNum(this.state.currentPhase);
    // New entries are timestamped records (value + phase + ISO instant); existing
    // entries (string or object) keep their form and timestamp. Dedup is by value.
    const merge = (existing: SpecEntry[], incoming: unknown): SpecEntry[] =>
      dedupeEntries([...existing, ...toStringArray(incoming).map((value): SpecEntry => ({ value, phase, at }))]);
    if (spec.stack) ps.stack = merge(ps.stack, spec.stack);
    if (spec.outOfScope) ps.outOfScope = merge(ps.outOfScope, spec.outOfScope);
    if (spec.patterns) ps.patterns = merge(ps.patterns, spec.patterns);
    if (spec.constraints) ps.constraints = merge(ps.constraints, spec.constraints);
    this.save();
  }

  getProjectSpec(): ProjectSpec {
    if (!this.state) throw new Error("Project not initialized.");
    return this.state.projectSpec ?? { stack: [], outOfScope: [], patterns: [], constraints: [] };
  }

  updateScore(score: number, breakdown: ScoreBreakdown): void {
    if (!this.state) throw new Error("Project not initialized.");
    this.state.phase0Score = toNum(score);
    this.state.phase0Breakdown = breakdown;
    this.save();
  }

  markExitCriterion(phase: number, criterion: string, met: boolean, details?: string): void {
    if (!this.state) throw new Error("Project not initialized.");

    phase = toNum(phase);
    met = toBool(met);

    const existing = this.state.exitCriteria.find(
      (c) => toNum(c.phase) === phase && c.criterion === criterion
    );

    if (existing) {
      existing.met = met;
      existing.details = details;
    } else {
      this.state.exitCriteria.push({ phase, criterion, met, details });
    }

    this.save();
  }

  markExitCriteria(entries: Array<{ phase: number; criterion: string; met: boolean; details?: string }>): void {
    if (!this.state) throw new Error("Project not initialized.");
    for (const e of entries) {
      const phase = toNum(e.phase);
      const met = toBool(e.met);
      const existing = this.state.exitCriteria.find(
        (c) => toNum(c.phase) === phase && c.criterion === e.criterion
      );
      if (existing) {
        existing.met = met;
        existing.details = e.details;
      } else {
        this.state.exitCriteria.push({ phase, criterion: e.criterion, met, details: e.details });
      }
    }
    this.save();
  }

  // --- Safeguards ---

  checkSafeguard(id: string): SafeguardResult {
    if (!this.state) {
      return { id, status: "ok", details: "Project not initialized." };
    }
    const result = validateSafeguard(id, this.state);

    // Update internal safeguard state
    const sg = this.state.safeguards.find((s) => s.id === id);
    if (sg) {
      sg.status = result.status;
      sg.details = result.details;
      sg.lastChecked = new Date().toISOString();
      this.save();
    }

    return result;
  }

  checkAllSafeguards(): SafeguardResult[] {
    if (!this.state) return [];
    const results = getSafeguardsForPhase(this.state.currentPhase)
      .map((s) => validateSafeguard(s.id, this.state!));

    for (const result of results) {
      const sg = this.state.safeguards.find((s) => s.id === result.id);
      if (sg) {
        sg.status = result.status;
        sg.details = result.details;
        sg.lastChecked = new Date().toISOString();
      }
    }
    this.save();

    return results;
  }

  // --- Specs ---

  checkSpecsStatus(): SpecsStatus {
    const dirs = [
      "references", "domain", "technical", "examples",
      "design", "models", "datasets", "validation", "competitors",
    ];

    const status: SpecsStatus = {};
    for (const dir of dirs) {
      const dirPath = path.join(this.specsPath, dir);
      try {
        if (fs.existsSync(dirPath)) {
          const files = fs.readdirSync(dirPath).filter((f) => f !== "README.md");
          status[dir] = { populated: files.length > 0, fileCount: files.length };
        } else {
          status[dir] = { populated: false, fileCount: 0 };
        }
      } catch {
        status[dir] = { populated: false, fileCount: 0 };
      }
    }
    return status;
  }

  // --- Evidence gates (persisted artifacts + witnessed test runs) ---

  /** True when specs/<relPath> exists and holds non-trivial content (>= 80 non-whitespace chars). */
  artifactPresent(relPath: string): boolean {
    try {
      const full = path.join(this.specsPath, relPath);
      if (!fs.existsSync(full)) return false;
      const content = fs.readFileSync(full, "utf-8").replace(/\s/g, "");
      return content.length >= 80;
    } catch { return false; }
  }

  /** Counts lines in specs/<relPath> matching `pattern` (multiline). Used to check
   *  structural form (per-finding id rows), not just existence. */
  countArtifactRows(relPath: string, pattern: string): number {
    try {
      const full = path.join(this.specsPath, relPath);
      if (!fs.existsSync(full)) return 0;
      const text = fs.readFileSync(full, "utf-8");
      return (text.match(new RegExp(pattern, "gm")) || []).length;
    } catch { return 0; }
  }

  /** True when the test-outcome hook witnessed a passing run in this phase. */
  witnessedTestPass(phase: number): boolean {
    const t = this.state?.lastTestOutcome;
    return !!t && t.outcome === "pass" && toNum(t.phase) === toNum(phase);
  }

  /** Required evidence (artifacts/witnessed passes) that is not yet on disk for `phase`. */
  private missingEvidence(phase: number): string[] {
    const out: string[] = [];
    for (const def of getExitCriteriaForPhase(phase)) {
      if (!def.required) continue;
      if (def.artifact && !this.artifactPresent(def.artifact)) {
        out.push(`[Phase ${phase}] ${def.criterion}: required artifact specs/${def.artifact} is missing or empty. Write the structured artifact to disk — marking the criterion met is not enough; the record must survive the session and be inspectable later.`);
      } else if (def.artifact && def.artifactRows && this.countArtifactRows(def.artifact, def.artifactRows.pattern) < def.artifactRows.count) {
        const eg = def.artifactRows.example ? `, e.g. '${def.artifactRows.example}'` : "";
        out.push(
          `[Phase ${phase}] ${def.criterion}: specs/${def.artifact} exists but is not in the required structured form ` +
          `(needs at least ${def.artifactRows.count} table row(s) with an id${eg}). ` +
          `A prose or id-less file cannot be machine-read — each row needs its own id.`
        );
      }
      if (def.verify === "test-pass" && !this.witnessedTestPass(phase)) {
        out.push(`[Phase ${phase}] ${def.criterion}: the engine did not witness a passing test run in this phase. Run your test suite so the result is verified by the test-outcome hook (S4: never assume tests passed — execute and verify). Marking the criterion met is not enough.`);
      }
    }
    return out;
  }

  // --- Loop Counter (S6) ---

  /**
   * Records the outcome of a test run. Only FAILURES accumulate: a green run is
   * the end of the work, never a loop, so it clears the counter. Blocking is
   * decided by the caller reading getLoopCounter() BEFORE the run.
   */
  recordTestOutcome(command: string, failed: boolean): { count: number } {
    if (!this.state) return { count: 0 };

    // Witness the run for the tests_passing evidence gate (S4). The existing
    // save() paths (resetLoopCounter on pass, save at the end on fail) persist it.
    this.state.lastTestOutcome = {
      outcome: failed ? "fail" : "pass",
      phase: toNum(this.state.currentPhase),
      at: new Date().toISOString(),
    };

    if (!failed) {
      this.resetLoopCounter();
      return { count: 0 };
    }

    const normalized = this.normalizeCommandPattern(command);
    const counter = this.state.loopCounter;
    const now = new Date().toISOString();

    if (counter && counter.pattern === normalized && counter.count > 0) {
      counter.count += 1;
      counter.lastSeen = now;
    } else {
      this.state.loopCounter = {
        pattern: normalized,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        lastDiagnosis: counter?.lastDiagnosis,
      };
    }

    this.save();
    return { count: this.state.loopCounter.count };
  }

  /**
   * A named diagnosis was recorded — the failures so far are understood, not
   * blind. Clears the counter and lets the next run through. This is the escape
   * hatch the S6 block message promises.
   */
  clearLoopCredit(): void {
    if (!this.state) return;
    const now = new Date().toISOString();
    this.state.loopCounter = {
      pattern: "",
      count: 0,
      firstSeen: "",
      lastSeen: "",
      lastDiagnosis: now,
    };
    this.save();
  }

  resetLoopCounter(): void {
    if (!this.state) return;
    this.state.loopCounter = {
      pattern: "",
      count: 0,
      firstSeen: "",
      lastSeen: "",
      lastDiagnosis: this.state.loopCounter?.lastDiagnosis,
    };
    this.save();
  }

  /** True when undiagnosed failures reached the threshold — next test run is blocked. */
  isLoopBlocked(): boolean {
    return this.getLoopCounter().count >= LOOP_FAILURE_THRESHOLD;
  }

  getLoopCounter(): { pattern: string; count: number; lastDiagnosis?: string } {
    if (!this.state || !this.state.loopCounter) return { pattern: "", count: 0 };
    const c = this.state.loopCounter;
    return { pattern: c.pattern, count: c.count, lastDiagnosis: c.lastDiagnosis };
  }

  /**
   * Normalizes a test command into a pattern. The suite/target argument is kept:
   * S6 talks about iterations on the same MODULE, so `npm test -- consent` and
   * `npm test -- link` must not collapse into the same pattern.
   */
  private normalizeCommandPattern(cmd: string): string {
    const trimmed = cmd.trim().toLowerCase();

    let runner = "";
    if (/\b(npm\s+test|npm\s+run\s+test|npx\s+jest|jest|vitest|mocha)\b/.test(trimmed)) runner = "test:js";
    else if (/\b(pytest|python\s+-m\s+pytest|unittest)\b/.test(trimmed)) runner = "test:py";
    else if (/\bcargo\s+test\b/.test(trimmed)) runner = "test:rust";
    else if (/\bgo\s+test\b/.test(trimmed)) runner = "test:go";
    else if (/\bnpm\s+run\s+build\b/.test(trimmed)) runner = "build";
    else if (/\btsc\b/.test(trimmed)) runner = "compile";
    else return trimmed.substring(0, 50);

    // Target = the suite/file/pattern being exercised, if any. Strips flags and
    // the runner words themselves; what remains identifies the module under test.
    const target = trimmed
      .replace(/^.*?\b(npm\s+run\s+test|npm\s+test|npx\s+jest|jest|vitest|mocha|pytest|python\s+-m\s+pytest|unittest|cargo\s+test|go\s+test|npm\s+run\s+build|tsc)\b/, "")
      .replace(/(^|\s)--?[\w-]+(=\S+)?/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return target ? `${runner}:${target}` : runner;
  }

  // --- Meta-iteration (v1.0 → v2.0) ---

  startNewCycle(): Result<{ cycle: number }, string> {
    if (!this.state) {
      return { ok: false, error: "Project not initialized." };
    }
    if (toNum(this.state.currentPhase) !== 7) {
      return { ok: false, error: `Current phase is ${this.state.currentPhase}. New cycle can only start from Phase 7 (Post-Review).` };
    }

    // Check Phase 7 exit criteria
    const p7Criteria = this.state.exitCriteria.filter((c) => toNum(c.phase) === 7);
    const unmet = p7Criteria.filter((c) => !toBool(c.met));
    if (unmet.length > 0) {
      return { ok: false, error: `Phase 7 exit criteria not met: ${unmet.map((c) => c.criterion).join(", ")}. Complete Post-Review before starting new cycle.` };
    }

    // Evidence gate: Phase 7 artifacts (lessons) must be persisted, not just marked.
    const missing = this.missingEvidence(7);
    if (missing.length > 0) {
      return { ok: false, error: missing.join(" ") };
    }

    // Count completed cycles from history (how many times we've reached phase 7)
    const cycleCount = this.state.history.filter((h) => h.to === 7).length + 1;

    // Record cycle boundary in history
    this.state.history.push({
      from: 7,
      to: 0,
      timestamp: new Date().toISOString(),
      criteriaMet: p7Criteria.map((c) => c.criterion),
    });

    // Preserve: decisions, projectSpec, history
    // Reset: phase, iteration, score, exit criteria, safeguards, loop counter
    this.state.currentPhase = 0;
    this.state.currentIteration = 1;
    this.state.phase0Score = null;
    this.state.phase0Breakdown = null;
    this.state.exitCriteria = [];
    this.state.safeguards = [
      { id: "S0", status: "ok" },
      { id: "S1", status: "ok" },
      { id: "S2", status: "ok" },
      { id: "S3", status: "ok" },
      { id: "S4", status: "ok" },
      { id: "S5", status: "ok" },
      { id: "S6", status: "ok" },
      { id: "S7", status: "ok" },
    ];
    this.resetLoopCounter();

    this.save();
    return { ok: true, value: { cycle: cycleCount + 1 } };
  }

  // --- Private helpers ---

  private getExpectedSpecsDirs(phase: number): string[] {
    switch (phase) {
      case 0: return ["references", "domain", "competitors"];
      case 1: return ["technical", "models", "examples"];
      case 5: return ["technical", "examples", "datasets"];
      case 6: return ["datasets", "validation"];
      default: return [];
    }
  }
}

/** Dedup projectSpec entries by their string value, preserving the first (and its timestamp). */
function dedupeEntries(arr: SpecEntry[]): SpecEntry[] {
  const seen = new Set<string>();
  const out: SpecEntry[] = [];
  for (const e of arr) {
    const v = specEntryValue(e);
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(e);
  }
  return out;
}
