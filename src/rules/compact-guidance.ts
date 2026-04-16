// Compact behavioral guidance per phase — consumed by the UserPromptSubmit hook (inject-context.ts).
// Each phase returns a minimal string[] to minimize token overhead per message.
//
// MAINTENANCE CHECKLIST — run when changing full guidance (full-guidance.ts):
// □ Lens names changed?           → Update (1)Assumptions... list in case 2
// □ Transition sequence changed?  → Update AFTER/WHEN lines in affected case
// □ New R5 mandatory display?     → Update R5 reminder line in affected case
// □ New MCP tool name added?      → Update tool call references in affected case
// □ Run `npm test`                → compact content tests catch missing key terms automatically

export function getCompactGuidance(phase: number): string[] {
  const lines: string[] = [];

  switch (phase) {
    case 0: // ← full: PHASE_0_GUIDANCE — HSA, scoring, teach-back, feasibility tiers
      lines.push("INSTRUCTIONS P0: FIRST ask Delivery Target (Complete product / MVP / Prototype) via AskUserQuestion — record_decision(category='scope', content='DELIVERY TARGET: ...'). THEN HSA 5-level exploration (1.Domain 2.Problem-5W1H 3.Elements 4.Processes 5.Product). AskUserQuestion per level. Mandatory teach-back. Technical+scientific research if specialized domain. Tier 1/2/3 feasibility. Score ≥90."); // ← [DELIVERY TARGET first, HIERARCHICAL SEMANTIC ANALYSIS]
      lines.push("R2: Every decision via AskUserQuestion. AP1: GENERATION mode — produce failure scenarios ('how does this fail?'), not quality judgments ('is this good?')."); // ← [R2, AP1]
      lines.push("R5: MUST DISPLAY score breakdown table + teach-back synthesis + delivery target question. If you computed it, SHOW it."); // ← [CONVERGENCE ASSESSMENT, VALIDATION, TEACH-BACK]
      lines.push("FLOW: After recording user answers → proceed IMMEDIATELY to next HSA level or to synthesis. NEVER write 'I will proceed with X' as text and stop — just do X."); // ← [HSA flow, Synthesis timing]
      lines.push("AFTER SCORE: score ≥90 → advance_phase() to Phase 1, then IMMEDIATELY call get_phase_guidance() and begin Phase 1 work — do NOT stop. Score <90 → call start_iteration() and continue HSA focusing on lowest-scoring criteria. Do NOT offer to advance."); // ← [CONVERGENCE ASSESSMENT → ≥90 / <90]
      lines.push("DO: Ask questions, explore the problem, populate specs/. | DON'T: Write source code (even via terminal), jump to solutions, skip HSA levels, stop after displaying score."); // ← [Step 0, Implementation Feasibility]
      break;
    case 1: // ← full: PHASE_1_GUIDANCE — 4 architecture questions, patterns, granularity
      lines.push("INSTRUCTIONS P1: 4 questions (Decomposition, Interfaces, Assumptions, Negative scope). 2 AskUserQuestion calls (patterns). Granularity: each module fits in 1 AI session. UI MODULE: if project requires UI, list it as an explicit named module in decomposition with its own interface contract — never as an implied extension of backend."); // ← [4 architecture questions, Granularity, UI explicit module]
      lines.push("FLOW: After recording user answers → proceed IMMEDIATELY to draft the 4 architecture answers (decomposition, interfaces, assumptions, negative scope) and present the pattern summary table. NEVER write 'I will draft X next' as text and stop — just do it."); // ← [P1 intra-phase flow]
      lines.push("R2+R4: specs/technical,models,examples. AP3: plan decoupled sessions for P5-P6. R5: MUST DISPLAY 4 architecture answers + pattern table + tech comparison."); // ← [R2, R4, AP3, R5]
      lines.push("WHEN DONE: After user confirms architecture → call update_project_spec(stack=[approved techs], outOfScope=[items NOT done], patterns=[architectural patterns], constraints=[hard constraints]), then advance_phase(), then get_phase_guidance() and begin Phase 2 immediately."); // ← [update_project_spec / Exit criteria / transition to P2]
      lines.push("DO: Define modules, interfaces, patterns via AskUserQuestion. | DON'T: Write implementation code, create source files, start coding."); // ← [AP3, Decoupled session principle]
      break;
    case 2: // ← full: PHASE_2_GUIDANCE — 7 universal lenses, conditional lenses, DTLs, protocol, matrix
      lines.push("INSTRUCTIONS P2: STEP 1 — Record activated lenses FIRST: call record_decision(category='architecture', content='ACTIVATED LENSES: [list]. NOT ACTIVATED: [lens — reason]') before starting critique. STEP 2 — Apply ALL 7 UNIVERSAL lenses on EACH module → 🔴🟡🟢: (1)Assumptions (2)Architectural (3)Implementability (4)Scientific (5)Security (6)Performance (7)Regulatory. Then apply all activated conditional lenses. Absence of findings is valid — do NOT skip any lens. Matrix + concentration analysis (module×lenses). ASYMMETRY: multiple agents attack, unified responds in P3."); // ← [Universal Lenses table, Conditional lens activation, Protocol per lens]
      lines.push("MODULE BOUNDARY: Apply lenses to ONLY the modules defined in P1 — do NOT propose new module boundaries or restructure decomposition here. If module granularity is insufficient, flag it as a finding for P3 to resolve."); // ← [P1 module boundary enforcement in P2]
      lines.push("FLOW: After recording activated lenses → immediately start applying them (lens 1 on all modules → lens 2 → ... → exit gate). NEVER write 'I will now apply lens X' as text and stop — just apply it."); // ← [P2 intra-phase flow]
      lines.push("BOUNDARY: do NOT cut/add requirements. P1 negative scope items CANNOT become implementation proposals — flag as out-of-scope if they appear. AP1: GENERATION mode — 'how does this fail?' (generative, no bias anchor), not 'is this good?' (evaluative, confirms your own output). R5: MUST DISPLAY full coverage matrix + concentration analysis + exit gate summary."); // ← [Coverage Matrix, Concentration analysis, Exit Gate, P1 negative scope guard]
      lines.push("AFTER GATE: If findings → YOUR NEXT TOOL CALL is advance_phase() to Phase 3 — do NOT write 'advancing' as text, then get_phase_guidance() and begin Phase 3. If zero findings → AskUserQuestion (Phase 3 optional or Phase 4). Do NOT block on 🔴 count — criticals are addressed IN Phase 3."); // ← [Exit Gate]
      lines.push("DO: Record lenses, apply all, advance to Phase 3 after gate. | DON'T: Block advancement because of 🔴 criticals, stop silently after gate summary, skip any lens."); // ← [Protocol per lens, AP1]
      break;
    case 3: // ← full: PHASE_3_GUIDANCE — simplification, change %, recommendation, anti-scope-creep
      lines.push("INSTRUCTIONS P3: Simplify V(N)→V(N+1) with UNIFIED vision. AI COMPUTES structural change % and critical count, then presents recommendation. User confirms or overrides. Anti-scope-creep checklist."); // ← [Purpose, Step 3 recommendation]
      lines.push("FLOW: Immediately compute change % and critical count, then display recommendation and checklist — all in one continuous turn. NEVER write 'I will compute X' as text and stop — just compute and display."); // ← [P3 intra-phase flow]
      lines.push("ASYMMETRY: integrate all corrections into the whole. AP2: simplify, not complexify. AP8: don't seek perfection. R5: MUST DISPLAY computed % + criticals + recommendation + checklist ✅/❌. Do NOT ask user to choose percentage range."); // ← [Asymmetry principle, AP2, AP8, R5]
      lines.push("AFTER CONFIRMATION: YOUR NEXT TOOL CALL — '→ Phase 4': advance_phase() then get_phase_guidance() and begin P4. 'More iterations': start_iteration() then advance_phase() to Phase 2, then get_phase_guidance(). Do NOT write 'advancing' as text — call the tool immediately."); // ← [Step 4 — Post-cycle decision]
      lines.push("ANTI-SCOPE-CREEP checklist (MUST DISPLAY ✅/❌ for each): 1. All P0 use cases still covered. 2. No unsolicited features added. 3. WHAT the system does hasn't changed (only HOW). 4. P1 negative scope is still negative — no item from P1 'NOT do' list was silently promoted."); // ← [P3 anti-scope-creep — P1 negative scope guard added]
      lines.push("DO: Simplify architecture, address criticals, compute change %, verify P1 negative scope. | DON'T: Add features, increase complexity, stop after confirmation without executing the action."); // ← [AP2, S5, Anti-scope-creep checklist]
      break;
    case 4: // ← full: PHASE_4_GUIDANCE — convergence verification, safeguards, LLM switch
      lines.push("INSTRUCTIONS P4: Convergence gate. Exit criteria P2-P3 + safeguards S1-S5 + 4 P1 questions + specs/ complete. get_exit_criteria() + check_all_safeguards()."); // ← [Convergence verification report]
      lines.push("FLOW: Call get_exit_criteria() then check_all_safeguards() then display convergence report — all in one continuous turn. NEVER write 'I will now call X' as text and stop — just call it."); // ← [P4 intra-phase flow]
      lines.push("WHEN ALL ✅: call advance_phase() to Phase 5, then get_phase_guidance() and begin Phase 5 immediately. R5: MUST DISPLAY convergence report ✅/❌. LLM Switch notification is in full guidance (get_phase_guidance()) — do NOT display it again in this turn."); // ← [LLM Switch dedup, Exit Gate P4→P5]
      lines.push("DO: Verify all exit criteria, run safeguard checks, check specs/. | DON'T: Skip verification steps, advance without confirming convergence, display LLM Switch notification twice."); // ← [Steps 1-6]
      break;
    case 5: // ← full: PHASE_5_GUIDANCE — implementation, S6 tiers, S7 progress, decoupled sessions
      lines.push("INSTRUCTIONS P5: Consult specs/ BEFORE each module (specs/technical, specs/examples, specs/models). S6: Tier 1(lib)→2(port)→3(new). S7: After each module, run ADVERSARIAL MICRO-CHECK: 'Where does this implementation DIVERGE from spec?' — find differences, do NOT validate. Fix any divergence before the next module. Do NOT write text between modules — YOUR NEXT TOOL CALL must be the first tool call of module X+1."); // ← [BEFORE each module, S6, S7 + adversarial micro-check]
      lines.push("FLOW: [per module: consult specs/ → implement → micro-check divergence → fix if needed → next] → scope inventory → advance. NEVER write text between modules ('X/N completed', 'I will now implement X', 'Next:') — just execute the next tool call."); // ← [P5 intra-phase flow — text output ends turn, micro-check + scope inventory]
      lines.push("BINDING CONSTRAINTS: The tech stack, patterns, and out-of-scope items decided in P1/P3 are HARD CONSTRAINTS — visible in the 'Decision history' above. DO NOT introduce any library, framework, runtime, or technology not explicitly selected in P1. If the decision says 'vanilla JS', do not use Node.js. If it says 'no framework', do not use one."); // ← [P1 decision enforcement]
      lines.push("Do NOT ask permission between files — implement autonomously. AP7: never code without reference. STOP only for blockers or >2 iter on same module."); // ← [AP7]
      lines.push("WHEN ALL MODULES DONE: run SCOPE INVENTORY (⚠️ MUST DISPLAY ✅/❌): 1. All P1 modules present in codebase? 2. All specs/validation requirements covered? 3. UI runnable? If UI module in P1: implemented + accessible for manual testing → mark_exit_criteria(phase=5, criterion='ui_runnable', met=true). If no UI → mark_exit_criteria(phase=5, criterion='ui_runnable', met=true, details='N/A—backend-only'). Fix any ❌ before advancing. WHEN SCOPE INVENTORY ALL ✅: do NOT end your response after the inventory table — your VERY NEXT action must be a tool call to advance_phase() (no text between the table and the tool call). Then call get_phase_guidance() and begin Phase 6. Never return control to the user between inventory and advance_phase()."); // ← [Scope inventory — presence/absence check — P5 exit gate — ui_runnable]
      lines.push("DO: Implement modules sequentially, micro-check divergence after each, run scope inventory before advancing. | DON'T: Validate instead of seeking divergence, introduce unapproved tech, run tests — that is Phase 6."); // ← [Validation Session, AP3, anti-AP1]
      break;
    case 6: // ← full: PHASE_6_GUIDANCE — spec-driven testing, test map, manual testing handoff
      lines.push("INSTRUCTIONS P6: SPEC-DRIVEN testing — test against SPECS, not implementation. Step 1: Review Decision history above (P0 use cases + P3 scope revisions) + read specs/validation + specs/technical. P3 may have revised scope boundaries — merge both. Step 2: build Test Map (⚠️ MUST DISPLAY) mapping every spec→test with Type(positive/negative). Every use case: ≥1 positive + ≥1 negative. Ratio: 1 negative per 2 positives minimum."); // ← [Step 1, Step 2 — Test Map, P3 scope merge]
      lines.push("FLOW: Recover scope → build Test Map → execute automated tests → record coverage → hand off to user — all without stopping to announce next steps. NEVER write 'I will now test X' as text and stop — just do it."); // ← [P6 intra-phase flow]
      lines.push("DISTINGUISH 'test green' vs 'spec met': test must verify EXACT criterion (not proxy). Step 3: record_decision(category='spec-coverage') with COVERED/NOT COVERED/NEGATIVE TESTS/GAPS. Step 4: Manual testing — HUMAN USER tests, NOT AI. Present test plan, record_decision(category='testing') with STATUS/PASS/FAIL/NEXT, then WAIT for user to return. Only mark manual_testing met after user confirms."); // ← [Step 3 — coverage, Step 4 — manual testing handoff]
      lines.push("WHEN TESTING COMPLETE: YOUR NEXT TOOL CALL is advance_phase() to Phase 7, then get_phase_guidance() and begin Phase 7 immediately."); // ← [Exit: P6→P7]
      lines.push("BINDING CONSTRAINTS in test code: use ONLY the tech stack approved in P1 — visible in Decision history above. Do NOT introduce test frameworks or runtimes not approved in P1."); // ← [P1 tech binding in P6 test code]
      lines.push("DO: Write spec-driven tests, execute them, hand off manual testing to user, wait for return. | DON'T: Simulate manual testing mentally, mark manual_testing without user confirmation, use unapproved tech in test code."); // ← [AP5, Step 4]
      break;
    case 7: // ← full: PHASE_7_GUIDANCE — update specs/, product evaluation, project lessons, meta-iteration
      lines.push("INSTRUCTIONS P7: Step 1: Update specs/ (validation, technical, references) with actual results. Step 2: Product evaluation — ask user via AskUserQuestion if software meets P0 requirements. Step 3: Capture 3-5 project lessons (domain insights, stack pitfalls, patterns that worked/failed, wrong P0/P1 assumptions) and deposit in specs/."); // ← [Update specs, product eval, project lessons]
      lines.push("Meta-iteration: After completing P7, offer start_new_cycle() via AskUserQuestion. NEVER use init_project() for v2 — it wipes context. R5: MUST DISPLAY product evaluation + project lessons + meta-iteration offer."); // ← [Meta-iteration, start_new_cycle]
      lines.push("DO: Update specs/, ask user about product, capture project lessons, offer meta-iteration. | DON'T: Use init_project() instead of start_new_cycle(), evaluate the methodology itself (that is not the user's responsibility), add lessons that are not tied to this project."); // ← [project-focused lessons only]
      break;
  }

  return lines;
}
