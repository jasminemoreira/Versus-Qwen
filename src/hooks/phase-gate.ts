#!/usr/bin/env node

// Layer 2: Tool blocking — PreToolUse (edit|write_file|run_shell_command)
// Blocks code editing in Phases 0-4.
//
// What is ALLOWED in Phases 0-4 (everything else inside the project is blocked):
//   - anything OUTSIDE the project (scratchpad, /tmp, ~/...): not the project's code;
//   - the methodology/config roots: specs/, .versus/, .qwen/ (anchored at the project
//     root — a `src/specs/Impl.swift` is code, the old substring match let it through);
//   - root config files: package.json, tsconfig*, README*, .gitignore, .mcp.json, .env*;
//   - documentation/data files anywhere (.md, .txt, .csv, .rst, .adoc, .log): research
//     notes, decision logs and reports are not code. The first external study (ESJUD) had
//     its research/ log blocked and fell back to writing it through shell heredocs.
//
// Shell: the gate used to cover edit/write_file only, so `cat > src/App.swift <<EOF` walked
// straight past it — and the ESJUD study adopted shell writes as standard practice (D0002)
// because the allowed route was blocked. Now the obvious shell write routes (redirection,
// tee, sed -i/perl -i, cp/mv/install destination) are checked against the same rules.

import * as path from "path";
import { StateEngine } from "../state/engine";
import { writeTargets } from "../shell/shell-parse";

const SHELL_TOOL = "run_shell_command";

interface HookInput {
  tool_name: string;
  tool_input: {
    file_path?: string;
    command?: string;
    content?: string;
    // run_shell_command: optional absolute dir the command runs in (default: project root)
    directory?: string;
  };
  cwd?: string;
}

const ALLOWED_ROOT_DIRS = ["specs", ".versus", ".qwen"];
const ALLOWED_ROOT_FILES = [/^package\.json$/, /^tsconfig.*\.json$/, /^readme/i, /^\.gitignore$/, /^\.mcp\.json$/, /^\.env/];
const DOC_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".csv", ".tsv", ".rst", ".adoc", ".log"]);

/** Whether writing `filePath` is allowed before Phase 5. Relative paths resolve against `cwd`. */
export function isAllowedPath(filePath: string, workspace: string, cwd: string = workspace): boolean {
  if (!filePath) return true;
  const abs = path.resolve(cwd, filePath.replace(/^~(?=\/|$)/, process.env.HOME || "~"));
  const rel = path.relative(path.resolve(workspace), abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return true;           // outside the project
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length === 0) return true;
  if (ALLOWED_ROOT_DIRS.includes(parts[0])) return true;
  if (parts.length === 1 && ALLOWED_ROOT_FILES.some((re) => re.test(parts[0]))) return true;
  if (DOC_EXTENSIONS.has(path.extname(abs).toLowerCase())) return true;
  return false;
}

/** Paths a tool call would write that the gate refuses in Phases 0-4. */
export function blockedTargets(hookInput: HookInput, workspace: string): string[] {
  const baseCwd = hookInput.cwd || workspace;
  if (hookInput.tool_name === SHELL_TOOL) {
    const dir = hookInput.tool_input?.directory;
    const cwd = dir ? path.resolve(baseCwd, dir) : baseCwd;
    return writeTargets(hookInput.tool_input?.command || "").filter((t) => !isAllowedPath(t, workspace, cwd));
  }
  const fp = hookInput.tool_input?.file_path || "";
  return isAllowedPath(fp, workspace, baseCwd) ? [] : [fp];
}

function deny(reason: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(output) + "\n");
  process.exit(0);
}

function allow(): void {
  process.exit(0);
}

function main() {
  const workspacePath = process.env.QWEN_PROJECT_DIR || process.cwd();
  const engine = new StateEngine(workspacePath);
  const state = engine.getPhaseState();

  // No project initialized — allow everything
  if (!state) {
    allow();
    return;
  }

  // Phase 5+ allows editing
  if (state.currentPhase >= 5) {
    allow();
    return;
  }

  // Phase 0-4: read input to check the file
  let input = "";
  process.stdin.setEncoding("utf-8");

  const timeoutId = setTimeout(() => {
    process.stdin.destroy();
    allow();
  }, 5000);

  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    clearTimeout(timeoutId);
    try {
      const hookInput: HookInput = JSON.parse(input);
      const blocked = blockedTargets(hookInput, workspacePath);

      if (blocked.length === 0) {
        allow();
      } else {
        const viaShell = hookInput.tool_name === SHELL_TOOL;
        deny(
          `[Versus] Blocked: Phase ${state.currentPhase} does not allow code editing. ` +
          `${viaShell ? "This shell command writes" : "File"}: ${blocked.join(", ")}. ` +
          (viaShell ? `Writing through the shell is gated the same as edit/write_file. ` : "") +
          `Allowed before Phase 5: specs/, .versus/, .qwen/, root config files, documentation ` +
          `files (.md/.txt/.csv), and anything outside the project. ` +
          `Complete Phases 0→4 before implementing. ` +
          `Use get_exit_criteria() to see what is missing.`
        );
      }
    } catch {
      // If unable to parse input, allow (fail-open)
      allow();
    }
  });
}

// Only run as a hook process — isAllowedPath()/blockedTargets() are imported by the test suite.
if (require.main === module) {
  main();
}
