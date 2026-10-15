/* ============================================================
   career/charts.js — 인라인 SVG 차트 (CLAUDE.md 26-12-2, dataviz 스킬 기준)
   - 꺾은선: 단일 계열(범례 없음, 제목이 이름) · 선 2px · 끝점 라벨 · 십자선 + 툴팁(터치 포함)
   - 능력치 막대: 시즌 전 값(계열 1) + 상승분(계열 2) — 범례 표시, 숫자는 텍스트 색
   - 색: 다크 표면 #15171b 기준 검증 통과(validate_palette: #3987e5 · #d95926) — css/career.css 변수
   툴팁·라벨 텍스트는 textContent로만 넣는다 (innerHTML 금지)
   ============================================================ */
const NS = "http://www.w3.org/2000/svg";

/* 꺾은선
   opts: { points: [{ x, y, tip: [줄…], mark?: "★" }], yInvert, yMin, yMax, xTicks, yTicks, bands: [{ from, to, cls, label }], ariaLabel, xFmt, yFmt } */
export function renderLine(host, opts) {
  const doc = host.ownerDocument;
  const W = 340, H = 180, L = 34, R = 14, T = 12, B = 26;
  const pts = opts.points;
  host.textContent = "";
  if (!pts.length) return;
  const xs = pts.map((p) => p.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = opts.yMin, y1 = opts.yMax;
  const sx = (x) => L + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y) => { const t = (y - y0) / (y1 - y0 || 1); return opts.yInvert ? T + t * (H - T - B) : H - B - t * (H - T - B); };
  const el = (name, attrs, parent) => { const e = doc.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; };
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "cr-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", opts.ariaLabel || "");
  // 배경 띠 (승격권·강등권 등) — 상태 색 + 라벨
  for (const b of opts.bands || []) {
    const ya = sy(b.from), yb = sy(b.to);
    el("rect", { x: L, y: Math.min(ya, yb), width: W - L - R, height: Math.abs(yb - ya), class: `cr-band ${b.cls}` });
    const t = el("text", { x: W - R - 2, y: Math.min(ya, yb) + 10, "text-anchor": "end", class: "cr-band-t" });
    t.textContent = b.label;
  }
  // 격자·축 (흐리게)
  for (const v of opts.yTicks || []) {
    el("line", { x1: L, x2: W - R, y1: sy(v), y2: sy(v), class: "cr-grid" });
    const t = el("text", { x: L - 6, y: sy(v) + 4, "text-anchor": "end", class: "cr-ax" });
    t.textContent = opts.yFmt ? opts.yFmt(v) : v;
  }
  for (const v of opts.xTicks || []) {
    const t = el("text", { x: sx(v), y: H - 8, "text-anchor": "middle", class: "cr-ax" });
    t.textContent = opts.xFmt ? opts.xFmt(v) : v;
  }
  // 선
  el("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(""), class: "cr-line" });
  // 강조 마커 (레전드 시즌 등) — 8px 이상 + 표면색 고리
  for (const p of pts.filter((q) => q.mark)) {
    el("circle", { cx: sx(p.x), cy: sy(p.y), r: 5, class: "cr-mark" });
    const t = el("text", { x: sx(p.x), y: sy(p.y) - 9, "text-anchor": "middle", class: "cr-mark-t" });
    t.textContent = p.mark;
  }
  // 끝점 + 라벨 (선택적 직접 라벨: 마지막 값만)
  const last = pts[pts.length - 1];
  el("circle", { cx: sx(last.x), cy: sy(last.y), r: 4, class: "cr-end" });
  const lt = el("text", { x: sx(last.x) - 6, y: sy(last.y) + (opts.yInvert ? 14 : -8), "text-anchor": "end", class: "cr-end-t" });
  lt.textContent = opts.yFmt ? opts.yFmt(last.y) : last.y;
  // 십자선 + 툴팁
  const cross = el("line", { y1: T, y2: H - B, class: "cr-cross", visibility: "hidden" });
  const dot = el("circle", { r: 4, class: "cr-hover", visibility: "hidden" });
  const wrap = doc.createElement("div");
  wrap.className = "cr-chart-wrap";
  const tip = doc.createElement("div");
  tip.className = "cr-tip";
  tip.hidden = true;
  wrap.appendChild(svg); wrap.appendChild(tip);
  host.appendChild(wrap);
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const vx = ((clientX - r.left) / r.width) * W;
    let best = pts[0];
    for (const p of pts) if (Math.abs(sx(p.x) - vx) < Math.abs(sx(best.x) - vx)) best = p;
    const cx = sx(best.x), cy = sy(best.y);
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("visibility", "visible");
    tip.textContent = "";
    best.tip.forEach((line, i) => { const d = doc.createElement(i ? "div" : "b"); d.textContent = line; tip.appendChild(d); });
    tip.hidden = false;
    const left = (cx / W) * r.width;
    tip.style.left = Math.min(Math.max(left - 70, 0), r.width - 140) + "px";
  };
  const hide = () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hidden = true; };
  svg.addEventListener("pointermove", (e) => show(e.clientX));
  svg.addEventListener("pointerdown", (e) => show(e.clientX));
  svg.addEventListener("pointerleave", hide);
}

/* 능력치 변화 막대 (HTML) — rows: [{ label, before, after }] */
export function attrBars(rows, esc) {
  const max = 99;
  const body = rows.map((r) => {
    const b = Math.max(0, Math.min(r.before, r.after)), up = Math.max(0, r.after - r.before), down = Math.max(0, r.before - r.after);
    const d = r.after - r.before;
    const ds = Math.abs(d) < 0.05 ? "±0" : (d > 0 ? "+" : "−") + Math.abs(d).toFixed(1);
    return `<div class="cr-bar-row" title="${esc(r.label)} ${r.before.toFixed(1)} → ${r.after.toFixed(1)}">
      <span class="cr-bar-l">${esc(r.label)}</span>
      <span class="cr-bar-track"><span class="cr-bar-base" style="width:${(b / max * 100).toFixed(1)}%"></span>${up ? `<span class="cr-bar-up" style="width:${(up / max * 100).toFixed(1)}%"></span>` : ""}</span>
      <span class="cr-bar-v">${Math.round(r.after)} <small class="${d < -0.05 ? "cr-down" : d > 0.05 ? "cr-upt" : "cr-dim"}">${d < -0.05 ? "▼" : ""}${ds}</small></span>
    </div>`;
  }).join("");
  return `<div class="cr-bars">${body}</div>
    <div class="cr-legend"><span><i class="cr-sw cr-sw-base"></i>시즌 전</span><span><i class="cr-sw cr-sw-up"></i>이번 시즌 상승</span><span class="cr-dim">▼ 하락</span></div>`;
}
