// Safeguard definitions S0-S7 for Iterative Convergence v3.6

import { PhaseState } from "../state/types";

export interface SafeguardDef {
  id: string;
  name: string;
  description: string;
  applicablePhases: number[];  // phases where it applies
}

export interface SafeguardResult {
  id: string;
  status: "ok" | "warning" | "violated";
  details: string;
}

/**
 * S6 loop detection. Consecutive FAILED test runs with no diagnosis recorded
 * between them before the next run is blocked. Executions are not counted and a
 * passing run clears the counter: re-running after a named fix is the normal
 * debugging cycle, and blocking the green run would make S4 (execute and verify)
 * impossible to satisfy.
 */
export const LOOP_FAILURE_THRESHOLD = 3;

/** record_decision categories that count as a named diagnosis and clear the S6 counter. */
export const DIAGNOSIS_CATEGORIES = ["diagnosis", "bugfix", "root-cause"];

export const SAFEGUARD_DEFINITIONS: SafeguardDef[] = [
  {
    id: "S0",
    name: "Problem Convergence",
    description: "Never advance to Phase 1 without score >= 90/100. Wrong problem costs 100x.",
    applicablePhases: [0],
  },
  {
    id: "S1",
    name: "Anti-Bug",
    description: "Simplification never introduces bugs. Features maintained after each Phase 3.",
    applicablePhases: [3],
  },
  {
    id: "S2",
    name: "Stopping Criterion",
    description: "Stopping criterion belongs to the USER, not the AI.",
    applicablePhases: [0, 1, 2, 3, 4, 5, 6, 7],
  },
  {
    id: "S3",
    name: "Premature Convergence Cost",
    description: "Stopping early = -400% to -600% ROI. Prefer iterating when in doubt.",
    applicablePhases: [0, 2, 3],
  },
  {
    id: "S4",
    name: "Explicit Verification (mandatory human-AV)",
    description:
      "Human-AV is irreplaceable at each gate. " +
      "Automated tests verify formalizable properties. " +
      "Semantic adequacy, usability, and domain correctness REQUIRE human judgment. " +
      "P0: human validates synthesis. P2: human arbitrated trade-offs. P4: human confirms convergence. " +
      "P6: NEVER assume tests passed — execute and verify + mandatory manual exploratory testing.",
    applicablePhases: [0, 2, 4, 6],
  },
  {
    id: "S5",
    name: "Scope Preservation",
    description:
      "Phase 2-3 operates WITHIN Phase 0 scope. Sub-rules: " +
      "5.1 Scope belongs to the user — Phase 2-3 suggests, never decides changes. " +
      "5.2 If not requested, don't add. If useful, document as v2.0 suggestion. " +
      "5.3 Detector: 'If the user compared V(N) with Phase 0, would they say this isn't what I asked for?' If yes → scope violated.",
    applicablePhases: [2, 3],
  },
  {
    id: "S6",
    name: "Don't Reimplement What Already Exists",
    description:
      "Tier 1: mature lib → USE IT. Tier 2: algorithm with ref → PORT literally (same structure, same names, test against same inputs). " +
      "Tier 3: neither of the above. If complex domain → PoC (~2h max). " +
      "Immediate STOP if: creating heuristics for problem with known solution, debugging complex logic from scratch, " +
      "trial-and-error on something deterministic, or >2 iterations on the same module. " +
      "Checklist per module: mature lib? → if not, why? → documented algorithm? → portable ref? → decision. " +
      `Loop detection: ${LOOP_FAILURE_THRESHOLD} consecutive FAILED test runs with no diagnosis recorded between them blocks the next run. ` +
      "A passing run never counts (S4 verification is never blockable) and record_decision(category='diagnosis') clears the counter. " +
      "Debugging with a named cause per round is the normal cycle; failing repeatedly without naming a cause is the blind loop.",
    applicablePhases: [5, 6],
  },
  {
    id: "S7",
    name: "Sequence Discipline",
    description: "After each file: mark completed, identify next, announce progress, start immediately.",
    applicablePhases: [5],
  },
];

