// Builds every SVG on the profile from profile.config.json, the font subsets and vendor/icons.
// Node standard library only. Same input, byte-identical output. Nothing is read from the network.
//
//   node scripts/build.mjs           check, then write the 14 SVG files
//   node scripts/build.mjs --check   check, build in memory, compare with the committed files, write nothing
//
// Files: assets/fab-{dark,light}.svg, assets/fab-narrow-{dark,light}.svg (the header),
// assets/typing-{dark,light}.svg (the typing line), assets/stack-{dark,light}.svg,
// assets/stack-narrow-{dark,light}.svg (the stack board) and assets/badges/*.svg (4 badges).
// Exits 1 on any failed check or, with --check, on any difference.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_ONLY = process.argv.includes("--check");
const cfg = JSON.parse(readFileSync(join(ROOT, "profile.config.json"), "utf8"));
const glyphs = JSON.parse(readFileSync(join(ROOT, "assets/fonts/glyphs.json"), "utf8"));
const F400 = readFileSync(join(ROOT, "assets/fonts/jbm-400.woff")).toString("base64");
const F800 = readFileSync(join(ROOT, "assets/fonts/jbm-800.woff")).toString("base64");

let failures = 0;
const fail = (msg) => { console.log(`FAIL ${msg}`); failures++; };
const pass = (msg) => console.log(`PASS ${msg}`);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fillIn = (s) => s.replace(/\{(\w+)\}/g, (_, k) => String(cfg.canonical[k]));
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;

// Every character drawn in each weight is recorded here, for the subset check.
const drawn = { 400: new Set(), 800: new Set() };
// Every text colour and its background is recorded here, for the contrast check.
const pairs = new Map();
function text(x, y, size, s, { w = 400, fill, bg, anchor, ls, cls, extra = "" }) {
  for (const c of s) drawn[w].add(c);
  if (fill && bg) pairs.set(`${fill} on ${bg}`, [fill, bg]);
  const a = [`x="${x}"`, `y="${y}"`, `font-size="${size}"`];
  if (w === 800) a.push(`font-weight="800"`);
  if (ls) a.push(`letter-spacing="${ls}"`);
  if (anchor) a.push(`text-anchor="${anchor}"`);
  if (fill) a.push(`fill="${fill}"`);
  if (cls) a.push(`class="${cls}"`);
  return `<text ${a.join(" ")}${extra}>`;
}
const T = (x, y, size, s, o) => `${text(x, y, size, s, o)}${esc(s)}</text>`;

const fontCss = (weights) => weights.map((w) => `@font-face{font-family:J;font-weight:${w};src:url(data:font/woff;base64,${w === 800 ? F800 : F400}) format("woff")}`).join("")
  + `text{font-family:J,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}`;

// ====================================================================== header: the fab line
const HC = cfg.header;
const LOOP = 16.4, CYCLE = 4.4, FINALE = 13.2;     // spec 3.1: three 4.4 s cycles, then a 3.2 s finale
const EASE = "0.45 0 0.2 1", LIN = "0 0 1 1";
const ARM = [900, 150], L1 = 90, L2 = 80;          // SCARA base and link lengths
const PICK = [816, 244], PITCH = 44;               // pick point on the belt, die pitch
const SOCK = [[1010, 104], [1010, 174], [1010, 244]];

