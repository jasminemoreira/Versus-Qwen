#!/usr/bin/env node

// Layer 0: Session start / post-compaction recovery — SessionStart (command)
//
// Not registered before 0.13.0 of this build: the notes from the 0.15.6 companion said Qwen
// did not inject SessionStart context. Qwen Code 0.28.4 does, and in a stronger place than
// Claude Code: plain stdout or hookSpecificOutput.additionalContext is appended to the
// SYSTEM INSTRUCTION of the session (setSessionStartContext) and re-applied when the chat
// is reset. systemMessage is shown to the user.
//
// It carries the instruction to load state + guidance, and the state itself, so the model
// starts informed even before it calls any tool.

import { StateEngine } from "../state/engine";
import { buildInjection } from "./state-block";
import { capText, writeAndExit } from "./hook-output";
import { getPhaseDefinition } from "../rules/phases";
import { VERSUS_VERSION } from "../version";

/** Budget for the embedded state block; the instructions around it are ~1.6K. Qwen does not cut
 *  this channel; the budget keeps the system instruction lean (it is sent on every request). */
const STATE_BUDGET = 7_200;

const NO_PROJECT =
  "[Versus] This workspace has Versus hooks but no initialized project (.versus/state.json is missing). " +
  "Before anything else, look at the init_project tool description: it has a BOOTSTRAP PROTOCOL for brownfield " +
  "projects (workspace with existing code) that requires reading surface files, presenting a proposal, getting " +
  "user confirmation, then calling init_project with bootstrap_data. For an empty workspace (greenfield), ask the " +
  "user for a project name and description, then call init_project directly.";

export function sessionStartText(engine: StateEngine, source: string): string {
  const state = engine.getPhaseState();
  if (!state) return NO_PROJECT;

  const compact = source === "compact";
  const steps = compact
    ? [
        "1. Call mcp__versus-qwen__get_phase_state() to reload the current phase.",
        "2. Call mcp__versus-qwen__get_phase_guidance() to reload the methodology. It is NOT in your context after compaction.",
        "3. Call mcp__versus-qwen__get_decisions() to reload previous decisions.",
      ]
    : [
        "1. Call mcp__versus-qwen__get_phase_state().",
        "2. Call mcp__versus-qwen__get_phase_guidance(). The methodology text comes ONLY from this call.",
      ];
  if (state.currentPhase === 6) {
    steps.push(`${steps.length + 1}. Call get_decisions(phase=6) to recover testing progress. Manual testing spans sessions.`);
  }
  const head =
    (compact
      ? "[Versus] Context was compacted. Before doing ANYTHING else, recover the methodology state:\n"
      : "[Versus] Versus manages the IACDM methodology in this project. Before reading files or exploring the codebase, run:\n") +
    steps.join("\n") +
    "\nDO NOT read .versus/state.json or .versus/qwen/server.js directly: use the MCP tools (record_decision, update_score, " +
    "mark_exit_criterion, advance_phase).";

  const stateBlock = buildInjection(engine, STATE_BUDGET) ?? "";
  return capText(`${head}\n\nCurrent state (snapshot at session ${compact ? "recovery" : "start"}):\n${stateBlock}`);
}

/** The banner, shown to the USER by the harness (systemMessage). On the Claude build it was an
 *  instruction to the model ("start your first response with a banner") and was followed 0 times
 *  in 3 real sessions, so it is mechanical. */
export function sessionBanner(engine: StateEngine, source: string): string | null {
  const st = engine.getPhaseState();
  if (!st) return null;
  const p = st.currentPhase;
  return (
    `📍 Versus ${VERSUS_VERSION} ${source === "compact" ? "retomado após compactação" : "ativo"} — ` +
    `Fase ${p} (${getPhaseDefinition(p)?.name ?? "?"}), iteração ${st.currentIteration}, ciclo ${engine.currentCycle()}.`
  );
}

/** SessionStart output: context for the model (additionalContext) + the banner for the user. */
export function sessionStartOutput(engine: StateEngine, source: string): string {
  const text = sessionStartText(engine, source);
  const banner = sessionBanner(engine, source);
  return JSON.stringify({
    ...(banner ? { systemMessage: banner } : {}),
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
  });
}

function main() {
  const workspacePath = process.env.QWEN_PROJECT_DIR || process.cwd();
  let input = "";
  process.stdin.setEncoding("utf-8");
  const timeoutId = setTimeout(() => { process.stdin.destroy(); finish("startup"); }, 3000);
  process.stdin.on("data", (c) => { input += c; });
  process.stdin.on("end", () => {
    clearTimeout(timeoutId);
    let source = "startup";
    try { source = (JSON.parse(input) as { source?: string }).source || "startup"; } catch { /* default */ }
    finish(source);
  });
  function finish(source: string) {
    try {
      writeAndExit(sessionStartOutput(new StateEngine(workspacePath), source));
    } catch {
      process.exit(0);
    }
  }
}

if (require.main === module) {
  main();
}
