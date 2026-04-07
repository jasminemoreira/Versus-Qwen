// MCP Tools: detailed behavioral instructions per phase

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../../state/engine";
import { getFullGuidance } from "../../rules/full-guidance";

export const getPhaseGuidanceTool: Tool = {
  name: "get_phase_guidance",
  description:
    "Returns COMPLETE instructions for the current or specified phase: global rules, " +
    "mandatory questions, templates, protocols, checklists, and criteria. " +
    "Call when entering each new phase to know exactly what to do. " +
    "Complements get_phase_state which returns only the state.",
  inputSchema: {
    type: "object" as const,
    properties: {
      phase: {
        type: "number",
        description: "Phase number (0-7). If omitted, uses the current phase.",
      },
    },
    required: [],
  },
};

export function handleGetPhaseGuidance(engine: StateEngine, args: { phase?: number }): string {
  const state = engine.getPhaseState();
  if (!state) {
    return JSON.stringify({
      error: "Project not initialized. Call init_project first.",
    });
  }

  const phase = args.phase ?? state.currentPhase;

  if (phase < 0 || phase > 7) {
    return JSON.stringify({ error: `Invalid phase: ${phase}. Use 0-7.` });
  }

  const guidance = getFullGuidance(phase);

  return JSON.stringify({
    phase,
    currentPhase: state.currentPhase,
    guidance,
  });
}
