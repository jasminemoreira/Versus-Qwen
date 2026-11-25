// MCP Tools: recording decisions, scores, and exit criteria

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine, DIAGNOSIS_CATEGORIES } from "../../state/engine";
import { ScoreBreakdown } from "../../state/types";
import { CONDITIONAL_LENSES } from "../../rules/lenses";

export const recordDecisionTool: Tool = {
  name: "record_decision",
  description:
    "Records a decision made during any phase. Decisions persist between sessions " +
    "and can be queried with get_decisions. Use to avoid losing architectural, " +
    "scope, pattern, and other decisions. " +
    "In P5-P6, category='diagnosis' also clears the S6 loop counter: it is how you " +
    "state the root cause of a failing test before re-running. Debugging with a named " +
    "cause per round is the normal cycle and is never blocked.",
  inputSchema: {
    type: "object" as const,
    properties: {
      phase: {
        type: "number",
        description: "Phase in which the decision was made (0-7).",
      },
      category: {
        type: "string",
        description:
          "Category: 'architecture', 'pattern', 'constraint', 'scope', 'technology', 'requirement', 'testing', " +
          "'process' (methodology/session decisions, e.g. an LLM switch or session renewal), " +
          "'diagnosis' (root cause of a test failure — clears the S6 loop counter; 'bugfix' and 'root-cause' are aliases).",
      },
      content: {
        type: "string",
        description: "Decision content in free text.",
      },
    },
    required: ["phase", "category", "content"],
  },
};

export const updateScoreTool: Tool = {
  name: "update_score",
  description:
    "Updates the Phase 0 convergence score (0-100) with per-criterion breakdown. " +
    "Score >= 90 is required to advance to Phase 1.",
  inputSchema: {
    type: "object" as const,
    properties: {
      score: {
        type: "number",
        description: "Total score (0-100).",
      },
      breakdown: {
        type: "object",
        description: "Per-criterion breakdown.",
        properties: {
          clarezaProblema: { type: "number", description: "Weight 10" },
          casosDeUso: { type: "number", description: "Weight 15" },
          vocabulario: { type: "number", description: "Weight 10" },
          ambiguidades: { type: "number", description: "Weight 15" },
          foraDeEscopo: { type: "number", description: "Weight 10" },
          criteriosSucesso: { type: "number", description: "Weight 10" },
          premissas: { type: "number", description: "Weight 10" },
          documentacao: { type: "number", description: "Weight 5" },
          usuarioConfirmou: { type: "number", description: "Weight 10" },
          iaConfiante: { type: "number", description: "Weight 5" },
        },
      },
    },
    required: ["score", "breakdown"],
  },
};

export const markExitCriterionTool: Tool = {
  name: "mark_exit_criterion",
  description:
    "Marks an exit criterion as met or pending. Use get_exit_criteria to see " +
    "the available criteria and their IDs.",
  inputSchema: {
    type: "object" as const,
    properties: {
      phase: {
        type: "number",
        description: "Phase (0-7).",
      },
      criterion: {
        type: "string",
        description: "Criterion ID (e.g., 'score_90', 'user_confirmed', 'tech_feasibility').",
      },
      met: {
        type: "boolean",
        description: "true if met, false if pending.",
      },
      details: {
        type: "string",
        description: "Optional details about how it was met.",
      },
    },
    required: ["phase", "criterion", "met"],
  },
};

export function handleRecordDecision(
  engine: StateEngine,
  args: { phase: number; category: string; content: string }
): string {
  try {
    const decision = engine.recordDecision(args.phase, args.category, args.content);
    const result: Record<string, any> = {
      success: true,
      id: decision.id,
      timestamp: decision.timestamp,
    };

    if (DIAGNOSIS_CATEGORIES.includes(args.category.trim().toLowerCase())) {
      result._s6 = "Diagnosis recorded — S6 loop counter cleared. The next test run will go through.";
    }

    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ success: false, error: String(err) });
  }
}

export function handleUpdateScore(
  engine: StateEngine,
  args: { score: number; breakdown: ScoreBreakdown }
): string {
  try {
    engine.updateScore(args.score, args.breakdown);
    return JSON.stringify({
      success: true,
      score: args.score,
      meetsThreshold: args.score >= 90,
    });
  } catch (err) {
    return JSON.stringify({ success: false, error: String(err) });
  }
}

