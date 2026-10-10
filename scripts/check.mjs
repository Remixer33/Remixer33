// Public copy checks for README.md. Node standard library only.
//
//   node scripts/check.mjs           check the README copy
//   node scripts/check.mjs --drift   also compare the live map with profile.config.json: the counts,
//                                    and every stack tool's node label
//
// Prints counts only. Exits 1 on any failure.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(ROOT, "profile.config.json"), "utf8"));
const raw = readFileSync(join(ROOT, "README.md"), "utf8");
const noComments = raw.replace(/<!--[\s\S]*?-->/g, "");

// Visible text: tags become their alt text, then link targets and URLs are dropped.
const visible = noComments
  .replace(/<[^>]*?\balt="([^"]*)"[^>]*>/g, " $1 ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\]\([^)]*\)/g, "] ")
  .replace(/https?:\/\/\S+/g, " ");

let fails = 0;
const report = (name, n) => {
  console.log(`${n === 0 ? "PASS" : "FAIL"} ${name}: ${n}`);
  if (n !== 0) fails++;
};

report("em dash U+2014", (raw.match(/\u2014/g) || []).length);
report("en dash U+2013", (raw.match(/\u2013/g) || []).length);
report("exclamation mark outside comments", (noComments.match(/!/g) || []).length);

const contractions = (noComments.match(/\b\w+'(s|t|re|ve|ll|d|m)\b/gi) || [])
  .filter((w) => w !== "SunPower's");
report("contractions (the possessive SunPower's is allowed)", contractions.length);

const hype = [
  "passionate", "leverage", "cutting edge", "thrilled", "visionary", "world class",
  "delve", "harness", "unlock", "seamless", "robust", "game-changer", "synergy",
  "empower", "foster", "showcase", "spearhead", "streamline", "journey",
  "ecosystem", "landscape", "autonomous", "self-running",
];
const hypeHits = hype.filter((w) => new RegExp(`\\b${w.replace(/[-\s]/g, "[-\\s]")}\\b`, "i").test(noComments));
report("hype words", hypeHits.length);

const allowed = new Set(["$1B+", "$1B", "33,000+", "14,000+", "46", "65+", String(cfg.canonical.agents), String(cfg.canonical.nodes), "33"]);
const digitRuns = visible.match(/\$?\d[\d,]*[B+]?\+?/g) || [];
report("numbers outside the canonical set", digitRuns.filter((d) => !allowed.has(d)).length);
const stray33 = (visible.match(/33(?!,)/g) || []).length - (visible.match(/Remixer33/g) || []).length;
report("a 33 that is not part of Remixer33", stray33);

const codeLines = [...noComments.matchAll(/```[a-z]*\n([\s\S]*?)```/g)]
  .flatMap((m) => m[1].split("\n"))
  .filter((l) => [...l].length > 37);
report("code block lines over 37 characters", codeLines.length);

// Prose words: tags are removed with their alt text, link targets and URLs are dropped, and the dot
// separators are dropped. The typing phrases count too, because a reader sees them. Limit: 120.
const prose = noComments
  .replace(/<[^>]*>/g, " ")
  .replace(/\]\([^)]*\)/g, "] ")
  .replace(/https?:\/\/\S+/g, " ")
  .split(/\s+/)
  .filter((w) => /[A-Za-z0-9]/.test(w));
const typingWords = cfg.typing.join(" ").split(/\s+/).filter(Boolean);
const totalWords = prose.length + typingWords.length;
console.log(`${totalWords <= 120 ? "PASS" : "FAIL"} prose words: README ${prose.length} + typing line ${typingWords.length} = ${totalWords} (limit 120)`);
if (totalWords > 120) fails++;

if (process.argv.includes("--drift")) {
  try {
    const res = await fetch(cfg.graphUrl, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const g = await res.json();
    const live = { nodes: g.counts?.total, agents: g.counts?.workforce, departments: g.sectors?.length };
    for (const key of ["nodes", "agents", "departments"]) {
      const same = live[key] === cfg.canonical[key];
      console.log(`${same ? "PASS" : "FAIL"} drift ${key}: live ${live[key]}, profile.config.json ${cfg.canonical[key]}`);
      if (!same) fails++;
    }
    const stackLabels = new Set((g.nodes || []).filter((n) => n.scene === "stack").map((n) => n.label));
    const tools = cfg.stack.flatMap((grp) => grp.tools);
    const gone = tools.filter((t) => !stackLabels.has(t.graph));
    console.log(`${gone.length ? "FAIL" : "PASS"} drift stack: ${tools.length - gone.length} of ${tools.length} tools have a node in the live stack scene${gone.length ? ` (missing: ${gone.map((t) => t.graph).join(", ")})` : ""}`);
    if (gone.length) fails++;
  } catch (err) {
    console.log(`FAIL drift: could not read the live map (${err.message})`);
    fails++;
  }
}

console.log(fails ? `RESULT: ${fails} check(s) failed` : "RESULT: all checks pass");
process.exit(fails ? 1 : 0);
