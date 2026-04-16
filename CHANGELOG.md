# Changelog

## [0.1.2] - 2026-04-08

### Added
- **Visible methodology banner on session start/resume.** SessionStart hooks (both default and compact matcher) now instruct the LLM to START its first response with a one-line banner (e.g., "📍 Versus ativo — Fase X, iteração Y. Próximo passo: ..."). The user now sees when methodology context was loaded; previously the LLM could load state silently and the user wouldn't know.
- **"Retomar Versus" as user-facing anchor phrase.** The init_project message (both MCP and VSCode notification) now tells the user they can type "retomar Versus" in chat at any time to force the LLM to recover methodology context (get_phase_state + get_phase_guidance + get_decisions). Empirically validated as the phrase that reliably triggers context recovery across sessions.

## [0.1.1] - 2026-04-08

### Changed
- **P7 refocused on project-level review.** Removed "Methodology Self-Improvement" 5-step ceremony and "Double-loop evaluation of the PROCESS" — these only benefit the methodology maintainer (who has access to SKILL.md) and risk methodology degradation when applied by end users. P7 now has 3 steps: (1) update specs/ with actual results, (2) product evaluation via AskUserQuestion (does the software meet P0 requirements?), (3) capture 3-5 project-level lessons (domain insights, stack pitfalls, patterns, wrong P0/P1 assumptions) and deposit in specs/. Meta-iteration v1→v2 via `start_new_cycle()` is unchanged. Applied to full-guidance.ts, compact-guidance.ts, and the MUST DISPLAY artifacts list.

## [0.1.0] - 2026-04-07

### Added
- **Initial release** — Port of Versus for Claude (v0.5.1) to Qwen Code Companion.
- **MCP server** (`versus-qwen`) with 15 tools for methodology orchestration via stdio transport.
- **8 sequential phases** with verifiable exit criteria (identical IACDM methodology).
- **8 safeguards (S0-S7)** preventing common AI agent errors.
- **Convergence score** (0-100) with weighted breakdown gating Phase 0 → Phase 1.
- **Persistent decision registry** surviving context switches across sessions.
- **Gateway guard** detecting when models skip loading context (>30min staleness).
- **VS Code sidebar** (TreeView) showing methodology state in real time with phase transition notifications.
- **6 Qwen Code hooks:**
  - `inject-context` (UserPromptSubmit) — injects phase, score, decisions, and compact guidance into every prompt.
  - `phase-gate` (PreToolUse: edit/write_file) — blocks code editing in Phases 0-4.
  - `loop-detector` (PreToolUse: bash) — detects repetitive test executions (>3x), safeguard S7.
  - `block-destructive` (PreToolUse: bash) — blocks destructive commands (rm -rf, DROP TABLE, force push, .env reads).
  - `truncation-check` (PostToolUse: grep_search/bash) — detects truncated tool output and injects warnings.
  - `stop-verify` (Stop) — blocks task completion until project compiles, lints, and tests pass.
- **Project initialization** via Command Palette (`Versus Qwen: Initialize Project`) creating `.versus/state.json`, `specs/` (9 subdirs), MCP registration, and hook configuration.
- **MCP registration** in `.qwen/settings.json` (project-level) using read-merge-write to preserve existing user config.
- **Hook configuration** in `.qwen/settings.json` with Qwen-native tool name matchers.
- **Global permissions** written to `~/.qwen/settings.json` on activation for all 15 MCP tools.
- **Meta-iteration** support via `start_new_cycle` tool (v1→v2 preserving decisions, specs/, history).
- **Adversarial critique** (Phase 2) with 7 universal + 12 conditional specialized lenses.

### Changed (vs. Versus for Claude)
- **Agent identifier:** `state.json` uses `agent: "qwen"` (supports coexistence with Claude/Copilot versions).
- **Config paths:** `.claude/` → `.qwen/` for all settings, hooks, and permissions.
- **MCP registration:** `.mcp.json` → `mcpServers` section in `.qwen/settings.json` (Qwen-native format).
- **Tool name matchers:** `Edit|Write` → `edit|write_file`, `Bash` → `bash`, `Grep|Bash` → `grep_search|bash`.
- **Prerequisite check:** Detects `qwenlm.qwen-code-vscode-ide-companion` extension instead of `anthropic.claude-code`.
- **Extension identifiers:** `versus-claude` → `versus-qwen` across all view IDs, commands, MCP server name, and tool prefixes.
- **Workspace env var:** `CLAUDE_PROJECT_DIR` → `QWEN_PROJECT_DIR` in all hook scripts.
- **Permission patterns:** Qwen-native tool names (`ReadFileTool`, `WriteFileTool`, `ShellTool`, etc.).

### Fixed (inherited from Claude v0.5.1, applied during port)
- **MCP args type coercion.** All numeric MCP parameters (`phase`, `target_phase`, `score`) coerced via `Number()`. Boolean params (`met`) coerced via dedicated `toBool()`. Array params (`stack`, `outOfScope`, `patterns`, `constraints`) handled by `toStringArray()` which accepts both arrays and JSON-encoded strings. Prevents silent failures when LLMs send `"2"` (string) instead of `2` (number) — strict equality comparisons in the engine would fail without coercion.
- **Exit criteria phase matching.** `toNum()` applied to `c.phase` comparisons in `advancePhase()`, `markExitCriterion()`, `markExitCriteria()`, `getExitCriteriaState()`, `getDecisions()`, and `startNewCycle()`. Previously, string-typed phases from `state.json` failed strict equality against numeric parameters.
- **`updateProjectSpec` character splitting.** `toStringArray()` detects and recovers from the MCP parameter parsing bug where arrays are split into individual characters.
