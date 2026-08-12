// The 19 lenses, as data — the SINGLE SOURCE for their names AND their full
// definitions (central question, exclusive failure class, activation trigger).
//
// They used to exist twice: as validated names here, and as hand-written markdown
// in the Phase 2 guidance table. That second copy is exactly where a trigger edit
// (like the three in v0.12.9) could drift a name from what the gate validates. Now
// the guidance table is RENDERED from these defs and the name arrays are DERIVED
// from them, so there is one source: the record_activated_lenses enum, the
// activated_lenses_recorded gate, the coverage-matrix lens-column gate, and the
// guidance table all read the same data.

export interface LensDef {
  name: string;          // canonical name — what the gates and the enum compare
  question: string;      // central (generative) question
  failureClass: string;  // exclusive failure class
  trigger?: string;      // activation trigger — conditionals only; universals have none
}

export const UNIVERSAL_LENS_DEFS: LensDef[] = [
  { name: "Assumptions", question: "What does this design assume as true without declaring?", failureClass: "Failures from hidden assumptions" },
  { name: "Architectural", question: "Can each module be replaced, removed, or tested in isolation?", failureClass: "Hidden coupling, circular dependencies, SRP violation" },
  { name: "Implementability", question: "Can I code this module in a single session with available context?", failureClass: "Incomplete specs, insufficient granularity" },
  { name: "Scientific", question: "Does each value/formula/algorithm have a verifiable bibliographic reference?", failureClass: "Invented parameters, plausibility-based logic" },
  { name: "Security", question: "How would an attacker exploit this with minimal effort?", failureClass: "Unanalyzed attack surface" },
  { name: "Performance", question: "Where are the bottlenecks? Asymptotic behavior?", failureClass: "Hidden bottlenecks, degradation at scale" },
  { name: "Regulatory", question: "Does each normative requirement have traceability to a module?", failureClass: "Non-compliance with applicable standards" },
];

export const CONDITIONAL_LENS_DEFS: LensDef[] = [
  { name: "Resilience", question: "What happens when an external dependency fails, responds slowly, or returns unexpected data?", failureClass: "Cascading failures, retry storms, partial outages", trigger: "The system depends on anything outside its own process that can fail, stall, or return unexpected data — a network service, a database, a queue, a file, a subprocess. Apply the central question wherever such a boundary exists; the list is illustrative, not the requirement." },
  { name: "UI/UX", question: "Can the user complete their task without frustration, confusion, or error?", failureClass: "Confusing flows, dead-end states, missing feedback, accessibility failures", trigger: "Any surface a PERSON operates — including a CLI or operational tooling, not only graphical end-user interfaces" },
  { name: "Migration / Coexistence", question: "What breaks during the transition from old to new? Is there a rollback path?", failureClass: "Data loss in migration, functional regression vs. legacy, impossible rollback", trigger: "The work must carry an existing, relied-upon state or contract across a change — a populated store, a format other code already reads, a live interface consumers depend on — that has to survive or roll back. Greenfield work, and a store only this version ever reads, do not activate." },
  { name: "Sustainability / Proportionality", question: "Is resource consumption proportionate to value delivered? Cost at 10× scale?", failureClass: "GPU where CPU suffices, heavy model for simple task, infinite data retention", trigger: "The system decides, allocates, or consumes a resource whose cost grows with use — e.g. (but NOT only) AI/ML, high-volume data processing, elastic infrastructure. Apply the central question, do not just match the examples" },
  { name: "Ethical / Human Impact", question: "Who is potentially harmed? Are there audit, correction, and transparency mechanisms?", failureClass: "Algorithmic bias, digital exclusion, automated decisions without human recourse", trigger: "The system makes or automates a consequential decision whose effect falls on people — directly, or through an entity they depend on (a budget cut borne by those it funds, an access denial, a flag acted on). Apply the central question — who can be harmed? — without requiring the decision be nominally \"about people\". A system that decides nothing consequential about anyone stays out." },
  { name: "Process / Workflow", question: "Are processes, state transitions, actor responsibilities, and exception paths complete?", failureClass: "Orphaned states, ambiguous handoffs, missing actors, happy-path bias", trigger: "The system has a process with states, handoffs, or exception paths — one actor or many. Apply the central question wherever a flow can be left incomplete; \"multi-actor\" is one case, not the requirement." },
  { name: "Governance / Accountability", question: "Is every action attributable? Does every data entity have a defined owner?", failureClass: "No data ownership, no accountability, shadow data flows", trigger: "The system records or decides something someone will later need to audit, attribute, or answer for — data with distinct owners, actions that need authorship, or an obligation to account. This is a SYSTEM property: a single-operator project activates it when the system has it (not only multi-team / compliance contexts)" },
  { name: "Observability / Operability", question: "Can degradation be detected and incidents diagnosed in production without code changes?", failureClass: "Opaque systems where nobody can figure out why it failed", trigger: "The system runs somewhere it can degrade or fail after it ships, and someone would need to tell WHY without changing code. Apply the central question wherever a running system can fail silently; it does not require a formal \"production\" or \"ops\" label." },
  { name: "Control Engineering", question: "Where does the system generate an error signal and correct it? Risk of oscillation or state drift?", failureClass: "Systems that react to events but don't regulate state — oscillation, drift, runaway feedback", trigger: "The system regulates state over time rather than only reacting — state synchronization, a runtime setting that changes behavior, a retry/backoff, a self-correcting or feedback-driven loop that can oscillate or drift. Apply the central question wherever such regulation exists; the list is illustrative." },
  { name: "Game Theory", question: "Do system actors have aligned incentives? Where does the design assume cooperation and may encounter strategic defection?", failureClass: "Architectures that work under cooperation assumptions but collapse under adversarial or strategic behavior", trigger: "The design assumes some actor — a user, a client, an integrator, an operator — behaves as intended, and a self-interested one could deviate to its own benefit. Apply the central question wherever cooperation is assumed rather than enforced; a public API or marketplace is one case, not the requirement." },
  { name: "Linguistics / Grammar", question: "Is the interface contract unambiguous? Can two correct implementations of the same contract produce incompatible behaviors?", failureClass: "Protocol ambiguity — two correct implementations that are mutually incompatible", trigger: "Any contract two parties must agree on — a function signature, a message format, a protocol, a file schema — where two correct readings could diverge. Apply the central question wherever a contract can be read two ways; it does not require separate teams." },
  { name: "Mechanical Engineering", question: "Where are the tolerances? Does the system tolerate variation or only work at exact specification?", failureClass: "Rigid coupling disguised as tolerance — failure from small deviations in dependency versions, environment, or load", trigger: "The system depends on something that can vary — a dependency version, an environment, an input range, a load — and could fail on small deviations. Apply the central question wherever variation is possible, not only in long-lived or maintenance-heavy systems." },
];

// Names DERIVED from the defs — one source, no hand-kept second copy.
export const UNIVERSAL_LENSES: string[] = UNIVERSAL_LENS_DEFS.map((l) => l.name);
export const CONDITIONAL_LENSES: string[] = CONDITIONAL_LENS_DEFS.map((l) => l.name);
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
