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
          "'diagnosis' (root cause of a test failure — clears the S6 loop counter; 'bugfix' and 'root-cause' are aliases), " +
          "'approval' (a human sign-off — give approvedBy).",
      },
      content: {
        type: "string",
        description: "Decision content in free text.",
      },
      proposedBy: {
        type: "string",
        description: "Who proposed it, e.g. 'Qwen' (the agent) or 'user'. Explicit provenance: a recommendation the user agreed to is different from a request the user made.",
      },
      approvedBy: {
        type: "string",
        description:
          "Who approved it, e.g. 'user', a name or a role, plus the basis when it matters ('user, after running it on the device'). " +
          "REQUIRED on the approval decision that gates 3→4 (convergence), 4→5 (convergence confirmed after the Phase 4 report), 6→7 (test sign-off) and the cycle close: " +
          "those transitions are refused without a decision of the phase that names an approver.",
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
      check_command: {
        type: "string",
        description:
          "When the criterion is MECHANICALLY checkable (e.g. 'OAuth removed from all 4 services' → " +
          "`grep -rli oauth services/ | wc -l`), declare the command here instead of attesting it. The gate " +
          "then requires the engine to SEE that command run through the shell (run_shell_command), after this declaration, with the " +
          "expected result. A check declared in details prose is not executed by anyone.",
      },
      check_expect: {
        type: "string",
        description:
          "What the check must give: 'exit:<n>' (default 'exit:0'; append `; echo \"VERSUS_EXIT=$?\"` to the run) " +
          "or 'output:<regex>' matched against the output (e.g. 'output:^\\s*0\\s*$' for a count of zero).",
      },
    },
    required: ["phase", "criterion", "met"],
  },
};

export function handleRecordDecision(
  engine: StateEngine,
  args: { phase: number; category: string; content: string; proposedBy?: string; approvedBy?: string }
): string {
  try {
    const decision = engine.recordDecision(args.phase, args.category, args.content, {
      proposedBy: typeof args.proposedBy === "string" ? args.proposedBy : undefined,
      approvedBy: typeof args.approvedBy === "string" ? args.approvedBy : undefined,
    });
    const result: Record<string, any> = {
      success: true,
      id: decision.id,
      timestamp: decision.timestamp,
    };

    if (DIAGNOSIS_CATEGORIES.includes(args.category.trim().toLowerCase())) {
      result._s6 = "Diagnosis recorded — S6 loop counter cleared. The next test run will go through.";
    }

    // Claude 0.18.2: the Phase 7 approval closes the cycle whether or not a new one follows. A project
    // that ENDS at Phase 7 (MoonPatrolClone: "Projeto concluído") never calls start_new_cycle,
    // so its readable record was never written. Write it here. start_new_cycle rewrites it from
    // the archive if the project goes on.
    const st = engine.getPhaseState();
    if (decision.approvedBy && args.phase === 7 && st?.currentPhase === 7) {
      const ex = engine.exportCycle(undefined, true);
      if (ex.ok) result._export = `Cycle ${ex.value.cycle} record written to ${ex.value.path} (${ex.value.bytes} bytes).`;
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
  args: { phase: number; criterion: string; met: boolean; details?: string; check_command?: string; check_expect?: string }
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
    let checkNote: string | undefined;
    if (typeof args.check_command === "string" && args.check_command.trim()) {
      const d = engine.declareCheck(args.phase, args.criterion, args.check_command, args.check_expect);
      if (!d.ok) return JSON.stringify({ success: false, error: d.error });
      const exp = args.check_expect?.trim() || "exit:0";
      checkNote =
        `Check declared. Now run it through the shell (run_shell_command), exactly: \`${args.check_command.trim()}` +
        `${exp.startsWith("exit:") ? `; echo "VERSUS_EXIT=$?"` : ""}\`. The gate needs to SEE it give ${exp}.`;
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
    if (checkNote) result._check = checkNote;
    // Lessons that did not become a guard are listed for the HUMAN to decide on.
    if (args.criterion === "lessons_documented") {
      const ls = engine.lessons();
      const none = ls.filter((l) => l.guard?.toLowerCase() === "none").map((l) => l.title.slice(0, 80));
      const missing = ls.filter((l) => !l.guard).map((l) => l.title.slice(0, 80));
      if (none.length) result._lessonsWithoutGuard = { lessons: none, action: "Show these to the user: each is a lesson kept only as text. Ask whether any should become a test now." };
      if (missing.length) result._lessonsMissingGuardLine = { lessons: missing, action: "Add 'guard: <test id>' or 'guard: none' to each — start_new_cycle is blocked until every lesson says." };
    }

    // When all criteria for any phase < 7 become met, force next action: advance_phase
    if (allMet && args.phase < 7 && args.met) {
      const state = engine.getPhaseState();
      if (state && state.currentPhase === args.phase) {
        result._nextAction = `⚠️ ALL Phase ${args.phase} exit criteria are now met. Your VERY NEXT tool call MUST be advance_phase(target_phase=${args.phase + 1}) — no summary text, no closing prose. Then call get_phase_guidance() to load Phase ${args.phase + 1} instructions and continue work in the same turn.`;
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
    "call, instead of silently failing the coverage-matrix lens check later. " +
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
