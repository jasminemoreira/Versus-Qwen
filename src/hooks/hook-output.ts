// Output shapes Qwen Code actually honours, per event. Read from the Qwen Code 0.28.4 CLI
// bundled in the VS Code companion (DefaultHookOutput.getRawAdditionalContext and the
// per-event consumers), not assumed from Claude Code:
//
//  - Context for the model is read ONLY from `hookSpecificOutput.additionalContext`. Before
//    0.13.0 three hooks (test-outcome, truncation-check, stop-verify) emitted a top-level
//    `{additionalContext}`, which Qwen ignores: the S6 escalation, the truncation warning and
//    the stop warnings never reached the model.
//  - Plain stdout is read as context only for SessionStart, UserPromptSubmit and
//    UserPromptExpansion (PLAIN_TEXT_CONTEXT_EVENTS). For any other event it becomes a
//    systemMessage.
//  - Every additionalContext has `<` and `>` replaced by `&lt;` / `&gt;` before the model sees it.
//
// Every hook goes through these helpers, and the channel tests check the shapes.

/** Hook stdout is cut at 1 MiB by Qwen (MAX_OUTPUT_LENGTH in the command hook runner). That is
 *  not a practical limit. The real per-channel limits are lower:
 *   - PostToolUse context is appended to the tool result, which is truncated past 25,000 chars
 *     (truncateToolOutputThreshold);
 *   - PreCompact context is cut at 4,000 chars (MAX_HOOK_INSTRUCTIONS_CHARS).
 *  This cap is a Versus budget, not a host limit: a warning stays a warning, not an essay. */
export const HOOK_TEXT_CAP = 10_000;
/** Qwen's PreCompact cut (MAX_HOOK_INSTRUCTIONS_CHARS = 4e3). */
export const PRE_COMPACT_CAP = 4_000;

/** Keeps a text under the cap. A truncated warning beats one cut mid-sentence by the host. */
export function capText(text: string, cap = HOOK_TEXT_CAP - 200): string {
  return text.length <= cap ? text : text.slice(0, cap - 40) + "\n…[truncated by Versus to fit the hook cap]";
}

/** PostToolUse: context for the model, appended to the tool result. */
export function postToolUseContext(text: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: capText(text) } });
}

/** Stop, non-blocking: a message shown to the USER (Qwen yields it as hook_system_message).
 *  Stop has no additionalContext consumer; a block would make the model take another turn. */
export function stopUserMessage(text: string): string {
  return JSON.stringify({ systemMessage: capText(text) });
}

/** Stop, blocking: `decision: "block"` with exit 0. The reason goes back to the model, which
 *  keeps working. (Exit code 2 is also blocking in Qwen, but then the reason is read from
 *  stderr, not from this JSON.) */
export function stopBlock(reason: string): string {
  return JSON.stringify({ decision: "block", reason: capText(reason) });
}

/** PreCompact: extra instructions for the compaction summary. Must be hookSpecificOutput —
 *  plain stdout is not read as context for this event. */
export function preCompactContext(text: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreCompact", additionalContext: capText(text, PRE_COMPACT_CAP - 100) } });
}

/** Writes and exits only after stdout drains (an exit right after write() truncates pipes). */
export function writeAndExit(text: string, code = 0): void {
  process.stdout.write(text.endsWith("\n") ? text : text + "\n", () => process.exit(code));
}
