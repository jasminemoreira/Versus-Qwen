// Versus core types

import { VERSUS_VERSION } from "../version";

export interface PhaseState {
  agent?: "copilot" | "claude" | "qwen";  // identifies which extension owns this state
  projectName: string;
  projectDescription: string;
  projectSpec: ProjectSpec;      // structured technical context
  currentPhase: number;          // 0-7
  currentIteration: number;      // within the phase
  phase0Score: number | null;    // 0-100
  phase0Breakdown: ScoreBreakdown | null;
  decisions: Decision[];
  exitCriteria: ExitCriterionState[];
  safeguards: SafeguardState[];
  loopCounter: LoopCounter;
  /** Last test run the test-outcome hook witnessed. Gates tests_passing (S4).
   *  "unknown" records an unclassifiable run so a stale "fail" cannot freeze. */
  lastTestOutcome?: {
    outcome: "pass" | "fail" | "unknown";
    phase: number;
    at: string;
    command?: string;
    source?: "harness" | "manual" | "unknown";
    toolUseId?: string;
    sessionId?: string;
    outputSha256?: string;
    outputBytes?: number;
    exitCode?: number;
    exitSource?: "harness" | "echo";
    cwd?: string;
    runDir?: string;
    outsideWorkspace?: boolean;
  };
  /** Phase 2 lens declarations — one entry per critique iteration (2↔3 loop). */
  activatedLenses?: LensActivation[];
  /** Schema version stamped at init. Its ABSENCE marks a pre-structured-lenses
   *  project, the only case where free-text lens declarations are still honoured. */
  stateVersion?: number;
  /** Versus version that last opened this project (0.12.x+ of this build). Absent = a project
   *  last opened by an older Versus. A mismatch with the running version triggers a one-time
   *  update notice listing what the new version requires that the project lacks. */
  versusVersion?: string;
  /** Update notices issued — the migration record the auditor can read. */
  migrations?: { from: string | null; to: string; at: string; pending: string[] }[];
  /** Closed cycles, archived by start_new_cycle BEFORE the reset. Exit criteria (with
   *  details and provenance), transitions and the test outcome of a cycle used to be wiped
   *  when the next one began — the record lost its own history. Decisions are not copied
   *  (they are preserved in `decisions` already); a cycle's decisions are those
   *  timestamped within [startedAt, closedAt]. */
  cycles?: CycleRecord[];
  lastPhaseStateCheck?: string;  // ISO timestamp — gateway guard for smaller models
  createdAt: string;             // ISO timestamp
  updatedAt: string;
  history: PhaseTransition[];    // transition log
}

/** Provenance for a witnessed test run (I.5) — does not prevent forgery, makes a
 *  workaround legible in a post-mortem. */
export interface TestProvenance {
  source?: "harness" | "manual" | "unknown";
  toolUseId?: string;
  sessionId?: string;
  outputSha256?: string;
  outputBytes?: number;
  exitCode?: number;
  exitSource?: "harness" | "echo";
  /** Session cwd the harness reported for the shell call. */
  cwd?: string;
  /** Directory the test runner actually ran in, after any `cd` in the command. */
  runDir?: string;
  /** True when the run happened outside the project (runDir outside the workspace, or a
   *  test script invoked by a path outside it). Such a pass does not satisfy
   *  tests_passing: an audit found a "24/24" that ran from the scratchpad. */
  outsideWorkspace?: boolean;
}

/** Structured Phase 2 lens activation — one per critique iteration. */
export interface LensActivation {
  universal: string[];                                  // the 7, always
  conditional: string[];                                // the subset activated this iteration
  notActivated: { lens: string; reason: string }[];     // the rest, each with a reason
  iteration: number;                                    // critique iteration (1 = first Phase 2 pass)
  againstVersion: number;                               // architecture version it was decided against
  recordedAt: string;                                   // ISO timestamp
}

/**
 * A projectSpec entry. Either a plain string (legacy projects) or a timestamped
 * record capturing WHEN the entry was added and in which phase — so a later
 * analysis can ask "which entries existed when Phase 2 declared lenses in
 * iteration N?". Readers must accept both forms.
 */
export type SpecEntry = string | { value: string; phase?: number; at: string };

/** Extracts the string value of a SpecEntry regardless of form. */
export function specEntryValue(e: SpecEntry): string {
  return typeof e === "string" ? e : e.value;
}

/** Structured technical context — survives model switches */
export interface ProjectSpec {
  stack: SpecEntry[];            // approved technologies (e.g., "TypeScript", "Node 18+")
  outOfScope: SpecEntry[];       // explicitly excluded (e.g., "Local models")
  patterns: SpecEntry[];         // architectural patterns (e.g., "MCP server standalone")
  constraints: SpecEntry[];      // hard constraints (e.g., "Qwen-only, no Claude Code artifacts")
}

/**
 * S6 loop detection. `count` is consecutive test FAILURES with no diagnosis
 * recorded between them — not test executions. A passing run, a recorded
 * diagnosis, or a phase change all clear it. Debugging with a named cause per
 * round is the normal cycle; failing repeatedly without naming a cause is the
 * blind loop S6 exists to stop.
 */
