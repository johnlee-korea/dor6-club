/* ============================================================
   scripts/career/growth-sim.js — 커리어 성장 밸런스 시뮬레이션 (② 기획 단계 계수 역산용)
   실행: node scripts/career/growth-sim.js [--runs 1000] [--seed S] [--policy best,normal,passive,...] [--json]

   ★ 목적: CLAUDE.md 26장 성장 공식(나이·출전·평점·수준 둔화·코치진·경기 수준·상점·레전드 시즌)의
     계수가 마스터 6-2 목표표(최선 27세 OVR 약 86 등)를 만족하는지 1,000회 커리어로 확인.
   ★ 기획 단계 근사 모델(기록용): 경기를 역할별 출전 확률·평점 근사식으로 대신한다.
     확정 계수는 js/career/rules.js, 실제 엔진 검증은 npm run career:test -- --careers N (CLAUDE.md 26-20).
     이 파일의 계수는 ② 기획 당시 값이며 rules.js와 다를 수 있다.
   ★ 구단 세계는 data/career/clubs.json이 아직 없으므로 리그 밴드(26-7-2)로 합성한다.
   ============================================================ */
import { makeRng } from "../../js/engine/rng.js";

/* ------------------------------------------------------------
   1. 계수 (26장 표와 1:1 — 바꾸면 CLAUDE.md도 함께 고칠 것)
   ------------------------------------------------------------ */
export const P = {
  cats: ["spd", "sht", "pas", "dri", "def", "phy"],
  // 포지션 OVR 대분류 가중치(%) — 26-3-2
  W: {
    ST: { sht: 40, spd: 21, dri: 18, phy: 16, pas: 5, def: 0 },
    WG: { spd: 31, dri: 29, pas: 19, sht: 16, phy: 5, def: 0 },
    AM: { pas: 33, dri: 27, sht: 19, spd: 16, phy: 5, def: 0 },
    DM: { def: 34, pas: 28, phy: 18, dri: 15, spd: 5, sht: 0 },
    CB: { def: 40, phy: 24, spd: 16, pas: 15, dri: 5, sht: 0 },
    FB: { spd: 31, def: 29, pas: 19, phy: 16, dri: 5, sht: 0 }
  },
  slots: { ST: 1, WG: 2, AM: 1, DM: 2, CB: 2, FB: 2 },
  // 시즌 성장 기본값 (대분류당)
  baseFocus: 4, baseRest: 1.2,
  // 나이 계수 G (성장 부분에만 곱함)
  G: { 16: 1, 17: 1, 18: 1, 19: 1, 20: 0.95, 21: 0.88, 22: 0.78, 23: 0.68, 24: 0.6, 25: 0.6, 26: 0.62,
       27: 0.56, 28: 0.44, 29: 0.34, 30: 0.24, 31: 0.15 },
  // 노화 하락 (대분류당, 성장과 별개로 더함): [집중, 미집중]
  D: { 31: [0, -0.6], 32: [-2, -3], 33: [-3, -4.2], 34: [-3, -4.2], 35: [-3, -4.2],
       36: [-3.2, -4.4], 37: [-3.4, -4.6], 38: [-3.6, -4.8], 39: [-3.8, -5], 40: [-4, -5.2] },
  // OVR 수준 둔화 (선형 보간 기준점) — 85부터 가파름: 낮은 구간 따라잡기 효과를 줄여 선택의 차이를 보존
  L: [[0, 1], [60, 1], [75, 0.9], [80, 0.8], [85, 0.6], [90, 0.35], [99, 0.15]],
  // 경기 수준 계수: OVR − 소속 요구 OVR
  stage: (gap) => (gap <= 0 ? 1.1 : gap <= 5 ? 1 : gap <= 9 ? 0.85 : gap <= 14 ? 0.7 : 0.5),
  // 출전 계수 = playFloor + (1 − playFloor) × 출전 비율
  playFloor: 0.25,
  youthBench: 0.5,            // 18세 이하 1군 미출전 = 2군 출전 0.5
  // 평점 계수 0.9~1.1
  rateCoef: (avg) => Math.min(1.1, Math.max(0.9, 1 + (avg - 6.6) / 6)),
  coach: 1.3,
  spill: true,
  // 역할별 경기 출전 확률: [선발, (선발 아닐 때) 교체]
  roleProb: { S: [0.9, 0.7], R: [0.4, 0.45], B: [0.08, 0.3] },
  shortageBonus: 0.1,
  // 역할 기준: 주전 = 요구 + (슬롯1: 5 / 슬롯2: 3) ± 구단 편차, 로테이션 = 요구 − 1 이상
  starterGap: { 1: 5, 2: 3 }, rotGap: -1,
  // 영입·입단 가능: 요구 OVR ≤ OVR + 3 + 유망주 여유
  offerMargin: 3, youthMargin: { 16: 7, 17: 5, 18: 3 },
  // 레전드 시즌 (근사: 리그 평점 상위 3 + 개인상 확률을 '리그 최상위 요구 OVR 대비'로 모델링)
  legend: { minAge: 25, startShare: 0.75, base: 0.08, slope: 0.13, max: 0.92, extra: 5, center: 3.5 },
  // 상점: 일반 +2 / 특급 +4 (수준 둔화 적용), 가격(만 €) — OVR 기준점 선형 보간
  shop: { normal: 2, special: 4,
    price: [[45, 0.5, 3], [55, 0.9, 6], [60, 2, 12], [65, 7, 45], [70, 25, 160], [75, 90, 450],
            [80, 220, 900], [85, 350, 1300], [90, 500, 1800], [99, 700, 2600]] },
  // 연봉(만 €): 구단 요구 OVR 기준점 선형 보간 × 역할 × 나이
  salary: [[45, 3], [50, 4], [55, 8], [60, 18], [65, 40], [70, 90], [75, 220], [80, 600], [84, 1300], [90, 2000]],
  salaryRole: { S: 1, R: 0.7, B: 0.5 },
  salaryAge: (a) => (a <= 18 ? 0.3 : a <= 20 ? 0.6 : a >= 33 ? 0.8 : 1)
};

