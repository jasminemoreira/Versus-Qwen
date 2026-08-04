// MCP Tools: project initialization

import * as fs from "fs";
import * as path from "path";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../../state/engine";
import { ensureSettings, ensureMcpInQwenSettings, ensureSpecsReadme, ensureCommonjsPin } from "../../setup";

const SPECS_SUBDIRS = [
  "references",
  "domain",
  "technical",
  "examples",
  "design",
  "models",
  "datasets",
  "validation",
  "competitors",
];

const BUNDLE_FILES = ["inject-context.js", "phase-gate.js", "loop-detector.js", "stop-verify.js", "truncation-check.js", "block-destructive.js", "server.js"];

/**
 * Resolves the bundle directory.
 * If running from bundle (out/bundle/server.js) → bundles are in the same dir (__dirname).
 * If running from source (out/mcp/tools/project-tools.js) → bundles in out/bundle/.
 */
function getBundleDir(): string {
  if (fs.existsSync(path.join(__dirname, "inject-context.js"))) {
    return __dirname;
  }
  return path.resolve(__dirname, "..", "..", "bundle");
}

/**
 * Copies the bundles to .versus/qwen/ in the project (own subfolder so they
 * never collide with the sibling Versus extensions). Returns true if any file
 * was created/updated.
 */
function deployBundles(workspace: string): boolean {
  const bundleDir = getBundleDir();
  const targetDir = path.join(workspace, ".versus", "qwen");

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Immunize the deploy dir against a project-level "type":"module".
  ensureCommonjsPin(targetDir);

  let deployed = false;
  for (const file of BUNDLE_FILES) {
    const src = path.join(bundleDir, file);
    const dest = path.join(targetDir, file);

    if (!fs.existsSync(src)) {
      continue; // bundle not found, skip
    }

    const srcContent = fs.readFileSync(src);
    const destExists = fs.existsSync(dest);
    const destContent = destExists ? fs.readFileSync(dest) : null;

    if (!destExists || !srcContent.equals(destContent!)) {
      fs.writeFileSync(dest, srcContent);
      deployed = true;
    }
  }

  return deployed;
}

// MCP registration is handled by ensureMcpInQwenSettings from setup.ts

export const initProjectTool: Tool = {
  name: "init_project",
  description:
    "Initializes a project with the Iterative Convergence methodology. Supports two modes:\n\n" +
    "**GREENFIELD** (empty workspace, no existing code): call directly with name + description. Phase 0 starts with full HSA exploration of the new domain.\n\n" +
    "**BROWNFIELD BOOTSTRAP** (workspace has existing code): before calling, you MUST follow this protocol:\n\n" +
    "1. Detect existing code: check for README.md, root config files (package.json, requirements.txt, Cargo.toml, pom.xml, tsconfig.json, etc.), and a non-empty src/ or lib/ directory. If detected, you are in brownfield mode.\n\n" +
    "2. Read SURFACE files only (do NOT read implementations): README.md, root configs, directory listing of src/ or lib/ (names only, not file contents).\n\n" +
    "3. Infer: tech stack (from configs), module map (from directory structure), apparent use cases (from README/CLI/routes), domain vocabulary (from naming patterns).\n\n" +
    "4. Present a Bootstrap Proposal in chat (⚠️ MUST DISPLAY) with two sections:\n" +
    "   - **Inferred from code:** stack, modules, apparent use cases, domain vocabulary\n" +
    "   - **Required from user:** locked constraints (public APIs / DB schema / contracts that cannot change), high-inertia areas (have tests, change carefully), open areas (free to evolve)\n" +
    "   - **Granularity recommendation:** the next development cycle should focus on a SMALL unit (one module / one feature / one layer). Versus produces better results with scoped work, not 'evolve everything at once'.\n\n" +
    "5. Wait for user confirmation in a single chat turn (user reviews everything, corrects what is wrong, declares constraints).\n\n" +
    "6. After confirmation, call init_project with the bootstrap_data parameter populated. The `description` field should describe the NEXT change/feature the user wants to make, not the existing project.\n\n" +
    "If a project is already initialized (.versus/state.json exists), call get_phase_state instead — do NOT re-init.",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "Project name.",
      },
      description: {
        type: "string",
        description: "Brief project description. In brownfield mode, describe the next change/feature, not the existing project.",
      },
      bootstrap_data: {
        type: "object",
        description: "Brownfield bootstrap data captured before init. Omit for greenfield projects.",
        properties: {
          stack: { type: "array", items: { type: "string" }, description: "Tech stack inferred from configs and confirmed by user." },
          patterns: { type: "array", items: { type: "string" }, description: "Architectural patterns observed in existing code." },
          constraints: { type: "array", items: { type: "string" }, description: "Locked constraints declared by user." },
          apparent_use_cases: { type: "array", items: { type: "string" }, description: "Use cases inferred and confirmed." },
          domain_vocabulary: { type: "array", items: { type: "string" }, description: "Domain terms from naming patterns." },
          module_map: { type: "array", items: { type: "string" }, description: "Module names with brief responsibility." },
        },
      },
    },
    required: ["name", "description"],
  },
};

interface BootstrapData {
  stack?: string[];
  patterns?: string[];
  constraints?: string[];
  apparent_use_cases?: string[];
  domain_vocabulary?: string[];
  module_map?: string[];
}