export function handleMarkExitCriterion(
  engine: StateEngine,
  args: { phase: number; criterion: string; met: boolean; details?: string }
): string {
  try {
    // Only the CURRENT phase's criteria can be marked. advance_phase reads only those, so a
    // past phase's mark is inert — and a FUTURE phase's mark is pre-stamping: the ESJUD study's
    // G2/G3 gates landed in the same second because Phase 3 was done (and its criteria marked)
    // while Versus still said Phase 2. The engine method stays unrestricted (tests drive it).
    const current = engine.getPhaseState()?.currentPhase;
    if (typeof current === "number" && args.phase !== current) {
      return JSON.stringify({
        success: false,
        error:
          `Cannot mark a Phase ${args.phase} criterion: the current phase is ${current}. ` +
          (args.phase > current
            ? `Criteria are marked in the phase they belong to — finish Phase ${current}, advance_phase(target_phase=${current + 1}), then mark.`
            : `Phase ${args.phase} is already closed; only Phase ${current} criteria gate the next transition.`),
        currentPhase: current,
      });
    }
    engine.markExitCriterion(args.phase, args.criterion, args.met, args.details);
    const criteria = engine.getExitCriteriaWithDefs(args.phase);
    const metCount = criteria.filter((c) => c.met).length;
    const allMet = metCount === criteria.length;

    const result: Record<string, any> = {
      success: true,
      phase: args.phase,
      criterion: args.criterion,
      met: args.met,
      totalMet: metCount,
      totalCriteria: criteria.length,
    };

    // When all criteria for any phase < 7 become met, force next action: advance_phase
    if (allMet && args.phase < 7 && args.met) {
      const state = engine.getPhaseState();
      if (state && state.currentPhase === args.phase) {
        result._nextAction = `⚠️ ALL Phase ${args.phase} exit criteria are now met. Your VERY NEXT tool call MUST be advance_phase(target_phase=${args.phase + 1}) — no summary text, no closing prose. Then follow the \"## Phase ${args.phase + 1}\" section of the methodology already injected in your context and continue work in the same turn.`;
      }
    }

    // When all Phase 7 criteria are met, hint to offer new cycle
    if (args.phase === 7 && allMet) {
      result._phase7Action = "ALL Phase 7 exit criteria are now met. You MUST offer the user a new development cycle via AskUserQuestion: Option 1 'Start next cycle' (calls start_new_cycle()) / Option 2 'Project complete'. Do NOT skip this step.";
    }

    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ success: false, error: String(err) });
  }
}

export const recordActivatedLensesTool: Tool = {
  name: "record_activated_lenses",
  description:
    "Phase 2, STEP 1 — records which conditional lenses this project activates, and why each " +
    "of the others does not. Replaces recording the same thing as free-text prose: names are " +
    "validated against the canonical 12, so an abbreviation or a translation is rejected at the " +
    "call instead of silently poisoning a later cross-project analysis. " +
    "All 12 conditional lenses must be accounted for — activated, or not-activated WITH a reason. " +
    "Leaving one out is refused: 'I did not activate it' and 'I forgot it' must not look the same. " +
    "The 7 universal lenses are always active and are not passed here. " +
    "The engine stamps the record with the current critique iteration (the same N you write in the " +
    "matrix's `## Iteração N` header) — call it again after each 2↔3 loop-back to re-declare against " +
    "the new architecture; a fresh call within the same round corrects that round's record.",
  inputSchema: {
    type: "object" as const,
    properties: {
      conditional: {
        type: "array",
        description: "Conditional lenses ACTIVATED for this project (exact canonical names).",
        items: { type: "string", enum: [...CONDITIONAL_LENSES] },
      },
      notActivated: {
        type: "array",
        description:
          "Every conditional lens NOT activated, each with the reason. Together with " +
          "`conditional` this must cover all 12.",
        items: {
          type: "object",
          properties: {
            lens: { type: "string", enum: [...CONDITIONAL_LENSES] },
            reason: {
              type: "string",
              description: "Why this project does not activate it. Concrete, one line.",
            },
          },
          required: ["lens", "reason"],
        },
      },
    },
    required: ["conditional", "notActivated"],
  },
};

export function handleRecordActivatedLenses(
  engine: StateEngine,
  args: { conditional: string[]; notActivated: { lens: string; reason: string }[] }
): string {
  const r = engine.recordActivatedLenses(args.conditional ?? [], args.notActivated ?? []);
  if (!r.ok) {
    return JSON.stringify({ success: false, error: r.error.message });
  }
  return JSON.stringify({
    success: true,
    iteration: r.value.iteration,
    againstVersion: r.value.againstVersion,
    activated: r.value.conditional,
    notActivatedCount: r.value.notActivated.length,
    recordedAt: r.value.recordedAt,
    _nextAction:
      "Lens set on record for this iteration. Now apply EVERY universal lens plus these conditional ones " +
      "to EVERY module, then write the findings table to specs/design/coverage-matrix.md — head it with " +
      `## Iteração ${r.value.iteration} — V(${r.value.againstVersion}).`,
  });
}
