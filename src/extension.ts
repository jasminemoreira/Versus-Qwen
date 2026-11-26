// Extension Core — lifecycle, component registration
// No files are created automatically; everything depends on explicit user action.

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";
import { SidebarProvider } from "./views/sidebar";
import { ensureSettings, ensureGlobalPermissions, ensureMcpInQwenSettings, ensureSpecsReadme, ensureCommonjsPin } from "./setup";
import { VERSUS_VERSION } from "./version";

let sidebarProvider: SidebarProvider | undefined;
let outputChannel: vscode.OutputChannel;

function log(msg: string) {
  outputChannel?.appendLine(`[Versus for Qwen] ${new Date().toISOString()} ${msg}`);
}

function checkPrerequisites(): boolean {
  const missing: string[] = [];
  const nodeOk = (() => {
    const r = spawnSync("node", ["--version"], { encoding: "utf-8" });
    return r.status === 0 && !r.error;
  })();
  const qwenOk = !!vscode.extensions.getExtension("qwenlm.qwen-code-vscode-ide-companion");

  if (!nodeOk) {
    missing.push("**Node.js** — install from https://nodejs.org/en/download and restart VSCode.");
  }
  if (!qwenOk) {
    missing.push("**Qwen Code Companion** — install from the VSCode Marketplace (publisher: QwenLM).");
  }

  if (missing.length > 0) {
    const msg = `Versus for Qwen requires the following to work:\n${missing.join("\n")}\nThe extension will not function until these are installed.`;
    const buttons: string[] = [];
    if (!nodeOk) buttons.push("Download Node.js");
    if (!qwenOk) buttons.push("Open Marketplace");
    vscode.window.showErrorMessage(msg, ...buttons).then((action) => {
      if (action === "Download Node.js") {
        vscode.env.openExternal(vscode.Uri.parse("https://nodejs.org/en/download"));
      } else if (action === "Open Marketplace") {
        vscode.commands.executeCommand("workbench.extensions.search", "@publisher:qwenlm");
      }
    });
    return false;
  }

  return true;
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("Versus for Qwen");
  context.subscriptions.push(outputChannel);
  log("Activating extension...");

  if (!checkPrerequisites()) {
    log("Prerequisites missing — activation aborted.");
    return;
  }

  // Write MCP permissions to ~/.qwen/settings.json globally so Qwen Code
  // doesn't prompt for each tool even on fresh machines or new workspaces.
  try {
    ensureGlobalPermissions();
    log("Global permissions ensured.");
  } catch (err) {
    log(`ensureGlobalPermissions WARNING: ${String(err)}`);
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    log("No workspace open — activation aborted.");
    return;
  }

  const workspacePath = workspaceFolders[0].uri.fsPath;
  const extensionPath = context.extensionPath;
  log(`Workspace: ${workspacePath}`);

  try {
    // Register TreeView sidebar (read-only — does not create files)
    sidebarProvider = new SidebarProvider(workspacePath);
    const treeView = vscode.window.createTreeView("versus-qwen.phaseView", {
      treeDataProvider: sidebarProvider,
      showCollapseAll: true,
    });
    context.subscriptions.push(treeView);
    log("TreeView registered.");

    // Command: manual refresh
    context.subscriptions.push(
      vscode.commands.registerCommand("versus-qwen.refreshView", () => {
        sidebarProvider?.refresh();
      })
    );
    log("Command refreshView registered.");

    // Command: initialize project (only way to create files in the workspace)
    context.subscriptions.push(
      vscode.commands.registerCommand("versus-qwen.initProject", async () => {
        const name = await vscode.window.showInputBox({
          prompt: "Project name",
          placeHolder: "my-project",
        });
        if (!name) return;

        const description = await vscode.window.showInputBox({
          prompt: "Brief description",
          placeHolder: "Project description...",
        });
        if (!description) return;

        try {
          const { StateEngine } = await import("./state/engine");
          const engine = new StateEngine(workspacePath);
          const existing = engine.getPhaseState();
          if (existing) {
            vscode.window.showWarningMessage(
              `Project '${existing.projectName}' already exists (Phase ${existing.currentPhase}).`
            );
            return;
          }

          engine.initProject(name, description);

          // Create specs/ directory structure
          const specsDirs = [
            "domain", "references", "technical", "examples",
            "design", "models", "datasets", "validation", "competitors",
          ];
          for (const dir of specsDirs) {
            fs.mkdirSync(path.join(workspacePath, "specs", dir), { recursive: true });
          }
          ensureSpecsReadme(workspacePath);

          // Deploy bundles and configurations (only now, by user action)
          deployServer(extensionPath, workspacePath);
          ensureMcpInQwenSettings(workspacePath);
          ensureSettings(workspacePath);

          sidebarProvider?.refresh();
          vscode.window.showInformationMessage(
            `Project '${name}' initialized. Phase 0 — Problem Discovery. Tip: type "retomar Versus" in chat anytime to recover methodology context.`
          );
          vscode.window.showWarningMessage(
            `⚠️ If Qwen Code is already open, close and reopen the chat so it discovers the MCP server (.qwen/settings.json was just updated).`
          );
          vscode.window.showWarningMessage(
            `⚠️ Populate ./specs/ before starting Phase 0 — the AI reads from there. Key dirs: domain, references, technical, examples.`,
            "Open specs/"
          ).then((action) => {
            if (action === "Open specs/") {
              vscode.commands.executeCommand(
                "revealInExplorer",
                vscode.Uri.file(path.join(workspacePath, "specs"))
              );
            }
          });
          log("initProject: completed successfully.");
        } catch (err) {
          log(`initProject ERROR: ${String(err)}`);
          vscode.window.showErrorMessage(`Versus for Qwen: Error initializing project: ${String(err)}`);
        }
      })
    );
    log("Command initProject registered.");

    // If the project was already initialized, update bundles (maintenance)
    const statePath = path.join(workspacePath, ".versus", "state.json");
    if (fs.existsSync(statePath)) {
      deployServer(extensionPath, workspacePath);
      ensureMcpInQwenSettings(workspacePath);
      ensureSettings(workspacePath);
      log("Existing project detected — bundles, .qwen/settings.json, and settings updated.");
    } else {
      log("No Versus project in this workspace — nothing to do on activation.");
    }

    // A window keeps running the Versus it activated with. Installing a new version does not
    // redeploy .versus/qwen/ in already-open windows (on the Claude build, MoonPatrolClone ran
    // Claude 0.18.0 for a whole cycle with Claude 0.18.1 installed). VS Code tells the running extension when the
    // installed set changes, so offer the reload that deploys the new build.
    context.subscriptions.push(
      vscode.extensions.onDidChange(() => {
        const installed = vscode.extensions.getExtension("JasmineMoreira.versus-qwen")?.packageJSON?.version;
        if (installed && installed !== VERSUS_VERSION && fs.existsSync(statePath)) {
          vscode.window
            .showWarningMessage(
              `Versus Qwen ${installed} is installed, but this window is still running ${VERSUS_VERSION}: this ` +
              `project's .versus/qwen/ hooks and server stay on ${VERSUS_VERSION} until the window reloads.`,
              "Reload Window"
            )
            .then((a) => { if (a === "Reload Window") vscode.commands.executeCommand("workbench.action.reloadWindow"); });
        }
      })
    );

    log("Activation completed successfully.");
  } catch (err) {
    log(`ACTIVATION ERROR: ${String(err)}`);
    vscode.window.showErrorMessage(`Versus for Qwen: Activation error — ${String(err)}`);
  }
}

