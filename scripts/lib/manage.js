/* ============================================================
   manage.js — 구단운영(모드별 선수 진단) 공용 로직 (v2.2.0)
   사용처(단일 소스)
   - Worker /manage/details : 넥슨 매치 상세 → 압축 행(compactMatch)
   - ranker-baseline.js     : 랭커 샘플 → 모드별 포지션 기준값 + xG 표 + 실점 루트 평균
   - 브라우저 js/manage.js  : 압축 행 목록 → 요약·선수 진단·xG·실점 루트·투입 여부 차이(analyze)
   설계 의도
   - 넥슨 원본은 경기당 수십 KB → 필요한 숫자만 짧은 배열로 남겨 브라우저에 최대 300경기 저장
   - 판정 규칙(가중치·임계값·표본 보정)은 여기 한 곳에만 둔다 (화면은 결과를 그리기만)
   ============================================================ */

import { posGroup, GROUP_LABEL, P_METRICS, MIN_BASE_MEAN } from "./insight.js";

/* ---------- 모드 ----------
   rankerType: 넥슨 ranker-stats 조회 유형 — 친선(60·30)은 넥슨이 랭커 통계를 주지 않아(실측 0건) 공식경기(50)로 대체
   baseMode  : 포지션 기준값·xG 표를 가져올 모드 */
export const MODES = {
  official: { label: "공식경기", types: [50], rankerType: 50, baseMode: "official" },
  friendly: { label: "친선", types: [60, 30], rankerType: 50, baseMode: "official" },
  manager:  { label: "감독모드", types: [52], rankerType: 52, baseMode: "manager" }
};
export const MODE_OF_TYPE = { 50: "official", 60: "friendly", 30: "friendly", 52: "manager" };

/* ---------- 압축 행 ----------
   row = { id, t(매치유형), d(일시 UTC), r(win|draw|lose), gf, ga, end(0=정상 종료),
           ps: 선수 [PS_KEYS 순서],            — 평점 0(미출전 교체) 제외, 교체 출전은 pos 28
           s : 내 슈팅 [x, y, 유형, 결과, spId, 도움spId|0, 도움x|null, 도움y|null],
           o : 상대 슈팅 [x, y, 유형, 결과, 도움x|null, 도움y|null] }
   좌표: 넥슨 shootDetail 기준(공격 방향 x 0→1, y 0→1 = 공격수 기준 왼쪽→오른쪽 — 실측 확인) */
export const PS_KEYS = ["spId", "pos", "grade", "gol", "ast", "rt", "sht", "pas", "drb", "int", "win", "blk", "air", "sav", "esh", "pTry", "dTry", "aTry", "yc", "rc"];
export const PSI = Object.fromEntries(PS_KEYS.map((k, i) => [k, i]));
export const SUB_POS = 28;
const R_MAP = { "승": "win", "무": "draw", "패": "lose" };
const r3 = (n) => (n == null ? null : Math.round(n * 1000) / 1000);

export function compactMatch(detail, ouid) {
  const info = (detail && detail.matchInfo) || [];
  const me = info.find((i) => i.ouid === ouid);
  if (!me) return null;
  const opp = info.find((i) => i.ouid !== ouid) || null;
  const md = me.matchDetail || {};
  const ps = (me.player || []).filter((pl) => pl.status && pl.status.spRating > 0).map((pl) => {
    const s = pl.status;
    return [pl.spId, pl.spPosition, pl.spGrade ?? 0, s.goal ?? 0, s.assist ?? 0, s.spRating ?? 0, s.shoot ?? 0,
      s.passSuccess ?? 0, s.dribbleSuccess ?? 0, s.intercept ?? 0, s.ballPossesionSuccess ?? 0, s.block ?? 0,
      s.aerialSuccess ?? 0, s.defending ?? 0, s.effectiveShoot ?? 0, s.passTry ?? 0, s.dribbleTry ?? 0,
      s.aerialTry ?? 0, s.yellowCards ?? 0, s.redCards ?? 0];
  });
  const shot = (x) => [r3(x.x), r3(x.y), x.type, x.result];
  const ast = (x) => (x.assist ? [r3(x.assistX), r3(x.assistY)] : [null, null]);
  return {
    id: detail.matchId, t: detail.matchType, d: detail.matchDate,
    r: R_MAP[md.matchResult] || "draw",
    gf: (me.shoot && me.shoot.goalTotal) ?? 0,
    ga: (opp && opp.shoot && opp.shoot.goalTotal) ?? 0,
    end: md.matchEndType ?? 0,
    ps,
    s: (me.shootDetail || []).map((x) => [...shot(x), x.spId, x.assist ? x.assistSpId : 0, ...ast(x)]),
    o: ((opp && opp.shootDetail) || []).map((x) => [...shot(x), ...ast(x)])
  };
}

