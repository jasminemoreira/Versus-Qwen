// State Engine — manages persistent methodology state

import * as fs from "fs";
import * as path from "path";
import { randomUUID, createHash } from "crypto";
import { VERSUS_VERSION } from "../version";
import { parseShell, TEST_COMMAND_PATTERNS, loadExtraTestPatterns } from "../hooks/shell-parse";
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
  LensActivation,
  TestProvenance,
  CycleRecord,
  PhaseTransition,
} from "./types";
import { CONDITIONAL_LENSES, UNIVERSAL_LENSES, canonicalLens } from "../rules/lenses";
import {
  isValidTransition,
  getExitCriteriaForPhase,
  getPhaseDefinition,
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
        return this.state;
      }
    } catch (err) {
      // state.json corrupted — returns null
    }
    return null;
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

    // 2→3: every module a finding cites must exist in the architecture table
    // (union of all ## V(N) versions — a removed module is tolerated, an
    // invented one blocks and is named).
    const moduleDrift = from === 2 && targetPhase === 3 ? this.moduleTraceabilityErrors() : [];

    // 2→3: every finding's lens column must be a canonical name (or NENHUMA), a
    // conditional lens must have been declared for that finding's iteration, and its
    // severity must be one of 🔴/🟡/🟢.
    const lensDrift = from === 2 && targetPhase === 3 ? this.findingLensErrors() : [];

    // 6→7: Phase 6 re-verifies what earlier phases decided survived the code (III):
    // every critical finding, and every numbered premise, traced to a test or a reason.
    const coverageDrift = from === 6 && targetPhase === 7
      ? [...this.criticalCoverageErrors(), ...this.premiseCoverageErrors(), ...this.testPromiseErrors(), ...this.deviationsErrors()]
      : [];
    // The Phase 5 Scope Inventory leaves a record (it was MUST DISPLAY only, and the
    // ESJUD study crossed 5→6 without ever running the formal inventory).
    if (from === 5 && targetPhase === 6) coverageDrift.push(...this.scopeInventoryMissing());

    // Human sign-off on the record: convergence (3→4), the convergence RESULT (4→5) and
    // test sign-off (6→7) need an approval DECISION of this phase naming who approved.
    // Audits found these gates crossed with only stamped criteria — the approval lived in a
    // lessons file or nowhere. Presence, not truth: approvedBy is still written by the agent.
    // 4→5 too: the first real 0.18 session ran Phase 4 in 28 s and presented the convergence
    // report only AFTER advance_phase(5); the 3→4 approval does not confirm the result.
    const approvalMissing =
      (from === 3 && targetPhase === 4) || (from === 4 && targetPhase === 5) || (from === 6 && targetPhase === 7)
        ? this.approvalMissing(from) : [];

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

    if (!validation.valid || artifactMissing.length > 0 || moduleDrift.length > 0 || lensDrift.length > 0 || coverageDrift.length > 0 || approvalMissing.length > 0) {
      return {
        ok: false,
        error: {
          message: `Cannot advance from Phase ${from} to Phase ${targetPhase}.`,
          missingCriteria: [...validation.missingCriteria, ...artifactMissing, ...moduleDrift, ...lensDrift, ...coverageDrift, ...approvalMissing],
          safeguardViolations: validation.safeguardViolations,
          specsWarnings,
        },
      };
    }

    // Gates passed — stamp engine-authored provenance on the verify-criteria we just
    // checked, before the transition commits (II).
    this.stampVerificationProvenance(from);

    // Valid transition
    const transition: PhaseTransition = {
      from,
      to: targetPhase,
      timestamp: new Date().toISOString(),
      criteriaMet: Array.from(exitCriteriaMet.entries())
        .filter(([, met]) => met)
        .map(([criterion]) => criterion),
    };
    const fp = this.designFingerprint();
    if (fp.length) transition.artifacts = fp;
    transition.decisionsAt = this.state.decisions.length;
    this.state.history.push(transition);

    this.state.currentPhase = targetPhase;
    if (targetPhase < from) {
      // Backward transition inside the 2↔3 loop (only 3→2 today): every phase from
      // the target up to the one being left will be REDONE against the new design,
      // so reset all their exit criteria — Phase 2 AND Phase 3. A stamp from the
      // previous pass answered the OLD critique; it must not satisfy the new gate.
      // Bump the loop iteration counter.
      this.state.currentIteration += 1;
      for (const ec of this.state.exitCriteria) {
        if (toNum(ec.phase) >= targetPhase && toNum(ec.phase) <= from) { ec.met = false; ec.details = undefined; }
      }
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

  recordDecision(
    phase: number,
    category: string,
    content: string,
    provenance?: { proposedBy?: string; approvedBy?: string }
  ): Decision {
    if (!this.state) throw new Error("Project not initialized.");

    const decision: Decision = {
      id: randomUUID(),
      phase: toNum(phase),
      category,
      content,
      timestamp: new Date().toISOString(),
      cycle: this.currentCycle(),
    };
    const proposedBy = provenance?.proposedBy?.trim();
    const approvedBy = provenance?.approvedBy?.trim();
    if (proposedBy) decision.proposedBy = proposedBy;
    if (approvedBy) decision.approvedBy = approvedBy;

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
    // New entries are plain strings again. The {value, phase, at} stamp (v0.6.x) was research
    // instrumentation ("metadata for external analysis"), read by no gate and never shown to
    // the model. Existing stamped entries are kept as they are and read normally. Dedup is by value.
    const merge = (existing: SpecEntry[], incoming: unknown): SpecEntry[] =>
      dedupeEntries([...existing, ...toStringArray(incoming)]);
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

  /** Declares (or replaces) the mechanical check of a criterion. A new declaration clears any
   *  earlier witness: the check must be seen to run AFTER it was declared. */
  declareCheck(phase: number, criterion: string, command: string, expect?: string): Result<void, string> {
    if (!this.state) return { ok: false, error: "Project not initialized." };
    const cmd = command.trim();
    if (!cmd) return { ok: false, error: "check_command is empty." };
    const exp = (expect ?? "exit:0").trim();
    if (!/^exit:\d+$/.test(exp) && !/^output:.+/s.test(exp)) {
      return { ok: false, error: `check_expect must be "exit:<n>" or "output:<regex>"; got "${exp}".` };
    }
    if (exp.startsWith("output:")) {
      try { new RegExp(exp.slice(7)); } catch (e) { return { ok: false, error: `check_expect regex is invalid: ${String(e)}` }; }
    }
    let ec = this.state.exitCriteria.find((c) => c.phase === phase && c.criterion === criterion);
    if (!ec) { ec = { phase, criterion, met: false }; this.state.exitCriteria.push(ec); }
    ec.check = { command: cmd, expect: exp, declaredAt: new Date().toISOString() };
    this.save();
    return { ok: true, value: undefined };
  }

  /**
   * Called by the PostToolUse hook for EVERY run_shell_command call, in any phase: if the command contains a
   * declared check's command, record what happened. Returns the criteria whose check this run
   * witnessed (empty when none matched).
   */
  witnessChecks(command: string, output: string, exitCode?: number): { criterion: string; phase: number; ok: boolean }[] {
    if (!this.state) return [];
    const norm = (x: string) => x.replace(/\s+/g, " ").trim();
    const ran = norm(command);
    const hits: { criterion: string; phase: number; ok: boolean }[] = [];
    for (const ec of this.state.exitCriteria) {
      const ck = ec.check;
      if (!ck || !ran.includes(norm(ck.command))) continue;
      let ok: boolean;
      if (ck.expect.startsWith("exit:")) ok = typeof exitCode === "number" && exitCode === parseInt(ck.expect.slice(5), 10);
      else {
        // match against the output with the exit-echo line removed
        const body = output.replace(/^.*VERSUS_(?:TEST_)?EXIT=\d+.*$/gm, "").trim();
        try { ok = new RegExp(ck.expect.slice(7), "m").test(body); } catch { ok = false; }
      }
      ck.witnessed = {
        at: new Date().toISOString(),
        ok,
        exitCode,
        outputTail: output.slice(-600),
        outputSha256: createHash("sha256").update(output).digest("hex"),
      };
      hits.push({ criterion: ec.criterion, phase: ec.phase, ok });
    }
    if (hits.length) this.save();
    return hits;
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
      // Per line, not a global match over the whole file: a global regex can walk
      // across a newline and swallow the start of the next line, undercounting rows
      // that are visibly there. The function counts LINES matching pattern.
      const re = new RegExp(pattern);
      return fs.readFileSync(full, "utf-8").split(/\r?\n/).filter((l) => re.test(l)).length;
    } catch { return 0; }
  }

  /** Module names in the 2nd column of table rows whose 1st cell matches idPattern.
   *  Normalized (trim + lowercase) for comparison. */
  private tableColumn2(relPath: string, idPattern: string): Set<string> {
    const out = new Set<string>();
    try {
      const full = path.join(this.specsPath, relPath);
      if (!fs.existsSync(full)) return out;
      // Line by line, anchored. A single global regex over the whole file walks
      // across newlines: a row whose last cell is itself an id — `depends-on`
      // holding `M-01` — matches `| M-01 |\n|` and consumes the pipe that OPENS
      // the next row, so that row is never seen and its module drops from the set.
      const re = new RegExp(`^\\s*\\|\\s*(?:${idPattern})\\s*\\|\\s*([^|]+?)\\s*\\|`);
      for (const line of fs.readFileSync(full, "utf-8").split(/\r?\n/)) {
        const m = re.exec(line);
        if (!m) continue;
        const v = m[1].trim().toLowerCase();
        if (v) out.add(v);
      }
    } catch { /* never blocks */ }
    return out;
  }

  /** Drift: every module a finding cites must appear in architecture.md's module
   *  table in SOME version (union of all ## V(N)). Tolerates a removed module,
   *  catches an invented one. Skips when either artifact is absent. */
  private moduleTraceabilityErrors(): string[] {
    const arch = this.tableColumn2("technical/architecture.md", "M-\\d+");
    const matrix = this.tableColumn2("design/coverage-matrix.md", "(?!M-)[A-Za-z]{1,4}-\\d+");
    if (arch.size === 0 || matrix.size === 0) return [];
    const drift = [...matrix].filter((mod) => !arch.has(mod));
    if (drift.length === 0) return [];
    return [
      `[Phase 2] coverage_matrix cites module(s) absent from every version of the architecture table: ${drift.join(", ")}. ` +
      `Each module in a finding row must appear in specs/technical/architecture.md's module table (any \`## V(N)\` version). ` +
      `Either the name drifted — fix it to the Phase-1 module name — or the architecture is missing the module. ` +
      `Left unfixed, those findings point at modules no artifact records, and per-module traceability breaks after the session.`
    ];
  }

  /** Critique iteration = how many transitions entered Phase 2 (min 1). Derived
   *  from history, NOT currentIteration (which resets on every phase change). In the
   *  2↔3 loop this is 1 on the first pass, 2 after the first 3→2 loop-back — matching
   *  the `## Iteração N` header the model writes in the matrix. */
  private critiqueIteration(): number {
    const entries = (this.state?.history ?? []).filter((h) => toNum(h.to) === 2).length;
    return Math.max(1, entries);
  }

  /** Current architecture version = number of `## V(N)` sections in architecture.md,
   *  or 1 if none/absent. Stamped on a lens declaration as `againstVersion`. */
  private currentArchitectureVersion(): number {
    try {
      const full = path.join(this.specsPath, "technical/architecture.md");
      if (!fs.existsSync(full)) return 1;
      const text = fs.readFileSync(full, "utf-8");
      const n = (text.match(/^#{1,6}\s*V\s*\(\s*\d+\s*\)/gmi) || []).length;
      return n > 0 ? n : 1;
    } catch { return 1; }
  }

  /** Finding rows of the coverage matrix, each tagged with the iteration of the
   *  `## Iteração N` section it sits under (null before the first header). The lens
   *  is the 3rd cell — the row format is frozen (id | module | lens | severity | desc). */
  private matrixFindings(): { id: string; lens: string; severity: string; iteration: number | null }[] {
    const out: { id: string; lens: string; severity: string; iteration: number | null }[] = [];
    try {
      const full = path.join(this.specsPath, "design/coverage-matrix.md");
      if (!fs.existsSync(full)) return out;
      const text = fs.readFileSync(full, "utf-8");
      const idRe = /^(?!M-)[A-Za-z]{1,4}-\d+$/;                       // finding id, M- reserved for modules
      const headerRe = /^#{1,6}\s*(?:Itera[cç][ãa]o|Iteration)\s+(\d+)/i;
      let currentIter: number | null = null;
      for (const line of text.split(/\r?\n/)) {
        const h = line.match(headerRe);
        if (h) { currentIter = parseInt(h[1], 10); continue; }
        if (!line.includes("|")) continue;
        const cells = line.split("|").map((c) => c.trim());
        if (cells.length && cells[0] === "") cells.shift();            // outer pipes
        if (cells.length && cells[cells.length - 1] === "") cells.pop();
        if (cells.length < 3) continue;
        if (!idRe.test(cells[0])) continue;
        out.push({ id: cells[0], lens: cells[2], severity: cells[3] ?? "", iteration: currentIter });
      }
    } catch { /* an unreadable artifact reads as empty — the gate that needs it reports it */ }
    return out;
  }

  /**
   * Errors in the `lens` column of the coverage matrix (2→3 gate). Two layers:
   *   (2.1) every finding's lens must be one of the 19 canonical names — or the
   *         literal NENHUMA (the declared channel for a finding that fit no lens).
   *         `Sustainability` (a truncation) is rejected; `Sustainability /
   *         Proportionality` accepted. This is what the T21 case needed.
   *   (2.2) a CONDITIONAL lens on a finding must have been DECLARED for that
   *         finding's iteration. Universals always run, so they never fail (2.2).
   * Judge a finding by ITS round's set — never the current-only set, never the union
   * as the primary check (the trap the v0.13.0 module gate proved costly): a lens set
   * evolves across the loop. When the iteration cannot be resolved (no header, or no
   * declaration for that number) it degrades to the UNION of all declared sets —
   * permissive, never over-blocking. Skips (2.2) when nothing is declared; (2.1) still
   * runs. Form only.
   */
  private findingLensErrors(): string[] {
    const findings = this.matrixFindings();
    if (findings.length === 0) return [];
    const acts = this.state?.activatedLenses ?? [];
    const union = new Set<string>();
    const byIter = new Map<number, Set<string>>();
    for (const a of acts) {
      for (const c of a.conditional) union.add(c);
      byIter.set(toNum(a.iteration), new Set(a.conditional));
    }
    const universals = new Set<string>(UNIVERSAL_LENSES as readonly string[]);
    const SEVERITIES = ["🔴", "🟡", "🟢"];
    const errs: string[] = [];
    for (const f of findings) {
      // Severity column (4th cell): exactly one of the three glyphs. Tolerant of a
      // trailing word (🔴 Critical), strict on the signal — a word, a code like
      // "P1", an empty cell, or two glyphs cannot be counted.
      const sev = SEVERITIES.filter((s) => f.severity.includes(s));
      if (sev.length !== 1) {
        errs.push(
          `[Phase 2] coverage_matrix row ${f.id}: severity "${f.severity || "(empty)"}" must be exactly one of ` +
          `🔴 (Critical) / 🟡 (Important) / 🟢 (Suggestion). Phase 6 traces every 🔴 to a test (critical-coverage.md), so this ` +
          `column must be machine-readable — a word, a code like "P1", or an empty cell cannot be read.`
        );
      }
      if (/^nenhuma$/i.test(f.lens)) continue;                        // declared "no lens" channel
      const canon = canonicalLens(f.lens);
      if (!canon) {
        errs.push(
          `[Phase 2] coverage_matrix row ${f.id}: lens "${f.lens}" is not one of the 19 canonical lens names (nor NENHUMA). ` +
          `Use the EXACT canonical name — the gate matches each finding's lens against the lenses declared for its iteration, and an abbreviation or a translation cannot be matched.`
        );
        continue;
      }
      if (universals.has(canon)) continue;                            // universals always valid
      if (acts.length === 0) continue;                                // nothing to check membership against yet
      const iterSet = f.iteration !== null ? byIter.get(f.iteration) : undefined;
      const declared = iterSet ?? union;                              // fall back to union, never the current-only set
      if (!declared.has(canon)) {
        const scope = iterSet ? `iteration ${f.iteration}` : "any declared iteration";
        errs.push(
          `[Phase 2] coverage_matrix row ${f.id}: lens "${canon}" was not among the conditional lenses declared for ${scope} ` +
          `(declared: ${[...declared].join(", ") || "none"}). A finding may only use a lens activated for its own iteration — ` +
          `declare it for that round with record_activated_lenses, or fix the finding's lens.`
        );
      }
    }
    return errs;
  }

  /**
   * Records Phase 2 lens activation as structured state, stamped with the current
   * critique iteration and architecture version. Rejects any name outside the
   * canonical 12 conditionals and any lens left unaccounted for: "I did not activate
   * it" and "I forgot it" must not look the same. Re-recording within the SAME
   * iteration replaces that iteration's entry (a correction); a new iteration
   * appends, preserving the per-round history the matrix gate reads.
   */
  recordActivatedLenses(
    conditional: string[],
    notActivated: { lens: string; reason: string }[]
  ): Result<LensActivation, { message: string }> {
    if (!this.state) {
      return { ok: false, error: { message: "Project not initialized." } };
    }
    conditional = toStringArray(conditional);   // MCP may char-split arrays

    const asConditional = (raw: string): string | null => {
      const c = canonicalLens(raw);
      return c && (CONDITIONAL_LENSES as readonly string[]).includes(c) ? c : null;
    };
    const outOfDomain = (raw: string): string =>
      canonicalLens(raw)
        ? `"${raw}" is a UNIVERSAL lens. Universals always run and are not passed here — this ` +
          `field records the CONDITIONAL set, and counting a universal among them corrupts it.`
        : `"${raw}" is not one of the 12 conditional lenses. Use the exact canonical name — ` +
          `abbreviations and translations cannot be matched against the coverage matrix's lens column.`;

    const canon: string[] = [];
    for (const raw of conditional) {
      const c = asConditional(raw);
      if (!c) return { ok: false, error: { message: outOfDomain(raw) } };
      if (canon.includes(c)) {
        return { ok: false, error: { message:
          `Lens "${c}" is listed twice as activated. A duplicate inflates the activated count ` +
          `while passing the completeness check unnoticed.` } };
      }
      canon.push(c);
    }

    const no: { lens: string; reason: string }[] = [];
    for (const item of notActivated ?? []) {
      const c = asConditional(item.lens);
      if (!c) return { ok: false, error: { message: outOfDomain(item.lens) } };
      if (canon.includes(c)) {
        return { ok: false, error: { message:
          `Lens "${c}" appears as BOTH activated and not-activated. The record would contradict ` +
          `itself, and the matrix gate could not tell whether findings of that lens are expected.` } };
      }
      if (no.some((x) => x.lens === c)) {
        return { ok: false, error: { message: `Lens "${c}" is listed twice as not-activated.` } };
      }
      if (!item.reason || !item.reason.trim()) {
        return { ok: false, error: { message:
          `Lens "${c}" is marked not-activated without a reason. The justification is half the ` +
          `record: without it there is no way to tell a considered exclusion from an oversight.` } };
      }
      no.push({ lens: c, reason: item.reason.trim() });
    }

    const counted = new Set([...canon, ...no.map((n) => n.lens)]);
    const missing = CONDITIONAL_LENSES.filter((l) => !counted.has(l));
    if (missing.length > 0) {
      return { ok: false, error: { message:
        `${missing.length} conditional lens(es) unaccounted for: ${missing.join(", ")}. ` +
        `Every one of the 12 must be either activated or explicitly not activated with a reason.` } };
    }

    const iteration = this.critiqueIteration();
    const activation: LensActivation = {
      universal: [...UNIVERSAL_LENSES],
      conditional: canon,
      notActivated: no,
      iteration,
      againstVersion: this.currentArchitectureVersion(),
      recordedAt: new Date().toISOString(),
    };
    if (!this.state.activatedLenses) this.state.activatedLenses = [];
    const existing = this.state.activatedLenses.findIndex((a) => toNum(a.iteration) === iteration);
    if (existing >= 0) this.state.activatedLenses[existing] = activation;   // correction within a round
    else this.state.activatedLenses.push(activation);
    this.save();
    return { ok: true, value: activation };
  }

  /** True if Phase 2 lens activation is on record for the CURRENT critique iteration.
   *  Checking the current iteration (not merely "any entry") forces a fresh declaration
   *  each round of the 2↔3 loop. Legacy free-text is honoured ONLY for projects created
   *  before this schema (no stateVersion); on new projects the structured record is
   *  mandatory, so the fallback cannot become an opt-out. */
  lensesRecorded(): boolean {
    const acts = this.state?.activatedLenses ?? [];
    if (acts.some((a) => toNum(a.iteration) === this.critiqueIteration())) return true;
    if (this.state?.stateVersion !== undefined) return false;              // new project: structured only
    const marks = ["ACTIVATED LENSES", "LENTES ATIVADAS"];
    return (this.state?.decisions ?? []).some((d) =>
      marks.some((m) => d.content.toUpperCase().includes(m))
    );
  }

  /** Reads a specs/ file, or "" if absent/unreadable. */
  private readSpec(relPath: string): string {
    try {
      const full = path.join(this.specsPath, relPath);
      return fs.existsSync(full) ? fs.readFileSync(full, "utf-8") : "";
    } catch { return ""; }
  }

  /**
   * Cross-gate (6→7): every critical (🔴) finding of the matrix must be traced to a
   * test or a stated reason in specs/validation/critical-coverage.md (III.1). Phase 3
   * resolved the criticals; this confirms the code kept them resolved. Skips when there
   * are no criticals. Form only — whether the test truly covers it stays human.
   */
  private criticalCoverageErrors(): string[] {
    const criticals = this.matrixFindings().filter((f) => f.severity.includes("🔴"));
    if (criticals.length === 0) return [];
    if (!this.artifactPresent("validation/critical-coverage.md")) {
      return [
        `[Phase 6] critical coverage: ${criticals.length} critical (🔴) finding(s) in the matrix, but ` +
        `specs/validation/critical-coverage.md is missing or empty. For each 🔴 id, name the test that ` +
        `covers it — or the reason there is none. Phase 3 resolved these; this confirms the code kept them resolved.`
      ];
    }
    const text = this.readSpec("validation/critical-coverage.md");
    const uncovered = criticals.filter((f) => !new RegExp(`\\b${escapeRegExp(f.id)}\\b`).test(text));
    if (uncovered.length > 0) {
      return [
        `[Phase 6] critical coverage: critical finding(s) ${uncovered.map((f) => f.id).join(", ")} ` +
        `are not referenced in specs/validation/critical-coverage.md. Each 🔴 finding must be traced to a ` +
        `test that would catch its regression, or a stated reason there is none (e.g. the module was removed).`
      ];
    }
    return [];
  }

  /**
   * Cross-gate (6→7): every NUMBERED premise of the architecture must be traced to a
   * test or a reason in specs/validation/premise-coverage.md (III.2). CONDITIONAL:
   * premise ids are not a stable convention (half the corpus writes premises as prose),
   * so the gate engages only when architecture.md HAS numbered premises — never
   * over-blocking a prose project. Guidance nudges numbering.
   */
  private premiseCoverageErrors(): string[] {
    const arch = this.readSpec("technical/architecture.md");
    if (!arch) return [];
    const ids = new Set<string>();
    const re = /\b((?:P-A|A)-?\d+)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arch)) !== null) {
      const raw = m[1].toUpperCase().replace(/^A(\d)/, "A-$1");
      if (/^(P-A|A-)\d+$/.test(raw)) ids.add(raw);
    }
    if (ids.size === 0) return [];   // premises are prose here — guidance handles it, gate does not over-block
    if (!this.artifactPresent("validation/premise-coverage.md")) {
      return [
        `[Phase 6] premise coverage: the architecture numbers ${ids.size} premise(s) (${[...ids].slice(0, 6).join(", ")}${ids.size > 6 ? ", …" : ""}), ` +
        `but specs/validation/premise-coverage.md is missing or empty. For each numbered premise, name the test that ` +
        `would FAIL if it stopped holding — or the reason there is none. Criticising a premise's plausibility in Phase 2 ` +
        `is not the same as measuring whether it holds in the code.`
      ];
    }
    const text = this.readSpec("validation/premise-coverage.md");
    const uncovered = [...ids].filter((id) => !new RegExp(`\\b${escapeRegExp(id)}\\b`, "i").test(text));
    if (uncovered.length > 0) {
      return [
        `[Phase 6] premise coverage: premise(s) ${uncovered.join(", ")} are not referenced in ` +
        `specs/validation/premise-coverage.md. Each numbered premise needs a test that would measure it failing, ` +
        `or a stated reason there is none.`
      ];
    }
    return [];
  }

  /**
   * Stamps engine-authored provenance onto the `verify:`-gated criteria of `phase`
   * (II), when the transition passes. `nominal` is false when the gate was met via a
   * degraded path — a pass not confirmed by a harness exit_code=0, or a lens record via
   * the legacy prose fallback — so a post-mortem sees the bypass in the criterion.
   */
  private stampVerificationProvenance(phase: number): void {
    if (!this.state) return;
    for (const def of getExitCriteriaForPhase(phase)) {
      if (!def.verify) continue;
      const ec = this.state.exitCriteria.find((c) => toNum(c.phase) === phase && c.criterion === def.criterion);
      if (!ec) continue;
      if (def.verify === "test-pass") {
        const t = this.state.lastTestOutcome;
        if (!t) continue;
        // nominal: an exit status was OBSERVED (harness or the VERSUS_TEST_EXIT echo)
        // and was 0 — not inferred from output markers. On a harness that supplies no
        // numeric exit code, requiring source==="harness" would make this always false.
        const nominal = typeof t.exitCode === "number" && t.exitCode === 0;
        ec.verifiedBy = {
          path: "test-pass",
          nominal,
          at: new Date().toISOString(),
          note: nominal ? undefined : "pass NOT confirmed by an observed exit status (no harness exit_code and no VERSUS_TEST_EXIT echo) — classified via output markers",
          snapshot: { outcome: t.outcome, command: t.command, exitCode: t.exitCode, exitSource: t.exitSource, source: t.source, outputSha256: t.outputSha256, at: t.at },
        };
      } else if (def.verify === "lenses-recorded") {
        const cur = (this.state.activatedLenses ?? []).find((a) => toNum(a.iteration) === this.critiqueIteration());
        const nominal = !!cur;
        ec.verifiedBy = {
          path: "lenses-recorded",
          nominal,
          at: new Date().toISOString(),
          note: nominal ? undefined : "satisfied via the legacy free-text fallback, not the structured record",
          snapshot: cur ? { iteration: cur.iteration, againstVersion: cur.againstVersion, recordedAt: cur.recordedAt } : {},
        };
      }
    }
  }

  /** True when the test-outcome hook witnessed a passing run in this phase. */
  witnessedTestPass(phase: number): boolean {
    const t = this.state?.lastTestOutcome;
    // A pass that ran outside the project (from the scratchpad, or a script invoked by a
    // path outside it) is not evidence about THIS project's suite.
    return !!t && t.outcome === "pass" && toNum(t.phase) === toNum(phase) && !t.outsideWorkspace;
  }

  /** Required evidence (artifacts/witnessed passes) that is not yet on disk for `phase`. */
  private missingEvidence(phase: number): string[] {
    const out: string[] = [];
    // Declared mechanical checks (Claude 0.19.0): any criterion of this phase that declared one needs
    // a witnessed run, after the declaration, with the expected result.
    for (const ec of this.state?.exitCriteria ?? []) {
      if (ec.phase !== phase || !ec.check) continue;
      const w = ec.check.witnessed;
      const exitHint = ec.check.expect.startsWith("exit:") ? `; echo "VERSUS_EXIT=$?"` : "";
      if (!w || w.at < ec.check.declaredAt) {
        out.push(
          `[Phase ${phase}] ${ec.criterion}: declares the check \`${ec.check.command}\` (expect ${ec.check.expect}) but the ` +
          `engine has not seen it run. Run it through the shell (run_shell_command), exactly: \`${ec.check.command}${exitHint}\`. ` +
          `A declared check is executed, not attested.`
        );
      } else if (!w.ok) {
        out.push(
          `[Phase ${phase}] ${ec.criterion}: the declared check \`${ec.check.command}\` ran at ${w.at} and did NOT give ` +
          `${ec.check.expect}${typeof w.exitCode === "number" ? ` (exit ${w.exitCode})` : ""}. Output tail: ` +
          `${JSON.stringify(w.outputTail.slice(-200))}. Fix the cause and run it again.`
        );
      }
    }
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
      if (def.verify === "lenses-recorded" && !this.lensesRecorded()) {
        out.push(`[Phase ${phase}] ${def.criterion}: lens activation is not on record for iteration ${this.critiqueIteration()}. Call record_activated_lenses(conditional, notActivated) — the structured tool — BEFORE advancing. Marking the criterion met is not enough: without the record, which lenses were applied cannot be reconstructed after the session, and each round of the 2↔3 loop must re-declare against the new architecture.`);
      }
      if (def.criterion === "lessons_documented" && this.artifactPresent("references/lessons.md")) {
        const unguarded = this.lessons().filter((l) => !l.guard);
        if (unguarded.length) {
          out.push(
            `[Phase ${phase}] lessons_documented: ${unguarded.length} lesson(s) in specs/references/lessons.md do not say whether ` +
            `they became a guard: ${unguarded.map((l) => `"${l.title.slice(0, 60)}"`).join(", ")}. Add a line ` +
            `\`guard: <test id>\` (the test that now catches it) or \`guard: none\` to each. A lesson kept only as text did ` +
            `not stop a recurrence before; the test did.`
          );
        }
      }
      if (def.verify === "test-pass" && !this.witnessedTestPass(phase)) {
        const t = this.state?.lastTestOutcome;
        // Distinguish "nothing was observed" from "observed and not a pass" (I.3).
        const seen = t
          ? `The last run the engine recorded was outcome="${t.outcome}"` +
            `${t.command ? ` for \`${t.command}\`` : ""} at ${t.at}` +
            `${toNum(t.phase) !== phase ? ` (in Phase ${t.phase}, not this phase)` : ""}` +
            `${typeof t.exitCode === "number" ? `, exit_code=${t.exitCode}` : ""}.` +
            (t.outcome === "unknown" ? ` "unknown" means the hook could not classify the output — check the run's output, or re-run.` : "") +
            (t.outsideWorkspace
              ? ` That run happened OUTSIDE the project (ran in ${t.runDir ?? "?"}) — a suite run from the scratchpad or another ` +
                `directory is not evidence about this project's tests. Run it from inside the project.`
              : "")
          : `The engine has recorded NO test run in this phase.`;
        out.push(
          `[Phase ${phase}] ${def.criterion}: no witnessed passing test run in this phase. ${seen} ` +
          `Run the suite so the engine reads the EXIT STATUS, not the runner's prose — append the exit echo: ` +
          `\`<your test command>; echo "VERSUS_TEST_EXIT=$?"\` (e.g. \`npm test; echo "VERSUS_TEST_EXIT=$?"\`). ` +
          `The engine keys on that number, so it works in any language or output format. Do NOT modify the test runner. ` +
          `If the engine does not see your runner as a test command at all, add a regex for it to \`.versus/test-commands\` (one per line). ` +
          `(S4: never assume tests passed — execute and verify. Marking the criterion met is not enough.)`
        );
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
  recordTestOutcome(
    command: string,
    outcome: "pass" | "fail" | "unknown",
    provenance?: TestProvenance
  ): { count: number } {
    if (!this.state) return { count: 0 };

    // Record what the engine actually witnessed — gates tests_passing (S4),
    // independent of the S6 loop-counter logic below.
    this.state.lastTestOutcome = {
      outcome,
      phase: toNum(this.state.currentPhase),
      at: new Date().toISOString(),
      command,
      ...(provenance ?? {}),
    };

    if (outcome === "pass") {
      this.resetLoopCounter();  // resetLoopCounter saves, persisting lastTestOutcome too
      return { count: 0 };
    }

    if (outcome === "unknown") {
      // Unclassifiable output is not a failure: leave the S6 counter untouched, just
      // persist the record so a stale "fail" cannot stay frozen (I.1).
      this.save();
      return { count: this.state.loopCounter?.count ?? 0 };
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
   *
   * Claude 0.18.2: only the RUNNER's own simple command counts. A regex over the whole command used to
   * fold `; echo "VERSUS_TEST_EXIT=$?"` and `| grep …` into the "target"
   * (`test:js:; echo "versus_test_exit=$?"`). An agent varying the plumbing (adding a pipe,
   * switching to PIPESTATUS) therefore restarted the count, and S6 under-counted.
   */
  private normalizeCommandPattern(cmd: string): string {
    const patterns = [...TEST_COMMAND_PATTERNS, ...loadExtraTestPatterns(this.workspacePath)];
    for (const seg of parseShell(cmd)) {
      if (!patterns.some((p) => p.test(seg.words.join(" ")))) continue;
      const kept = seg.words.filter((w) => w !== "--" && !/^--?[\w-]+(=.*)?$/.test(w)).map((w) => w.toLowerCase());
      return kept.join(" ").slice(0, 80);
    }
    return cmd.trim().toLowerCase().substring(0, 50);
  }

  // --- Meta-iteration (v1.0 → v2.0) ---

  startNewCycle(): Result<{ cycle: number; archived: number; exportPath?: string }, string> {
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

    const approval = this.approvalMissing(7);
    if (approval.length > 0) {
      return { ok: false, error: approval.join(" ") };
    }

    // Cycle numbering: closed cycles are the 7→0 boundaries in history. (Before Claude 0.18.0
    // this counted arrivals at Phase 7 and added 2, so closing cycle 1 announced cycle 3.)
    const cycle = this.currentCycle();
    const startedAt = this.cycleStartedAt();
    const closedAt = new Date().toISOString();

    const close: PhaseTransition = {
      from: 7,
      to: 0,
      timestamp: closedAt,
      criteriaMet: p7Criteria.map((c) => c.criterion),
    };
    const fp = this.designFingerprint();
    if (fp.length) close.artifacts = fp;
    close.decisionsAt = this.state.decisions.length;

    // Archive the cycle BEFORE the reset (Claude 0.18.0). The reset below used to be the end of
    // this cycle's exit criteria — details, provenance and all — so the record lost its
    // own history the moment the next cycle began.
    const record: CycleRecord = {
      cycle,
      startedAt,
      closedAt,
      phase0Score: this.state.phase0Score,
      exitCriteria: JSON.parse(JSON.stringify(this.state.exitCriteria)),
      transitions: [...this.state.history.filter((h) => h.timestamp > startedAt), close],
      lastTestOutcome: this.state.lastTestOutcome ? { ...this.state.lastTestOutcome } : undefined,
      decisionCount: this.state.decisions.filter((d) => d.timestamp >= startedAt && d.timestamp <= closedAt).length,
    };
    try {
      record.exportPath = this.writeCycleExport(this.renderCycleMarkdown(record), cycle);
    } catch { /* the archive in state.json is the record; the export is a convenience */ }
    if (!this.state.cycles) this.state.cycles = [];
    this.state.cycles.push(record);

    this.state.history.push(close);

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
    return { ok: true, value: { cycle: cycle + 1, archived: cycle, exportPath: record.exportPath } };
  }

  // --- Promised tests, deviations, scope inventory, lessons (Claude 0.19.0) ---

  /** Text of the architecture's latest version section (after the last `## V(N)`), or the whole file. */
  private latestArchitectureSection(): string {
    try {
      const full = path.join(this.specsPath, "technical", "architecture.md");
      if (!fs.existsSync(full)) return "";
      const text = fs.readFileSync(full, "utf-8");
      const idx = [...text.matchAll(/^##\s*V\(\d+\)/gm)].map((m) => m.index ?? 0);
      return idx.length ? text.slice(idx[idx.length - 1]) : text;
    } catch { return ""; }
  }

  /** Test-promise ids (T-01…) the CURRENT design version names. */
  promisedTestIds(): string[] {
    return dedupe([...this.latestArchitectureSection().matchAll(/\bT-\d+\b/g)].map((m) => m[0]));
  }

  /** Concatenated text of the project's test files (bounded walk; build/vendor dirs skipped). */
  private testFilesText(): string {
    const SKIP = new Set(["node_modules", ".git", ".versus", "specs", "dist", "build", "out", ".next", "coverage",
      "DerivedData", "Pods", "vendor", ".venv", "venv", "target", ".gradle", ".idea", ".vscode"]);
    const TESTY = /(^|\/)(tests?|__tests__|spec|e2e|[\w-]*Tests?)(\/|$)|\.(test|spec)\.[\w]+$|_test\.[\w]+$|Tests?\.(swift|kt|java|cs)$/i;
    const chunks: string[] = [];
    let files = 0;
    const walk = (dir: string, rel: string) => {
      if (files > 5000) return;
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith(".") && e.name !== ".github") { if (e.isDirectory()) continue; }
        const r = rel ? `${rel}/${e.name}` : e.name;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(full, r); continue; }
        if (!e.isFile() || !TESTY.test(r)) continue;
        try {
          if (fs.statSync(full).size > 1_000_000) continue;
          chunks.push(fs.readFileSync(full, "utf-8"));
          files++;
        } catch { /* skip */ }
      }
    };
    walk(this.workspacePath, "");
    return chunks.join("\n");
  }

  /** 6→7: every test the current design promises (T-xx) must exist in a test file (Claude 0.19.0). */
  private testPromiseErrors(): string[] {
    const ids = this.promisedTestIds();
    if (!ids.length) return [];
    const text = this.testFilesText();
    const missing = ids.filter((id) => !new RegExp(`\\b${escapeRegExp(id)}\\b`).test(text));
    if (!missing.length) return [];
    return [
      `[Phase 6] promised tests: the current architecture version promises ${missing.join(", ")}, but no test file names ` +
      `${missing.length === 1 ? "it" : "them"}. Put the id in the test that implements the promise (its name or a comment), ` +
      `or, if the promise was dropped, say so in the architecture's Desvios section and remove the id. A promise that ` +
      `exists only in the design is not a test.`,
    ];
  }

  /** 6→7: the current design version records how the code deviated from it, or says "nenhum" (Claude 0.19.0). */
  private deviationsErrors(): string[] {
    const sec = this.latestArchitectureSection();
    if (!sec) return [];   // architecture.md absence is reported by its own gate
    const lines = sec.split(/\r?\n/);
    const h = lines.findIndex((l) => /^#{2,4}\s*(Desvios|Deviations)\b/i.test(l));
    const body: string[] = [];
    if (h >= 0) {
      for (let i = h + 1; i < lines.length && !/^#{1,4}\s/.test(lines[i]); i++) if (lines[i].trim()) body.push(lines[i]);
    }
    if (h >= 0 && body.length) return [];
    return [
      `[Phase 6] deviations: the current version of specs/technical/architecture.md has no ${h >= 0 ? "content under its" : ""} ` +
      `"## Desvios" section. Before leaving Phase 6, record every way the code departed from this design, one line each with ` +
      `the reason (a timing that changed, a mechanism replaced, a state removed), or write "nenhum". Design drift left out of ` +
      `the record makes the architecture lie to the next cycle.`,
    ];
  }

  /** 5→6: a Scope Inventory decision of the current pass of Phase 5 (Claude 0.19.0). */
  private scopeInventoryMissing(): string[] {
    const ok = this.decisionsSincePhaseEntry().some(
      (d) => d.phase === 5 && d.category.trim().toLowerCase() === "scope-inventory" && /[✅❌]/.test(d.content)
    );
    return ok ? [] : [
      `[Phase 5] scope inventory: no Scope Inventory on record for this pass of Phase 5. Run it (P1 modules present? ` +
      `specs/validation covered? UI runnable?) and record it: record_decision(phase=5, category='scope-inventory', ` +
      `content='<each item with ✅/❌>'). Displaying it in chat is not a record.`,
    ];
  }

  /** Lessons in specs/references/lessons.md: `##` sections (minus backlog/next-cycle) or top-level bullets. */
  lessons(): { title: string; guard: string | null }[] {
    let text = "";
    try { text = fs.readFileSync(path.join(this.specsPath, "references", "lessons.md"), "utf-8"); } catch { return []; }
    let lines = text.split(/\r?\n/);
    // A file that accumulates cycles ("# Ciclo 5 — …", "# Lessons — X (Cycle 2)") is scoped to
    // the CURRENT cycle's section, or to the last cycle section if none carries its number.
    // Lessons written before Claude 0.19.0 in earlier cycles are not asked for a guard line.
    const cycleHeads = lines
      .map((l, i) => { const m = /^#\s.*\b(?:ciclo|cycle)\s*(\d+)/i.exec(l); return m ? { i, n: parseInt(m[1], 10) } : null; })
      .filter((x): x is { i: number; n: number } => x !== null);
    if (cycleHeads.length) {
      const cur = this.currentCycle();
      const idx = cycleHeads.findIndex((c) => c.n === cur);
      const k = idx >= 0 ? idx : cycleHeads.length - 1;
      const start = cycleHeads[k].i;
      const nextH1 = lines.findIndex((l, i) => i > start && /^#\s/.test(l));
      lines = lines.slice(start + 1, nextH1 === -1 ? lines.length : nextH1);
    }
    // Word-initial: "dependências" is a lesson title, "Pendências" is not a lesson. Reference,
    // metric, debt and process-cost sections hold no project lessons either.
    const NOT_LESSON = /\bbacklog|\bpr[óo]ximo ciclo|\bnext cycle|\bv2(\.0)?\b|\bcarry|(^|[\s—–-])pend[eê]ncias?\b|\brefer[eê]ncias|\breferences\b|\bm[ée]tricas|\bmetrics\b|\bd[íi]vidas|\bdebts?\b|\bprocess cost|\bcusto do processo/i;
    const blocks: { title: string; body: string[] }[] = [];
    const ITEM = /^(?:[-*]|\d+[.)])\s+\S/;
    // Top-level list items of a run of lines, each with its indented continuation (and an
    // unindented `guard:` line right under it).
    const items = (ls: string[]): { title: string; body: string[] }[] => {
      const out: { title: string; body: string[] }[] = [];
      let cur: { title: string; body: string[] } | null = null;
      for (const l of ls) {
        if (ITEM.test(l)) { cur = { title: l.replace(/^(?:[-*]|\d+[.)])\s+/, "").trim(), body: [l] }; out.push(cur); }
        else if (cur && (/^\s+\S/.test(l) || /^guard:/i.test(l))) cur.body.push(l);
        else if (!l.trim()) continue;
        else cur = null;
      }
      return out;
    };
    const heads = lines.map((l, i) => (/^##\s+\S/.test(l) && !/^###/.test(l) ? i : -1)).filter((i) => i >= 0);
    if (heads.length) {
      heads.forEach((h, k) => {
        const end = k + 1 < heads.length ? heads[k + 1] : lines.length;
        const title = lines[h].replace(/^##\s+/, "").trim();
        if (NOT_LESSON.test(title)) return;
        const section = lines.slice(h + 1, end);
        // "## 1. …" / "## Lição 3 — …" is ONE lesson (its bullets are details). A category heading
        // ("## Domain", "## Stack") groups lessons: each top-level item is one.
        const numbered = /^(?:\d+[.)]|li[cç][ãa]o\s*\d+|lesson\s*\d+|L\d+\b)/i.test(title);
        const its = numbered ? [] : items(section);
        if (its.length) blocks.push(...its);
        else blocks.push({ title, body: lines.slice(h, end) });
      });
    } else {
      blocks.push(...items(lines));
    }
    return blocks.map((b) => {
      const m = /\bguard:\s*([^\s,;)]+)/i.exec(b.body.join("\n"));
      return { title: b.title, guard: m ? m[1] : null };
    });
  }

  // --- Cycles, approvals, fingerprints, version (Claude 0.18.0) ---

  /** The cycle in progress: closed cycles (7→0 boundaries) + 1. */
  currentCycle(): number {
    return (this.state?.history ?? []).filter((h) => h.from === 7 && h.to === 0).length + 1;
  }

  /** When the cycle in progress began: the last 7→0 boundary, or project creation. */
  cycleStartedAt(): string {
    const closes = (this.state?.history ?? []).filter((h) => h.from === 7 && h.to === 0);
    return closes.length ? closes[closes.length - 1].timestamp : (this.state?.createdAt ?? "");
  }

  /** Decisions recorded since the current phase was (last) entered. Ordered by the entry
   *  transition's decisionsAt when present (Claude 0.18.0+), by timestamp for older history. */
  private decisionsSincePhaseEntry(): Decision[] {
    const st = this.state!;
    const h = st.history;
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].to === st.currentPhase) {
        if (typeof h[i].decisionsAt === "number") return st.decisions.slice(h[i].decisionsAt);
        return st.decisions.filter((d) => d.timestamp >= h[i].timestamp);
      }
    }
    return st.decisions;
  }

  /** Message(s) when the current phase has no approval decision (approvedBy) since it was entered. */
  private approvalMissing(phase: number): string[] {
    if (!this.state) return [];
    const ok = this.decisionsSincePhaseEntry().some(
      (d) => d.phase === phase && !!d.approvedBy?.trim() && !!d.content?.trim()
    );
    if (ok) return [];
    const what =
      phase === 3 ? "the convergence decision (why this design version is ready to be verified)"
      : phase === 4 ? "the convergence confirmation (the Phase 4 verification report was PRESENTED and the user accepted it — before any code)"
      : phase === 6 ? "the test sign-off (what the user ran and saw, on which device/versions, and their verdict)"
      : "the cycle close (what the user reviewed and accepted)";
    return [
      `[Phase ${phase}] approval: no decision recording who approved ${what} in this phase. ` +
      `Call record_decision(phase=${phase}, category='approval', content='<what was presented and what the approver saw/said>', ` +
      `proposedBy='<who proposed>', approvedBy='<who approved, e.g. the user by name or role>'). ` +
      `A stamped criterion or a note in lessons.md is not a record of the approval.`,
    ];
  }

  /** sha256 + size of the design artifacts at this instant (empty when absent). */
  private designFingerprint(): { path: string; sha256: string; bytes: number }[] {
    const out: { path: string; sha256: string; bytes: number }[] = [];
    for (const rel of ["technical/architecture.md"]) {
      try {
        const full = path.join(this.specsPath, rel);
        if (!fs.existsSync(full)) continue;
        const buf = fs.readFileSync(full);
        out.push({ path: `specs/${rel}`, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length });
      } catch { /* ignore */ }
    }
    return out;
  }

  /** The cycle in progress, shaped like an archived record (closedAt empty). */
  private liveCycleRecord(): CycleRecord {
    const startedAt = this.cycleStartedAt();
    return {
      cycle: this.currentCycle(),
      startedAt,
      closedAt: "",
      phase0Score: this.state!.phase0Score,
      exitCriteria: this.state!.exitCriteria,
      transitions: this.state!.history.filter((h) => h.timestamp > startedAt),
      lastTestOutcome: this.state!.lastTestOutcome,
      decisionCount: this.state!.decisions.filter((d) => d.timestamp >= startedAt).length,
    };
  }

  /** Readable Markdown of one cycle: transitions, exit criteria with provenance, decisions. */
  renderCycleMarkdown(rec: CycleRecord): string {
    const st = this.state!;
    const name = (p: number) => getPhaseDefinition(p)?.name ?? `Phase ${p}`;
    const end = rec.closedAt || "\uffff";
    const decisions = st.decisions.filter((d) => d.timestamp >= rec.startedAt && d.timestamp <= end);
    const L: string[] = [];
    L.push(`# ${st.projectName} — Cycle ${rec.cycle}`);
    L.push("");
    L.push(
      `Exported by Versus ${VERSUS_VERSION} · started ${rec.startedAt || "?"} · ` +
      (rec.closedAt ? `closed ${rec.closedAt}` : `in progress (Phase ${st.currentPhase} — ${name(st.currentPhase)})`) +
      (rec.phase0Score !== null ? ` · Phase 0 score ${rec.phase0Score}/100` : "")
    );
    const closedBefore = rec.cycle - 1 - (st.cycles?.filter((c) => c.cycle < rec.cycle).length ?? 0);
    if (closedBefore > 0) {
      L.push("");
      L.push(`> ${closedBefore} earlier cycle(s) closed before this Versus archived cycles (0.13.0): their exit criteria were not kept; their transitions remain in state.json history.`);
    }
    L.push("");
    L.push("## Transitions");
    L.push("");
    if (!rec.transitions.length) L.push("_None yet._");
    else {
      L.push("| from → to | at | criteria met | design fingerprint |");
      L.push("|---|---|---|---|");
      for (const t of rec.transitions) {
        const fp = (t.artifacts ?? []).map((a) => `${a.path} ${a.sha256.slice(0, 12)} (${a.bytes} B)`).join("; ") || "—";
        L.push(`| ${t.from} → ${t.to} | ${t.timestamp} | ${t.criteriaMet.join(", ") || "—"} | ${fp} |`);
      }
    }
    L.push("");
    L.push("## Exit criteria");
    for (let p = 0; p <= 7; p++) {
      const cs = rec.exitCriteria.filter((c) => c.phase === p);
      if (!cs.length) continue;
      L.push("");
      L.push(`### Phase ${p} — ${name(p)}`);
      L.push("");
      for (const c of cs) {
        L.push(`- [${c.met ? "x" : " "}] **${c.criterion}**${c.details ? ` — ${c.details}` : ""}`);
        if (c.verifiedBy) {
          const v = c.verifiedBy;
          L.push(`  - verified by engine: ${v.path}, ${v.nominal ? "nominal" : "DEGRADED path"}, ${v.at}${v.note ? ` — ${v.note}` : ""}`);
        }
      }
    }
    L.push("");
    L.push(`## Decisions (${decisions.length})`);
    for (let p = 0; p <= 7; p++) {
      const ds = decisions.filter((d) => d.phase === p);
      if (!ds.length) continue;
      L.push("");
      L.push(`### Phase ${p} — ${name(p)}`);
      for (const d of ds) {
        const who = [d.proposedBy ? `proposed by ${d.proposedBy}` : "", d.approvedBy ? `approved by ${d.approvedBy}` : ""]
          .filter(Boolean).join(" · ");
        L.push("");
        L.push(`- **[${d.category}]** ${d.timestamp}${who ? ` · ${who}` : ""}`);
        L.push("");
        for (const line of d.content.split("\n")) L.push(`  ${line}`);
      }
    }
    const t = rec.lastTestOutcome;
    if (t) {
      L.push("");
      L.push("## Last witnessed test run");
      L.push("");
      L.push(`- outcome: **${t.outcome}** (Phase ${t.phase}, ${t.at})`);
      if (t.command) L.push(`- command: \`${t.command.replace(/\n/g, " ⏎ ").slice(0, 400)}\``);
      if (typeof t.exitCode === "number") L.push(`- exit status: ${t.exitCode} (from ${t.exitSource ?? "?"})`);
      if (t.runDir) L.push(`- ran in: ${t.runDir}${t.outsideWorkspace ? " — OUTSIDE the project" : ""}`);
      if (t.outputSha256) L.push(`- output: ${t.outputBytes ?? "?"} B, sha256 ${t.outputSha256}`);
    }
    L.push("");
    return L.join("\n");
  }

  /** Writes a cycle export to .versus/cycles/cycle-N.md; returns the workspace-relative path. */
  private writeCycleExport(md: string, cycle: number, suffix = ""): string {
    const rel = path.join(".versus", "cycles", `cycle-${cycle}${suffix}.md`);
    const full = path.join(this.workspacePath, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, md, "utf-8");
    return rel.replace(/\\/g, "/");
  }

  /** export_cycle: an archived cycle by number, or the cycle in progress (default). */
  exportCycle(cycle?: number, final = false): Result<{ path: string; bytes: number; cycle: number; inProgress: boolean }, string> {
    if (!this.state) return { ok: false, error: "Project not initialized." };
    const cur = this.currentCycle();
    const target = cycle ?? cur;
    let rec: CycleRecord | undefined;
    if (target === cur) rec = this.liveCycleRecord();
    else rec = this.state.cycles?.find((c) => c.cycle === target);
    if (!rec) {
      return {
        ok: false,
        error: target > cur || target < 1
          ? `No cycle ${target}: the project is in cycle ${cur}.`
          : `Cycle ${target} closed before this Versus archived cycles (0.13.0) — its exit criteria were not kept. ` +
            `Archived: ${(this.state.cycles ?? []).map((c) => c.cycle).join(", ") || "none"}.`,
      };
    }
    const md = this.renderCycleMarkdown(rec);
    const inProgress = target === cur && !final;
    const p = this.writeCycleExport(md, target, inProgress ? "-in-progress" : "");
    return { ok: true, value: { path: p, bytes: Buffer.byteLength(md, "utf-8"), cycle: target, inProgress } };
  }

  /**
   * One-time update notice (Claude 0.18.0). When the project was last opened by another Versus
   * version, returns what the running version requires from here on that the project
   * lacks — and records the migration. Does NOT create content: an empty lessons.md would
   * pass an existence gate while saying nothing, which is worse than the gate firing.
   */
  noteVersion(): { from: string | null; to: string; pending: string[] } | null {
    if (!this.state) return null;
    const from = this.state.versusVersion ?? null;
    if (from === VERSUS_VERSION) return null;
    const pending: string[] = [];
    const cur = this.state.currentPhase;
    for (let p = cur; p <= 7; p++) {
      for (const def of getExitCriteriaForPhase(p)) {
        if (def.required && def.artifact && !this.artifactPresent(def.artifact)) {
          pending.push(`specs/${def.artifact} — required by ${def.criterion} (Phase ${p}); missing or empty`);
        }
      }
    }
    if (cur <= 6 && this.criticalCoverageErrors().length > 0 && !this.artifactPresent("validation/critical-coverage.md")) {
      pending.push("specs/validation/critical-coverage.md — required at 6→7 (the matrix has 🔴 findings)");
    }
    // In this build every gate below arrived together in 0.13.0 (the port of Versus Claude
    // Claude 0.18.0–0.19.0), and versusVersion is stamped from 0.13.0 on: null = a project last opened
    // by an older Versus Qwen, which lacks all of them.
    if (from === null) {
      if (cur <= 5) pending.push("5→6 now needs record_decision(phase=5, category='scope-inventory', content='<items with ✅/❌>')");
      if (cur <= 6) pending.push("6→7 now needs a '## Desvios' section in the current architecture version, and every promised test id (T-xx) present in a test file");
      const unguarded = this.lessons().filter((l) => !l.guard).length;
      if (unguarded) pending.push(`specs/references/lessons.md — ${unguarded} lesson(s) without 'guard: <test id>' or 'guard: none' (required to close the cycle)`);
      pending.push(
        "approval decisions — 3→4, 4→5, 6→7 and the cycle close now require record_decision(..., category='approval', approvedBy='<who>') in that phase"
      );
    }
    this.state.versusVersion = VERSUS_VERSION;
    if (!this.state.migrations) this.state.migrations = [];
    const at = new Date().toISOString();
    this.state.migrations.push({ from, to: VERSUS_VERSION, at, pending });
    this.save();
    return { from, to: VERSUS_VERSION, pending };
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Dedup projectSpec entries by their string value, preserving the first (and its timestamp). */
function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

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
