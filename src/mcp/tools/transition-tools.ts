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
  const result = engine.advancePhase(args.target_phase);
  if (result.ok) {
    const newState = engine.getPhaseState();
    return JSON.stringify({
      success: true,
      message: `Advanced to Phase ${args.target_phase}.`,
      currentPhase: newState?.currentPhase,
      currentIteration: newState?.currentIteration,
      nextStep: `IMMEDIATELY call get_phase_guidance() NOW to load Phase ${args.target_phase} instructions and present them to the user. Do NOT wait for user input before calling get_phase_guidance().`,
    });
  } else {
    return JSON.stringify({
      success: false,
      error: result.error.message,
      missingCriteria: result.error.missingCriteria,
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
    });
  } else {
    return JSON.stringify({ success: false, error: result.error });
  }
}