export interface LoopCounter {
  pattern: string;             // normalized command pattern of the failing runs
  count: number;               // consecutive undiagnosed failures
  firstSeen: string;           // ISO timestamp
  lastSeen: string;
  lastDiagnosis?: string;      // ISO timestamp of the diagnosis that last cleared the counter
}

export interface ScoreBreakdown {
  clarezaProblema: number;       // weight 10
  casosDeUso: number;            // weight 15
  vocabulario: number;           // weight 10
  ambiguidades: number;          // weight 15
  foraDeEscopo: number;          // weight 10
  criteriosSucesso: number;      // weight 10
  premissas: number;             // weight 10
  documentacao: number;          // weight 5
  usuarioConfirmou: number;      // weight 10
  iaConfiante: number;           // weight 5
}

export interface Decision {
  id: string;
  phase: number;
  category: string;
  content: string;
  timestamp: string;
  /** Cycle the decision was recorded in (Claude 0.18.0+; older decisions: derive from timestamps). */
  cycle?: number;
  /** Who proposed it — e.g. "Qwen" (the agent), "user". Explicit provenance (0.13.0+). */
  proposedBy?: string;
  /** Who approved it, and on what basis when it matters — e.g. "user (saw the demo on device)".
   *  Required on the approval decision that gates 3→4, 4→5, 6→7 and the cycle close. */
  approvedBy?: string;
}

/** One closed cycle, as archived by start_new_cycle. */
export interface CycleRecord {
  cycle: number;
  startedAt: string;
  closedAt: string;
  phase0Score: number | null;
  exitCriteria: ExitCriterionState[];
  transitions: PhaseTransition[];
  lastTestOutcome?: PhaseState["lastTestOutcome"];
  decisionCount: number;
  /** Path (relative to the workspace) of the Markdown export written at close. */
  exportPath?: string;
}

export interface ExitCriterionState {
  phase: number;
  criterion: string;
  met: boolean;
  details?: string;
  /** Engine-authored provenance for a `verify:`-gated criterion (II): HOW the gate was
   *  satisfied and whether the path was nominal. Written by the engine when the
   *  transition passes — not self-reported — so a post-mortem sees a degraded path
   *  (hook not nominal, legacy fallback) even if the agent logged nothing. Only the two
   *  verify-criteria carry it. */
  /** A mechanical check DECLARED for this criterion, e.g. "OAuth gone from all 4 services"
   *  → `grep -rl oauth services/ | wc -l` expecting output "0". The gate requires that the hook
   *  WITNESSED that command run, after the declaration, with the expected result. An audit
   *  found exactly such a criterion attested ("grep = 0") and never executed. */
  check?: {
    command: string;
    /** "exit:<n>" (exit status via harness or the VERSUS_EXIT echo) or "output:<regex>". */
    expect: string;
    declaredAt: string;
    witnessed?: { at: string; ok: boolean; exitCode?: number; outputTail: string; outputSha256: string };
  };
  verifiedBy?: {
    path: "test-pass" | "lenses-recorded";
    nominal: boolean;                 // false = satisfied via a degraded path
    at: string;
    note?: string;
    snapshot?: Record<string, unknown>;
  };
}

export interface SafeguardState {
  id: string;                  // "S0" to "S7"
  status: "ok" | "warning" | "violated";
  details?: string;
  lastChecked?: string;
}

export interface SpecsStatus {
  [directory: string]: {
    populated: boolean;
    fileCount: number;
  };
}

export interface PhaseTransition {
  from: number;
  to: number;
  timestamp: string;
  criteriaMet: string[];
  /** Content fingerprint of design artifacts at the moment of the transition (Claude 0.18.0+):
   *  evidence, independent of git, that the design existed — in that exact content —
   *  before the code that follows it. */
  artifacts?: { path: string; sha256: string; bytes: number }[];
  /** decisions.length at the moment of the transition (Claude 0.18.0+): orders decisions against
   *  transitions without trusting clock resolution (two events in one millisecond). */
  decisionsAt?: number;
}

export interface TransitionError {
  message: string;
  missingCriteria: string[];
  safeguardViolations?: string[];  // a violated safeguard vetoes the transition — say which
  specsWarnings?: string[];
}

export interface IterationInfo {
  phase: number;
  iterationNumber: number;
  previousSummary?: string;
}

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function createDefaultState(name: string, description: string): PhaseState {
  return {
    agent: "qwen",
    versusVersion: VERSUS_VERSION,
    projectName: name,
    projectDescription: description,
    projectSpec: { stack: [], outOfScope: [], patterns: [], constraints: [] },
    currentPhase: 0,
    currentIteration: 1,
    phase0Score: null,
    phase0Breakdown: null,
    decisions: [],
    exitCriteria: [],
    safeguards: [
      { id: "S0", status: "ok" },
      { id: "S1", status: "ok" },
      { id: "S2", status: "ok" },
      { id: "S3", status: "ok" },
      { id: "S4", status: "ok" },
      { id: "S5", status: "ok" },
      { id: "S6", status: "ok" },
      { id: "S7", status: "ok" },
    ],
    loopCounter: { pattern: "", count: 0, firstSeen: "", lastSeen: "" },
    activatedLenses: [],
    stateVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  };
}