/* 정상 종료 + 양쪽 기록이 있는 경기만 지표에 사용 (몰수·기권은 전적 요약에만) */
export const isNormal = (m) => m.end === 0 && (m.ps || []).length > 0;

/* ---------- ⚽ 기대 득점(xG) ----------
   '구간별 실측 득점률 표' — 거리 × 각도 × 슈팅 유형. 표는 랭커 샘플 슈팅으로 ranker-baseline.js가 만든다.
   유형 코드(넥슨 shootDetail.type, 실측): 3 헤더 · 8 프리킥 · 9 페널티킥 (나머지는 코드 그대로 구분) */
export const SHOT_TYPE = { HEAD: 3, FK: 8, PK: 9 };
const PITCH_L = 105, PITCH_W = 68;
const DIST_EDGES = [6, 9, 12, 16.5, 20, 25, 30];   // m
const ANGLE_EDGES = [20, 40];                      // 골문 중앙 기준 벌어진 각도(도)
const XG_PRIOR_K = 20;                             // 표본이 적은 칸은 상위 구간 비율 쪽으로 당김

export function shotGeo(x, y) {
  const dx = Math.max(0, (1 - x) * PITCH_L), dy = Math.abs(y - 0.5) * PITCH_W;
  return { dist: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}
const binOf = (v, edges) => { let i = 0; while (i < edges.length && v >= edges[i]) i++; return i; };
function xgKeys(x, y, type) {
  const g = shotGeo(x, y);
  const d = binOf(g.dist, DIST_EDGES), a = binOf(g.angle, ANGLE_EDGES);
  return { d: `d${d}`, da: `d${d}a${a}`, full: `d${d}a${a}t${type}` };
}

/* 슈팅 목록 [x,y,type,result,...] → xG 표 { pk, fk, t:{키:[득점,시도]} } */
export function buildXgModel(shots) {
  const t = {}, add = (k, goal) => { const c = (t[k] ||= [0, 0]); c[0] += goal; c[1]++; };
  let pk = [0, 0], fk = [0, 0];
  for (const [x, y, type, res] of shots) {
    if (x == null) continue;
    const goal = res === 3 ? 1 : 0;
    if (type === SHOT_TYPE.PK) { pk[0] += goal; pk[1]++; continue; }
    if (type === SHOT_TYPE.FK) { fk[0] += goal; fk[1]++; continue; }
    const k = xgKeys(x, y, type);
    add(k.d, goal); add(k.da, goal); add(k.full, goal);
  }
  const rate = ([g, n]) => (n ? Math.round((g / n) * 1000) / 1000 : null);
  return { shots: shots.length, pk: rate(pk), fk: rate(fk), t };
}

/* 슈팅 1개의 득점 확률 — 세부 칸이 적으면 (거리·각도) → (거리) 비율로 보정 */
export function xgOf(model, x, y, type) {
  if (!model || x == null) return 0;
  if (type === SHOT_TYPE.PK) return model.pk ?? 0.78;
  if (type === SHOT_TYPE.FK) return model.fk ?? 0.07;
  const k = xgKeys(x, y, type), t = model.t;
  const pD = t[k.d] ? t[k.d][0] / t[k.d][1] : 0.05;
  const cDA = t[k.da] || [0, 0];
  const pDA = (cDA[0] + XG_PRIOR_K * pD) / (cDA[1] + XG_PRIOR_K);
  const cF = t[k.full] || [0, 0];
  return (cF[0] + XG_PRIOR_K * pDA) / (cF[1] + XG_PRIOR_K);
}

/* ---------- 🛡 실점 루트 ----------
   상대 공격의 출발점 = 도움이 있으면 도움 위치, 없으면 슈팅 위치 → 우리 수비 기준 좌·중·우 레인
   상대 y가 크면(상대의 오른쪽) = 우리 왼쪽 */
export const LANES = { L: "왼쪽 측면", C: "중앙", R: "오른쪽 측면" };
export const LANE_POS = {       // 레인 → 점검할 우리 포지션 (수비·측면 위주)
  L: [7, 8, 6, 16, 27, 11],
  C: [5, 1, 4, 6, 10, 9, 11],
  R: [3, 2, 4, 12, 23, 9]
};
export function laneOf(oppShot) {
  const [x, y, , , ax, ay] = oppShot;
  const oy = ay != null ? ay : y;
  if (oy == null) return null;
  return oy > 0.7 ? "L" : oy < 0.3 ? "R" : "C";
}
/* 상대 슈팅 목록 → 레인별 xG 비중 */
export function laneShares(oppShots, model) {
  const sum = { L: 0, C: 0, R: 0 };
  for (const s of oppShots) {
    if (s[2] === SHOT_TYPE.PK) continue;                 // PK는 위치 의미 없음
    const lane = laneOf(s);
    if (lane) sum[lane] += xgOf(model, s[0], s[1], s[2]);
  }
  const tot = sum.L + sum.C + sum.R;
  return { xg: tot, share: tot ? { L: sum.L / tot, C: sum.C / tot, R: sum.R / tot } : null };
}

/* ---------- 🩺 선수 진단 — 도륙 지수 v2 (v2.9.0, 사용자 승인 기준) ----------
   B 포지션 대비: 같은 포지션 그룹 랭커 선수 분포(ranker-baseline modes.*.dor6) — 도륙 지수·배지를 정함
   A 카드 대비 : 같은 카드·같은 포지션 랭커 평균(넥슨 ranker-stats) — 배지에는 넣지 않고 '카드 활용' 안내만
   계산 순서 (100점 만점 배점제)
     ① 포지션마다 지표별 배점(D6_PTS, 합계 100) — 중요한 지표일수록 배점이 큼
     ② 지표 Z = (내 경기당 값 − 랭커 평균) ÷ 랭커 표준편차, 단 '운 보정'으로 내 값의 표본 흔들림만큼 평균 쪽으로 당김
     ③ 지표 점수 = 배점 × (0.5 + Z/4) — 랭커 평균이면 배점의 절반, +2σ 이상이면 만점, −2σ 이하면 0점
     ④ 압도 보너스: Z가 +1.5σ(랭커 상위 약 7%)를 넘는 지표는 배점 × (Z−1.5) × 0.5만큼 만점을 넘겨 받음 (선수당 최대 +15)
        → 한 가지가 압도적이면 약점(예: 제공권)이 있어도 고득점 가능
     ⑤ 도륙 지수 = 기본 점수 + 압도 보너스 (0~100, 랭커 평균 ≈ 50)
     ⑥ 배지는 지수만으로 정함 — 모든 포지션·모드 같은 기준 (D6_GRADES)
   넥슨은 선수별 크로스 수치를 주지 않음(실측) → 슈팅 상세의 도움 위치로 '키패스'·'측면 키패스'(크로스·컷백 추정)를 계산
   선수 status.dribble은 팀 합계와 맞지 않아 의미 불명 → 사용하지 않음 */
export const D6_METRICS = {
  gol: "골", esh: "유효 슈팅", xg: "기대 득점(xG)", fin: "결정력(골−xG)",
  ast: "도움", kp: "키패스", xa: "기대 도움(xA)", wkp: "측면 키패스",
  drb: "드리블 성공", drbR: "드리블 성공률",
  pas: "패스 성공", pasR: "패스 성공률",
  int: "가로채기", win: "볼 획득", blk: "슈팅 블록",
  air: "공중볼 성공", airR: "공중볼 성공률",
  sav: "선방", gkp: "실점 억제", rt: "평점"
};
export const D6_CATS = {
  fin: { label: "득점", keys: ["gol", "esh", "xg", "fin"] },
  cre: { label: "찬스", keys: ["ast", "kp", "xa", "wkp"] },
  drb: { label: "돌파", keys: ["drb", "drbR"] },
  pas: { label: "패스", keys: ["pas", "pasR"] },
  def: { label: "수비", keys: ["int", "win", "blk"] },
  air: { label: "제공권", keys: ["air", "airR"] },
  sav: { label: "선방", keys: ["sav"] },
  gkp: { label: "실점 억제", keys: ["gkp"] }
};
/* 포지션별 지표 배점(합계 100) — 사용자 승인 표 (2026-10-07)
   제공권: 넥슨 공중볼 성공이 랭커 ST·CB도 경기당 약 0.15회뿐(실측) → 비중을 낮춤(ST 20→8, CB 30→15) */
export const D6_PTS = {
  ST: { gol: 18, fin: 14, esh: 10, xg: 8, ast: 5, kp: 6, xa: 4, drb: 10, drbR: 7, pas: 4, pasR: 6, air: 5, airR: 3 },
  W:  { gol: 12, fin: 7, esh: 4, xg: 3, ast: 8, kp: 9, xa: 6, wkp: 7, drb: 17, drbR: 13, pas: 4, pasR: 6, int: 2, win: 2 },
  AM: { gol: 10, fin: 6, esh: 5, xg: 4, ast: 10, kp: 12, xa: 9, wkp: 4, drb: 9, drbR: 6, pas: 10, pasR: 10, int: 2, win: 3 },
  CM: { gol: 4, esh: 3, fin: 3, ast: 6, kp: 8, xa: 6, drb: 5, drbR: 5, pas: 15, pasR: 20, int: 10, win: 12, blk: 3 },
  DM: { ast: 3, kp: 4, xa: 3, pas: 10, pasR: 25, int: 20, win: 22, blk: 8, air: 3, airR: 2 },
  FB: { ast: 6, kp: 6, xa: 4, wkp: 6, drb: 8, drbR: 7, pas: 8, pasR: 12, int: 13, win: 17, blk: 8, air: 3, airR: 2 },
  CB: { pas: 7, pasR: 18, int: 20, win: 26, blk: 14, air: 9, airR: 6 },
  GK: { sav: 50, gkp: 40, pas: 3, pasR: 7 }
};
const catOf = (k) => Object.keys(D6_CATS).find((c) => D6_CATS[c].keys.includes(k));
/* 묶음별 배점 합계(화면 표시·기준값 생성용) — D6_PTS에서 자동 계산 */
export const POS_CAT_W = Object.fromEntries(Object.entries(D6_PTS).map(([g, t]) => {
  const w = {};
  for (const [k, p] of Object.entries(t)) w[catOf(k)] = (w[catOf(k)] || 0) + p;
  return [g, w];
}));
/* 배지 — 지수만 보고 정함. 기준은 랭커 분포(실측 2026-10-07: 랭커 상위 10% ≈ 60, 하위 10% ≈ 36~39) */
export const D6_GRADES = [
  { min: 60, key: "core" },      // 랭커 상위 10% 수준
  { min: 45, key: "keep" },      // 랭커 평균권
  { min: 35, key: "watch" },     // 랭커 하위권
  { min: -Infinity, key: "replace" }
];
/* 성공률 지표: [성공, 시도, 최소 시도 합] — 시도가 적으면 비율이 튀어 제외 */
const RATE_KEYS = { drbR: ["drb", "dTry", 10], pasR: ["pas", "pTry", 50], airR: ["air", "aTry", 10] };
/* 랭커 평균이 이보다 작으면 제외(1~2개로 튀는 노이즈). null = 제한 없음(비율·차이 지표) */
const MIN_MEAN = { fin: null, gkp: null, drbR: null, pasR: null, airR: null, rt: null, wkp: 0.05, xa: 0.05, xg: 0.05, air: 0.1 };   // 공중볼은 랭커 CB도 경기당 0.15개(실측)라 0.1
const SUM_KEYS = ["gol", "ast", "rt", "sht", "pas", "drb", "int", "win", "blk", "air", "sav", "esh", "pTry", "dTry", "aTry"];
export const SPIKE_Z = 1.5, SPIKE_K = 0.5, SPIKE_MAX = 15;   // 압도 보너스: +1.5σ 초과분 × 배점 × 0.5, 선수당 최대 +15
/* 측면 키패스: 상대 진영 깊은 곳(x ≥ 0.66)의 측면(y ≤ 0.2 또는 ≥ 0.8)에서 슈팅으로 이어진 패스 */
const isWide = (x, y) => x != null && y != null && x >= 0.66 && (y <= 0.2 || y >= 0.8);
export const d6Index = (score) => (score == null ? null : Math.round(Math.max(0, Math.min(100, score))));

/* ranker-stats status 키 ↔ 우리 지표 (카드 대비 비교에 쓰는 것만) */
export const RANKER_KEY = { gol: "goal", ast: "assist", esh: "effectiveShoot", pas: "passSuccess", drb: "dribbleSuccess", int: "tackle", blk: "block" };
export const LOW = -0.4;             // 카드 대비 '덜 쓰이는 중' 기준(배점 가중 평균 Z)
export const MIN_JUDGE_GAMES = 10;   // 미만이면 '참고'(배지 판정 안 함)
export const CONF = (n) => (n < MIN_JUDGE_GAMES ? "참고" : n < 30 ? "보통" : "높음");
const ZCLIP = 3;
const clip = (z) => Math.max(-ZCLIP, Math.min(ZCLIP, z));

/* 선발 행 → (spId, 주 포지션 그룹) 단위 경기당 평균 — 브라우저 진단·랭커 기준값 공용
   xg: xG 표(없으면 xG 계열 0) */
export function playerUnits(rows, xg) {
  const units = new Map(); // key spId|group
  for (const m of rows) {
    // 이 경기 슈팅 → 선수별 xG · 키패스 · xA · 측면 키패스
    const sh = new Map();
    const of = (id) => { let x = sh.get(id); if (!x) sh.set(id, (x = { xg: 0, kp: 0, xa: 0, wkp: 0 })); return x; };
    for (const s of m.s || []) {
      const v = xgOf(xg, s[0], s[1], s[2]);
      of(s[4]).xg += v;
      if (s[5]) { const a = of(s[5]); a.kp++; a.xa += v; if (isWide(s[6], s[7])) a.wkp++; }
    }
    const oppXg = (m.o || []).reduce((t, s) => t + xgOf(xg, s[0], s[1], s[2]), 0);
    for (const p of m.ps) {
      const g = posGroup(p[PSI.pos]);
      if (!g) continue;
      const key = `${p[PSI.spId]}|${g}`;
      const u = units.get(key) || { spId: p[PSI.spId], group: g, games: 0, posCount: {}, grade: {}, sum: {}, sq: {} };
      u.games++;
      u.posCount[p[PSI.pos]] = (u.posCount[p[PSI.pos]] || 0) + 1;
      u.grade[p[PSI.grade]] = (u.grade[p[PSI.grade]] || 0) + 1;
      // 경기당 값의 합·제곱합 — 제곱합은 '표본이 적어 생기는 흔들림' 추정용(d6Baseline 우연 편차 제거)
      const add = (k, v) => { u.sum[k] = (u.sum[k] || 0) + v; u.sq[k] = (u.sq[k] || 0) + v * v; };
      for (const k of SUM_KEYS) add(k, p[PSI[k]] ?? 0);
      const x = sh.get(p[PSI.spId]);
      for (const k of ["xg", "kp", "xa", "wkp"]) add(k, x ? x[k] : 0);
      add("fin", (p[PSI.gol] ?? 0) - (x ? x.xg : 0));
      if (g === "GK") add("gkp", oppXg - m.ga);
      units.set(key, u);
    }
  }
  const main = new Map();
  for (const u of units.values()) {
    const n = u.games, s = u.sum;
    u.avg = {}; u.noise = {};   // noise[k] = 평균값의 표본 분산(경기당 분산 ÷ 경기 수)
    for (const k of [...SUM_KEYS, "xg", "kp", "xa", "wkp", "fin", "gkp"]) {
      if (s[k] == null) continue;
      u.avg[k] = s[k] / n;
      u.noise[k] = Math.max(0, u.sq[k] / n - u.avg[k] ** 2) / n;
    }
    if (u.group !== "GK") u.avg.gkp = null;
    for (const [k, [ok, tr, min]] of Object.entries(RATE_KEYS)) {
      const t = s[tr] || 0, p = t >= min ? (s[ok] || 0) / t : null;
      u.avg[k] = p; u.noise[k] = p == null ? null : (p * (1 - p)) / t;   // 성공률은 이항 분산
    }
    u.pos = +Object.entries(u.posCount).sort((a, b) => b[1] - a[1])[0][0];
    u.grade = +Object.entries(u.grade).sort((a, b) => b[1] - a[1])[0][0];
    delete u.sum; delete u.sq;
    const cur = main.get(u.spId);
    if (!cur || u.games > cur.games) main.set(u.spId, u);
  }
  return [...main.values()];
}

/* 랭커 선수 단위 목록 → 포지션 그룹별 지표 분포 { GROUP: { n, metric:{mean,sd} } } (ranker-baseline.js) */
export const D6_MIN_UNIT_GAMES = 5;
const SD_FLOOR = 0.35;   // 우연 편차를 빼도 관측 편차의 35% 아래로는 줄이지 않음(과보정 방지)
/* 우연 편차 제거: 랭커 한 명당 5~15경기 평균이라 관측 편차에는 '실력 차이 + 표본 흔들림'이 섞여 있음
   → 실력 편차² ≈ 관측 편차² − 평균(표본 분산). 100경기 평균인 우리 선수와 같은 잣대로 비교하기 위함 */
const r3b = (v) => Math.round(v * 1000) / 1000;
export function d6Baseline(unitList, { noise = true } = {}) {
  const out = {};
  for (const g of Object.keys(POS_CAT_W)) {
    const us = unitList.filter((u) => u.group === g && u.games >= D6_MIN_UNIT_GAMES);
    if (us.length < 5) continue;
    out[g] = { n: us.length };
    const keys = new Set(["rt"]);
    for (const c of Object.keys(POS_CAT_W[g])) D6_CATS[c].keys.forEach((k) => keys.add(k));
    for (const k of keys) {
      const ok = us.filter((u) => u.avg[k] != null);
      if (ok.length < 5) continue;
      const vals = ok.map((u) => u.avg[k]);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const obs = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      const nz = ok.reduce((s, u) => s + ((u.noise && u.noise[k]) || 0), 0) / ok.length;
      const sd = noise ? Math.sqrt(Math.max(obs * obs - nz, (SD_FLOOR * obs) ** 2)) : obs;
      out[g][k] = { mean: r3b(mean), sd: r3b(sd), sdObs: r3b(obs) };
    }
  }
  return out;
}
/* 랭커 선수들을 같은 방식으로 채점한 도륙 지수 분포(_dist) — 배지 기준(60·45·35)이 랭커 기준으로 어디쯤인지 확인용
   (v2.7.1의 기준점 보정 _cmu·_mu·판정선 _low는 v2.9.0 배점제에서 쓰지 않음) */
export function d6Calibrate(base, unitList) {
  const pick = (a, p) => a[Math.floor(p * (a.length - 1))];
  for (const g of Object.keys(base)) {
    delete base[g]._cmu; delete base[g]._mu; delete base[g]._sd; delete base[g]._low;
    const idx = unitList.filter((u) => u.group === g && u.games >= D6_MIN_UNIT_GAMES)
      .map((u) => diagnose(u, base, null).index).filter((v) => v != null).sort((a, b) => a - b);
    if (idx.length >= 5) base[g]._dist = { p10: pick(idx, 0.1), p50: pick(idx, 0.5), p90: pick(idx, 0.9) };
  }
  return base;
}

/* 판정 — 지수 구간만으로 정함 (포지션·모드 공통) */
export const VERDICTS = {
  core:    { emoji: "⭐", label: "핵심", tone: "ok", line: "랭커 상위 10% 수준 — 팀의 핵심 카드" },
  keep:    { emoji: "🟢", label: "유지", tone: "ok" },
  watch:   { emoji: "🟡", label: "관찰", tone: "warn", line: "랭커 하위권 — 약한 지표를 점검해 보세요" },
  replace: { emoji: "🔴", label: "교체 고려", tone: "danger", line: "랭커 하위 10%보다 낮음 — 상위 카드나 다른 선수 고려" },
  pending: { emoji: "⚪", label: "참고", tone: "dim", line: `선발 ${MIN_JUDGE_GAMES}경기 미만 — 판정 보류` }
};
export const CARD_LOW_LINE = "같은 카드를 쓰는 랭커보다 덜 쓰이는 중 → 포지션·전술 점검";
export function verdictOf(n, index) {
  if (n < MIN_JUDGE_GAMES || index == null) return "pending";
  return D6_GRADES.find((g) => index >= g.min).key;
}

/* 역할 태그 — 가장 강한 묶음(배점 10 이상, 묶음 점수 60 이상) */
const ROLE_WORD = { fin: "득점형", cre: "찬스메이커", drb: "돌파형", pas: "빌드업형", def: "수비형", air: "제공권형", sav: "선방형", gkp: "안정형" };
const ATTACK = ["ST", "W", "AM"];
function roleOf(group, cats) {
  const top = Object.entries(cats).filter(([, c]) => c.w >= 10 && c.index >= 60).sort((a, b) => b[1].index - a[1].index)[0];
  if (!top) return null;
  const [k, c] = top;
  if (k === "cre" && c.best === "wkp") return "크로스형";
  if (k === "pas" && ATTACK.includes(group)) return "연계형";
  if (k === "def") return ATTACK.includes(group) ? "수비 가담형" : ["CB", "DM"].includes(group) ? "철벽형" : "수비형";
  return ROLE_WORD[k];
}

/* 선수 한 명 진단
   base: 모드 포지션 분포 { GROUP: { metric:{mean,sd} } } (ranker-baseline modes.*.dor6)
   rankerCard: ranker-stats status (같은 카드·같은 포지션) 또는 null */
export function diagnose(unit, base, rankerCard) {
  const b = base && base[unit.group];
  const pts = D6_PTS[unit.group];
  if (!b || !pts) return { ...unit, verdict: "pending", scoreA: null, index: null, base: null, spike: 0, cats: {}, zB: [], zA: [] };
  const usable = (k) => {
    const bb = b[k];
    if (!bb || !(bb.sd > 0) || unit.avg[k] == null) return false;
    const mm = k in MIN_MEAN ? MIN_MEAN[k] : MIN_BASE_MEAN;
    return mm == null || bb.mean >= mm;
  };
  // 운 보정(경험적 베이즈): 내 평균의 표본 흔들림(noise)이 클수록 차이를 줄여 봄 — 적은 경기·운이 큰 지표(결정력 등)의 반짝 수치 억제
  const zOf = (k, ref) => {
    const sd = b[k].sd, nz = (unit.noise && unit.noise[k]) || 0;
    return clip(((unit.avg[k] - ref) / sd) * ((sd * sd) / (sd * sd + nz)));
  };
  const zB = [];
  for (const [k, w] of Object.entries(pts)) {
    if (!usable(k)) continue;
    const z = zOf(k, b[k].mean);
    const basePt = w * Math.max(0, Math.min(1, 0.5 + z / 4));
    const over = z > SPIKE_Z ? w * (z - SPIKE_Z) * SPIKE_K : 0;
    zB.push({ metric: k, cat: catOf(k), value: unit.avg[k], ref: b[k].mean, z, w, pt: basePt, over });
  }
  // 못 쓰는 지표(랭커 기록 부족 등)가 있으면 남은 배점을 100점으로 환산
  const tot = zB.reduce((s, x) => s + x.w, 0);
  const scale = tot ? 100 / tot : 0;
  for (const x of zB) { x.w *= scale; x.pt *= scale; x.over *= scale; }
  const cats = {};
  for (const x of zB) {
    const c = (cats[x.cat] ||= { w: 0, pt: 0, over: 0, best: x.metric, bestZ: -Infinity });
    c.w += x.w; c.pt += x.pt; c.over += x.over;
    if (x.z > c.bestZ) { c.best = x.metric; c.bestZ = x.z; }
  }
  for (const c of Object.values(cats)) c.index = Math.round(((c.pt + c.over) / c.w) * 100);   // 묶음 점수(배점 대비 %, 50 = 랭커 평균)
  const basePts = tot ? zB.reduce((s, x) => s + x.pt, 0) : null;
  const spikeRaw = zB.reduce((s, x) => s + x.over, 0), spike = Math.min(SPIKE_MAX, spikeRaw);
  const index = basePts == null ? null : d6Index(basePts + spike);
  // 카드 대비: 랭커가 이 카드를 같은 포지션에 쓴 평균 — 이 포지션 배점이 있는 지표만, 배점 가중 평균 Z
  const zA = [];
  if (rankerCard && unit.group !== "GK") {
    for (const [k, rk] of Object.entries(RANKER_KEY)) {
      const ref = rankerCard[rk];
      if (!pts[k] || ref == null || ref < MIN_BASE_MEAN || !usable(k)) continue;
      zA.push({ metric: k, cat: catOf(k), value: unit.avg[k], ref, z: zOf(k, ref), w: pts[k] });
    }
  }
  const wsum = zA.reduce((s, x) => s + x.w, 0);
  const scoreA = zA.length >= 2 ? zA.reduce((s, x) => s + x.z * x.w, 0) / wsum : null;
  const verdict = verdictOf(unit.games, index);
  return { ...unit, zA, zB, cats, base: basePts == null ? null : Math.round(basePts), spike: Math.round(spike), spikeRaw, scoreA, index,
    role: roleOf(unit.group, cats), cardLow: verdict !== "pending" && scoreA != null && scoreA < LOW,
    rankerGames: rankerCard ? rankerCard.matchCount ?? null : null, verdict };
}

/* ---------- 전체 분석 ----------
   rows: 압축 행(최신순 무관), ctx: { base(모드 포지션 기준값), xg(모드 xG 표), lanesBase(랭커 레인 비중), ranker({"spId|pos": status}) } */
export const ONOFF_MIN = 10;
export function analyze(rows, ctx) {
  const all = [...rows].sort((a, b) => String(b.d).localeCompare(String(a.d)));
  const normal = all.filter(isNormal);
  const cnt = (r) => all.filter((m) => m.r === r).length;
  const summary = {
    games: all.length, normal: normal.length, win: cnt("win"), draw: cnt("draw"), lose: cnt("lose"),
    gf: avg(normal.map((m) => m.gf)), ga: avg(normal.map((m) => m.ga)),
    from: all.length ? all[all.length - 1].d : null, to: all.length ? all[0].d : null,
    forfeit: all.length - normal.length
  };
  // 팀 xG
  let xgFor = 0, xgAg = 0;
  const pxg = new Map(), pxa = new Map(), pgoal = new Map(), pshots = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const m of normal) {
    for (const s of m.s) {
      const v = xgOf(ctx.xg, s[0], s[1], s[2]);
      xgFor += v; add(pxg, s[4], v); add(pshots, s[4], 1);
      if (s[3] === 3) add(pgoal, s[4], 1);
      if (s[5]) add(pxa, s[5], v);
    }
    for (const s of m.o) xgAg += xgOf(ctx.xg, s[0], s[1], s[2]);
  }
  summary.xgFor = normal.length ? xgFor / normal.length : null;
  summary.xgAg = normal.length ? xgAg / normal.length : null;

  // 선수 진단
  const starters = normal.map((m) => ({ ...m, ps: m.ps.filter((p) => p[PSI.pos] !== SUB_POS) }));
  const players = playerUnits(starters, ctx.xg).map((u) => {
    const d = diagnose(u, ctx.base, ctx.ranker ? ctx.ranker[`${u.spId}|${u.pos}`] : null);
    d.xg = pxg.get(u.spId) || 0; d.goals = pgoal.get(u.spId) || 0; d.shots = pshots.get(u.spId) || 0;
    d.xa = pxa.get(u.spId) || 0;
    d.finishing = d.goals - d.xg;
    d.onOff = onOff(normal, u.spId);
    d.ratings = starters.filter((m) => m.ps.some((p) => p[PSI.spId] === u.spId))
      .slice(0, 20).reverse().map((m) => m.ps.find((p) => p[PSI.spId] === u.spId)[PSI.rt]);
    return d;
  }).sort((a, b) => posOrder(a.pos) - posOrder(b.pos));

  // 실점 루트
  const lanes = laneShares(normal.flatMap((m) => m.o), ctx.xg);
  const laneReport = lanes.share ? Object.keys(LANES).map((k) => ({
    lane: k, share: lanes.share[k], base: ctx.lanesBase ? ctx.lanesBase[k] : null,
    diff: ctx.lanesBase ? lanes.share[k] - ctx.lanesBase[k] : null,
    watch: lanePlayers(starters, k)
  })) : [];

  return { summary, players, lanes: laneReport, formations: formationCounts(starters) };
}

