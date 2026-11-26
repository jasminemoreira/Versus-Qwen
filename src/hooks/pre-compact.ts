#!/usr/bin/env node

// Layer 0b: Compaction — PreCompact (command)
//
// Not registered before 0.13.0 of this build. In Qwen Code 0.28.4 the PreCompact context
// (hookSpecificOutput.additionalContext ONLY; plain stdout is not read as context for this
// event) becomes extra instructions for the compaction SUMMARY, cut at 4,000 chars
// (MAX_HOOK_INSTRUCTIONS_CHARS). Tell the summarizer what Versus state must survive.
// Recovery itself is the SessionStart(compact) hook's job.

import { StateEngine } from "../state/engine";
import { getPhaseDefinition } from "../rules/phases";
import { capText, preCompactContext, PRE_COMPACT_CAP, writeAndExit } from "./hook-output";

export function preCompactText(engine: StateEngine): string {
  const st = engine.getPhaseState();
  if (!st) return "";
  const phase = st.currentPhase;
  const pending = engine.getExitCriteriaWithDefs(phase).filter((c) => !c.met).map((c) => c.criterion);
  const recent = st.decisions.slice(-5).map((d) => {
    const flat = d.content.replace(/\s+/g, " ").trim();
    return `  - [P${d.phase}/${d.category}] ${flat.length > 200 ? flat.slice(0, 199) + "…" : flat}`;
  });
  return capText(
    "In the summary, PRESERVE this Versus (IACDM methodology) state verbatim:\n" +
    `- Project "${st.projectName}": Phase ${phase} (${getPhaseDefinition(phase)?.name ?? "?"}), iteration ${st.currentIteration}, cycle ${engine.currentCycle()}.\n` +
    `- Pending exit criteria of Phase ${phase}: ${pending.join(", ") || "none"}.\n` +
    (recent.length ? `- Most recent decisions:\n${recent.join("\n")}\n` : "") +
    "- What was being worked on, and the next step.\n" +
    "- That after compaction the agent must call get_phase_state() and get_phase_guidance() BEFORE acting: " +
    "the methodology text is not carried in the summary.",
    PRE_COMPACT_CAP - 500
  );
}

function main() {
  const workspacePath = process.env.QWEN_PROJECT_DIR || process.cwd();
  try {
    const t = preCompactText(new StateEngine(workspacePath));
    if (t) { writeAndExit(preCompactContext(t)); return; }
  } catch { /* fail open */ }
  process.exit(0);
}

if (require.main === module) {
  main();
}