export function getSafeguardDefinition(id: string): SafeguardDef | undefined {
  return SAFEGUARD_DEFINITIONS.find((s) => s.id === id);
}

export function getSafeguardsForPhase(phase: number): SafeguardDef[] {
  return SAFEGUARD_DEFINITIONS.filter((s) => s.applicablePhases.includes(phase));
}

export function validateSafeguard(id: string, state: PhaseState): SafeguardResult {
  const def = getSafeguardDefinition(id);
  if (!def) {
    return { id, status: "ok", details: `Safeguard ${id} not found.` };
  }

  switch (id) {
    case "S0":
      return validateS0(state);
    case "S1":
      return validateS1(state);
    case "S5":
      return validateS5(state);
    case "S6":
      return validateS6(state);
    case "S7":
      return validateS7(state);
    default:
      // S2, S3, S4 are behavioral — not automatically validatable
      return {
        id,
        status: "ok",
        details: `${def.name}: behavioral check — requires agent attention. ${def.description}`,
      };
  }
}

function validateS0(state: PhaseState): SafeguardResult {
  if (state.currentPhase === 0) {
    return { id: "S0", status: "ok", details: "Still in Phase 0. Current score: " + (state.phase0Score ?? "not evaluated") };
  }
  if (state.phase0Score === null || state.phase0Score < 90) {
    return {
      id: "S0",
      status: "violated",
      details: `Phase 0 score ${state.phase0Score ?? "null"} < 90. Should not have advanced.`,
    };
  }
  return { id: "S0", status: "ok", details: `Phase 0 score ${state.phase0Score}/100. OK.` };
}

function validateS1(state: PhaseState): SafeguardResult {
  if (state.currentPhase !== 3) {
    return { id: "S1", status: "ok", details: "Not in Phase 3." };
  }
  return {
    id: "S1",
    status: "warning",
    details: "Phase 3 active: verify that simplification did not introduce bugs. Features must be maintained.",
  };
}

function validateS5(state: PhaseState): SafeguardResult {
  if (state.currentPhase !== 2 && state.currentPhase !== 3) {
    return { id: "S5", status: "ok", details: "Not in Phase 2-3." };
  }
  return {
    id: "S5",
    status: "warning",
    details: "Phase 2-3 active: Phase 0 scope must be preserved. Don't cut requirements, don't add features.",
  };
}

function validateS6(state: PhaseState): SafeguardResult {
  if (state.currentPhase < 5) {
    return { id: "S6", status: "ok", details: "Not in implementation." };
  }

  const undiagnosedFailures = state.loopCounter?.count ?? 0;
  if (undiagnosedFailures >= LOOP_FAILURE_THRESHOLD) {
    return {
      id: "S6",
      status: "violated",
      details:
        `${undiagnosedFailures} consecutive failed runs of "${state.loopCounter.pattern}" with no diagnosis recorded. ` +
        "Test runs are blocked. Name the root cause via record_decision(category='diagnosis') to clear it, " +
        "or go Tier 2 (find a reference implementation) if you cannot name one.",
    };
  }

  return {
    id: "S6",
    status: "warning",
    details:
      "Implementation active: verify Tier 1/2/3 per module. STOP if creating heuristics for problems with known solutions. " +
      `Undiagnosed consecutive test failures: ${undiagnosedFailures}/${LOOP_FAILURE_THRESHOLD}.`,
  };
}

function validateS7(state: PhaseState): SafeguardResult {
  if (state.currentPhase !== 5) {
    return { id: "S7", status: "ok", details: "Not in Phase 5." };
  }
  return {
    id: "S7",
    status: "warning",
    details: "Phase 5 active: after each file, mark completed and announce progress. Don't start tangential discussions.",
  };
}
