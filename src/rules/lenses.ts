// The 19 lenses, as data.
//
// They existed only as prose inside the Phase 2 guidance table, so nothing could
// validate a lens name: a session could write "Segurança", "SEG" or "Security" and
// every one of them passed. v0.12.1 addressed that by INSTRUCTING the model to use
// the canonical name. Instruction is not enforcement — this constant is, once the
// activation tool and the coverage-matrix gate validate against it.
//
// Single source of truth for: the record_activated_lenses enum, the
// activated_lenses_recorded evidence gate, the coverage-matrix lens-column gate,
// and (eventually) the guidance table.

export const UNIVERSAL_LENSES = [
  "Assumptions",
  "Architectural",
  "Implementability",
  "Scientific",
  "Security",
  "Performance",
  "Regulatory",
] as const;

export const CONDITIONAL_LENSES = [
  "Resilience",
  "UI/UX",
  "Migration / Coexistence",
  "Sustainability / Proportionality",
  "Ethical / Human Impact",
  "Process / Workflow",
  "Governance / Accountability",
  "Observability / Operability",
  "Control Engineering",
  "Game Theory",
  "Linguistics / Grammar",
  "Mechanical Engineering",
] as const;

export const ALL_LENSES: readonly string[] = [...UNIVERSAL_LENSES, ...CONDITIONAL_LENSES];

/** Canonical name for `raw`, or null if it is not one of the 19.
 *  Tolerates case and spacing around "/" — "UI / UX" is the same lens as "UI/UX" —
 *  but NOT translations or abbreviations, which are what break cross-project
 *  aggregation. */
export function canonicalLens(raw: string): string | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
  const target = norm(raw);
  return ALL_LENSES.find((l) => norm(l) === target) ?? null;
}