// 리그 밴드: [코드, 팀 수, 요구 OVR 하한, 상한, 1부 여부]  (26-7-2, openfootball 2025-26 실제 팀 수)
const LEAGUES = [
  ["en.1", 20, 72, 84, 1], ["es.1", 20, 71, 84, 1], ["de.1", 18, 70, 83, 1], ["it.1", 20, 70, 83, 1], ["fr.1", 18, 68, 82, 1],
  ["en.2", 24, 64, 72, 0], ["de.2", 18, 63, 70, 0], ["es.2", 22, 62, 69, 0], ["it.2", 20, 61, 68, 0], ["fr.2", 18, 60, 67, 0],
  ["en.3", 24, 57, 65, 0], ["en.4", 24, 50, 58, 0]
];
const BIG = 80, TOP = 83;   // 빅클럽 = 요구 80 이상, 최상위 = 83 이상

/* ------------------------------------------------------------
   2. 도우미
   ------------------------------------------------------------ */
const lerp = (pts, x) => {
  if (x <= pts[0][0]) return pts[0].slice(1);
  for (let i = 1; i < pts.length; i++) {
    const [x1, ...a] = pts[i - 1], [x2, ...b] = pts[i];
    if (x <= x2) return a.map((v, j) => v + (b[j] - v) * (x - x1) / (x2 - x1));
  }
  return pts[pts.length - 1].slice(1);
};
const Lv = (ovr) => lerp(P.L, ovr)[0];
const salaryOf = (R, role, age) => lerp(P.salary, R)[0] * P.salaryRole[role] * P.salaryAge(age);
const priceOf = (ovr) => lerp(P.shop.price, ovr);
const ovrOf = (pos, A) => { let s = 0; for (const k of P.cats) s += P.W[pos][k] * A[k]; return s / 100; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function buildWorld(rng) {
  const clubs = [];
  for (const [code, n, lo, hi, top] of LEAGUES) {
    for (let i = 0; i < n; i++) {
      const R = Math.round(hi - (hi - lo) * i / (n - 1));
      const specs = rng.shuffle(P.cats).slice(0, rng.chance(0.4) ? 2 : 1);
      clubs.push({ id: clubs.length, lg: code, n, R, top, lgTop: hi, specs, v: rng.range(-1, 1),
                   short: rng.shuffle(Object.keys(P.slots)).slice(0, rng.chance(0.5) ? 2 : 1) });
    }
  }
  return clubs;
}
const rounds = (n) => 2 * (n - 1);

function roleAt(club, pos, score) {
  if (score >= club.R + P.starterGap[P.slots[pos]] + club.v) return "S";
  if (score >= club.R + P.rotGap + club.v) return "R";
  return "B";
}
function expectedRatio(role, age, short) {
  const [ps0, psub] = P.roleProb[role];
  const ps = Math.min(0.97, ps0 + (short ? P.shortageBonus : 0));
  const sub = (1 - ps) * psub, bench = (1 - ps) * (1 - psub);
  return ps + sub * 0.5 + (age <= 18 ? bench * P.youthBench : 0);
}

/* ------------------------------------------------------------
   3. 육성 방식(정책)
   ------------------------------------------------------------ */
const sortedCats = (pos) => P.cats.slice().sort((a, b) => P.W[pos][b] - P.W[pos][a]);
const POLICIES = {
  // 최선: 추천 조합 · 매 시즌 (가중치 × 코치진) 상위 3 집중 · 성장 효율 최대 구단(27세부터는 주전 가능한 최고 구단) · 상점 최적
  best: { combo: "top", focus: "opt", club: "growth", shop: true },
  // 최선인데 상점 안 씀
  bestNoShop: { combo: "top", focus: "opt", club: "growth", shop: false },
  // 보통: 추천 조합 · 집중 육성 들쭉날쭉(절반은 최적) · 로테이션 위주 구단 · 상점 안 씀
  normal: { combo: "top", focus: "half", club: "rotation", shop: false },
  normalShop: { combo: "top", focus: "half", club: "rotation", shop: true },
  // 소극적: 추천 조합 · 포지션과 안 맞는 집중이 섞임 · 후보 위주(가장 높은 구단) · 상점 안 씀
  passive: { combo: "top", focus: "random", club: "bench", shop: false },
  // 시나리오
  stay: { combo: "top", focus: "opt", club: "stay", shop: true },          // 시작 구단 끝까지 잔류
  flatten: { combo: "top", focus: "weakest", club: "growth", shop: true },  // 약한 대분류만 돌아가며 집중(평준화 시도)
  youthBench: { combo: "top", focus: "opt", club: "growth", shop: true, benchUntil: 18 }, // 16~18세 후보 시작
  worst: { combo: "worst", focus: "offpos", club: "bench", shop: false }
};

function chooseFocus(pol, pos, A, club, rng) {
  const coachW = (k) => P.W[pos][k] * (club.specs.includes(k) ? P.coach : 1);
  // 99에 닿은 대분류는 더 키울 수 없으므로 뒤로 (최선 육성은 다음 대분류로 넘어감)
  const opt = P.cats.slice().sort((a, b) => (A[a] >= 98.5) - (A[b] >= 98.5) || coachW(b) - coachW(a)).slice(0, 3);
  if (pol.focus === "opt") return opt;
  if (pol.focus === "half") return rng.chance(0.5) ? opt : [opt[0], ...rng.shuffle(P.cats.filter((k) => k !== opt[0])).slice(0, 2)];
  if (pol.focus === "random") return rng.shuffle(P.cats).slice(0, 3);
  if (pol.focus === "weakest") return P.cats.slice().sort((a, b) => A[a] - A[b]).slice(0, 3);
  if (pol.focus === "offpos") return sortedCats(pos).slice(3);
  return opt;
}

/* ------------------------------------------------------------
   4. 커리어 1회
   ------------------------------------------------------------ */
function runCareer(seed, pos, pol, world) {
  const rng = makeRng(seed);
  const order = sortedCats(pos);
  const strong = pol.combo === "worst" ? order.slice(4) : order.slice(0, 2);
  const A = {};
  const s1 = rng.range(57, 59), s2 = rng.range(57, 59);
  A[strong[0]] = s1; A[strong[1]] = s2;
  const weak = P.cats.filter((k) => !strong.includes(k));
  let rest = 300 - s1 - s2;
  weak.forEach((k, i) => { const v = i < 3 ? Math.round(rest / (4 - i)) + rng.range(-1, 1) : rest; A[k] = v; rest -= v; });

  let age = 16, money = 0, trust = 0, club = null, retired = false, bought = null;
  const log = [];
  const eligible = (ovr, a) => world.filter((c) => c.R <= Math.round(ovr) + P.offerMargin + (P.youthMargin[a] || 0));

  while (!retired && age <= 40) {
    const ovr0 = ovrOf(pos, A);
    // ---- 오프시즌: 상점 → 구단 선택 ----
    if (pol.shop) {
      const [pn, ps] = priceOf(ovr0);
      // 훈련 대상 = (가중치 × 코치진) 1순위 대분류 (99에 닿은 대분류는 뒤로 밀림)
      const top = chooseFocus({ focus: "opt" }, pos, A, club || { specs: [] }, rng)[0];
      bought = null;
      if (A[top] < 99) {
        if (money >= ps && age >= 19) { bought = "S"; money -= ps; A[top] = Math.min(99, A[top] + P.shop.special * Lv(ovr0)); }
        else if (money >= pn) { bought = "N"; money -= pn; A[top] = Math.min(99, A[top] + P.shop.normal * Lv(ovr0)); }
      }
    }
    const ovr = ovrOf(pos, A), score = Math.round(ovr) + trust;
    const pool = eligible(ovr, age);
    if (!pool.length && age >= 30) { retired = true; break; }
    // 영입 제안 (첫 시즌은 시작 구단 선택 = 입단 가능 전체)
    let offers;
    if (!club) offers = pool;
    else {
      // 26-7-4 영입 제안 묶음: 도전 1 (로테이션·후보 예상) + 주전 예상 2 (주전 가능한 구단 중 요구 OVR 상위 6개에서) + 무작위 2
      const o = Math.round(ovr);
      const ch = pool.filter((c) => roleAt(c, pos, o) !== "S");
      const st = pool.filter((c) => roleAt(c, pos, o) === "S" && c.R >= o - 15).sort((a, b) => b.R - a.R).slice(0, 6);
      offers = [...new Set([...rng.shuffle(ch).slice(0, 1), ...rng.shuffle(st).slice(0, 2), ...rng.shuffle(pool).slice(0, 2)])];
      offers.push(club);
    }
    const shortOf = (c) => c.short.includes(pos);
    const evalClub = (c) => {
      const role = pol.benchUntil && age <= pol.benchUntil ? "B" : roleAt(c, pos, c === club ? score : Math.round(ovr));
      const ratio = expectedRatio(role, age, shortOf(c));
      const f = chooseFocus({ focus: "opt" }, pos, A, c, rng);
      const coachF = f.reduce((s, k) => s + P.W[pos][k] * (c.specs.includes(k) ? P.coach : 1), 0) / f.reduce((s, k) => s + P.W[pos][k], 0);
      return { c, role, g: (P.playFloor + (1 - P.playFloor) * ratio) * P.stage(Math.round(ovr) - c.R) * coachF };
    };
    let pick;
    const ev = offers.map(evalClub);
    if (pol.club === "stay" && club) pick = ev.find((e) => e.c === club);
    else if (pol.club === "growth" || pol.club === "stay") {
      const starters = ev.filter((e) => e.role === "S");
      if (age >= 27 && starters.length) pick = starters.sort((a, b) => b.c.R - a.c.R || b.g - a.g)[0];
      else pick = ev.sort((a, b) => b.g - a.g || b.c.R - a.c.R)[0];
    } else if (pol.club === "rotation") {
      const rot = ev.filter((e) => e.role === "R");
      pick = rot.length ? rot[rng.int(rot.length)] : ev[rng.int(ev.length)];
    } else if (pol.club === "bench") {
      pick = ev.sort((a, b) => b.c.R - a.c.R)[0];
    }
    if (pick.c !== club) trust = 0;
    club = pick.c;
    const role = pol.benchUntil && age <= pol.benchUntil ? "B" : roleAt(club, pos, Math.round(ovr) + trust);

    // ---- 시즌 진행 (근사) ----
    const N = rounds(club.n), short = shortOf(club);
    let starts = 0, subs = 0, bench = 0;
    const [ps0, psub] = P.roleProb[role];
    const ps = Math.min(0.97, ps0 + (short ? P.shortageBonus : 0));
    for (let m = 0; m < N; m++) {
      if (rng.chance(ps)) starts++; else if (rng.chance(psub)) subs++; else bench++;
    }
    const ratio = (starts + subs * 0.5 + (age <= 18 ? bench * P.youthBench : 0)) / N;
    const play = P.playFloor + (1 - P.playFloor) * ratio;
    const noise = (rng.next() + rng.next() - 1) * 0.25;
    const avg = 6.55 + 0.04 * (ovr - (club.R + 4)) + (role === "B" ? -0.1 : 0) + noise;
    const rate = P.rateCoef(avg);
    const gap = Math.round(ovr) - club.R;
    const legend = age >= P.legend.minAge && club.top && starts >= N * P.legend.startShare &&
      rng.chance(clamp(P.legend.base + P.legend.slope * (ovr - club.lgTop - P.legend.center), 0, P.legend.max));
    const focus = chooseFocus(pol, pos, A, club, rng);
    const lv = legend ? 1 : Lv(ovr);
    const G = P.G[age] || 0;
    const [df, du] = P.D[age] || [0, 0];
    let spill = 0;
    for (const k of P.cats) {
      const f = focus.includes(k);
      let g = (f ? P.baseFocus : P.baseRest) * G * play * rate * lv * P.stage(gap) * (f && club.specs.includes(k) ? P.coach : 1);
      // 레전드 시즌: 32세 미만은 집중 대분류 +extra, 32세 이상은 그 시즌 노화 하락 절반(정점이 33세 이후로 밀리지 않게)
      if (legend && f && age < 32) g += P.legend.extra;
      const v = A[k] + g + (f ? df : du) * (legend && age >= 32 ? 0.5 : 1);
      if (v > 99) spill += v - 99;
      A[k] = clamp(v, 1, 99);
    }
    // 99를 넘친 성장분은 포지션 가중치가 큰 순서로 99 미만인 대분류에 이월 (P.spill이 true일 때)
    for (const k of order) { if (!P.spill || spill <= 0) break; const room = 99 - A[k]; const add = Math.min(room, spill); A[k] += add; spill -= add; }
    const goal = avg >= 6.65 ? 1 : -1;
    trust = clamp(trust + goal, -3, 3);
    money += salaryOf(club.R, role, age) * (1.05 + (legend ? 0.3 : 0));
    log.push({ bought, focusKey: focus.slice().sort().join("+"), baseKey: order.slice(0, 3).sort().join("+"), age, ovr: ovr, R: club.R, role, top: club.top, legend, ratio, play, gap, lg: club.lg, money });
    age++;
    // 은퇴(시뮬레이션 가정): 36세부터 후보이거나 정점 대비 OVR −8 이하면 은퇴, 40세 강제
    if (age > 40) retired = true;
    else if (age >= 36 && (role === "B" || ovr < Math.max(...log.map((x) => x.ovr)) - 8)) retired = true;
  }
  return log;
}

/* ------------------------------------------------------------
   5. 집계
   ------------------------------------------------------------ */
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : def; };
if (opt("set")) Object.assign(P, JSON.parse(opt("set")));   // 계수 시험: --set '{"baseFocus":5}'
const RUNS = +opt("runs", 1000), SEED = opt("seed", "CAREER-SIM");
const pols = opt("policy", "best,bestNoShop,normal,normalShop,passive,stay,flatten,youthBench,worst").split(",");
const world = buildWorld(makeRng(SEED + "|world"));
const POS = Object.keys(P.slots);
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const f1 = (v) => (v === undefined ? "  - " : v.toFixed(1).padStart(5));

