# Versus for Qwen

**IACDM (Iterative Adversarial Convergence Development Methodology) orchestrator for Qwen Code.**

An original methodology created by [Jasmine Moreira](https://github.com/jasminemoreira) that transforms LLMs from reactive code generators into disciplined agents following a structured 8-phase process — from problem discovery to delivery with tests and post-review.

## Why?

AI coding tools (Lovable, Cursor, Claude Code, Qwen Code, ChatGPT) all share the same fundamental limitation: **zero internal verification capability**. They generate statistically plausible output without distinguishing correct code from incorrect code. The METR study (2025) showed experienced developers using AI tools were actually **19% slower** — despite believing they were 20% faster.

**The real distinction isn't between tools — it's between process and no process.**

Versus implements the AG/AV (Generative Agent / Verification Agent) model: the AI generates, external agents (automated tests + human operator) verify at discrete **gates**. Errors are caught at the earliest possible phase, not in production.

## Features

- **8 sequential phases** with verifiable exit criteria — no skipping steps
- **8 safeguards (S0-S7)** that prevent common AI agent errors (premature convergence, scope creep, reimplementation)
- **Convergence score** (0-100) that gates advancement until the problem is truly understood
- **15 MCP tools** for state management, decision recording, phase transitions, and meta-iteration (v1→v2)
- **6 Qwen Code hooks** — context injection, edit blocking in early phases, loop detection, destructive command blocking, truncation detection, stop verification
- **Persistent decision registry** that survives context switches
- **Gateway guard** that detects when models skip loading context
- **Adversarial critique** with 7 universal + 8 conditional specialized lenses
- **VS Code sidebar** showing methodology state in real time
- **Multi-session testing protocol** for Phase 6 continuity across sessions
- **Phase 6 session renewal** to decouple implementer from tester (reduces confirmation bias)
- **UI testing tooling proposal** — Phase 6 detects UI modules from Phase 1 and offers stack-appropriate browser/automation tools (Playwright, Puppeteer, Cypress, Detox, Maestro, etc.) via interactive selection
- **Production Capacity Check** in Phase 0 — mandatory asset inventory (authoring/visual/audio/data/integrations) before P0 score can converge, preventing "complete product" targets without production capacity
- **AP10 — Silent Scope Deferral** — new antipattern blocking `met=true` with prose like "will be done in next cycle"; the inverse of AP9 (silent scope creep)
- **Empirical `ui_runnable`** — exit criterion now requires explicit user confirmation that a P0 use case was executed end-to-end (literal user confirmation captured in `details`), not just "UI rendered"

## How It Works

```
Phase 0: Problem Discovery    → HSA 5-level exploration (score >= 90 to advance)
Phase 1: Architecture         → Define modules, interfaces, patterns
Phase 2: Adversarial Critique → Attack the architecture with specialized lenses
Phase 3: Simplification       → Address criticals, simplify (loops with Phase 2)
Phase 4: Convergence Gate     → Validate all exit criteria + safeguards
Phase 5: Implementation       → Code the final architecture
Phase 6: Tests                → 100% passing + exploratory testing
Phase 7: Post-Review          → Double-loop learning: evaluate product AND process
```

### Phase 0: Hierarchical Semantic Analysis (HSA)

The most distinctive contribution. Structures problem exploration in 5 levels, each building on the previous:

| Level | Focus | What is sought |
|---|---|---|
| 1. Domain | Universe where the problem exists | Vocabulary, theoretical/technical field, tools, state of the art |
| 2. Problem | What needs to be solved | 5W1H: who, what, when, where, why, how solved today |
| 3. Elements | Parts composing the problem | Components, entities, actors, constraints |
| 4. Processes | How parts relate | Flows, transformations, dependencies, feedback cycles |
| 5. Product | Expected outcome | Deliverables, acceptance criteria, success metrics |

### Context Efficiency

The methodology maximizes `E = I₀/C` (relevant information / total context consumed) through granularization: each session focuses on one module with just its interface signatures, keeping context efficiency near 1.0 instead of degrading to 0.3+ in monolithic sessions.

## Quick Start

1. Install the extension
2. Open the Command Palette (`Ctrl+Shift+P`) and run **Versus Qwen: Initialize Project**
3. Enter a project name and description when prompted
4. Open a **new Qwen Code conversation** (the extension configures hooks and MCP on initialization)
5. Type **`start`** — Qwen will automatically load the methodology state and begin Phase 0

> **Important:** After initializing, always start a **new conversation** so Qwen picks up the MCP server and hooks. If Qwen doesn't use MCP tools, run "Developer: Reload Window" from the Command Palette.

## Qwen Code Hooks

| Hook | Event | Function |
|---|---|---|
| **inject-context** | `UserPromptSubmit` | Injects phase, score, and recent decisions into each prompt |
| **phase-gate** | `PreToolUse` (edit/write_file) | Blocks code editing in Phases 0-4 |
| **loop-detector** | `PreToolUse` (bash) | Detects repetitive test executions (>3x) |
| **block-destructive** | `PreToolUse` (bash) | Blocks destructive commands (rm -rf, force push, DROP TABLE) |
| **truncation-check** | `PostToolUse` (grep_search/bash) | Detects when tool output was truncated |
| **stop-verify** | `Stop` | Verifies code compiles and tests pass before completing |

## The 8 Safeguards

| ID | Name | Protects Against |
|---|---|---|
| S0 | Problem Convergence | Advancing without understanding the problem |
| S1 | Anti-Bug | Simplification that introduces bugs |
| S2 | Stopping Criterion | AI deciding when to stop (user's decision) |
| S3 | Premature Convergence | Stopping iteration too early |
| S4 | Explicit Verification | Skipping human validation at gates |
| S5 | Scope Preservation | Scope creep during critique-simplification |
| S6 | Do Not Reimplement | Recreating what already exists |
| S7 | Sequence Discipline | Starting tangential discussions during implementation |

## The AG/AV Model

```
F₀ → G₀ → F₁ → G₁ → ... → Fₙ → Gₙ → delivery
      ↑              ↑                    ↑
  AV evaluates   AV evaluates        AV evaluates
```

- **AG (Generative Agent):** The LLM. Produces artifacts without verification capability.
- **AV-automatic:** Tests, linters, compilers — binary verdict on formalizable properties.
- **AV-human:** The operator — evaluates semantic adequacy, usability, domain correctness.
- **Gate (Gₖ):** Discrete point where progression requires AV approval. Rejection feeds concrete error information back to AG.

## LLM Compatibility

The IACDM methodology demands strict instruction following, reliable MCP tool calling, and sustained reasoning across long contexts. Not all models meet these requirements equally.

### Selection Criteria

| Criterion | Why it matters |
|---|---|
| Instruction following | Each phase has detailed behavioral rules (~2-4k tokens). Models that summarize or skip steps break the methodology |
| MCP tool reliability | The methodology relies on 15 tools being called consistently. Models that "narrate" tool calls instead of executing them are incompatible |
| Context window | Phases 0-2 accumulate significant context. Minimum 32k tokens, recommended 128k+ |
| Reasoning depth | Phases 0-4 (design) require architectural analysis, not code generation. Shallow reasoning produces shallow designs |

### Model Recommendation

| Strategy | Phases 0-4 (Design) | Phases 5-7 (Code) | Best for |
|---|---|---|---|
| Maximum quality | Qwen3 (largest) | Qwen3 (largest) | Critical/high-complexity projects |
| Optimal cost/quality | Qwen3 (largest) | Qwen3 (balanced) | Most projects — leverages the LLM Switch Point |
| Budget | Qwen3 (balanced) | Qwen3 (balanced) | Medium-complexity projects |

### LLM Switch Point

The methodology includes a natural **LLM Switch Point at Phase 4**. The architecture is fully validated and persisted in `state.json` + `specs/`, so no context is lost when switching models.

> **Rule of thumb:** The cost of architectural error (detected in Phase 5-6) is 10-100x the cost of using a more capable model in Phases 0-4. Invest in reasoning where reasoning matters.

### Built-in Protections for Weaker Models

| Mechanism | Protects against |
|---|---|
| Gateway Guard | Model forgetting to load context (>30min without `get_phase_state`) |
| Phase Gate hook | Code editing in Phases 0-4 (blocked regardless of model) |
| Loop Detector | Repetitive patterns (>3x same action) — safeguard S7 |
| Compact Guidance | Summarized instructions injected into every prompt via hook |
| Phase 7 Engine Hint | Forces meta-iteration offer even if model didn't read guidance |

## Requirements

| Requirement | Minimum | Why |
|---|---|---|
| **VS Code** | >= 1.85.0 | Extension API compatibility |
| **Node.js** | >= 18.0.0 | Runs the MCP server (`node .versus/server.js`) |
| **Qwen Code Companion** | Latest | Extension for MCP and hooks |

> **Node.js is mandatory.** Without it, the MCP server cannot start and Qwen will ignore the methodology entirely. Install from [nodejs.org](https://nodejs.org).

## Related Extensions

- **[Versus for Claude](https://marketplace.visualstudio.com/items?itemName=jasminemoreira.versus-claude)** — IACDM for Claude Code
- **[Versus for Copilot](https://marketplace.visualstudio.com/items?itemName=jasminemoreira.versus-copilot)** — IACDM for GitHub Copilot Agent Mode

All extensions share the same `.versus/state.json` format.

## References

- Source methodology: **[Versus](https://github.com/jasminemoreira/Versus)** — canonical repository with the methodology's theory, history, and evolution.
- Academic paper: **[arxiv:2604.16399](https://arxiv.org/abs/2604.16399)** — formal description of IACDM.

## License

[MIT](LICENSE) - Created by [Jasmine Moreira](https://github.com/jasminemoreira).
