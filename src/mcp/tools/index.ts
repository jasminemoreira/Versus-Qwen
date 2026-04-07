// Central registry of all MCP tools

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../../state/engine";

import { getPhaseStateTool, getDecisionsTool, getExitCriteriaTool, updateProjectSpecTool, handleGetPhaseState, handleGetDecisions, handleGetExitCriteria, handleUpdateProjectSpec } from "./state-tools";
import { advancePhaseTool, startIterationTool, startNewCycleTool, handleAdvancePhase, handleStartIteration, handleStartNewCycle } from "./transition-tools";
import { recordDecisionTool, updateScoreTool, markExitCriterionTool, handleRecordDecision, handleUpdateScore, handleMarkExitCriterion } from "./record-tools";
import { checkSafeguardTool, checkAllSafeguardsTool, handleCheckSafeguard, handleCheckAllSafeguards } from "./safeguard-tools";
import { checkSpecsStatusTool, handleCheckSpecsStatus } from "./specs-tools";
import { initProjectTool, handleInitProject } from "./project-tools";
import { getPhaseGuidanceTool, handleGetPhaseGuidance } from "./guidance-tools";

export const ALL_TOOLS: Tool[] = [
  getPhaseStateTool,
  getDecisionsTool,
  getExitCriteriaTool,
  advancePhaseTool,
  startIterationTool,
  recordDecisionTool,
  updateScoreTool,
  markExitCriterionTool,
  checkSafeguardTool,
  checkAllSafeguardsTool,
  checkSpecsStatusTool,
  initProjectTool,
  getPhaseGuidanceTool,
  updateProjectSpecTool,
  startNewCycleTool,
];

// Tools exempt from gateway guard (they are themselves the "context loading")
const GUARD_EXEMPT = new Set(["get_phase_state", "init_project", "start_new_cycle"]);

const CONTEXT_WARNING =
  "MANDATORY ACTION: Call get_phase_state() and get_phase_guidance() BEFORE proceeding. " +
  "Without loaded context, your actions may be inconsistent with decisions already made in the project.";

export function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  engine: StateEngine
): string {
  const result = dispatch(toolName, args, engine);

  // Gateway guard: warns models that haven't loaded context
  if (!GUARD_EXEMPT.has(toolName) && engine.isContextStale()) {
    try {
      const parsed = JSON.parse(result);
      parsed._contextWarning = CONTEXT_WARNING;
      return JSON.stringify(parsed);
    } catch {
      return result;
    }
  }

  return result;
}

function dispatch(
  toolName: string,
  args: Record<string, unknown>,
  engine: StateEngine
): string {
  switch (toolName) {
    case "get_phase_state":
      return handleGetPhaseState(engine);
    case "get_decisions":
      return handleGetDecisions(engine, args as { phase?: number });
    case "get_exit_criteria":
      return handleGetExitCriteria(engine, args as { phase: number });
    case "advance_phase":
      return handleAdvancePhase(engine, args as { target_phase: number });
    case "start_iteration":
      return handleStartIteration(engine, args as { phase: number });
    case "record_decision":
      return handleRecordDecision(engine, args as { phase: number; category: string; content: string });
    case "update_score":
      return handleUpdateScore(engine, args as { score: number; breakdown: any });
    case "mark_exit_criterion":
      return handleMarkExitCriterion(engine, args as { phase: number; criterion: string; met: boolean; details?: string });
    case "check_safeguard":
      return handleCheckSafeguard(engine, args as { id: string });
    case "check_all_safeguards":
      return handleCheckAllSafeguards(engine);
    case "check_specs_status":
      return handleCheckSpecsStatus(engine);
    case "init_project":
      return handleInitProject(engine, args as { name: string; description: string });
    case "get_phase_guidance":
      return handleGetPhaseGuidance(engine, args as { phase?: number });
    case "update_project_spec":
      return handleUpdateProjectSpec(engine, args as { stack?: string[]; outOfScope?: string[]; patterns?: string[]; constraints?: string[] });
    case "start_new_cycle":
      return handleStartNewCycle(engine);
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}