const report = {};
for (const pn of pols) {
  const pol = POLICIES[pn];
  const at = {}, peaks = [], peakAges = [], big27 = [], bigBefore25 = [], topAge = [], retire = [], legendPrime = [0, 0];
  const legendsPer = [], legendAge = {}, eligAge = {}, shopAge = {}, modal = {}; let swapS = 0, allS = 0;
  const shopAfford = {};
  for (let r = 0; r < RUNS; r++) {
    const pos = POS[r % POS.length];
    const log = runCareer(`${SEED}|${pn}|${r}`, pos, pol, world);
    let peak = 0, peakAge = 16, firstTop = null, legends = 0, bigBy = null;
    for (const s of log) {
      (at[s.age] = at[s.age] || []).push(s.ovr);
      if (s.ovr > peak + 1e-9) { peak = s.ovr; peakAge = s.age; }
      if (s.role === "S" && s.R >= BIG && bigBy === null) bigBy = s.age;
      if (s.role === "S" && s.R >= TOP && firstTop === null) firstTop = s.age;
      const band = s.age <= 18 ? "16~18" : s.age <= 22 ? "19~22" : s.age <= 26 ? "23~26" : s.age <= 31 ? "27~31" : "32+";
      const sa = (shopAge[band] = shopAge[band] || { n: 0, N: 0, S: 0 }); sa.n++; if (s.bought) sa[s.bought]++;
      if (s.age <= 31) { allS++; if (s.focusKey !== s.baseKey) swapS++; }
      if (s.legend) { legends++; legendAge[s.age] = (legendAge[s.age] || 0) + 1; }
      if (s.age >= 25 && s.top && s.role === "S") eligAge[s.age] = (eligAge[s.age] || 0) + 1;
      if (s.age >= 27 && s.age <= 32) { legendPrime[1]++; if (s.legend) legendPrime[0]++; }
    }
    // 은퇴 직전 시즌 이후 성장분 반영한 마지막 OVR은 무시(시즌 시작 OVR 기준)
    if (args.includes("--showmax") && (!report.__max || peak > report.__max.peak)) report.__max = { peak, pos, log };
    { const c = {}; for (const s of log) if (s.age <= 31) c[s.focusKey] = (c[s.focusKey] || 0) + 1; const m = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; modal[pos + " " + m] = (modal[pos + " " + m] || 0) + 1; }
    peaks.push(Math.round(peak)); peakAges.push(peakAge); legendsPer.push(legends);
    big27.push(bigBy !== null && bigBy <= 27); bigBefore25.push(bigBy !== null && bigBy < 25);
    if (firstTop !== null) topAge.push(firstTop);
    retire.push(log[log.length - 1].age);
  }
  const dist = { "≤87": 0, "88~92": 0, "93~96": 0, "97~98": 0, "99": 0 };
  for (const p of peaks) dist[p <= 87 ? "≤87" : p <= 92 ? "88~92" : p <= 96 ? "93~96" : p <= 98 ? "97~98" : "99"]++;
  report[pn] = {
    ovrAt: Object.fromEntries([16, 18, 21, 24, 27, 30, 31, 33, 36].map((a) => [a, at[a] ? +mean(at[a]).toFixed(1) : null])),
    peakMean: +mean(peaks).toFixed(1), peakP10: pct(peaks, 0.1), peakP90: pct(peaks, 0.9),
    peakDist: Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, +(100 * v / RUNS).toFixed(1)])),
    peakAgeIn27to32: +(100 * peakAges.filter((a) => a >= 27 && a <= 32).length / RUNS).toFixed(1),
    peakAgeMean: +mean(peakAges).toFixed(1),
    bigStarterBy27: +(100 * big27.filter(Boolean).length / RUNS).toFixed(1),
    bigStarterBefore25: +(100 * bigBefore25.filter(Boolean).length / RUNS).toFixed(1),
    topStarterAgeMedian: topAge.length ? pct(topAge, 0.5) : null, topStarterReached: +(100 * topAge.length / RUNS).toFixed(1),
    legendRatePrime: legendPrime[1] ? +(100 * legendPrime[0] / legendPrime[1]).toFixed(1) : 0,
    legendsMean: +mean(legendsPer).toFixed(2),
    retireAgeMean: +mean(retire).toFixed(1),
    shopByAge: Object.fromEntries(Object.entries(shopAge).map(([b, v]) => [b, `일반 ${(100 * v.N / v.n).toFixed(0)}% · 특급 ${(100 * v.S / v.n).toFixed(0)}%`])),
    focusSwapSeasons: +(100 * swapS / (allS || 1)).toFixed(1),
    careerModalTop: Object.entries(modal).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(100 * v / RUNS * 6).toFixed(0)}%`),
    legendByAge: Object.fromEntries(Object.keys(eligAge).map((a) => [a, `${legendAge[a] || 0}/${eligAge[a]}`]))
  };
}

const mx = report.__max; delete report.__max;
if (mx) { console.log("[최고 정점 커리어]", mx.pos); for (const s of mx.log) console.log(s.age, s.lg, "R" + s.R, s.role, s.ovr.toFixed(1), s.legend ? "★" : ""); }
if (args.includes("--json")) console.log(JSON.stringify(report, null, 1));
else {
  const ages = [16, 18, 21, 24, 27, 30, 31, 33, 36];
  console.log(`커리어 성장 시뮬레이션 — 정책별 ${RUNS}회 (포지션 6개 균등), 시드 ${SEED}\n`);
  console.log("정책".padEnd(12) + ages.map((a) => String(a).padStart(5)).join("") + " | 정점 평균(p10~p90) | 정점 27~32세 | 27세 빅클럽주전 | 25세前 | 최상위 주전 중앙나이(도달%) | 레전드/전성기시즌 | 은퇴");
  for (const [pn, r] of Object.entries(report)) {
    console.log(pn.padEnd(12) + ages.map((a) => f1(r.ovrAt[a] ?? undefined)).join("") +
      ` | ${r.peakMean} (${r.peakP10}~${r.peakP90}) | ${r.peakAgeIn27to32}% | ${r.bigStarterBy27}% | ${r.bigStarterBefore25}% | ${r.topStarterAgeMedian ?? "-"}세 (${r.topStarterReached}%) | ${r.legendRatePrime}% (평균 ${r.legendsMean}회) | ${r.retireAgeMean}`);
  }
  console.log("\n정점 OVR 분포(%)");
  for (const [pn, r] of Object.entries(report)) console.log(pn.padEnd(12), JSON.stringify(r.peakDist));
}

// 디버그: --trace 정책명 → 커리어 1회 시즌별 내역
if (args.includes("--trace")) {
  const pn = opt("trace", "best");
  for (const pos of ["ST", "CB"]) {
    console.log(`\n[trace ${pn} ${pos}]`);
    for (const s of runCareer(`${SEED}|trace|${pos}`, pos, POLICIES[pn], world))
      console.log(s.age, s.lg, "R" + s.R, s.role, "ovr", s.ovr.toFixed(1), "gap", s.gap, "play", s.play.toFixed(2), s.legend ? "★" : "", "돈", Math.round(s.money));
  }
}
