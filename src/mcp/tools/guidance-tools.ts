// MCP Tools: detailed behavioral instructions per phase

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../../state/engine";
import { getPhaseDefinition } from "../../rules/phases";

export const getPhaseGuidanceTool: Tool = {
  name: "get_phase_guidance",
  description:
    "Points you at the phase's instructions. The COMPLETE methodology (all phases, rules, " +
    "templates, checklists) is injected into your context before every message — this tool no " +
    "longer repeats it inline (the full text spilled to disk). It returns the section heading to " +
    "read in that injected context.",
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

  const heading = `## Phase ${phase} — ${getPhaseDefinition(phase)?.name ?? "Unknown"}`;
  return JSON.stringify({
    phase,
    currentPhase: state.currentPhase,
    guidancePointer:
      `Phase ${phase} guidance is already in your injected context this turn — read the "${heading}" ` +
      `section and follow it. The full methodology is injected before every message; this tool no ` +
      `longer repeats it inline (it spilled to disk).`,
  });
}
