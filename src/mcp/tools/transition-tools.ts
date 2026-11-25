// MCP Tools: phase transitions

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../../state/engine";

export const advancePhaseTool: Tool = {
  name: "advance_phase",
  description:
    "Requests transition to the next phase. The server validates all exit criteria " +
    "and safeguards before allowing. If criteria are not met, returns an error " +
    "with a detailed list of what's missing. Use get_exit_criteria first to check pending items.",
  inputSchema: {
    type: "object" as const,
    properties: {
      target_phase: {
        type: "number",
        description: "Target phase (0-7). Valid transitions: sequential or loop 2↔3.",
      },
    },
    required: ["target_phase"],
  },
};

export const startIterationTool: Tool = {
  name: "start_iteration",
  description:
    "Starts a new iteration within a cyclic phase (Phase 0, 2, or 3). " +
    "Increments the iteration counter and returns information from the previous iteration.",
  inputSchema: {
    type: "object" as const,
    properties: {
      phase: {
        type: "number",
        description: "Current phase (0, 2, or 3).",
      },
    },
    required: ["phase"],
  },
};

export function handleAdvancePhase(engine: StateEngine, args: { target_phase: number }): string {
  // The schema requires target_phase, but a call without it reached the engine and came back
  // as "Phase undefined" (ESJUD study, Phase 7). Not defaulted to current+1: from Phase 3 the
  // valid targets are 4 AND the 2↔3 loop, so the caller must say which.
  if (typeof args.target_phase !== "number" || !Number.isInteger(args.target_phase)) {
    const cur = engine.getPhaseState()?.currentPhase;
    return JSON.stringify({
      success: false,
      error:
        "advance_phase requires target_phase (an integer 0-7)." +
        (typeof cur === "number"
          ? ` Current phase is ${cur}; the next sequential phase is ${cur + 1}` +
            (cur === 3 ? " (or 2, to loop back for another critique round)." : ".")
          : ""),
    });
  }
  const result = engine.advancePhase(args.target_phase);
  if (result.ok) {
    const newState = engine.getPhaseState();
    return JSON.stringify({
      success: true,
      message: `Advanced to Phase ${args.target_phase}.`,
      currentPhase: newState?.currentPhase,
      currentIteration: newState?.currentIteration,
      nextStep: `IMMEDIATELY follow the "## Phase ${args.target_phase}" section of the methodology already injected in your context — present it to the user and start its work. Do NOT wait for user input.`,
    });
  } else {
    return JSON.stringify({
      success: false,
      error: result.error.message,
      missingCriteria: result.error.missingCriteria,
      safeguardViolations: result.error.safeguardViolations,
      specsWarnings: result.error.specsWarnings,
    });
  }
}

export function handleStartIteration(engine: StateEngine, args: { phase: number }): string {
  const result = engine.startIteration(args.phase);
  if (result.ok) {
    return JSON.stringify({
      success: true,
      phase: result.value.phase,
      iterationNumber: result.value.iterationNumber,
    });
  } else {
    return JSON.stringify({ success: false, error: result.error });
  }
}

export const startNewCycleTool: Tool = {
  name: "start_new_cycle",
  description:
    "Starts a new development cycle (v1→v2) after Phase 7 completion. " +
    "Resets phase to 0 while PRESERVING all decisions, projectSpec, and history from the previous cycle. " +
    "specs/ directory is also preserved as baseline for the new cycle. " +
    "Phase 7 exit criteria must all be met before calling this tool. " +
    "Use at the end of Phase 7 when the user wants to evolve the project to the next version.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export function handleStartNewCycle(engine: StateEngine): string {
  const result = engine.startNewCycle();
  if (result.ok) {
    return JSON.stringify({
      success: true,
      message: `New cycle started (cycle ${result.value.cycle}). Phase reset to 0. Previous decisions and specs/ preserved as baseline.`,
      cycle: result.value.cycle,
      currentPhase: 0,
      hint: "Phase 0 of the new cycle starts from existing specs/ — knowledge is NOT lost. Use get_decisions() to review previous cycle context. Negative scope from the previous cycle can become new scope (with operator approval).",
      _modelSwitchAction: "⚠️ MODEL SWITCH RECOMMENDED — A new cycle starts at Phase 0 (design). If you switched to a smaller Qwen variant at the original LLM Switch Point in cycle " + (result.value.cycle - 1) + " Phase 4→5, you are likely STILL on that model. Phase 0 design benefits from the MOST CAPABLE Qwen variant. DISPLAY this notification to the user and recommend the same close+reopen+retomar Versus mechanic used at the original LLM Switch Point: (1) close this chat, (2) open a new chat with the design-grade model, (3) type `retomar Versus`. The new model recovers state cleanly via the inject-context hook (fires on that first message) and resumes Phase 0 of the new cycle.",
    });
  } else {
    return JSON.stringify({ success: false, error: result.error });
  }
}
