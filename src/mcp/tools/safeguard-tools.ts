// MCP Tools: verification of safeguards S0-S7

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../../state/engine";

export const checkSafeguardTool: Tool = {
  name: "check_safeguard",
  description:
    "Checks a specific safeguard (S0-S7). Returns status and recommendations. " +
    "Safeguards protect against common errors: S0=convergence, S1=anti-bug, " +
    "S2=user stop, S3=premature convergence, S4=explicit verification, " +
    "S5=scope preservation, S6=no reimplementation, S7=sequence discipline.",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        type: "string",
        description: "Safeguard ID: 'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', or 'S7'.",
      },
    },
    required: ["id"],
  },
};

export const checkAllSafeguardsTool: Tool = {
  name: "check_all_safeguards",
  description:
    "Checks ALL safeguards applicable to the current phase. " +
    "Returns a complete status overview. Use before phase transitions.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export function handleCheckSafeguard(engine: StateEngine, args: { id: string }): string {
  const result = engine.checkSafeguard(args.id);
  return JSON.stringify(result);
}

export function handleCheckAllSafeguards(engine: StateEngine): string {
  const results = engine.checkAllSafeguards();
  const violated = results.filter((r) => r.status === "violated").length;
  const warnings = results.filter((r) => r.status === "warning").length;
  return JSON.stringify({
    total: results.length,
    violated,
    warnings,
    ok: results.length - violated - warnings,
    safeguards: results,
  });
}
