// MCP Tools: recording decisions, scores, and exit criteria

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../../state/engine";
import { ScoreBreakdown } from "../../state/types";

export const recordDecisionTool: Tool = {
  name: "record_decision",
  description:
    "Records a decision made during any phase. Decisions persist between sessions " +
    "and can be queried with get_decisions. Use to avoid losing architectural, " +
    "scope, pattern, and other decisions.",
  inputSchema: {
    type: "object" as const,
    properties: {
      phase: {
        type: "number",
        description: "Phase in which the decision was made (0-7).",
      },
      category: {
        type: "string",
        description: "Category: 'architecture', 'pattern', 'constraint', 'scope', 'technology', 'requirement', 'testing'.",
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
    return JSON.stringify({
      success: true,
      id: decision.id,
      timestamp: decision.timestamp,
    });
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
        result._nextAction = `⚠️ ALL Phase ${args.phase} exit criteria are now met. Your VERY NEXT tool call MUST be advance_phase() — no summary text, no closing prose. After advance_phase(), call get_phase_guidance() to load Phase ${args.phase + 1} instructions and continue work in the same turn.`;
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
