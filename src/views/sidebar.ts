// TreeView Sidebar — read-only view of the methodology state

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { PhaseState } from "../state/types";
import { getPhaseDefinition, getExitCriteriaForPhase } from "../rules/phases";
import { CRITERION_ID_MIGRATION } from "../rules/phases";

export class SidebarProvider implements vscode.TreeDataProvider<StateItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StateItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private state: PhaseState | null = null;
  private watcher: vscode.FileSystemWatcher | null = null;
  private lastPhase: number = -1;        // for transition detection
  private lastNotifiedPhase: number = -1; // deduplicates notifications
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private workspacePath: string) {
    this.loadState();
    this.setupWatcher();
  }

  refresh(): void {
    this.loadState();
    this._onDidChangeTreeData.fire(null);
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.watcher?.dispose();
    this._onDidChangeTreeData.dispose();
  }

  private loadState(): void {
    const statePath = path.join(this.workspacePath, ".versus", "state.json");
    try {
      if (fs.existsSync(statePath)) {
        const raw = fs.readFileSync(statePath, "utf-8");
        const prevPhase = this.state?.currentPhase ?? -1;
        this.state = JSON.parse(raw) as PhaseState;

        // Detect phase transition and notify user
        // Only notify if this state belongs to Qwen (prevents cross-extension duplicates)
        const isOurs = !this.state.agent || this.state.agent === "qwen";
        if (isOurs && prevPhase >= 0 && this.state.currentPhase !== prevPhase) {
          this.notifyPhaseTransition(this.state.currentPhase);
        }
        if (this.lastPhase < 0 && this.state) {
          this.lastPhase = this.state.currentPhase;
        } else if (this.state) {
          this.lastPhase = this.state.currentPhase;
        }
      } else {
        this.state = null;
      }
    } catch {
      this.state = null;
    }
  }

  /** Show VS Code notification when phase changes (deduplicated) */
  private notifyPhaseTransition(phase: number): void {
    if (phase === this.lastNotifiedPhase) return;
    this.lastNotifiedPhase = phase;
    const def = getPhaseDefinition(phase);
    if (!def) return;
    vscode.window.showInformationMessage(
      `Versus for Qwen: Phase ${phase} — ${def.name} started. ${def.userHint}`
    );
  }

  private debouncedRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, 300);
  }

  private setupWatcher(): void {
    const pattern = new vscode.RelativePattern(
      this.workspacePath,
      ".versus/state.json"
    );
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidChange(() => this.debouncedRefresh());
    this.watcher.onDidCreate(() => this.debouncedRefresh());
    this.watcher.onDidDelete(() => this.debouncedRefresh());
  }

  getTreeItem(element: StateItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StateItem): StateItem[] {
    if (!this.state) {
      return [new StateItem("No project initialized", "", "info")];
    }

    if (!element) {
      return this.getRootItems();
    }

    return element.children || [];
  }

  private getRootItems(): StateItem[] {
    if (!this.state) return [];

    const items: StateItem[] = [];

    // Project
    items.push(new StateItem(
      this.state.projectName,
      this.state.projectDescription,
      "project"
    ));

    // Current phase with hint child
    const phaseDef = getPhaseDefinition(this.state.currentPhase);
    const phaseName = phaseDef?.name ?? "Unknown";
    const phaseHint = phaseDef?.userHint ?? "";
    const phaseChildren: StateItem[] = [];
    if (phaseHint) {
      phaseChildren.push(new StateItem(phaseHint, "", "info"));
    }
    const phaseItem = new StateItem(
      `Phase ${this.state.currentPhase} — ${phaseName}`,
      `Iteration ${this.state.currentIteration}`,
      "phase",
      phaseChildren
    );
    phaseItem.tooltip = `Phase ${this.state.currentPhase} — ${phaseName}\n${phaseHint}\nIteration ${this.state.currentIteration}`;
    items.push(phaseItem);

    // Score (if Phase 0)
    if (this.state.phase0Score !== null) {
      const scoreIcon = this.state.phase0Score >= 90 ? "pass" : "warning";
      items.push(new StateItem(
        `Score Phase 0: ${this.state.phase0Score}/100`,
        this.state.phase0Score >= 90 ? "Threshold reached" : "Below threshold (90)",
        scoreIcon
      ));
    }

    // Exit Criteria for current phase
    items.push(this.buildExitCriteriaItem());

    // Decisions
    const decisionsItem = new StateItem(
      `Decisions: ${this.state.decisions.length}`,
      "",
      "decisions",
      this.state.decisions.slice(-5).map(
        (d) => new StateItem(
          `[P${d.phase}] ${d.category}`,
          d.content.length > 80 ? d.content.substring(0, 80) + "..." : d.content,
          "decision"
        )
      )
    );
    items.push(decisionsItem);

    // Safeguards
    const violated = this.state.safeguards.filter((s) => s.status === "violated");
    const warnings = this.state.safeguards.filter((s) => s.status === "warning");
    const sgIcon = violated.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
    const sgItem = new StateItem(
      `Safeguards`,
      `${violated.length} violated, ${warnings.length} warnings`,
      sgIcon,
      this.state.safeguards.map(
        (s) => new StateItem(
          `${s.id}: ${s.status}`,
          s.details || "",
          s.status === "violated" ? "error" : s.status === "warning" ? "warning" : "pass"
        )
      )
    );
    items.push(sgItem);

    // Last updated
    const updated = new Date(this.state.updatedAt);
    items.push(new StateItem(
      `Updated: ${updated.toLocaleString("en-US")}`,
      "",
      "info"
    ));

    return items;
  }

  /** Build exit criteria section for current phase */
  private buildExitCriteriaItem(): StateItem {
    const state = this.state!;
    const phase = state.currentPhase;
    const defs = getExitCriteriaForPhase(phase);

    const children = defs.map((def) => {
      // Look up state, handling both old Portuguese IDs and new English IDs
      const stateEntry = state.exitCriteria.find(
        (c) => c.phase === phase && (c.criterion === def.criterion || CRITERION_ID_MIGRATION[c.criterion] === def.criterion)
      );
      const met = stateEntry?.met ?? false;
      const icon = met ? "pass" : def.required ? "warning" : "info";
      return new StateItem(
        def.description,
        met ? "met" : def.required ? "required" : "optional",
        icon
      );
    });

    const metCount = defs.filter((def) => {
      const stateEntry = state.exitCriteria.find(
        (c) => c.phase === phase && (c.criterion === def.criterion || CRITERION_ID_MIGRATION[c.criterion] === def.criterion)
      );
      return stateEntry?.met ?? false;
    }).length;

    const allRequiredMet = defs
      .filter((d) => d.required)
      .every((def) => {
        const stateEntry = state.exitCriteria.find(
          (c) => c.phase === phase && (c.criterion === def.criterion || CRITERION_ID_MIGRATION[c.criterion] === def.criterion)
        );
        return stateEntry?.met ?? false;
      });

    const rootIcon = allRequiredMet ? "pass" : "exit-criteria";

    const item = new StateItem(
      `Exit Criteria [${metCount}/${defs.length}]`,
      allRequiredMet ? "Ready to advance" : "",
      rootIcon,
      children
    );
    item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    return item;
  }

}

class StateItem extends vscode.TreeItem {
  children?: StateItem[];

  constructor(
    label: string,
    description: string,
    iconType: string,
    children?: StateItem[]
  ) {
    super(
      label,
      children && children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    this.description = description;
    this.children = children;
    this.iconPath = StateItem.getIcon(iconType);
    this.tooltip = description || label;
  }

  private static getIcon(type: string): vscode.ThemeIcon {
    switch (type) {
      case "project": return new vscode.ThemeIcon("folder");
      case "phase": return new vscode.ThemeIcon("layers");
      case "pass": return new vscode.ThemeIcon("check", new vscode.ThemeColor("testing.iconPassed"));
      case "warning": return new vscode.ThemeIcon("warning", new vscode.ThemeColor("testing.iconQueued"));
      case "error": return new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
      case "exit-criteria": return new vscode.ThemeIcon("tasklist");
      case "decisions": return new vscode.ThemeIcon("checklist");
      case "decision": return new vscode.ThemeIcon("arrow-right");
      case "info": return new vscode.ThemeIcon("info");
      default: return new vscode.ThemeIcon("circle-outline");
    }
  }
}
