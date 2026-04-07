// MCP Tools: verification of the specs/ directory

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../../state/engine";

export const checkSpecsStatusTool: Tool = {
  name: "check_specs_status",
  description:
    "Checks which subdirectories of specs/ are populated. " +
    "Returns file count per directory (excluding README.md). " +
    "Use before implementing to ensure technical references exist.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export function handleCheckSpecsStatus(engine: StateEngine): string {
  const status = engine.checkSpecsStatus();
  const populated = Object.entries(status).filter(([, s]) => s.populated).length;
  const total = Object.keys(status).length;
  return JSON.stringify({
    populated,
    total,
    directories: status,
  });
}
