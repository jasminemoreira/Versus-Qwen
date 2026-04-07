// Extension Core — lifecycle, component registration
// No files are created automatically; everything depends on explicit user action.

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";
import { SidebarProvider } from "./views/sidebar";
import { ensureSettings, ensureGlobalPermissions, ensureMcpInQwenSettings } from "./setup";

let sidebarProvider: SidebarProvider | undefined;
let outputChannel: vscode.OutputChannel;

function log(msg: string) {
  outputChannel?.appendLine(`[Versus for Qwen] ${new Date().toISOString()} ${msg}`);
}

function checkPrerequisites(): boolean {
  const missing: string[] = [];

  const nodeResult = spawnSync("node", ["--version"], { encoding: "utf-8" });
  if (nodeResult.status !== 0 || nodeResult.error) {
    missing.push("**Node.js** — install from https://nodejs.org and restart VSCode.");
  }

  if (!vscode.extensions.getExtension("qwenlm.qwen-code-vscode-ide-companion")) {
    missing.push("**Qwen Code Companion** — install from the VSCode Marketplace (publisher: QwenLM).");
  }

  if (missing.length > 0) {
    const msg = `Versus for Qwen requires the following to work:\n${missing.join("\n")}\nThe extension will not function until these are installed.`;
    vscode.window.showErrorMessage(msg, "Open Marketplace").then((action) => {
      if (action === "Open Marketplace") {
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

          // Deploy bundles and configurations (only now, by user action)
          deployServer(extensionPath, workspacePath);
          ensureMcpInQwenSettings(workspacePath);
          ensureSettings(workspacePath);

          sidebarProvider?.refresh();
          vscode.window.showInformationMessage(
            `Project '${name}' initialized. Phase 0 — Problem Discovery.`
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

    log("Activation completed successfully.");
  } catch (err) {
    log(`ACTIVATION ERROR: ${String(err)}`);
    vscode.window.showErrorMessage(`Versus for Qwen: Activation error — ${String(err)}`);
  }
}

/**
 * Copies extension bundles to .versus/ in the workspace.
 * Only updates if content has changed (idempotent).
 */
function deployServer(extensionPath: string, workspacePath: string) {
  const bundleDir = path.join(extensionPath, "out", "bundle");
  const targetDir = path.join(workspacePath, ".versus");
  const files = ["inject-context.js", "phase-gate.js", "loop-detector.js", "server.js"];

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  for (const file of files) {
    const src = path.join(bundleDir, file);
    const dest = path.join(targetDir, file);
    if (!fs.existsSync(src)) continue;

    const srcContent = fs.readFileSync(src);
    if (fs.existsSync(dest) && srcContent.equals(fs.readFileSync(dest))) continue;

    fs.writeFileSync(dest, srcContent);
  }
}


export function deactivate() {
  sidebarProvider?.dispose();
}
