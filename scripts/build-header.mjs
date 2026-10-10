// Builds the four boot screen SVGs from profile.config.json.
// Node standard library only. Same input, byte-identical output.
//
//   node scripts/build-header.mjs           check, then write assets/*.svg
//   node scripts/build-header.mjs --check   check, build in memory, compare, write nothing
//
// Exits 1 on any failed check or, with --check, on any difference.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_ONLY = process.argv.includes("--check");
const cfg = JSON.parse(readFileSync(join(ROOT, "profile.config.json"), "utf8"));
const S = cfg.strings;
const glyphs = JSON.parse(readFileSync(join(ROOT, "assets/fonts/glyphs.json"), "utf8"));
const font400 = readFileSync(join(ROOT, "assets/fonts/jbm-400.woff")).toString("base64");
const font800 = readFileSync(join(ROOT, "assets/fonts/jbm-800.woff")).toString("base64");

let failures = 0;
const fail = (msg) => { console.log(`FAIL ${msg}`); failures++; };
const pass = (msg) => console.log(`PASS ${msg}`);

// ---------- check 1: no dashes, no exclamation marks in any config string
const allStrings = [];
(function walk(v) {
  if (typeof v === "string") allStrings.push(v);
  else if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === "object") Object.values(v).forEach(walk);
})(cfg);
const badChars = allStrings.filter((s) => /[\u2013\u2014!]/.test(s));
badChars.length ? fail(`config strings with a dash or exclamation mark: ${badChars.length}`) : pass("no em dash, en dash or exclamation mark in the config");

// ---------- check 2: contrast (WCAG 2.x relative luminance)
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const theme of ["dark", "light"]) {
  const p = cfg.palette[theme];
  for (const [role, min] of [["name", 4.5], ["sage", 4.5], ["muted", 4.5], ["copper", 3]]) {
    const r = ratio(p[role], p.panel);
    const line = `contrast ${theme} ${role} ${p[role]} on ${p.panel}: ${r.toFixed(2)}:1 (min ${min}, ${min === 3 ? "stroke" : "text"})`;
    r >= min ? pass(line) : fail(line);
  }
}

// ---------- check 3: every character is in the subset for its weight
const w400 = [S.silkLeft, S.silkRight, ...S.boot, S.tagline, ...S.taglineNarrow, S.status];
const w800 = [S.name, ...S.nameNarrow];
const missing = (list, set) => [...new Set(list.join(""))].filter((c) => !set.includes(c));
const m4 = missing(w400, glyphs["400"]), m8 = missing(w800, glyphs["800"]);
m4.length || m8.length ? fail(`characters missing from the font subset: 400=${m4.length}, 800=${m8.length}`) : pass("every drawn character is in the font subset");

// ---------- check 4: every drawn word is in the alt text
const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const altWords = new Set(words(S.alt));
const lost = [...new Set(words([...w400, ...w800].join(" ")))].filter((w) => !altWords.has(w));
lost.length ? fail(`drawn words not in the alt text: ${lost.join(", ")}`) : pass("every drawn word is in the alt text");

