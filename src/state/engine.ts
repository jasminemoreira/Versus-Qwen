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
} from "../rules/safeguards";

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

    if (!validation.valid) {
      return {
        ok: false,
        error: {
          message: `Cannot advance from Phase ${from} to Phase ${targetPhase}.`,
          missingCriteria: validation.missingCriteria,
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
    this.state.currentIteration = 1;
    this.state.loopCounter = { pattern: "", count: 0, firstSeen: "", lastSeen: "" };
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
    return decision;
  }

  updateProjectSpec(spec: Partial<{ stack: string[]; outOfScope: string[]; patterns: string[]; constraints: string[] }>): void {
    if (!this.state) throw new Error("Project not initialized.");
    if (!this.state.projectSpec) {
      this.state.projectSpec = { stack: [], outOfScope: [], patterns: [], constraints: [] };
    }
    const ps = this.state.projectSpec;
    if (spec.stack) ps.stack = dedupe([...ps.stack, ...toStringArray(spec.stack)]);
    if (spec.outOfScope) ps.outOfScope = dedupe([...ps.outOfScope, ...toStringArray(spec.outOfScope)]);
    if (spec.patterns) ps.patterns = dedupe([...ps.patterns, ...toStringArray(spec.patterns)]);
    if (spec.constraints) ps.constraints = dedupe([...ps.constraints, ...toStringArray(spec.constraints)]);
    this.save();
  }

  getProjectSpec(): { stack: string[]; outOfScope: string[]; patterns: string[]; constraints: string[] } {
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

  // --- Loop Counter ---

  incrementLoopCounter(pattern: string): { count: number; blocked: boolean } {
    if (!this.state) return { count: 0, blocked: false };

    const normalized = this.normalizeCommandPattern(pattern);
    if (!this.state.loopCounter) {
      this.state.loopCounter = { pattern: "", count: 0, firstSeen: "", lastSeen: "" };
    }
    const counter = this.state.loopCounter;

    if (counter.pattern === normalized && counter.count > 0) {
      counter.count += 1;
      counter.lastSeen = new Date().toISOString();
    } else {
      this.state.loopCounter = {
        pattern: normalized,
        count: 1,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      };
    }

    this.save();
    return { count: this.state.loopCounter.count, blocked: this.state.loopCounter.count > 3 };
  }

  resetLoopCounter(): void {
    if (!this.state) return;
    this.state.loopCounter = { pattern: "", count: 0, firstSeen: "", lastSeen: "" };
    this.save();
  }

  getLoopCounter(): { pattern: string; count: number } {
    if (!this.state || !this.state.loopCounter) return { pattern: "", count: 0 };
    return { pattern: this.state.loopCounter.pattern, count: this.state.loopCounter.count };
  }

  private normalizeCommandPattern(cmd: string): string {
    // Normalizes test commands to detect repetitions
    // "npm test", "npm run test", "npx jest" → "test"
    // "pytest src/test_foo.py", "python -m pytest" → "pytest"
    const trimmed = cmd.trim().toLowerCase();
    if (/\b(npm\s+test|npx\s+jest|jest|vitest|mocha)\b/.test(trimmed)) return "test:js";
    if (/\b(pytest|python\s+-m\s+pytest|unittest)\b/.test(trimmed)) return "test:py";
    if (/\b(cargo\s+test)\b/.test(trimmed)) return "test:rust";
    if (/\b(go\s+test)\b/.test(trimmed)) return "test:go";
    if (/\bnpm\s+run\s+build\b/.test(trimmed)) return "build";
    if (/\btsc\b/.test(trimmed)) return "compile";
    // Fallback: first 50 chars
    return trimmed.substring(0, 50);
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
    this.state.loopCounter = { pattern: "", count: 0, firstSeen: "", lastSeen: "" };

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

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
