// Phase definitions and exit criteria for Iterative Convergence v3.6

export interface PhaseDefinition {
  number: number;
  name: string;
  description: string;
  userHint: string;    // concise DO/DON'T for sidebar tooltip
  iterative: boolean;  // whether it allows multiple iterations
}

export interface ExitCriterionDef {
  phase: number;
  criterion: string;
  description: string;
  required: boolean;  // required to advance
}

export const PHASE_DEFINITIONS: PhaseDefinition[] = [
  {
    number: 0,
    name: "Problem Discovery",
    description: "Iterative problem discovery loop. Score >= 90/100 to advance.",
    userHint: "Explore the problem thoroughly. No coding yet.",
    iterative: true,
  },
  {
    number: 1,
    name: "Architecture",
    description: "Module, interface, pattern, and principle definitions.",
    userHint: "Design modules and interfaces. No coding yet.",
    iterative: false,
  },
  {
    number: 2,
    name: "Adversarial Critique",
    description: "Attack architecture with specialized lenses. Generates coverage matrix.",
    userHint: "Challenge the architecture with adversarial lenses.",
    iterative: true,
  },
  {
    number: 3,
    name: "Simplification",
    description: "Simplify architecture. Address Phase 2 critical findings.",
    userHint: "Simplify — address criticals without adding features.",
    iterative: true,
  },
  {
    number: 4,
    name: "Convergence Gate",
    description: "Validate convergence: exit criteria from Phases 2-3 + safeguards S1-S5.",
    userHint: "Verify everything before implementation begins.",
    iterative: false,
  },
  {
    number: 5,
    name: "Code Implementation",
    description: "Implement final architecture. One file per response.",
    userHint: "Implement code. Testing happens in Phase 6.",
    iterative: false,
  },
  {
    number: 6,
    name: "Tests",
    description: "100% tests passing + manual exploratory testing.",
    userHint: "Write and run tests. Manual testing is mandatory.",
    iterative: false,
  },
  {
    number: 7,
    name: "Post-Review",
    description: "Lessons learned, update specs/, methodology meta-iteration.",
    userHint: "Review lessons. Offer meta-iteration for next cycle.",
    iterative: false,
  },
];

export const EXIT_CRITERIA: ExitCriterionDef[] = [
  // Phase 0
  { phase: 0, criterion: "score_90", description: "Score >= 90/100", required: true },
  { phase: 0, criterion: "user_confirmed", description: "User confirmed synthesis", required: true },
  { phase: 0, criterion: "ambiguities_zero", description: "Ambiguities = 0 (or accepted)", required: true },
  { phase: 0, criterion: "use_cases_complete", description: "Use cases complete", required: true },
  { phase: 0, criterion: "vocabulary_agreed", description: "Vocabulary agreed upon", required: true },
  { phase: 0, criterion: "out_of_scope_clear", description: "Out of scope clear", required: true },
  { phase: 0, criterion: "tech_feasibility", description: "Target platform tech feasibility VERIFIED: fundamental capabilities confirmed (not assumed). In porting projects: does the destination platform support essential mechanisms?", required: true },
  { phase: 0, criterion: "implementation_feasibility", description: "Components evaluated Tier 1/2/3. If complex Tier 3 → PoC before Phase 1", required: true },
  { phase: 0, criterion: "technical_scientific_research", description: "If specialized domain: complete technical AND scientific research (F.2) — papers, algorithms, parameters with source", required: false },
  { phase: 0, criterion: "specs_populated", description: "specs/ populated with technical and scientific references", required: true },

  // Phase 1
  { phase: 1, criterion: "patterns_defined", description: "Patterns/principles defined and confirmed", required: true },
  { phase: 1, criterion: "modules_responsibility", description: "Each module with clear responsibility", required: true },
  { phase: 1, criterion: "interfaces_defined", description: "Interfaces defined (signatures, I/O types)", required: true },
  { phase: 1, criterion: "dependencies_explicit", description: "Dependencies between modules explicit", required: true },
  { phase: 1, criterion: "assumptions_listed", description: "Assumptions listed", required: true },
  { phase: 1, criterion: "architecture_doc", description: "Architecture doc fits in ~2k tokens", required: true },
  { phase: 1, criterion: "tech_100_scope", description: "Tech supports 100% of scope, tech assumptions verified", required: true },
  { phase: 1, criterion: "modules_adherent_patterns", description: "Modules adherent to chosen patterns", required: true },

  // Phase 2
  { phase: 2, criterion: "activated_lenses_recorded", description: "Activated conditional lenses recorded via record_decision(category='architecture') with justification for each non-activated lens — includes 8 situational lenses and 4 Domain Transfer Lenses (Control Engineering, Game Theory, Linguistics/Grammar, Mechanical Engineering)", required: true },
  { phase: 2, criterion: "lenses_applied", description: "All 7 universal lenses + all activated conditional lenses applied to each module (no lens skipped — absence of findings is a valid result)", required: true },
  { phase: 2, criterion: "coverage_matrix", description: "Coverage matrix modules x lenses (all applied lenses as columns)", required: true },
  { phase: 2, criterion: "criticals_identified", description: "Critical findings identified and classified", required: true },
  { phase: 2, criterion: "concentration_analyzed", description: "Concentration analysis performed (by module and by lens)", required: true },

  // Phase 3
  { phase: 3, criterion: "criticals_addressed", description: "All critical findings addressed", required: true },
  { phase: 3, criterion: "important_decided", description: "All important findings with decision", required: true },
  { phase: 3, criterion: "scope_preserved", description: "Phase 0 scope preserved (anti-scope-creep)", required: true },
  { phase: 3, criterion: "architecture_simplified", description: "Architecture simpler than previous", required: true },

  // Phase 4
  { phase: 4, criterion: "exit_criteria_p2p3", description: "Exit criteria Phases 2-3 verified", required: true },
  { phase: 4, criterion: "safeguards_s1_s5", description: "Safeguards S1-S5 met", required: true },

  // Phase 5
  { phase: 5, criterion: "all_modules", description: "All modules implemented", required: true },
  { phase: 5, criterion: "specs_consulted", description: "specs/ consulted before each module", required: true },
  { phase: 5, criterion: "s6_applied", description: "S6 applied (Tier 1/2/3 per module)", required: true },
  { phase: 5, criterion: "ui_runnable", description: "Smoke test: user runs P0 end-to-end", required: true },

  // Phase 6
  { phase: 6, criterion: "tests_passing", description: "100% tests passing", required: true },
  { phase: 6, criterion: "manual_testing", description: "Manual exploratory testing performed", required: true },
  { phase: 6, criterion: "edge_cases", description: "Edge cases tested", required: true },

  // Phase 7
  { phase: 7, criterion: "specs_updated", description: "specs/ updated with results", required: true },
  { phase: 7, criterion: "lessons_documented", description: "Lessons learned documented", required: true },
  { phase: 7, criterion: "human_feedback", description: "Human feedback collected", required: true },
];

