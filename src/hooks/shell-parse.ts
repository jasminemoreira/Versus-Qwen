// Minimal shell-command reader shared by the Bash hooks (test-outcome, loop-detector,
// phase-gate). Not a shell parser — just enough structure to stop classifying a command
// by regex over its WHOLE text, which is what let `cat >> LOG.md <<EOF … npm test … EOF`
// count as a test run (the heredoc body is data, not something the shell executes) and
// what let a `grep "npm test" …` look like one too.
//
// What it does:
//   1. drops heredoc bodies (`<<EOF … EOF`, `<<-'EOF'`, `<<"EOF"`);
//   2. tokenizes quote-aware (single/double quotes, backslash escapes);
//   3. splits into simple commands on `;` `&&` `||` `|` `&` and newlines;
//   4. reports, per simple command, its words and its output-redirection targets.
// Anything it cannot make sense of degrades to "no segments" — callers fail open.

import * as fs from "fs";
import * as path from "path";

export interface ShellSegment {
  /** The words of the simple command, quotes removed, leading VAR=val / env / time stripped. */
  words: string[];
  /** Targets of `>` / `>>` / `&>` / `N>` redirections in this simple command. */
  redirects: string[];
}

/** Removes heredoc bodies: from the line after `<<[-]DELIM` up to the line that is DELIM. */
export function stripHeredocs(cmd: string): string {
  const lines = cmd.split("\n");
  const out: string[] = [];
  let pending: string[] = [];          // delimiters whose bodies start on the next line
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    const re = /<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      // `<<<` is a here-string, not a heredoc
      if (line[m.index + 2] === "<" || (m.index > 0 && line[m.index - 1] === "<")) continue;
      pending.push(m[3]);
    }
    i++;
    for (const delim of pending) {
      while (i < lines.length && lines[i].trim() !== delim) i++;
      i++; // skip the delimiter line itself
    }
    pending = [];
  }
  return out.join("\n");
}

type Tok = { t: "w"; v: string } | { t: "sep" } | { t: "redir"; fd: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let cur = "";
  let inWord = false;
  const flush = () => {
    if (inWord) toks.push({ t: "w", v: cur });
    cur = "";
    inWord = false;
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      cur += end === -1 ? src.slice(i + 1) : src.slice(i + 1, end);
      inWord = true;
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) { cur += src[i + 1]; i += 2; continue; }
        cur += src[i++];
      }
      i++;
      inWord = true;
      continue;
    }
    if (c === "\\" && i + 1 < src.length) {
      if (src[i + 1] !== "\n") { cur += src[i + 1]; inWord = true; }
      i += 2;
      continue;
    }
    if (c === "#" && !inWord) {               // comment to end of line
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === " " || c === "\t") { flush(); i++; continue; }
    if (c === "\n" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")") {
      if (c === "&" && src[i + 1] === ">") {   // &> / &>>
        flush();
        i += src[i + 2] === ">" ? 3 : 2;
        toks.push({ t: "redir", fd: "&" });
        continue;
      }
      if (c === "&" && i > 0 && src[i - 1] === ">") { cur += c; inWord = true; i++; continue; } // >&2
      flush();
      toks.push({ t: "sep" });
      i += (c === "&" && src[i + 1] === "&") || (c === "|" && src[i + 1] === "|") ? 2 : 1;
      continue;
    }
    if (c === ">") {
      const fd = inWord && /^\d+$/.test(cur) ? cur : "1";
      if (inWord && /^\d+$/.test(cur)) { cur = ""; inWord = false; } else flush();
      i += src[i + 1] === ">" ? 2 : 1;
      if (src[i] === "&") {                   // >&2, 2>&1 — fd duplication, not a file
        i++;
        while (i < src.length && /[\d-]/.test(src[i])) i++;
        continue;
      }
      if (src[i] === "|") i++;                // >| clobber
      toks.push({ t: "redir", fd });
      continue;
    }
    if (c === "<") {                           // input redirection: skip operator + its word
      flush();
      i++;
      if (src[i] === "<") { i++; if (src[i] === "<") i++; }
      while (src[i] === " " || src[i] === "\t") i++;
      // consume the word (heredoc delimiter or input file)
      let q = "";
      while (i < src.length && (q || !/[\s;|&()]/.test(src[i]))) {
        if (!q && (src[i] === "'" || src[i] === '"')) { q = src[i]; i++; continue; }
        if (q && src[i] === q) { q = ""; i++; continue; }
        i++;
      }
      continue;
    }
    cur += c;
    inWord = true;
    i++;
  }
  flush();
  return toks;
}

const PREFIX_WORDS = new Set(["time", "nice", "nohup", "command", "builtin", "exec", "sudo"]);

/** Parses a Bash tool command into simple commands. Never throws. */
export function parseShell(cmd: string): ShellSegment[] {
  try {
    const toks = tokenize(stripHeredocs(cmd));
    const segs: ShellSegment[] = [];
    let words: string[] = [];
    let redirects: string[] = [];
    let expectTarget = false;
    const close = () => {
      // strip leading VAR=val assignments, `env [VAR=val…]`, and prefix words like `time`
      while (words.length) {
        const w = words[0];
        if (/^[A-Za-z_]\w*=/.test(w) || w === "env" || PREFIX_WORDS.has(w)) { words.shift(); continue; }
        break;
      }
      if (words.length || redirects.length) segs.push({ words, redirects });
      words = [];
      redirects = [];
      expectTarget = false;
    };
    for (const tk of toks) {
      if (tk.t === "sep") { close(); continue; }
      if (tk.t === "redir") { expectTarget = true; continue; }
      if (expectTarget) { redirects.push(tk.v); expectTarget = false; continue; }
      words.push(tk.v);
    }
    close();
    return segs;
  } catch {
    return [];
  }
}

