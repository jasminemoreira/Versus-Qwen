// Single source of the Versus version string. package.json carries the same value
// (a test asserts they match); the engine stamps it into state.json so a project can
// tell which Versus last opened it — the basis of the update notice (Versus Claude 0.18.0; this build 0.13.0).
export const VERSUS_VERSION = "0.13.2";