/**
 * Copies extension bundles to .versus/qwen/ in the workspace.
 * Own subfolder so bundles never collide with the sibling Versus extensions
 * (Claude/Copilot); state.json stays at .versus/state.json, shared across tools.
 * Only updates if content has changed (idempotent).
 */
function deployServer(extensionPath: string, workspacePath: string) {
  const bundleDir = path.join(extensionPath, "out", "bundle");
  const targetDir = path.join(workspacePath, ".versus", "qwen");
  // Must list every bundle referenced by buildOrchestratorHooks() in setup.ts —
  // a hook registered in settings.json whose file is missing here fails silently.
  const files = [
    "inject-context.js",
    "phase-gate.js",
    "loop-detector.js",
    "test-outcome.js",
    "truncation-check.js",
    "block-destructive.js",
    "session-start.js",
    "pre-compact.js",
    "stop-verify.js",
    "server.js",
  ];

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Immunize the deploy dir against a project-level "type":"module".
  ensureCommonjsPin(targetDir);

  const missing: string[] = [];
  for (const file of files) {
    const src = path.join(bundleDir, file);
    const dest = path.join(targetDir, file);
    if (!fs.existsSync(src)) { missing.push(file); continue; }   // was a silent skip

    const srcContent = fs.readFileSync(src);
    if (fs.existsSync(dest) && srcContent.equals(fs.readFileSync(dest))) continue;

    fs.writeFileSync(dest, srcContent);
  }
  // Which Versus is deployed in this project, readable by people and by the audit.
  fs.writeFileSync(path.join(targetDir, "VERSION"), VERSUS_VERSION + "\n");
  if (missing.length) {
    vscode.window.showErrorMessage(
      `Versus Qwen ${VERSUS_VERSION}: ${missing.length} bundle(s) missing from the extension, NOT deployed to this ` +
      `project: ${missing.join(", ")}. Their hooks will fail silently. Reinstall the extension.`
    );
  }
}


export function deactivate() {
  sidebarProvider?.dispose();
}