// --- Test-command recognition -------------------------------------------------------

/**
 * Test runners recognized at the START of a simple command (after `cd x &&`, env vars,
 * `time`, etc. are separated/stripped). Matched against the segment's words joined by
 * spaces. Anchored on purpose: `grep "npm test" LOG.md` and `echo "… npm test …" >> f`
 * begin with grep/echo and are not test runs.
 *
 * Platform breadth is the point — the first external study ran on macOS/Xcode and had to
 * wrap `xcodebuild test` in a package.json, which left every red Xcode round invisible to
 * S6. Projects with an unlisted runner add patterns to `.versus/test-commands` (one regex
 * per line, matched the same way; `#` comments allowed).
 */
export const TEST_COMMAND_PATTERNS: RegExp[] = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/,
  /^npm\s+t\b/,
  /^npx\s+(jest|vitest|mocha|ava|tap|playwright\s+test|cypress\s+run)\b/,
  /^(jest|vitest|mocha)\b/,
  /^(deno|bun)\s+test\b/,
  /^node\s+.*test/,
  /^pytest\b/,
  /^python[\d.]*\s+-m\s+(pytest|unittest)\b/,
  /^(uv|poetry|pipenv|hatch)\s+run\s+(pytest|python[\d.]*\s+-m\s+(pytest|unittest))\b/,
  /^tox\b/,
  /^cargo\s+(test|nextest)\b/,
  /^go\s+test\b/,
  /^xcodebuild\b.*\s(test|test-without-building)\b/,
  /^swift\s+test\b/,
  /^(\.\/)?gradlew?\b.*\s(test\w*|check|connected\w*Test)\b/,
  /^(\.\/)?mvnw?\b.*\s(test|verify)\b/,
  /^dotnet\s+test\b/,
  /^(flutter|dart)\s+test\b/,
  /^make\b.*\s(test|check)\b/,
  /^ctest\b/,
  /^(bundle\s+exec\s+)?(rspec|rake\s+test)\b/,
  /^(\.\/)?(vendor\/bin\/)?phpunit\b/,
  /^mix\s+test\b/,
];

/** Extra project-specific patterns from `.versus/test-commands`. */
export function loadExtraTestPatterns(workspace: string): RegExp[] {
  try {
    const p = path.join(workspace, ".versus", "test-commands");
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .flatMap((l) => { try { return [new RegExp(l)]; } catch { return []; } });
  } catch {
    return [];
  }
}

const SHELL_WRAPPERS = new Set(["bash", "sh", "zsh", "dash"]);

function segmentIsTest(words: string[], patterns: RegExp[], depth: number): boolean {
  if (!words.length) return false;
  // `bash -c "npm test"` — look inside the script argument
  if (SHELL_WRAPPERS.has(path.basename(words[0])) && depth < 2) {
    const ci = words.findIndex((w) => /^-\w*c\w*$/.test(w));
    if (ci !== -1 && words[ci + 1] !== undefined) {
      return parseShell(words[ci + 1]).some((s) => segmentIsTest(s.words, patterns, depth + 1));
    }
  }
  const text = words.join(" ");
  return patterns.some((p) => p.test(text));
}

/** True when some simple command in `cmd` is a test-runner invocation. */
export function isTestCommand(cmd: string, extra: RegExp[] = []): boolean {
  const patterns = extra.length ? [...TEST_COMMAND_PATTERNS, ...extra] : TEST_COMMAND_PATTERNS;
  return parseShell(cmd).some((s) => segmentIsTest(s.words, patterns, 0));
}

// --- File-write targets (phase-gate on Bash) ------------------------------------------

/**
 * Files a command would WRITE, by the obvious routes: output redirection, `tee`,
 * in-place editors (`sed -i`, `perl -i`), and the destination of `cp`/`mv`/`install`.
 * Not exhaustive (a script can write anything) — the gate's job is to close the casual
 * route, which is the one the first external study used as standard practice. Targets
 * containing shell expansion (`$`, backtick, glob) are skipped: they cannot be resolved
 * here and blocking on a guess would be worse.
 */
export function writeTargets(cmd: string): string[] {
  const out: string[] = [];
  const ok = (t: string) => t && t !== "/dev/null" && !/^\/dev\//.test(t) && !/[$`*?]/.test(t);
  for (const seg of parseShell(cmd)) {
    for (const r of seg.redirects) if (ok(r)) out.push(r);
    const [head, ...rest] = seg.words;
    if (!head) continue;
    const name = path.basename(head);
    const args = rest.filter((a) => !a.startsWith("-"));
    if (name === "tee") {
      args.forEach((a) => ok(a) && out.push(a));
    } else if ((name === "sed" || name === "perl") && rest.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) {
      const last = args[args.length - 1];
      if (last && ok(last) && args.length >= 2) out.push(last);
    } else if ((name === "cp" || name === "mv" || name === "install") && args.length >= 2) {
      const last = args[args.length - 1];
      if (ok(last)) out.push(last);
    }
  }
  return out;
}