// ---------- SVG template
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const STACK = `"JBM", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;

function style(p) {
  return [
    `@font-face{font-family:"JBM";font-weight:400;font-style:normal;src:url(data:font/woff;base64,${font400}) format("woff")}`,
    `@font-face{font-family:"JBM";font-weight:800;font-style:normal;src:url(data:font/woff;base64,${font800}) format("woff")}`,
    `text{font-family:${STACK};font-weight:400}`,
    `.silk{fill:${p.muted};letter-spacing:.26em}`,
    `.boot{fill:${p.sage}}`,
    `.name{fill:${p.name};font-weight:800}`,
    `.ghost{fill:${p.copper};font-weight:800;opacity:0}`,
    `.tag{fill:${p.muted}}`,
    `.status{fill:${p.sage}}`,
    `.caret{fill:${p.sage}}`,
    `.cover{fill:${p.panel};transform-box:fill-box;transform-origin:right center;transform:scaleX(0)}`,
    `.trace{fill:none;stroke:${p.copper};stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:0}`,
    `.pad{fill:${p.copper}}`,
    `.ring{fill:none;stroke:${p.copper};stroke-width:1.5}`,
    `.pop{transform-box:fill-box;transform-origin:center}`,
    `@keyframes fade{from{opacity:0}to{opacity:1}}`,
    `@keyframes type{from{transform:scaleX(1)}to{transform:scaleX(0)}}`,
    `@keyframes blink{0%{opacity:1}50%{opacity:0}100%{opacity:1}}`,
    `@keyframes hold{from{opacity:0}to{opacity:0}}`,
    `@keyframes land{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`,
    `@keyframes flash{0%{opacity:.85}100%{opacity:0}}`,
    `@keyframes draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}`,
    `@keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}`,
    `@media (prefers-reduced-motion: no-preference){`,
    `.a-frame{animation:fade .3s ease-out 0s both}`,
    `.a-silk{animation:fade .3s ease-out .1s both}`,
    `.a-b1{animation:type .35s steps(${S.boot[0].length}, end) .2s both}`,
    `.a-b2{animation:type .55s steps(${S.boot[1].length}, end) .6s both}`,
    `.a-b3{animation:type .2s steps(${S.boot[2].length}, end) 1.2s both}`,
    // The caret waits, hidden, until the last boot line is typed (1.4 s), so it never runs ahead of the typing.
    `.a-caret{animation:blink .5s steps(1, end) 1.4s 4 both, hold 1.4s linear 0s 1 none}`,
    `.a-name{animation:land .4s cubic-bezier(.2,.7,.2,1) 1.5s both}`,
    `.a-ghost{animation:flash .12s linear 1.5s 1 none}`,
    `.a-trace{animation:draw 1.2s ease-in-out 1.9s both}`,
    `.a-pad{animation:pop .2s ease-out 3.1s both}`,
    `.a-tail{animation:fade .4s ease-out 3.2s both}`,
    `}`,
  ].join("\n");
}

// One cover rect per boot line: spec section 3.6.
const cover = (x, y, size, text, cls) => {
  const w = +(text.length * 0.6 * size + 4).toFixed(2);
  const h = +(size * 1.3).toFixed(2);
  return `<rect class="cover ${cls}" aria-hidden="true" x="${x - 2}" y="${y - size}" width="${w}" height="${h}"/>`;
};

function svg(theme, L) {
  const p = cfg.palette[theme];
  const alt = esc(S.alt);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.w}" height="${L.h}" viewBox="0 0 ${L.w} ${L.h}" role="img" aria-label="${alt}">`);
  out.push(`<title>${alt}</title>`);
  out.push(`<style>\n${style(p)}\n</style>`);
  out.push(`<defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="${p.grid}"/></pattern></defs>`);
  out.push(`<rect x="0.5" y="0.5" width="${L.w - 1}" height="${L.h - 1}" rx="14" fill="${p.panel}"/>`);
  out.push(`<g class="a-frame" aria-hidden="true">`);
  out.push(`<rect x="0.5" y="0.5" width="${L.w - 1}" height="${L.h - 1}" rx="14" fill="none" stroke="${p.border}" stroke-width="1"/>`);
  out.push(`<rect x="${L.grid[0]}" y="${L.grid[1]}" width="${L.grid[2]}" height="${L.grid[3]}" fill="url(#dots)" opacity="${p.gridOpacity}"/>`);
  out.push(`</g>`);
  out.push(`<g class="a-silk" font-size="13">`);
  out.push(`<text class="silk" x="${L.silkL}" y="${L.silkY}">${esc(S.silkLeft)}</text>`);
  out.push(`<text class="silk" x="${L.silkR}" y="${L.silkY}" text-anchor="end">${esc(S.silkRight)}</text>`);
  out.push(`</g>`);
  S.boot.forEach((line, i) => {
    out.push(`<text class="boot" x="${L.bootX}" y="${L.bootY[i]}" font-size="${L.bootSize}">${esc(line)}</text>`);
  });
  S.boot.forEach((line, i) => out.push(cover(L.bootX, L.bootY[i], L.bootSize, line, `a-b${i + 1}`)));
  out.push(`<rect class="caret a-caret" x="${L.caret[0]}" y="${L.caret[1]}" width="${L.caret[2]}" height="${L.caret[3]}"/>`);
  for (const n of L.names) {
    out.push(`<text class="ghost a-ghost" aria-hidden="true" x="${n.x + 4}" y="${n.y}" font-size="${L.nameSize}" textLength="${n.len}" lengthAdjust="spacingAndGlyphs">${esc(n.text)}</text>`);
  }
  for (const n of L.names) {
    out.push(`<text class="name a-name" x="${n.x}" y="${n.y}" font-size="${L.nameSize}" textLength="${n.len}" lengthAdjust="spacingAndGlyphs">${esc(n.text)}</text>`);
  }
  out.push(`<path class="trace a-trace" d="${L.trace}" pathLength="1"/>`);
  out.push(`<circle class="pad pop a-pad" cx="${L.pad[0]}" cy="${L.pad[1]}" r="7"/>`);
  out.push(`<circle class="ring pop a-pad" cx="${L.pad[0]}" cy="${L.pad[1]}" r="12"/>`);
  out.push(`<g class="a-tail">`);
  L.tag.forEach((t) => out.push(`<text class="tag" x="${L.tagX}" y="${t.y}" font-size="24">${esc(t.text)}</text>`));
  out.push(`<text class="status" x="${L.statusX}" y="${L.statusY}" font-size="${L.statusSize}" text-anchor="end">${esc(S.status)}</text>`);
  out.push(`</g>`);
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}

