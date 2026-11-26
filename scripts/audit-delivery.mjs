#!/usr/bin/env node
// Delivery audit (Qwen Code): what each Versus channel EMITTED vs what REACHED the model,
// read from a project's Qwen Code transcripts (~/.qwen/projects/<encoded path>/chats/*.jsonl).
//
// Why this exists: on the Claude build the per-message guidance arrived as a 2,000-char preview
// for months, and nobody saw it; the unit tests checked the emitter, not the receiver. This is
// the Qwen equivalent. Run it on a real project after every Qwen Code / companion update and
// before every Versus Qwen release.
//
// Evidence rules (Qwen Code 0.28.4, read from its CLI bundle):
//  - UserPromptSubmit context is recorded as an extra part of the user message, wrapped in
//    <qwen:user-prompt-submit-context> … </qwen:user-prompt-submit-context>. That part is what
//    the model received. An identical context already in the history is NOT re-sent.
//  - PostToolUse context is appended to the tool result (functionResponse), so a "[Versus]"
//    warning inside a shell tool result reached the model.
//  - A tool result over truncateToolOutputThreshold (25,000) starts with
//    "Tool output was too large and has been truncated".
//  - SessionStart context goes into the SYSTEM INSTRUCTION, which is not in the transcript. It is
//    reported as "not observable"; its effect shows as get_phase_guidance calls at session start.
//
// Usage: node scripts/audit-delivery.mjs <project-path> [--since YYYY-MM-DD]

import fs from "fs";
import os from "os";
import path from "path";

const args = process.argv.slice(2);
const project = path.resolve(args.find((a) => !a.startsWith("--")) ?? process.cwd());
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : "";

const dir = path.join(os.homedir(), ".qwen", "projects", project.replace(/[^A-Za-z0-9]/g, "-"), "chats");
if (!fs.existsSync(dir)) {
  console.error(`No transcripts for ${project} (looked in ${dir}).`);
  process.exit(1);
}

const OPEN = "<qwen:user-prompt-submit-context>";
const CLOSE = "</qwen:user-prompt-submit-context>";
const TRUNC = "Tool output was too large and has been truncated";
const INJECT_BUDGET = 9_000;          // hooks/state-block.ts
const TOOL_CAP = 25_000;              // Qwen truncateToolOutputThreshold default

const mcp = new Map();                // tool name → stats
const gates = new Map();              // "[Versus] …" prefix → count
const sessions = [];
const versions = new Set();
const stat = (k) => {
  if (!mcp.has(k)) mcp.set(k, { runs: 0, inline: 0, truncated: 0, maxDelivered: 0 });
  return mcp.get(k);
};
const textOfResponse = (fr) => {
  const r = fr?.response;
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    if (typeof r.output === "string") return r.output;
    if (typeof r.content === "string") return r.content;
    return JSON.stringify(r);
  }
  return "";
};

for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
  const s = { file: f, first: "", injections: 0, maxInjection: 0, overBudget: 0, guidanceCalls: 0, guidanceFirst: false, version: "", userMsgs: 0 };
  let toolCallsSeen = 0;
  for (const line of fs.readFileSync(path.join(dir, f), "utf-8").split("\n")) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.timestamp && since && o.timestamp.slice(0, 10) < since) continue;
    if (o.timestamp && !s.first) s.first = o.timestamp;
    if (o.version) versions.add(o.version);
    const parts = Array.isArray(o.message?.parts) ? o.message.parts : [];

    if (o.type === "user") {
      s.userMsgs++;
      for (const p of parts) {
        const t = typeof p?.text === "string" ? p.text : "";
        if (!t.startsWith(OPEN)) continue;
        const body = t.slice(OPEN.length, t.endsWith(CLOSE) ? -CLOSE.length : undefined).trim();
        if (!body.includes("[Versus]")) continue;
        s.injections++;
        s.maxInjection = Math.max(s.maxInjection, body.length);
        if (body.length > INJECT_BUDGET + 200) s.overBudget++;
        const ver = /\| v(\d+\.\d+\.\d+)/.exec(body);
        if (ver && !s.version) s.version = ver[1];
      }
    }

    for (const p of parts) {
      const fr = p?.functionResponse;
      if (!fr) continue;
      const name = String(fr.name ?? "");
      const t = textOfResponse(fr);
      toolCallsSeen++;
      if (name.startsWith("mcp__versus-qwen__")) {
        const short = name.replace("mcp__versus-qwen__", "");
        const st = stat(short);
        st.runs++;
        if (t.startsWith(TRUNC) || t.includes(TRUNC)) st.truncated++;
        else { st.inline++; st.maxDelivered = Math.max(st.maxDelivered, t.length); }
        if (short === "get_phase_guidance") {
          s.guidanceCalls++;
          if (toolCallsSeen <= 3) s.guidanceFirst = true;
        }
      }
      for (const m of t.matchAll(/\[Versus\] ([A-Za-z][\w -]{2,28})/g)) gates.set(m[1].trim(), (gates.get(m[1].trim()) ?? 0) + 1);
    }
  }
  if (s.first) sessions.push(s);
}

const rows = (m) => [...m.entries()].sort((a, b) => b[1].runs - a[1].runs);
console.log(`# Versus Qwen delivery audit — ${project}`);
console.log(`\nTranscripts: ${dir}\nSessions: ${sessions.length}${since ? ` (since ${since})` : ""} · Qwen Code versions: ${[...versions].sort().join(", ") || "?"}\n`);

console.log("## UserPromptSubmit (state injection) — what reached the model\n");
console.log("| session | started | Versus | user msgs | injections delivered | max chars | ⚠ over budget | get_phase_guidance calls | guidance among first 3 tool calls |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const s of sessions.sort((a, b) => a.first.localeCompare(b.first))) {
  console.log(`| ${s.file.slice(0, 8)} | ${s.first.slice(0, 16)} | ${s.version || "<0.13.0"} | ${s.userMsgs} | ${s.injections} | ${s.maxInjection} | ${s.overBudget} | ${s.guidanceCalls} | ${s.guidanceFirst ? "yes" : "⚠ no"} |`);
}

console.log("\n## MCP tools\n");
console.log(`| tool | calls | inline | ⚠ truncated (over ${TOOL_CAP}) | max delivered |`);
console.log("|---|---|---|---|---|");
for (const [k, v] of rows(mcp)) console.log(`| ${k} | ${v.runs} | ${v.inline} | ${v.truncated} | ${v.maxDelivered} |`);

console.log("\n## Gate / warning texts seen by the model (tool results, incl. PostToolUse context)\n");
for (const [k, n] of [...gates.entries()].sort((a, b) => b[1] - a[1])) console.log(`- ${n}× "[Versus] ${k}…"`);

console.log("\n## Not observable in the transcript\n");
console.log("- SessionStart: its context goes into the system instruction. Evidence of delivery = a get_phase_guidance call early in each session (column above).");
console.log("- PreCompact: its context goes into the compaction prompt (cut at 4,000 chars).");
console.log("- Stop systemMessage: shown to the user in the UI.");

const bad =
  sessions.some((s) => s.overBudget || (s.version && !s.guidanceFirst)) ||
  rows(mcp).some(([, v]) => v.truncated);
console.log(`\n**Verdict:** ${bad ? "⚠ some channel did not deliver as designed — see the ⚠ columns." : "every observable channel delivered what it emitted."}`);
process.exit(bad ? 2 : 0);