const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
/* 화면 정렬: GK → 수비 → 미드 → 공격 (포지션 코드가 대체로 이 순서) */
const posOrder = (pos) => (pos === 0 ? -1 : pos);

/* 🔁 선발로 뛴 경기 vs 안 뛴 경기 */
function onOff(normal, spId) {
  const on = [], off = [];
  for (const m of normal) (m.ps.some((p) => p[PSI.spId] === spId && p[PSI.pos] !== SUB_POS) ? on : off).push(m);
  if (on.length < ONOFF_MIN || off.length < ONOFF_MIN) return { on: on.length, off: off.length, ok: false };
  const wr = (a) => a.filter((m) => m.r === "win").length / a.length;
  const gd = (a) => avg(a.map((m) => m.gf - m.ga));
  return { ok: true, on: on.length, off: off.length, winOn: wr(on), winOff: wr(off), gdOn: gd(on), gdOff: gd(off) };
}

/* 레인 담당 포지션에 가장 많이 선발로 선 선수 (포지션별 1명) */
function lanePlayers(starters, lane) {
  const byPos = new Map();
  for (const m of starters) for (const p of m.ps) {
    if (!LANE_POS[lane].includes(p[PSI.pos])) continue;
    const k = `${p[PSI.pos]}|${p[PSI.spId]}`;
    byPos.set(k, (byPos.get(k) || 0) + 1);
  }
  const best = new Map();
  for (const [k, n] of byPos) {
    const [pos, spId] = k.split("|").map(Number);
    if (n < starters.length * 0.3) continue;        // 가끔만 선 선수는 제외
    if (!best.has(pos) || best.get(pos).n < n) best.set(pos, { pos, spId, n });
  }
  const seen = new Set();   // 한 선수가 두 포지션(LM·LW 등)에 걸쳐 있으면 한 번만
  return LANE_POS[lane].filter((p) => best.has(p)).map((p) => best.get(p))
    .filter((w) => !seen.has(w.spId) && seen.add(w.spId)).slice(0, 3);
}

/* 선발 포지션 조합별 경기 수·승 (포메이션 문자열은 화면 squad.js sqFormation으로 계산) */
function formationCounts(starters) {
  const map = new Map();
  for (const m of starters) {
    const key = m.ps.map((p) => p[PSI.pos]).sort((a, b) => a - b).join(",");
    const f = map.get(key) || { positions: key.split(",").map(Number), games: 0, win: 0 };
    f.games++; if (m.r === "win") f.win++;
    map.set(key, f);
  }
  return [...map.values()].sort((a, b) => b.games - a.games);
}

/* ranker-stats 조회 대상: 판정 가능한 선수(주 포지션)만 */
export function rankerTargets(rows) {
  const starters = rows.filter(isNormal).map((m) => ({ ...m, ps: m.ps.filter((p) => p[PSI.pos] !== SUB_POS) }));
  return playerUnits(starters, null).filter((u) => u.group !== "GK").map((u) => ({ id: u.spId, po: u.pos }));
}

export { GROUP_LABEL, P_METRICS };
