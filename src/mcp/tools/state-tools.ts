// MCP Tools: state queries

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../../state/engine";
import { validateSafeguard } from "../../rules/safeguards";
import { specEntryValue } from "../../state/types";

// get_phase_state is the gateway guard the model is told to call first, so a result too big
// to inline would leave it operating blind. The ~5.7 KB inline threshold that set these
// budgets was measured on the VS Code chat host (the LocalQwen build); Qwen Code inlines a
// tool result up to 25,000 chars (truncateToolOutputThreshold). The budgets stay: a lean
// snapshot costs nothing, and full decisions are one get_decisions() away.
const SPEC_PER_LIST = 6;
const DECISION_MAXLEN = 200;
const DECISION_BUDGET = 2200;
const DECISIONS_TOOL_BUDGET = 5000;

/** projectSpec for the read tools: VALUES only (drop the {value,phase,at} stamp — it
 *  is analysis metadata the model never reads), newest N per list kept INDEPENDENTLY
 *  (a 200-entry stack must not evict constraints), older ones dropped whole and counted.
 *  Entries are never truncated (each is a distinct commitment). */
function budgetSpec(spec: unknown): { spec: { stack: string[]; outOfScope: string[]; patterns: string[]; constraints: string[] }; omitted: number } {
  const s = (spec ?? {}) as Record<string, unknown[]>;
  const out = { stack: [] as string[], outOfScope: [] as string[], patterns: [] as string[], constraints: [] as string[] };
  let omitted = 0;
  for (const k of ["stack", "outOfScope", "patterns", "constraints"] as const) {
    const v = ((s[k] ?? []) as unknown[]).map((e) => specEntryValue(e as never));
    if (v.length > SPEC_PER_LIST) { omitted += v.length - SPEC_PER_LIST; out[k] = v.slice(-SPEC_PER_LIST); } else out[k] = v;
  }
  return { spec: out, omitted };
}

/** recentDecisions for get_phase_state: shorten content before dropping a decision
 *  whole, up to a budget, newest first. */
function budgetDecisions(decisions: { phase: number; category: string; content: string }[]): { shown: { phase: number; category: string; content: string }[]; shownCount: number; trimmed: boolean } {
  const shown: { phase: number; category: string; content: string }[] = [];
  let used = 0; let trimmed = false;
  for (let i = decisions.length - 1; i >= 0; i--) {
    const d = decisions[i];
    let content = d.content;
    if (content.length > DECISION_MAXLEN) { content = content.slice(0, DECISION_MAXLEN).trimEnd() + "…"; trimmed = true; }
    const e = { phase: d.phase, category: d.category, content };
    const c = JSON.stringify(e).length;
    if (used + c > DECISION_BUDGET && shown.length > 0) break;
    shown.push(e); used += c;
  }
  shown.reverse();
  return { shown, shownCount: shown.length, trimmed };
}

/** Caps a heredoc-y command string for transport. */
function capCommand(cmd?: string): string | undefined {
  if (cmd === undefined) return cmd;
  return cmd.length > DECISION_MAXLEN ? cmd.slice(0, DECISION_MAXLEN).trimEnd() + "…" : cmd;
}

export const getPhaseStateTool: Tool = {
  name: "get_phase_state",
  description:
    "MUST be called at the start of each interaction. Returns the current phase, iteration, score, " +
    "decisions, and safeguards of the Iterative Convergence methodology. " +
    "Without calling this tool, you don't know which phase you're in or what to do.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export const getDecisionsTool: Tool = {
  name: "get_decisions",
  description:
    "Queries decisions made in any phase of the methodology. " +
    "Use to retrieve previous decisions before making new ones.",
  inputSchema: {
    type: "object" as const,
    properties: {
      phase: {
        type: "number",
        description: "Phase number (0-7). If omitted, returns all decisions.",
      },
    },
    required: [],
  },
};

export const getExitCriteriaTool: Tool = {
  name: "get_exit_criteria",
  description:
    "Returns the exit criteria of a phase with status (met/pending). " +
    "Use to find out what's missing before attempting to advance phase.",
  inputSchema: {
    type: "object" as const,
    properties: {
      phase: {
        type: "number",
        description: "Phase number (0-7).",
      },
    },
    required: ["phase"],
  },
};

