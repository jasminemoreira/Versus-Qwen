// Shared setup utilities — no external dependencies (only fs/path).
// Used by both extension.ts (VS Code context) and project-tools.ts (MCP context).

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Permissions auto-approved in user projects when the extension initializes.
// Includes MCP tools + general development tools so Qwen can work without
// permission prompts for routine operations (read, write, search, execute).
const AUTO_APPROVED_PERMISSIONS = [
  // MCP tools
  "mcp__versus-qwen__get_phase_state",
  "mcp__versus-qwen__get_decisions",
  "mcp__versus-qwen__get_exit_criteria",
  "mcp__versus-qwen__advance_phase",
  "mcp__versus-qwen__start_iteration",
  "mcp__versus-qwen__record_decision",
  "mcp__versus-qwen__update_score",
  "mcp__versus-qwen__mark_exit_criterion",
  "mcp__versus-qwen__check_safeguard",
  "mcp__versus-qwen__check_all_safeguards",
  "mcp__versus-qwen__check_specs_status",
  "mcp__versus-qwen__init_project",
  "mcp__versus-qwen__get_phase_guidance",
  "mcp__versus-qwen__update_project_spec",
  "mcp__versus-qwen__start_new_cycle",
  // General development tools (Qwen Code tool names)
  "ReadFileTool",
  "WriteFileTool",
  "EditFileTool",
  "GlobTool",
  "GrepSearchTool",
  "ShellTool",
  "WebFetchTool",
  "WebSearchTool",
];

/**
 * Generates hooks config using LOCAL project paths (.versus/).
 */
function buildOrchestratorHooks(workspace: string): Record<string, any> {
  const orchDir = path.join(workspace, ".versus");

  return {
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: `node "${path.join(orchDir, "inject-context.js")}"`,
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "edit|write_file",
        hooks: [
          {
            type: "command",
            command: `node "${path.join(orchDir, "phase-gate.js")}"`,
          },
        ],
      },
      {
        matcher: "bash",
        hooks: [
          {
            type: "command",
            command: `node "${path.join(orchDir, "loop-detector.js")}"`,
          },
        ],
      },
      {
        matcher: "bash",
        hooks: [
          {
            type: "command",
            command: `node "${path.join(orchDir, "block-destructive.js")}"`,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "grep_search|bash",
        hooks: [
          {
            type: "command",
            command: `node "${path.join(orchDir, "truncation-check.js")}"`,
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: `node "${path.join(orchDir, "stop-verify.js")}"`,
            timeout: 120,
          },
        ],
      },
    ],
    PreCompact: [
      {
        hooks: [
          {
            type: "prompt",
            prompt:
              "BEFORE compaction: call get_phase_state() and save the result in MEMORY.md (in your auto memory directory). Include: current phase, iteration, key decisions, next steps.",
          },
        ],
      },
    ],
    SessionStart: [
      {
        matcher: "",
        hooks: [
          {
            type: "prompt",
            prompt:
              "STOP. Before doing ANYTHING else — before reading any files, before exploring the codebase — you MUST execute these two MCP tool calls RIGHT NOW:\n" +
              "1. Call mcp__versus-qwen__get_phase_state() to load the current methodology phase\n" +
              "2. Call mcp__versus-qwen__get_phase_guidance() to get detailed instructions\n" +
              "DO NOT read .versus/state.json or .versus/server.js directly. DO NOT skip these calls. " +
              "The MCP server versus-qwen manages the IACDM methodology state. All methodology interactions MUST go through MCP tools: " +
              "record_decision() for decisions, update_score() for scoring, mark_exit_criterion() for criteria, advance_phase() for transitions. " +
              "If get_phase_state returns an error, ask the user if they want to initialize with init_project(). " +
              "If in Phase 6: also call get_decisions(phase=6) to recover testing progress — manual testing spans sessions.\n" +
              "VISIBILITY: after loading state, START your first response with a one-line banner so the user knows Versus is active, e.g.: '📍 Versus ativo — Fase X (name), iteração Y. Próximo passo: <one line>.' The user must SEE that methodology context was loaded; do not load silently.",
          },
        ],
      },
      {
        matcher: "compact",
        hooks: [
          {
            type: "prompt",
            prompt:
              "STOP. Context was compacted. Before doing ANYTHING else, you MUST recover methodology state:\n" +
              "1. Call mcp__versus-qwen__get_phase_state() to reload current phase\n" +
              "2. Call mcp__versus-qwen__get_phase_guidance() to reload instructions\n" +
              "3. Call mcp__versus-qwen__get_decisions() to reload previous decisions\n" +
              "4. Read MEMORY.md (auto memory) for additional context\n" +
              "DO NOT read .versus/state.json or .versus/server.js directly. DO NOT skip these calls. " +
              "Continue where you left off only AFTER completing all 4 steps above.\n" +
              "VISIBILITY: after recovering, START your first response with a one-line banner so the user knows Versus recovered, e.g.: '📍 Versus retomado — Fase X (name), iteração Y. Continuando: <one line>.'",
          },
        ],
      },
    ],
  };
}