const deg = (r) => (r * 180) / Math.PI;
function ik([x, y]) {
  const dx = x - ARM[0], dy = y - ARM[1];
  const c2 = (dx * dx + dy * dy - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  const t2 = Math.acos(Math.max(-1, Math.min(1, c2)));
  const t1 = Math.atan2(dy, dx) - Math.atan2(L2 * Math.sin(t2), L1 + L2 * Math.cos(t2));
  return [deg(t1), deg(t2)];
}
const poseP = ik(PICK), poseQ = SOCK.map(ik);
const unwrap = (a, ref) => { while (a - ref > 180) a -= 360; while (a - ref < -180) a += 360; return a; };
poseQ.forEach((q) => { q[0] = unwrap(q[0], poseP[0]); });

// A track is a list of [time, value, ease]. The ease applies to the segment that ends at that key.
function spline(track) {
  const pts = [...track];
  if (pts[0][0] > 0) pts.unshift([0, pts[0][1]]);
  if (pts[pts.length - 1][0] < LOOP) pts.push([LOOP, pts[pts.length - 1][1]]);
  return {
    values: pts.map((p) => p[1]).join(";"),
    keyTimes: pts.map((p) => r3(p[0] / LOOP)).join(";"),
    keySplines: pts.slice(1).map((p) => p[2] || EASE).join(";"),
  };
}
const smil = (tag, attrs, s) => `<${tag} ${attrs} dur="${LOOP}s" repeatCount="indefinite" calcMode="spline" values="${s.values}" keyTimes="${s.keyTimes}" keySplines="${s.keySplines}"/>`;
const animRotate = (track) => smil("animateTransform", `attributeName="transform" type="rotate"`, spline(track.map(([t, v, e]) => [t, `${r3(v)}`, e])));
const animTranslate = (track) => smil("animateTransform", `attributeName="transform" type="translate"`, spline(track));
const animAttr = (attr, track) => smil("animate", `attributeName="${attr}"`, spline(track));
// Discrete on and off: a list of [from, to] windows in which the element shows.
function animShow(windows) {
  const keys = [[0, 0]];
  for (const [a, b] of windows) { keys.push([a, 1]); keys.push([b, 0]); }
  const merged = [];
  for (const k of keys) { if (merged.length && merged[merged.length - 1][0] === k[0]) merged[merged.length - 1] = k; else merged.push(k); }
  return `<animate attributeName="opacity" dur="${LOOP}s" repeatCount="indefinite" calcMode="discrete" values="${merged.map((k) => k[1]).join(";")}" keyTimes="${merged.map((k) => r3(k[0] / LOOP)).join(";")}"/>`;
}

// Arm tracks: wait over the belt, swing to the socket, place, swing back.
const a1 = [[0, poseP[0]]], a2 = [[0, poseP[1]]], jaw = [[0, 13]];
for (let c = 0; c < 3; c++) {
  const s = c * CYCLE;
  a1.push([s + 1.45, poseP[0]], [s + 2.65, poseQ[c][0]], [s + 3.1, poseQ[c][0]], [s + 4.3, poseP[0]]);
  a2.push([s + 1.45, poseP[1]], [s + 2.65, poseQ[c][1]], [s + 3.1, poseQ[c][1]], [s + 4.3, poseP[1]]);
  jaw.push([s + 1.15, 13], [s + 1.35, 9], [s + 2.75, 9], [s + 2.95, 13]);
}
const wrist = a1.map((k, i) => [k[0], -(k[1] + a2[i][1])]);

const die = (x, y, p) => {
  const pins = [];
  for (const o of [-6, 0, 6]) pins.push(`M${x + o} ${y - 11}v-4M${x + o} ${y + 11}v4M${x - 11} ${y + o}h-4M${x + 11} ${y + o}h4`);
  return `<path d="${pins.join("")}" stroke="${p.muted}" stroke-width="1.4"/><rect x="${x - 11}" y="${y - 11}" width="22" height="22" rx="2" fill="${p.die}" stroke="${p.fg}" stroke-width="1"/><rect x="${x - 5}" y="${y - 5}" width="10" height="10" fill="${p.fg}" opacity="0.28"/>`;
};
const traceSet = ([x, y]) => [
  `M${x + 16} ${y - 8} H1080 L1092 ${y - 20} H1150`,
  `M${x + 16} ${y} H1150`,
  `M${x + 16} ${y + 8} H1070 L1082 ${y + 20} H1150`,
  `M${x} ${y - 16} V${y - 26} H1040`,
];

const WIDE = {
  w: 1200, h: 320, scene: null,
  silk: { x: 40, y: 38, xr: 1160, size: 12 },
  name: { x: 38, y: 112, size: 60 },
  counters: { labelY: 170, labelSize: 13, labelX: [40, 190, 340], valueY: 218, valueSize: 44, valueX: [38, 188, 338] },
  status: { x: 40, y: 258, size: 17 },
  caret: { x: 40, y: 272, w: 10, h: 18 },
  main: "M1010 260 V300 H520 L470 250 V150 L456 136 H40", pad: [40, 136],
};
const NARROW = {
  w: 640, h: 460, scene: [-540, 150],
  silk: { x: 24, y: 30, xr: 616, size: 11 },
  name: { x: 22, y: 84, size: 44 },
  counters: { labelY: 128, labelSize: 12, labelX: [24, 170, 316], valueY: 166, valueSize: 34, valueX: [22, 168, 314] },
  status: { x: 24, y: 196, size: 15 },
  caret: null,
  main: "M470 410 V440 L460 450 H20 L10 440 V112 L20 102 H322", pad: [322, 102],
};

// The moving parts. anim = true gives the SMIL group (.m); false gives the finished still (.s).
// In the SMIL group every base attribute is also the finished state, so a viewer that runs no SMIL shows a finished board.
function fabLayer(p, L, anim) {
  const sceneA = [], sceneB = [], trace = [], canvas = [];
  const C = CYCLE, F = FINALE;
  // belt with dies; the station hood hides the three-pitch reset at the loop point
  const ticks = [];
  for (let x = 520; x < 845; x += 22) ticks.push(`M${x} 225v5M${x} 258v5`);
  const beltTrack = [[0, "0 0"]];
  for (let c = 0; c < 3; c++) beltTrack.push([c * C + 0.05, `${c * PITCH} 0`], [c * C + 1.1, `${(c + 1) * PITCH} 0`]);
  const dies = [];
  for (let k = 1; k <= 7; k++) {
    const show = anim && k <= 3 ? animShow([[0, (k - 1) * C + 1.35]]) : "";
    dies.push(`<g>${show}${die(PICK[0] - k * PITCH, PICK[1], p)}</g>`);
  }
  sceneA.push(`<g clip-path="url(#belt)"><g transform="translate(${PITCH} 0)">${anim ? animTranslate(beltTrack) : ""}<path d="${ticks.join("")}" stroke="${p.muted}" stroke-width="1" opacity="0.6"/>${dies.join("")}</g></g>`);
  // dicing station, wafer and scan line
  const grid = [];
  for (let gx = 570; gx < 642; gx += 9) for (let gy = 204; gy < 276; gy += 9) grid.push(`M${gx} ${gy}h7v7h-7z`);
  sceneA.push(`<rect x="560" y="192" width="92" height="96" rx="4" fill="${p.station}" stroke="${p.line}" stroke-width="1.5"/>`);
  const spin = anim ? `<animateTransform attributeName="transform" type="rotate" from="0 606 240" to="360 606 240" dur="${LOOP / 2}s" repeatCount="indefinite"/>` : "";
  sceneA.push(`<g>${spin}<circle cx="606" cy="240" r="36" fill="${p.wafer}" stroke="${p.muted}" stroke-width="1"/><path clip-path="url(#wf)" d="${grid.join("")}" fill="${p.fg}" opacity="0.18"/><path d="M600 276h12" stroke="${p.panel}" stroke-width="3"/></g>`);
  sceneA.push(anim
    ? `<path d="M566 240H646" stroke="${p.fg}" stroke-width="1" opacity="0.35"><animateTransform attributeName="transform" type="translate" values="0 -34;0 34;0 -34" dur="2.6s" repeatCount="indefinite"/></path>`
    : `<path d="M566 240H646" stroke="${p.fg}" stroke-width="1" opacity="0.35"/>`);
  // board: lit traces, LEDs, fingers, signal dots and seated dies
  SOCK.forEach((q, i) => {
    const s = i * C;
    const draw = anim ? animAttr("stroke-dashoffset", [[0, "1"], [s + 2.9, "1"], [s + 3.7, "0", LIN], [LOOP - 0.8, "0"], [LOOP - 0.3, "0"]]) : "";
    const fade = anim ? animAttr("opacity", [[0, "1"], [LOOP - 0.8, "1"], [LOOP - 0.3, "0", LIN], [LOOP - 0.01, "0"], [LOOP, "1", LIN]]) : "";
    const lit = (wd, extra) => traceSet(q).map((d) => `<path d="${d}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="0" fill="none" stroke="${p.copper}" stroke-width="${wd}"${extra}>${draw}</path>`).join("");
    sceneA.push(`<g>${fade}${lit(6, ` opacity="0.35" filter="url(#glow)"`)}${lit(2, "")}</g>`);
    const on = anim ? animShow([[s + 3.6, LOOP - 0.5]]) : "";
    sceneA.push(`<g>${on}${[-20, 0, 20].map((dy) => `<rect x="1150" y="${q[1] + dy - 3}" width="14" height="6" rx="1" fill="${p.copper}"/>`).join("")}<circle cx="1052" cy="${q[1] - 26}" r="3.5" fill="${p.copper}"/><circle cx="1052" cy="${q[1] - 26}" r="7" fill="${p.copper}" opacity="0.3" filter="url(#glow)"/></g>`);
    if (anim) sceneA.push(`<g opacity="0">${animShow([[s + 3.7, LOOP - 0.8]])}<circle r="2.6" fill="${p.fg}"><animateMotion dur="1.2s" repeatCount="indefinite" path="M${q[0] + 16} ${q[1]} H1150"/></circle><circle r="2.2" fill="${p.fg}"><animateMotion dur="1.2s" begin="0.6s" repeatCount="indefinite" path="${traceSet(q)[0]}"/></circle></g>`);
    const seat = anim ? animShow([[s + 2.8, LOOP - 0.5]]) : "";
    sceneA.push(`<g>${seat}${die(q[0], q[1], p)}</g>`);
  });
  // main trace: socket C to the name pad
  {
    const draw = anim ? animAttr("stroke-dashoffset", [[0, "1"], [F + 0.2, "1"], [F + 1.6, "0", LIN], [LOOP - 0.8, "0"]]) : "";
    const fade = anim ? animAttr("opacity", [[0, "1"], [LOOP - 0.8, "1"], [LOOP - 0.3, "0", LIN], [LOOP - 0.01, "0"], [LOOP, "1", LIN]]) : "";
    trace.push(`<g>${fade}<path d="${L.main}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="0" fill="none" stroke="${p.copper}" stroke-width="6" opacity="0.35" filter="url(#glow)">${draw}</path><path d="${L.main}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="0" fill="none" stroke="${p.copper}" stroke-width="2">${draw}</path></g>`);
    if (anim) trace.push(`<g opacity="0">${animShow([[F + 1.6, LOOP - 0.8]])}<circle r="3" fill="${p.fg}"><animateMotion dur="1.4s" repeatCount="indefinite" path="${L.main}"/></circle></g>`);
    const padOn = anim ? animShow([[F + 1.6, LOOP - 0.5]]) : "";
    trace.push(`<g>${padOn}<circle cx="${L.pad[0]}" cy="${L.pad[1]}" r="4" fill="${p.copper}"/><circle cx="${L.pad[0]}" cy="${L.pad[1]}" r="9" fill="${p.copper}" opacity="0.35" filter="url(#glow)"/></g>`);
  }
  // the arm, a SCARA seen from above; the wrist turns against the links so the die stays square
  {
    const [t1, t2] = poseP;
    const carry = anim ? animShow([0, 1, 2].map((c) => [c * C + 1.35, c * C + 2.8])) : "";
    const jl = anim ? animTranslate(jaw.map(([t, v]) => [t, `${-v} 0`])) : "";
    const jr = anim ? animTranslate(jaw.map(([t, v]) => [t, `${v} 0`])) : "";
    sceneB.push(`<g transform="translate(${ARM[0]} ${ARM[1]})">`
      + `<rect x="-36" y="-36" width="72" height="72" rx="6" fill="${p.panel}" stroke="${p.line}" stroke-width="1.5"/>${[[-27, -27], [27, -27], [-27, 27], [27, 27]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" fill="${p.line}"/>`).join("")}<circle r="26" fill="${p.station}" stroke="${p.muted}" stroke-width="1"/>`
      + `<g transform="rotate(${r3(t1)})">${anim ? animRotate(a1) : ""}<rect x="-14" y="-13" width="${L1 + 28}" height="26" rx="13" fill="${p.arm}" stroke="${p.armStroke}" stroke-width="1.2"/><circle r="7" fill="${p.panel}" stroke="${p.armStroke}"/><circle r="2.5" fill="${p.fg}"/>`
      + `<g transform="translate(${L1} 0)"><g transform="rotate(${r3(t2)})">${anim ? animRotate(a2) : ""}<rect x="-11" y="-10" width="${L2 + 22}" height="20" rx="10" fill="${p.arm}" stroke="${p.armStroke}" stroke-width="1.2"/><circle r="6" fill="${p.panel}" stroke="${p.armStroke}"/><circle r="2" fill="${p.fg}"/>`
      + `<g transform="translate(${L2} 0)"><g transform="rotate(${r3(-(t1 + t2))})">${anim ? animRotate(wrist) : ""}`
      + `<g opacity="0">${carry}<rect x="-10" y="-8" width="24" height="24" rx="2" fill="#000" opacity="0.25"/><g transform="scale(1.14)">${die(0, 0, p)}</g></g>`
      + `<rect x="-17" y="-17" width="34" height="34" rx="4" fill="none" stroke="${p.armStroke}" stroke-width="1" stroke-dasharray="2 3"/>`
      + `<g transform="translate(-13 0)">${jl}<rect x="-3" y="-14" width="6" height="28" rx="2" fill="${p.fg}" opacity="0.85"/></g>`
      + `<g transform="translate(13 0)">${jr}<rect x="-3" y="-14" width="6" height="28" rx="2" fill="${p.fg}" opacity="0.85"/></g>`
      + `<circle r="2" fill="${p.copper}"/></g></g></g></g></g></g>`);
  }
  // readout: slot letter, status line, caret
  const K = L.counters, St = L.status, sx = K.valueX[2];
  const val = (s, extra) => `${text(sx, K.valueY, K.valueSize, s, { w: 800, fill: p.fg, bg: p.panel, extra })}`;
  const stat = (s, col, extra) => `${text(St.x, St.y, St.size, `> ${s}`, { fill: col, bg: p.panel, extra })}`;
  const slots = HC.slots, all = slots.join("");
  const say = (s) => `&gt; ${esc(s)}`;
  if (anim) {
    slots.forEach((sl, i) => canvas.push(`${val(sl, ` opacity="0"`)}${animShow([[i * C, (i + 1) * C]])}${esc(sl)}</text>`));
    canvas.push(`${val(all, "")}${animShow([[F, LOOP]])}${esc(all)}</text>`);
    const win = [[0, 1.15], [1.15, 1.45], [1.45, 2.75], [2.75, 3.6]];
    HC.steps.forEach((w, i) => canvas.push(`${stat(w, p.fg, ` opacity="0"`)}${animShow([0, 1, 2].map((c) => [c * C + win[i][0], c * C + win[i][1]]))}${say(w)}</text>`));
    canvas.push(`${stat(HC.seated, p.copper, ` opacity="0"`)}${animShow([0, 1, 2].map((c) => [c * C + 3.6, c * C + C]))}${say(HC.seated)}</text>`);
    canvas.push(`${stat(HC.live, p.copper, "")}${animShow([[F, LOOP]])}${say(HC.live)}</text>`);
    if (L.caret) canvas.push(`<rect x="${L.caret.x}" y="${L.caret.y}" width="${L.caret.w}" height="${L.caret.h}" fill="${p.fg}"><animate attributeName="opacity" values="1;0" dur="1.1s" calcMode="discrete" repeatCount="indefinite"/></rect>`);
  } else {
    canvas.push(`${val(all, "")}${esc(all)}</text>`);
    canvas.push(`${stat(HC.live, p.copper, "")}${say(HC.live)}</text>`);
    if (L.caret) canvas.push(`<rect x="${L.caret.x}" y="${L.caret.y}" width="${L.caret.w}" height="${L.caret.h}" fill="${p.fg}"/>`);
  }
  const wrap = (parts) => (L.scene ? `<g transform="translate(${L.scene[0]} ${L.scene[1]})">${parts.join("")}</g>` : parts.join(""));
  return [wrap(sceneA), trace.join(""), wrap(sceneB), canvas.join("")].join("\n");
}

function fab(theme, L) {
  const p = cfg.palette[theme];
  const o = [];
  const title = esc(fillIn(HC.title));
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.w}" height="${L.h}" viewBox="0 0 ${L.w} ${L.h}" role="img" aria-label="${title}">`);
  o.push(`<title>${title}</title>`);
  o.push(`<style>${fontCss([400, 800])}\n.s{display:none}\n@media (prefers-reduced-motion:reduce){.m{display:none}.s{display:inline}}</style>`);
  o.push(`<defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${p.grid}" opacity="${p.gridOpacity}"/></pattern>`
    + `<clipPath id="belt"><rect x="652" y="222" width="190" height="44"/></clipPath><clipPath id="wf"><circle cx="606" cy="240" r="33"/></clipPath>`
    + `<filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>`);
  o.push(`<rect x="0.5" y="0.5" width="${L.w - 1}" height="${L.h - 1}" rx="10" fill="${p.panel}" stroke="${p.frame}"/>`);
  o.push(`<rect x="1" y="1" width="${L.w - 2}" height="${L.h - 2}" rx="10" fill="url(#g)"/>`);
  o.push(T(L.silk.x, L.silk.y, L.silk.size, HC.silkLeft, { fill: p.muted, bg: p.panel, ls: 2 }));
  o.push(T(L.silk.xr, L.silk.y, L.silk.size, HC.silkRight, { fill: p.muted, bg: p.panel, ls: 1, anchor: "end" }));
  o.push(T(L.name.x, L.name.y, L.name.size, HC.name, { w: 800, fill: p.fg, bg: p.panel, ls: 1 }));
  const K = L.counters;
  HC.counters.forEach(([label, key], i) => {
    o.push(T(K.labelX[i], K.labelY, K.labelSize, label, { fill: p.muted, bg: p.panel, ls: 2 }));
    if (key) o.push(T(K.valueX[i], K.valueY, K.valueSize, String(cfg.canonical[key]), { w: 800, fill: p.fg, bg: p.panel }));
  });
  o.push(`<path d="${L.main}" fill="none" stroke="${p.line}" stroke-width="2"/><circle cx="${L.pad[0]}" cy="${L.pad[1]}" r="4" fill="${p.line}"/>`);
  // the static scene: board, sockets, dim traces, station labels, belt bed
  const sc = [];
  sc.push(`<rect x="950" y="56" width="220" height="236" rx="6" fill="${p.board}" stroke="${p.line}" stroke-width="1.5"/>`);
  for (const [hx, hy] of [[962, 68], [1158, 68], [962, 280], [1158, 280]]) sc.push(`<circle cx="${hx}" cy="${hy}" r="4.5" fill="none" stroke="${p.line}" stroke-width="1.5"/>`);
  sc.push(T(974, 72, 10, HC.board, { fill: p.muted, bg: p.board, ls: 1.5 }));
  SOCK.forEach((q, i) => {
    for (const d of traceSet(q)) sc.push(`<path d="${d}" fill="none" stroke="${p.line}" stroke-width="2"/>`);
    sc.push(`<rect x="1110" y="${q[1] - 3}" width="10" height="6" fill="${p.muted}" opacity="0.5"/>`);
    for (const dy of [-20, 0, 20]) sc.push(`<rect x="1150" y="${q[1] + dy - 3}" width="14" height="6" rx="1" fill="${p.line}"/>`);
    sc.push(`<rect x="${q[0] - 16}" y="${q[1] - 16}" width="32" height="32" rx="3" fill="none" stroke="${p.muted}" stroke-width="1" stroke-dasharray="3 3"/>`);
    sc.push(T(q[0] - 30, q[1] + 4, 11, HC.slots[i], { fill: p.muted, bg: p.board, anchor: "end" }));
    sc.push(`<circle cx="1052" cy="${q[1] - 26}" r="3.5" fill="${p.line}"/>`);
  });
  sc.push(T(560, 184, 11, HC.dice, { fill: p.muted, bg: p.panel, ls: 1.5 }));
  sc.push(T(664, 212, 11, HC.feed, { fill: p.muted, bg: p.panel, ls: 1.5 }));
  sc.push(`<rect x="652" y="222" width="190" height="44" fill="${p.belt}"/><path d="M652 222H842M652 266H842" stroke="${p.muted}" stroke-width="1.2"/><path d="M838 222V266" stroke="${p.line}" stroke-width="3"/>`);
  o.push(L.scene ? `<g transform="translate(${L.scene[0]} ${L.scene[1]})">${sc.join("")}</g>` : sc.join(""));
  o.push(`<g class="m">\n${fabLayer(p, L, true)}\n</g>`);
  o.push(`<g class="s">\n${fabLayer(p, L, false)}\n</g>`);
  o.push(`</svg>`);
  return o.join("\n") + "\n";
}

