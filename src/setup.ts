// Shared setup utilities — no external dependencies (only fs/path).
// Used by both extension.ts (VS Code context) and project-tools.ts (MCP context).

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SPECS_README_CONTENT = `# specs/ — Material de referência para a metodologia

O assistente (Claude/Copilot/Qwen) lê destes diretórios durante as fases
0-7. Popule com conteúdo do seu projeto antes de iniciar cada fase.

## Como operar o Versus

**Retomar contexto:** digite \`retomar Versus\` no chat. O assistente
recarrega a fase atual, decisões e instruções. Use sempre que o chat
perder contexto (reinício do VSCode, conversa longa, trocou de modelo).

**MCP não foi descoberto:** se você já tinha o chat aberto quando
inicializou o projeto, feche e reabra — o MCP server só é detectado ao
iniciar uma nova sessão.

## Subdiretórios

- **domain/** — conhecimento de domínio, glossário, regras de negócio, invariantes
- **references/** — papers, artigos, documentação externa citada no design
- **technical/** — algoritmos, fórmulas, parâmetros numéricos com fontes
- **examples/** — implementações de referência (para port em S6 Tier 2)
- **design/** — mockups, wireframes, referências de UX
- **models/** — modelos de domínio, modelos de dados, relacionamentos
- **datasets/** — dados de teste, entradas de exemplo, saídas esperadas
- **validation/** — critérios de aceitação, cenários de teste, métricas de sucesso
- **competitors/** — produtos similares analisados em P0

## Qual pasta alimenta qual fase

- **Fase 0-1:** domain, references, technical, competitors
- **Fase 1:** + examples, design, models
- **Fase 5:** technical, examples, models, datasets
- **Fase 6:** validation, datasets
`;

/**
 * Writes specs/README.md if it does not already exist.
 * Never overwrites — respects user customizations.
 * Returns true if the file was created.
 */
export function ensureSpecsReadme(workspace: string): boolean {
  const readmePath = path.join(workspace, "specs", "README.md");
  if (fs.existsSync(readmePath)) return false;
  const specsDir = path.dirname(readmePath);
  if (!fs.existsSync(specsDir)) {
    fs.mkdirSync(specsDir, { recursive: true });
  }
  fs.writeFileSync(readmePath, SPECS_README_CONTENT, "utf-8");
  return true;
}

/**
 * Pins CommonJS for the bundle deploy directory. The project's own package.json
 * may declare "type":"module" (common in modern JS projects), which makes Node
 * treat every .js under the project tree as an ES module — including these
 * CommonJS bundles (server + hooks) — so they crash with "require is not defined
 * in ES module scope" and the methodology is silently disabled for that project.
 * Node resolves module type from the nearest package.json, so writing one here
 * pins CommonJS for the deploy dir only. Idempotent.
 */
export function ensureCommonjsPin(deployDir: string): void {
  const pkgPath = path.join(deployDir, "package.json");
  const pkgContent = JSON.stringify({ type: "commonjs" }, null, 2) + "\n";
  if (!fs.existsSync(pkgPath) || fs.readFileSync(pkgPath, "utf-8") !== pkgContent) {
    fs.writeFileSync(pkgPath, pkgContent);
  }
}

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
  "mcp__versus-qwen__record_activated_lenses",
  "mcp__versus-qwen__update_score",
  "mcp__versus-qwen__mark_exit_criterion",
  "mcp__versus-qwen__check_safeguard",
  "mcp__versus-qwen__check_all_safeguards",
  "mcp__versus-qwen__check_specs_status",
  "mcp__versus-qwen__init_project",
  "mcp__versus-qwen__get_phase_guidance",
  "mcp__versus-qwen__update_project_spec",
  "mcp__versus-qwen__start_new_cycle",
  "mcp__versus-qwen__export_cycle",
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
export function buildOrchestratorHooks(workspace: string): Record<string, any> {
  // Qwen bundles live in .versus/qwen/ so they never collide with the sibling
  // Versus extensions (Claude → .versus/*.js, Copilot → its own). state.json
  // stays at .versus/state.json, shared across tools for interchangeable work.
  const orchDir = path.join(workspace, ".versus", "qwen");

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
        // run_shell_command too: shell writes (`cat > src/x <<EOF`) bypassed the gate entirely before 0.12.0
        matcher: "edit|write_file|run_shell_command",
        hooks: [
          {
            type: "command",
            command: `node "${path.join(orchDir, "phase-gate.js")}"`,
          },
        ],
      },
      {
        matcher: "run_shell_command",
        hooks: [
          {
            type: "command",
            command: `node "${path.join(orchDir, "loop-detector.js")}"`,
          },
        ],
      },
      {
        matcher: "run_shell_command",
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
        matcher: "grep_search|run_shell_command",
        hooks: [
          {
            type: "command",
            command: `node "${path.join(orchDir, "truncation-check.js")}"`,
          },
        ],
      },
      {
        matcher: "run_shell_command",
        hooks: [
          {
            type: "command",
            command: `node "${path.join(orchDir, "test-outcome.js")}"`,
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
    // command hooks (Qwen Code 0.28.4, read from its CLI bundle):
    //  - SessionStart: plain stdout or hookSpecificOutput.additionalContext is appended to the
    //    SYSTEM INSTRUCTION for the session (re-applied on chat reset); systemMessage is shown
    //    to the user. One entry, no matcher: the script reads `source`.
    //  - PreCompact: hookSpecificOutput.additionalContext becomes extra instructions for the
    //    compaction summary, cut at 4,000 chars (MAX_HOOK_INSTRUCTIONS_CHARS). Plain stdout is
    //    NOT read as context for this event.
    // Before 0.13.0 neither was registered: the old Qwen notes (0.15.6 companion) said they
    // could not inject context. They can now.
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: `node "${path.join(orchDir, "session-start.js")}"`,
          },
        ],
      },
    ],
    PreCompact: [
      {
        hooks: [
          {
            type: "command",
            command: `node "${path.join(orchDir, "pre-compact.js")}"`,
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
  const serverPath = path.join(workspace, ".versus", "qwen", "server.js");

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