/**
 * Writes MCP tool permissions to ~/.qwen/settings.json (global).
 * Only touches permissions.allow — never writes hooks (workspace-specific).
 * Called on activation so permissions work even in fresh workspaces.
 */
export function ensureGlobalPermissions(): void {
  const globalDir = path.join(os.homedir(), ".qwen");
  const globalPath = path.join(globalDir, "settings.json");

  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true });
  }

  let settings: Record<string, any> = {};
  if (fs.existsSync(globalPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(globalPath, "utf-8"));
    } catch {
      settings = {};
    }
  }

  if (!settings.permissions) { settings.permissions = { allow: [] }; }
  if (!settings.permissions.allow) { settings.permissions.allow = []; }

  const allow: string[] = settings.permissions.allow;
  let modified = false;
  for (const perm of AUTO_APPROVED_PERMISSIONS) {
    if (!allow.includes(perm)) {
      allow.push(perm);
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(globalPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  }
}

/**
 * Ensures settings.json has MCP permissions and orchestrator hooks.
 * Preserves existing user permissions and hooks.
 */
export function ensureSettings(workspace: string): boolean {
  const settingsPath = path.join(workspace, ".qwen", "settings.json");
  const settingsDir = path.dirname(settingsPath);

  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }

  let settings: Record<string, any> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      settings = {};
    }
  }

  let modified = false;

  if (!settings.permissions) {
    settings.permissions = { allow: [] };
  }
  if (!settings.permissions.allow) {
    settings.permissions.allow = [];
  }
  const allow: string[] = settings.permissions.allow;
  for (const perm of AUTO_APPROVED_PERMISSIONS) {
    if (!allow.includes(perm)) {
      allow.push(perm);
      modified = true;
    }
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }
  // Force-replace all orchestrator hooks to ensure prompts stay current.
  // Previous versions appended hooks; now we overwrite the entire hook type
  // so stale prompts don't linger alongside updated ones.
  const orchestratorHooks = buildOrchestratorHooks(workspace);
  for (const [hookType, hookConfigs] of Object.entries(orchestratorHooks)) {
    const prev = JSON.stringify(settings.hooks[hookType] ?? null);
    settings.hooks[hookType] = hookConfigs;
    if (JSON.stringify(hookConfigs) !== prev) {
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  }

  return modified;
}

/**
 * Registers the MCP server in .qwen/settings.json (project-level).
 * Uses read-merge-write to preserve existing user config.
 */
export function ensureMcpInQwenSettings(workspace: string): boolean {
  const settingsDir = path.join(workspace, ".qwen");
  const settingsPath = path.join(settingsDir, "settings.json");
  const serverPath = path.join(workspace, ".versus", "server.js");

  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }

  let settings: Record<string, any> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      settings = {};
    }
  }

  if (!settings.mcpServers) {
    settings.mcpServers = {};
  }

  const expectedConfig = {
    command: "node",
    args: [serverPath],
    env: {},
  };

  // Check if already correct
  const existing = settings.mcpServers["versus-qwen"];
  if (existing && JSON.stringify(existing.args) === JSON.stringify(expectedConfig.args)) {
    return false;
  }

  settings.mcpServers["versus-qwen"] = expectedConfig;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  return true;
}