const WIDE = {
  w: 1200, h: 400, grid: [820, 24, 356, 352],
  silkL: 56, silkR: 1144, silkY: 44,
  bootX: 56, bootY: [92, 122, 152], bootSize: 20, caret: [182, 136, 11, 20],
  nameSize: 96, names: [{ text: S.name, x: 56, y: 262, len: 634 }],
  trace: "M56 292 H980 L1020 252 H1097", pad: [1104, 252],
  tagX: 56, tag: [{ text: S.tagline, y: 344 }],
  statusX: 1144, statusY: 380, statusSize: 15,
};
const NARROW = {
  w: 640, h: 560, grid: [430, 190, 186, 150],
  silkL: 40, silkR: 600, silkY: 40,
  bootX: 40, bootY: [88, 118, 148], bootSize: 22, caret: [179, 131, 12, 22],
  nameSize: 104, names: [{ text: S.nameNarrow[0], x: 40, y: 268, len: 250 }, { text: S.nameNarrow[1], x: 40, y: 372, len: 374 }],
  trace: "M40 402 H500 L540 362 H585", pad: [592, 362],
  tagX: 40, tag: S.taglineNarrow.map((text, i) => ({ text, y: [446, 476, 506][i] })),
  statusX: 600, statusY: 540, statusSize: 16,
};

const files = {
  "assets/boot-dark.svg": svg("dark", WIDE),
  "assets/boot-light.svg": svg("light", WIDE),
  "assets/boot-narrow-dark.svg": svg("dark", NARROW),
  "assets/boot-narrow-light.svg": svg("light", NARROW),
};

// ---------- checks 5 and 6: size budget and no external reference
for (const [name, body] of Object.entries(files)) {
  const bytes = Buffer.byteLength(body);
  bytes <= cfg.budgetBytes ? pass(`${name} ${bytes} bytes (budget ${cfg.budgetBytes})`) : fail(`${name} ${bytes} bytes, over budget ${cfg.budgetBytes}`);
  const noNs = body.replace('xmlns="http://www.w3.org/2000/svg"', "");
  const urls = (body.match(/url\(([^)]*)\)/g) || []).filter((u) => !/^url\((#|data:)/.test(u));
  const bad = [/<script/i.test(body), /https?:\/\//i.test(noNs), /@import/i.test(body), urls.length > 0].filter(Boolean).length;
  bad ? fail(`${name} has a script, an external URL or an import`) : pass(`${name} has no script, no external URL, no import`);
}

if (failures) { console.log(`RESULT: ${failures} check(s) failed, nothing written`); process.exit(1); }

if (CHECK_ONLY) {
  let diff = 0;
  for (const [name, body] of Object.entries(files)) {
    const path = join(ROOT, name);
    const same = existsSync(path) && readFileSync(path, "utf8") === body;
    same ? pass(`${name} matches a fresh build`) : (fail(`${name} differs from a fresh build`), diff++);
  }
  console.log(diff ? "RESULT: committed SVGs are out of date" : "RESULT: all checks pass");
  process.exit(diff ? 1 : 0);
}

for (const [name, body] of Object.entries(files)) writeFileSync(join(ROOT, name), body);
console.log("RESULT: all checks pass, four SVGs written");