// ====================================================================== typing line
// readme-typing-svg pattern, vendored: type, hold, delete, next. Plays once and ends on phrase 1.
// The base CSS is the finished frame. Every keyframe sits inside prefers-reduced-motion: no-preference.
function typing(theme) {
  const p = cfg.palette[theme];
  const W = 620, H = 36, X = 26, CW = 12, SIZE = 20, BASE = 25;
  const TYPE = 0.055, HOLD = 1.8, DEL = 0.03, GAP = 0.3;
  const seq = [...cfg.typing, cfg.typing[0]];
  const last = seq.length - 1;
  let t = 0;
  const marks = seq.map((ph, i) => {
    const n = ph.length, a = t, b = a + n * TYPE;
    const c = b + HOLD, d = c + n * DEL;
    t = i === last ? b : d + GAP;
    return { ph, n, a, b, c, d };
  });
  const total = r3(t);
  const pc = (x) => `${r3((x / total) * 100)}%`;
  const kf = [], els = [], rules = [];
  marks.forEach((m, i) => {
    const w = m.n * CW, next = i < last ? marks[i + 1].a : total;
    const st = `animation-timing-function:steps(${m.n},end)`;
    if (i < last) {
      kf.push(`@keyframes w${i}{0%,${pc(m.a)}{transform:scaleX(0);${st}}${pc(m.b)},${pc(m.c)}{transform:scaleX(1);${st}}${pc(m.d)},100%{transform:scaleX(0)}}`);
      const pre = i === 0 ? "" : `0%,${pc(m.a - 0.001)}{opacity:0}`;
      kf.push(`@keyframes c${i}{${pre}${pc(m.a)}{opacity:1;transform:translateX(0);${st}}${pc(m.b)},${pc(m.c)}{opacity:1;transform:translateX(${w}px);${st}}${pc(m.d)},${pc(next - 0.001)}{opacity:1;transform:translateX(0)}${pc(next)},100%{opacity:0;transform:translateX(0)}}`);
    } else {
      kf.push(`@keyframes w${i}{0%,${pc(m.a)}{transform:scaleX(0);${st}}100%{transform:scaleX(1)}}`);
      kf.push(`@keyframes c${i}{0%,${pc(m.a - 0.001)}{opacity:0;transform:translateX(0)}${pc(m.a)}{opacity:1;transform:translateX(0);${st}}100%{opacity:1;transform:translateX(${w}px)}}`);
    }
    rules.push(`.w${i}{animation:w${i} ${total}s linear both}.c${i}{animation:c${i} ${total}s linear both${i === last ? `,bl 1.1s steps(1,end) ${total}s infinite` : ""}}`);
    els.push(`<clipPath id="k${i}"><rect class="k w${i}" x="${X}" y="0" width="${w}" height="${H}"/></clipPath>`
      + `${text(X, BASE, SIZE, m.ph, { fill: p.fg, bg: p.page, extra: ` clip-path="url(#k${i})"` })}${esc(m.ph)}</text>`
      + `<rect class="cu c${i}" x="${X + 1}" y="8" width="10" height="20"/>`);
  });
  const wl = marks[last].n * CW;
  const css = `${fontCss([400])}
.k{transform-box:fill-box;transform-origin:left center;transform:scaleX(0)}.w${last}{transform:none}
.cu{fill:${p.copper};opacity:0}.c${last}{opacity:1;transform:translateX(${wl}px)}
@media (prefers-reduced-motion:no-preference){
@keyframes bl{0%{opacity:1}50%{opacity:0}100%{opacity:1}}
${kf.join("\n")}
${rules.join("\n")}
}`;
  const label = esc(cfg.typing.join(". ") + ".");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
<title>${label}</title>
<style>${css}</style>
${T(2, BASE, SIZE, ">", { fill: p.copper, bg: p.page })}
${els.join("\n")}
</svg>
`;
}

// ====================================================================== stack board
const ICONS = join(ROOT, "vendor/icons");
function icon(spec) {
  const [kind, ref] = spec.split(":");
  if (kind === "mark") return { mark: ref };
  const file = kind === "si" ? join(ICONS, "simple-icons", `${ref}.svg`) : join(ICONS, "devicon", `${ref}.svg`);
  const src = readFileSync(file, "utf8");
  const paths = [...src.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  const vb = +src.match(/viewBox="0 0 (\d+) \d+"/)[1];
  if (paths.length !== 1) fail(`${spec}: expected one path, found ${paths.length}`);
  return { d: paths[0], vb, rule: /fill-rule="evenodd"/.test(src) ? "evenodd" : "nonzero" };
}
const STACK = cfg.stack.map((g) => ({ group: g.group, tools: g.tools.map((t) => ({ ...t, ic: icon(t.icon) })) }));

function tile(p, tx, ty, t, n) {
  const S = 56, cx = tx + S / 2, cy = ty + S / 2, o = [];
  const pins = [];
  for (const k of [-14, -5, 5, 14]) pins.push(`M${cx + k} ${ty}v-5M${cx + k} ${ty + S}v5M${tx} ${cy + k}h-5M${tx + S} ${cy + k}h5`);
  o.push(`<path class="pin" style="animation-delay:${r3(0.25 + n * 0.035)}s" d="${pins.join("")}" stroke-width="1.6"/>`);
  o.push(`<rect x="${tx}" y="${ty}" width="${S}" height="${S}" rx="5" fill="${p.tile}" stroke="${p.tileStroke}"/>`);
  o.push(`<circle cx="${tx + 6}" cy="${ty + 6}" r="1.6" fill="${p.muted}"/>`);
  if (t.ic.mark) o.push(T(cx, cy + 7, 20, t.ic.mark, { w: 800, fill: p.fg, bg: p.tile, anchor: "middle" }));
  else { pairs.set(`${p.fg} on ${p.tile}`, [p.fg, p.tile]); o.push(`<path transform="translate(${cx - 14} ${cy - 14}) scale(${r3(28 / t.ic.vb)})" fill="${p.fg}" fill-rule="${t.ic.rule}" d="${t.ic.d}"/>`); }
  o.push(T(cx, ty + S + 20, 11, t.name, { fill: p.muted, bg: p.panel, anchor: "middle" }));
  return o.join("");
}

function stack(theme, narrow) {
  const p = cfg.palette[theme];
  const W = narrow ? 440 : 800;
  const body = [];
  let n = 0, y;
  if (!narrow) {
    // six rows, one group per row
    STACK.forEach((g, gi) => {
      const y0 = 66 + gi * 98, cyRow = y0 + 8 + 28;
      body.push(T(40, cyRow + 4, 12, g.group, { fill: p.copper, bg: p.panel, ls: 1.5 }));
      body.push(`<path d="M174 ${cyRow}H206" stroke="${p.pin}" stroke-width="1"/><path class="bus" pathLength="1" style="animation-delay:${r3(gi * 0.15)}s" d="M174 ${cyRow}H206" stroke="${p.copper}" stroke-width="1.4" fill="none"/><circle cx="206" cy="${cyRow}" r="2.5" fill="${p.copper}"/>`);
      g.tools.forEach((t, i) => { body.push(tile(p, 216 + i * 82, y0 + 8, t, n)); n++; });
    });
    y = 66 + 6 * 98 + 20;
  } else {
    // each group label on its own line, then up to five tiles per line
    y = 58;
    STACK.forEach((g, gi) => {
      const labelY = y + 14, lw = g.group.length * (7.2 + 1.5);
      body.push(T(32, labelY, 12, g.group, { fill: p.copper, bg: p.panel, ls: 1.5 }));
      const bx0 = r2(32 + lw + 8), by = labelY - 4;
      body.push(`<path d="M${bx0} ${by}H408" stroke="${p.pin}" stroke-width="1"/><path class="bus" pathLength="1" style="animation-delay:${r3(gi * 0.15)}s" d="M${bx0} ${by}H408" stroke="${p.copper}" stroke-width="1.4" fill="none"/><circle cx="408" cy="${by}" r="2.5" fill="${p.copper}"/>`);
      y += 34;
      for (let i = 0; i < g.tools.length; i += 5) {
        g.tools.slice(i, i + 5).forEach((t, j) => { body.push(tile(p, 32 + j * 80, y, t, n)); n++; });
        y += 94;
      }
      y += 4;
    });
    y += 8;
  }
  const Hh = y;
  const label = esc("Stack. " + STACK.map((g) => `${g.group.toLowerCase().replace("&", "and")}: ${g.tools.map((t) => t.tool).join(", ")}`).join(". ") + ".");
  const css = `${fontCss([400, 800])}
.pin{stroke:${p.pin}}.bus{stroke-dasharray:1 1;stroke-dashoffset:0}
@media (prefers-reduced-motion:no-preference){
@keyframes pw{0%{stroke:${p.pin}}35%{stroke:${p.copper}}100%{stroke:${p.pin}}}
@keyframes bd{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
.pin{animation:pw 1.1s ease-out both}.bus{animation:bd .6s ease-out both}
}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${label}">`,
    `<title>${label}</title>`,
    `<style>${css}</style>`,
    `<defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${p.grid}" opacity="${p.gridOpacity}"/></pattern></defs>`,
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${Hh - 1}" rx="10" fill="${p.panel}" stroke="${p.frame}"/><rect x="1" y="1" width="${W - 2}" height="${Hh - 2}" rx="10" fill="url(#g)"/>`,
    T(narrow ? 32 : 40, 38, 12, cfg.stackSilk[0], { fill: p.muted, bg: p.panel, ls: narrow ? 1.5 : 2 }),
    T(W - (narrow ? 32 : 40), 38, 12, cfg.stackSilk[1], { fill: p.muted, bg: p.panel, ls: 1, anchor: "end" }),
    body.join("\n"),
    `</svg>`,
  ].join("\n") + "\n";
}

// ====================================================================== badges (fixed colours, one file serves both themes)
function badge(b) {
  const P = cfg.palette.badge, value = fillIn(b.value);
  const CW = 7.2, PAD = 10, H = 28;
  const lw = Math.round(b.label.length * CW + 2 * PAD), vw = Math.round(value.length * CW + 2 * PAD), w = lw + vw;
  const label = esc(`${b.label}: ${value}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${label}"><title>${label}</title>`
    + `<style>${fontCss([400])}</style>`
    + `<rect width="${w}" height="${H}" fill="${P.labelFill}"/><rect x="${lw}" width="${vw}" height="${H}" fill="${P.valueFill}"/><rect x="0.5" y="0.5" width="${w - 1}" height="${H - 1}" fill="none" stroke="${P.hairline}"/>`
    + T(PAD, 18, 12, b.label, { fill: P.labelText, bg: P.labelFill })
    + T(lw + PAD, 18, 12, value, { fill: P.valueText, bg: P.valueFill })
    + `</svg>\n`;
}

// ====================================================================== build in memory
const files = {};
for (const th of ["dark", "light"]) {
  files[`assets/fab-${th}.svg`] = fab(th, WIDE);
  files[`assets/fab-narrow-${th}.svg`] = fab(th, NARROW);
  files[`assets/typing-${th}.svg`] = typing(th);
  files[`assets/stack-${th}.svg`] = stack(th, false);
  files[`assets/stack-narrow-${th}.svg`] = stack(th, true);
}
for (const b of cfg.badges) files[`assets/badges/${b.file}.svg`] = badge(b);

// ====================================================================== checks
// 1. contrast: every text colour on its own background, WCAG 2.x, at least 4.5:1
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const low = [...pairs.values()].filter(([f, b]) => ratio(f, b) < 4.5);
const minPair = [...pairs.values()].reduce((m, pr) => (ratio(...pr) < ratio(...m) ? pr : m));
low.length
  ? fail(`text colours under 4.5:1: ${low.map(([f, b]) => `${f} on ${b} ${ratio(f, b).toFixed(2)}`).join(", ")}`)
  : pass(`contrast: ${pairs.size} text colour pairs, lowest ${minPair[0]} on ${minPair[1]} at ${ratio(...minPair).toFixed(2)}:1`);

// 2. every drawn character is in the subset of its weight
for (const w of [400, 800]) {
  const miss = [...drawn[w]].filter((c) => !glyphs[w].includes(c));
  miss.length ? fail(`weight ${w}: characters not in the font subset: ${miss.length}`) : pass(`weight ${w}: all ${drawn[w].size} drawn characters are in the subset`);
}

// 3. size, no script, no foreignObject, no outside reference, no dash, no exclamation mark
for (const [name, body] of Object.entries(files)) {
  const bytes = Buffer.byteLength(body);
  const hrefs = [...body.matchAll(/\bhref="([^"]*)"/g)].filter((m) => !m[1].startsWith("#")).length;
  const urls = [...body.matchAll(/url\(([^)]*)\)/g)].filter((m) => !/^(#|data:)/.test(m[1])).length;
  const bad = [/<script/i.test(body) && "script", /<foreignObject/i.test(body) && "foreignObject", hrefs && "href", urls && "url(", /@import/.test(body) && "@import", /[–—]/.test(body) && "dash", /!/.test(body) && "exclamation mark"].filter(Boolean);
  if (bytes > cfg.budgetBytes) fail(`${name}: ${bytes} bytes, over the budget of ${cfg.budgetBytes}`);
  else if (bad.length) fail(`${name}: holds ${bad.join(", ")}`);
  else pass(`${name}: ${bytes} bytes, clean`);
}

// 4. the README: no style, class or id; no dash or exclamation mark; the alt texts name every tool, counter and badge value
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const attrs = (readme.match(/\b(style|class|id)=/g) || []).length;
attrs ? fail(`README.md has ${attrs} style, class or id attribute(s)`) : pass("README.md has no style, class or id attribute");
const rbad = (readme.match(/[–—!]/g) || []).length;
rbad ? fail(`README.md has ${rbad} dash or exclamation mark character(s)`) : pass("README.md has no em dash, en dash or exclamation mark");
const alts = [...readme.matchAll(/\balt="([^"]*)"/g)].map((m) => m[1]).join(" | ");
const needed = [
  ...STACK.flatMap((g) => g.tools.map((t) => t.tool)),
  String(cfg.canonical.agents), String(cfg.canonical.nodes),
  ...cfg.badges.map((b) => fillIn(b.value)),
];
const missingAlt = needed.filter((s) => !alts.includes(s));
missingAlt.length ? fail(`README alt texts miss: ${missingAlt.join(", ")}`) : pass(`README alt texts name all ${needed.length} tools, counter values and badge values`);

if (failures) { console.log(`RESULT: ${failures} check(s) failed, nothing written`); process.exit(1); }

if (CHECK_ONLY) {
  let diff = 0;
  for (const [name, body] of Object.entries(files)) {
    const path = join(ROOT, name);
    if (!(existsSync(path) && readFileSync(path, "utf8") === body)) { fail(`${name} differs from a fresh build`); diff++; }
  }
  if (!diff) pass(`all ${Object.keys(files).length} SVG files match a fresh build`);
  console.log(diff ? "RESULT: committed SVGs are out of date" : "RESULT: all checks pass");
  process.exit(diff ? 1 : 0);
}

mkdirSync(join(ROOT, "assets/badges"), { recursive: true });
for (const [name, body] of Object.entries(files)) writeFileSync(join(ROOT, name), body);
console.log(`RESULT: all checks pass, ${Object.keys(files).length} SVG files written`);