export function handleInitProject(
  engine: StateEngine,
  args: { name: string; description: string; bootstrap_data?: BootstrapData }
): string {
  const existing = engine.getPhaseState();
  if (existing) {
    return JSON.stringify({
      success: false,
      error: `Project '${existing.projectName}' already exists (Phase ${existing.currentPhase}). Use get_phase_state to query.`,
    });
  }

  const state = engine.initProject(args.name, args.description);
  const workspace = engine.getWorkspace();
  const isBrownfield = !!args.bootstrap_data;

  if (args.bootstrap_data) {
    const bd = args.bootstrap_data;
    if (bd.stack || bd.patterns || bd.constraints) {
      engine.updateProjectSpec({
        stack: bd.stack ?? [],
        patterns: bd.patterns ?? [],
        constraints: bd.constraints ?? [],
        outOfScope: [],
      });
    }
    if (bd.apparent_use_cases?.length) {
      engine.recordDecision(0, "scope", `AS-IS USE CASES (existing system): ${bd.apparent_use_cases.join("; ")}`);
    }
    if (bd.domain_vocabulary?.length) {
      engine.recordDecision(0, "constraint", `AS-IS DOMAIN VOCABULARY: ${bd.domain_vocabulary.join(", ")}`);
    }
    if (bd.module_map?.length) {
      engine.recordDecision(1, "architecture", `AS-IS MODULE MAP (existing decomposition): ${bd.module_map.join("; ")}`);
    }
    if (bd.constraints?.length) {
      engine.recordDecision(0, "constraint", `LOCKED CONSTRAINTS (cannot change without breaking): ${bd.constraints.join("; ")}`);
    }
  }

  // Copy bundles to .versus/qwen/ of the project
  const bundlesDeployed = deployBundles(workspace);

  // Create specs/ and subfolders if they don't exist
  const specsDir = path.join(workspace, "specs");
  let specsCreated = false;
  if (!fs.existsSync(specsDir)) {
    for (const sub of SPECS_SUBDIRS) {
      fs.mkdirSync(path.join(specsDir, sub), { recursive: true });
    }
    specsCreated = true;
  }
  // Write specs/README.md (idempotent — never overwrites user edits)
  ensureSpecsReadme(workspace);

  // Pre-populate specs/ with bootstrap data (brownfield mode)
  if (args.bootstrap_data) {
    const bd = args.bootstrap_data;
    if (bd.stack?.length) {
      const stackPath = path.join(specsDir, "technical", "AS-IS-stack.md");
      if (!fs.existsSync(stackPath)) {
        fs.writeFileSync(stackPath, `# AS-IS Tech Stack\n\nCaptured during bootstrap. Confirmed by user.\n\n${bd.stack.map((s) => `- ${s}`).join("\n")}\n`, "utf-8");
      }
    }
    if (bd.module_map?.length) {
      const modulePath = path.join(specsDir, "references", "AS-IS-modules.md");
      if (!fs.existsSync(modulePath)) {
        fs.writeFileSync(modulePath, `# AS-IS Module Map\n\nExisting decomposition captured during bootstrap.\n\n${bd.module_map.map((m) => `- ${m}`).join("\n")}\n`, "utf-8");
      }
    }
    if (bd.domain_vocabulary?.length) {
      const vocabPath = path.join(specsDir, "domain", "AS-IS-vocabulary.md");
      if (!fs.existsSync(vocabPath)) {
        fs.writeFileSync(vocabPath, `# AS-IS Domain Vocabulary\n\nExtracted from existing code naming patterns.\n\n${bd.domain_vocabulary.map((v) => `- ${v}`).join("\n")}\n`, "utf-8");
      }
    }
  }

  // Ensure MCP server registered in .qwen/settings.json
  const mcpCreated = ensureMcpInQwenSettings(workspace);

  // Ensure settings.json with permissions and hooks
  const settingsUpdated = ensureSettings(workspace);

  const settingsPath = path.join(workspace, ".qwen", "settings.json");

  const baseMessage =
    `NEW PROJECT '${args.name}' initialized in ${workspace}. ` +
    `This is an INDEPENDENT and AUTONOMOUS project — DO NOT fetch specs, decisions, or code from other projects. ` +
    `Structure created: .versus/state.json (shared), server.js + hooks (in .versus/qwen/), specs/ (9 subfolders), .qwen/settings.json (MCP + hooks). ` +
    `Everything local — no external dependencies. ` +
    `MANDATORY ACTION: Read ${settingsPath} with the Read tool to load permissions and hooks. ` +
    `Then call get_phase_guidance() for Phase 0 instructions. ` +
    `USER TIP: the user can type "retomar Versus" in chat at any time to recover methodology context — treat that phrase as an instruction to call get_phase_state() + get_phase_guidance() + get_decisions().`;

  const brownfieldMessage = isBrownfield
    ? ` ⚠️ BROWNFIELD MODE: bootstrap_data was applied. The existing system context is captured in projectSpec (stack, patterns, constraints) and as AS-IS decisions in P0/P1. Phase 0 should now run in DELTA MODE: explore ONLY the new change/feature described, NOT the existing domain. Skip HSA Level 1 (Domain) — it is already captured. Focus Levels 2-5 on the delta. Production Capacity Check should ask about capacity to MODIFY the existing system, not produce from scratch. Granularity guidance: the user was advised to focus the cycle on a small unit (one module / one feature / one layer) — respect that scope.`
    : "";

  return JSON.stringify({
    success: true,
    projectName: state.projectName,
    currentPhase: state.currentPhase,
    workspace,
    mode: isBrownfield ? "brownfield" : "greenfield",
    bundlesDeployed,
    specsCreated,
    mcpCreated,
    settingsUpdated,
    message: baseMessage + brownfieldMessage,
  });
}