export function handleGetPhaseState(engine: StateEngine): string {
  const state = engine.getPhaseState();
  if (!state) {
    return JSON.stringify({
      error: "Project not initialized. Call init_project first.",
    });
  }
  // Mark that the model loaded context (gateway guard)
  engine.touchPhaseStateCheck();

  // Budget the three fields that grow without bound in a long project (measured: a
  // real state.json produced 50 KB here — projectSpec 39 KB, recentDecisions 11 KB).
  const { spec: specBudgeted, omitted: specOmitted } = budgetSpec(state.projectSpec);
  const { shown: recentDecisions, shownCount, trimmed } = budgetDecisions(state.decisions);
  const lastTest = state.lastTestOutcome
    ? { ...state.lastTestOutcome, command: capCommand(state.lastTestOutcome.command) }
    : null;

  // Detect Phase 7 completion → hint to offer new cycle
  let phase7Hint: string | undefined;
  if (state.currentPhase === 7) {
    const p7Criteria = state.exitCriteria.filter((c) => c.phase === 7);
    const allMet = p7Criteria.length > 0 && p7Criteria.every((c) => c.met);
    if (allMet) {
      phase7Hint = "ACTION REQUIRED: Phase 7 exit criteria are ALL met. You MUST offer the user a new development cycle via AskUserQuestion: Option 1 'Start next cycle' (calls start_new_cycle()) / Option 2 'Project complete'. Do NOT skip this step.";
    }
  }

  // Detect "ready to advance" state for any phase < 7 — all criteria met but phase not advanced
  let readyToAdvanceHint: string | undefined;
  if (state.currentPhase < 7) {
    const phaseCriteria = engine.getExitCriteriaWithDefs(state.currentPhase);
    const allMet = phaseCriteria.length > 0 && phaseCriteria.every((c) => c.met);
    if (allMet) {
      readyToAdvanceHint = `⚠️ READY TO ADVANCE — Phase ${state.currentPhase} exit criteria are ALL met but currentPhase is still ${state.currentPhase}. Your VERY NEXT tool call MUST be advance_phase(target_phase=${state.currentPhase + 1}) followed by get_phase_guidance(). Do NOT write summary text. Do NOT wait for user input. Continue work into Phase ${state.currentPhase + 1} in the same turn.`;
    }
  }

  const result: Record<string, any> = {
    projectName: state.projectName,
    projectDescription: state.projectDescription,
    projectSpec: specBudgeted,
    currentPhase: state.currentPhase,
    currentIteration: state.currentIteration,
    currentCycle: engine.currentCycle(),
    archivedCycles: (state.cycles ?? []).map((c) => c.cycle),
    phase0Score: state.phase0Score,
    decisionsCount: state.decisions.length,
    recentDecisions,
    safeguards: state.safeguards.map((s) => ({ id: s.id, status: validateSafeguard(s.id, state).status })),
    lastTestOutcome: lastTest,
    updatedAt: state.updatedAt,
  };

  if (specOmitted > 0) {
    result._specNote = `${specOmitted} older projectSpec entr${specOmitted === 1 ? "y" : "ies"} omitted (newest ${SPEC_PER_LIST}/list shown). The per-message context also lists the spec (shortened past 600 chars per list).`;
  }
  if (state.decisions.length > shownCount || trimmed) {
    result._decisionsNote = `Showing ${shownCount} of ${state.decisions.length} decisions (newest first, content capped at ${DECISION_MAXLEN}). Use get_decisions(phase?) for more.`;
  }
  if (phase7Hint) {
    result._phase7Action = phase7Hint;
  }
  if (readyToAdvanceHint) {
    result._nextAction = readyToAdvanceHint;
  }

  return JSON.stringify(result);
}