// Migration map: old Portuguese IDs → new English IDs
export const CRITERION_ID_MIGRATION: Record<string, string> = {
  "usuario_confirmou": "user_confirmed",
  "ambiguidades_zero": "ambiguities_zero",
  "casos_uso_completos": "use_cases_complete",
  "vocabulario_acordado": "vocabulary_agreed",
  "fora_escopo_claro": "out_of_scope_clear",
  "viabilidade_tech": "tech_feasibility",
  "viabilidade_implementacao": "implementation_feasibility",
  "pesquisa_tecnica_cientifica": "technical_scientific_research",
  "specs_populado": "specs_populated",
  "padroes_definidos": "patterns_defined",
  "modulos_responsabilidade": "modules_responsibility",
  "interfaces_definidas": "interfaces_defined",
  "dependencias_explicitas": "dependencies_explicit",
  "premissas_listadas": "assumptions_listed",
  "doc_arquitetura": "architecture_doc",
  "tech_100_escopo": "tech_100_scope",
  "modulos_aderentes_padroes": "modules_adherent_patterns",
  "lentes_aplicadas": "lenses_applied",
  "matriz_cobertura": "coverage_matrix",
  "criticos_identificados": "criticals_identified",
  "concentracao_analisada": "concentration_analyzed",
  "criticos_endereçados": "criticals_addressed",
  "criticos_enderecados": "criticals_addressed",
  "importantes_decididos": "important_decided",
  "escopo_preservado": "scope_preserved",
  "arquitetura_simplificada": "architecture_simplified",
  "exit_criteria_23": "exit_criteria_p2p3",
  "salvaguardas_s1_s5": "safeguards_s1_s5",
  "todos_modulos": "all_modules",
  "specs_consultado": "specs_consulted",
  "s6_aplicado": "s6_applied",
  "testes_passando": "tests_passing",
  "teste_manual": "manual_testing",
  "specs_atualizado": "specs_updated",
  "licoes_documentadas": "lessons_documented",
  "feedback_humano": "human_feedback",
};

export function getPhaseDefinition(phase: number): PhaseDefinition | undefined {
  return PHASE_DEFINITIONS.find((p) => p.number === phase);
}

export function getExitCriteriaForPhase(phase: number): ExitCriterionDef[] {
  return EXIT_CRITERIA.filter((c) => c.phase === phase);
}

// Valid transitions: sequential only, except 2↔3 (loop)
export function isValidTransition(from: number, to: number): boolean {
  if (to === from + 1) return true;      // advance 1 phase
  if (from === 3 && to === 2) return true; // Phase 2-3 loop
  if (from === 2 && to === 3) return true; // Phase 2-3 loop
  return false;
}