export function handleGetDecisions(engine: StateEngine, args: { phase?: number }): string {
  const all = engine.getDecisions(args.phase);
  // Budget for the host disk-spill limit: newest first up to DECISIONS_TOOL_BUDGET.
  // (A full dump measured 601 KB — pointing get_phase_state here would just move the
  // spill.) A single decision larger than the whole budget is truncated, not spilled.
  const shown: unknown[] = [];
  let used = 0; let truncatedOne = false;
  for (let i = all.length - 1; i >= 0; i--) {
    let d: typeof all[number] = all[i];
    let cost = JSON.stringify(d).length;
    if (shown.length === 0 && cost > DECISIONS_TOOL_BUDGET) {
      const keep = Math.max(0, DECISIONS_TOOL_BUDGET - (cost - d.content.length));
      d = { ...d, content: d.content.slice(0, keep).trimEnd() + `… [truncated; ${d.content.length} chars — narrow by phase]` };
      cost = JSON.stringify(d).length; truncatedOne = true;
    }
    if (used + cost > DECISIONS_TOOL_BUDGET && shown.length > 0) break;
    shown.push(d); used += cost;
  }
  shown.reverse();
  const result: Record<string, unknown> = { count: all.length, shown: shown.length, decisions: shown };
  if (all.length > shown.length || truncatedOne) {
    result._note = `newest ${shown.length} of ${all.length}${args.phase === undefined ? " — narrow by phase to see more" : ""}`;
  }
  return JSON.stringify(result);
}

export function handleGetExitCriteria(engine: StateEngine, args: { phase: number }): string {
  const criteria = engine.getExitCriteriaWithDefs(args.phase);
  const met = criteria.filter((c) => c.met).length;
  const total = criteria.length;
  return JSON.stringify({ phase: args.phase, met, total, criteria });
}

export const updateProjectSpecTool: Tool = {
  name: "update_project_spec",
  description:
    "Updates the project's structured technical context (stack, out-of-scope, patterns, constraints). " +
    "Use to register technical decisions in a structured way. " +
    "Items are added (merged), never overwritten. Duplicates are ignored.",
  inputSchema: {
    type: "object" as const,
    properties: {
      stack: {
        type: "array",
        items: { type: "string" },
        description: "Approved technologies for the project (e.g., ['TypeScript', 'Node 18+', 'MCP SDK']).",
      },
      outOfScope: {
        type: "array",
        items: { type: "string" },
        description: "Items explicitly excluded from scope (e.g., ['Local models', 'Web UI']).",
      },
      patterns: {
        type: "array",
        items: { type: "string" },
        description: "Architectural patterns to follow (e.g., ['MCP server standalone', 'shared state.json']).",
      },
      constraints: {
        type: "array",
        items: { type: "string" },
        description: "Hard constraints of the project (e.g., ['Copilot-only', 'No external dependencies']).",
      },
    },
    required: [],
  },
};

export function handleUpdateProjectSpec(
  engine: StateEngine,
  args: { stack?: string[]; outOfScope?: string[]; patterns?: string[]; constraints?: string[] }
): string {
  // Snapshot by value: Qwen's getProjectSpec returns the live state object, which the update mutates.
  const live = engine.getProjectSpec();
  const before = {
    stack: [...live.stack], outOfScope: [...live.outOfScope], patterns: [...live.patterns], constraints: [...live.constraints],
  };
  engine.updateProjectSpec(args);
  const after = engine.getProjectSpec();
  // Return what CHANGED plus counts, not the whole spec. The spec only grows: on the Claude
  // build a real project got a 40,764-char result, past this host's 25,000-char inline cap.
  // The caller already knows what it sent. (Qwen's getProjectSpec keeps stamped entries;
  // compare by value.)
  const keys = ["stack", "outOfScope", "patterns", "constraints"] as const;
  const added: Record<string, string[]> = {};
  const counts: Record<string, number> = {};
  for (const k of keys) {
    const had = new Set(before[k].map(specEntryValue));
    const n = after[k].map(specEntryValue).filter((v) => !had.has(v));
    if (n.length) added[k] = n;
    counts[k] = after[k].length;
  }
  return JSON.stringify({
    success: true,
    added,
    counts,
    message:
      "Project spec updated. Values already present were kept, not duplicated. get_phase_state shows the newest " +
      "entries per list, and the per-message context lists the spec.",
  });
}
