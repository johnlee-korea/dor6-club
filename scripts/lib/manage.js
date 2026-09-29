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

/* ---------- 🩺 선수 진단 — 도륙 지수 (v2.7.0, 사용자 승인 기준) ----------
   B 포지션 대비: 같은 포지션 그룹 랭커 선수 분포(ranker-baseline modes.*.dor6) — '이 카드가 이 자리에서 통하나'
   A 카드 대비 : 같은 카드·같은 포지션 랭커 평균(넥슨 ranker-stats) — '이 카드만큼 쓰고 있나'
   계산 순서
     ① 지표마다 Z = (내 경기당 값 − 랭커 평균) ÷ 랭커 표준편차
     ② 6묶음(득점·찬스·돌파·패스·수비·제공권, GK는 선방·실점 억제·패스)으로 모으되
        '잘하는 방식 인정' = 묶음 안 최고 지표 60% + 나머지 평균 40% (예: 도움은 적어도 측면 키패스가 높은 윙어)
     ③ 포지션별 묶음 비중(POS_CAT_W)으로 가중 평균
     ④ 가산점: 비중 25% 이상 핵심 묶음이 랭커보다 눈에 띄게 높으면(Z≥1) 묶음마다 +0.2 (최대 +0.4)
     ⑤ 표본 보정 × n/(n+10) → 도륙 지수 = 50 + 20×점수 (0~100)
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
/* 포지션별 묶음 비중(%) — 사용자 승인 표 그대로 */
export const POS_CAT_W = {
  ST: { fin: 40, cre: 15, drb: 15, pas: 10, air: 20 },
  W:  { fin: 25, cre: 30, drb: 30, pas: 10, def: 5 },
  AM: { fin: 25, cre: 35, drb: 15, pas: 20, def: 5 },
  CM: { fin: 10, cre: 20, drb: 10, pas: 35, def: 25 },
  DM: { cre: 10, pas: 35, def: 45, air: 10 },
  FB: { cre: 20, drb: 15, pas: 20, def: 35, air: 10 },
  CB: { pas: 25, def: 45, air: 30 },
  GK: { sav: 50, gkp: 40, pas: 10 }
};
/* 성공률 지표: [성공, 시도, 최소 시도 합] — 시도가 적으면 비율이 튀어 제외 */
const RATE_KEYS = { drbR: ["drb", "dTry", 10], pasR: ["pas", "pTry", 50], airR: ["air", "aTry", 10] };
/* 랭커 평균이 이보다 작으면 제외(1~2개로 튀는 노이즈). null = 제한 없음(비율·차이 지표) */
const MIN_MEAN = { fin: null, gkp: null, drbR: null, pasR: null, airR: null, rt: null, wkp: 0.05, xa: 0.05, xg: 0.05, air: 0.1 };   // 공중볼은 랭커 CB도 경기당 0.15개(실측)라 0.1
const SUM_KEYS = ["gol", "ast", "rt", "sht", "pas", "drb", "int", "win", "blk", "air", "sav", "esh", "pTry", "dTry", "aTry"];
const BEST_SHARE = 0.6, CORE_W = 25, BONUS_Z = 1.0, BONUS = 0.2, BONUS_MAX = 0.4;
/* 측면 키패스: 상대 진영 깊은 곳(x ≥ 0.66)의 측면(y ≤ 0.2 또는 ≥ 0.8)에서 슈팅으로 이어진 패스 */
const isWide = (x, y) => x != null && y != null && x >= 0.66 && (y <= 0.2 || y >= 0.8);
export const d6Index = (score) => (score == null ? null : Math.round(Math.max(0, Math.min(100, 50 + 20 * score))));

/* ranker-stats status 키 ↔ 우리 지표 (카드 대비 비교에 쓰는 것만) */
export const RANKER_KEY = { gol: "goal", ast: "assist", esh: "effectiveShoot", pas: "passSuccess", drb: "dribbleSuccess", int: "tackle", blk: "block" };
export const SHRINK_K = 10;          // 표본 보정 Z × n/(n+K)
export const LOW = -0.4;             // 보정 후 점수가 이보다 낮으면 '낮음' (도륙 지수 42 미만)
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
      const u = units.get(key) || { spId: p[PSI.spId], group: g, games: 0, posCount: {}, grade: {}, sum: {} };
      u.games++;
      u.posCount[p[PSI.pos]] = (u.posCount[p[PSI.pos]] || 0) + 1;
      u.grade[p[PSI.grade]] = (u.grade[p[PSI.grade]] || 0) + 1;
      for (const k of SUM_KEYS) u.sum[k] = (u.sum[k] || 0) + (p[PSI[k]] ?? 0);
      const x = sh.get(p[PSI.spId]);
      for (const k of ["xg", "kp", "xa", "wkp"]) u.sum[k] = (u.sum[k] || 0) + (x ? x[k] : 0);
      if (g === "GK") u.sum.gkp = (u.sum.gkp || 0) + (oppXg - m.ga);
      units.set(key, u);
    }
  }
  const main = new Map();
  for (const u of units.values()) {
    const n = u.games, s = u.sum;
    u.avg = {};
    for (const k of [...SUM_KEYS, "xg", "kp", "xa", "wkp"]) u.avg[k] = (s[k] || 0) / n;
    u.avg.fin = ((s.gol || 0) - (s.xg || 0)) / n;
    u.avg.gkp = u.group === "GK" ? (s.gkp || 0) / n : null;
    for (const [k, [ok, tr, min]] of Object.entries(RATE_KEYS)) u.avg[k] = (s[tr] || 0) >= min ? (s[ok] || 0) / s[tr] : null;
    u.pos = +Object.entries(u.posCount).sort((a, b) => b[1] - a[1])[0][0];
    u.grade = +Object.entries(u.grade).sort((a, b) => b[1] - a[1])[0][0];
    delete u.sum;
    const cur = main.get(u.spId);
    if (!cur || u.games > cur.games) main.set(u.spId, u);
  }
  return [...main.values()];
}

/* 랭커 선수 단위 목록 → 포지션 그룹별 지표 분포 { GROUP: { n, metric:{mean,sd} } } (ranker-baseline.js) */
export const D6_MIN_UNIT_GAMES = 5;
export function d6Baseline(unitList) {
  const out = {};
  for (const g of Object.keys(POS_CAT_W)) {
    const us = unitList.filter((u) => u.group === g && u.games >= D6_MIN_UNIT_GAMES);
    if (us.length < 5) continue;
    out[g] = { n: us.length };
    const keys = new Set(["rt"]);
    for (const c of Object.keys(POS_CAT_W[g])) D6_CATS[c].keys.forEach((k) => keys.add(k));
    for (const k of keys) {
      const vals = us.map((u) => u.avg[k]).filter((v) => v != null);
      if (vals.length < 5) continue;
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      out[g][k] = { mean: Math.round(mean * 1000) / 1000, sd: Math.round(sd * 1000) / 1000 };
    }
  }
  return out;
}

const wmean = (zs) => {
  const w = zs.reduce((s, x) => s + x.w, 0);
  return w ? zs.reduce((s, x) => s + x.z * x.w, 0) / w : null;
};
/* 판정 매트릭스 */
export const VERDICTS = {
  keep:      { emoji: "🟢", label: "유지", tone: "ok" },
  underused: { emoji: "🟡", label: "관찰", tone: "warn", line: "카드는 좋은데 덜 쓰이는 중 → 포지션·전술 점검" },
  capped:    { emoji: "🟠", label: "관찰", tone: "warn", line: "이 카드 한계치만큼 뛰는 중 → 상위 카드 고려" },
  replace:   { emoji: "🔴", label: "교체 고려", tone: "danger", line: "카드 기준으로도, 포지션 기준으로도 부진" },
  pending:   { emoji: "⚪", label: "참고", tone: "dim", line: `선발 ${MIN_JUDGE_GAMES}경기 미만 — 판정 보류` }
};
export function verdictOf(n, scoreA, scoreB) {
  if (n < MIN_JUDGE_GAMES || scoreB == null) return "pending";
  const lowB = scoreB < LOW, lowA = scoreA != null && scoreA < LOW;
  if (lowA && lowB) return "replace";
  if (lowB) return "capped";
  if (lowA) return "underused";
  return "keep";
}

/* 역할 태그 — 가장 강한 묶음(비중 10% 이상, 점수 0.5 이상) */
const ROLE_WORD = { fin: "득점형", cre: "찬스메이커", drb: "돌파형", pas: "빌드업형", def: "수비형", air: "제공권형", sav: "선방형", gkp: "안정형" };
const ATTACK = ["ST", "W", "AM"];
function roleOf(group, cats) {
  const top = Object.entries(cats).filter(([, c]) => c.w >= 10 && c.score >= 0.5).sort((a, b) => b[1].score - a[1].score)[0];
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
  const cw = POS_CAT_W[unit.group];
  if (!b || !cw) return { ...unit, verdict: "pending", scoreA: null, scoreB: null, index: null, cats: {}, zB: [], zA: [] };
  const shrink = unit.games / (unit.games + SHRINK_K);
  const zOf = (k, ref) => clip((unit.avg[k] - ref) / b[k].sd);
  const usable = (k) => {
    const bb = b[k];
    if (!bb || !(bb.sd > 0) || unit.avg[k] == null) return false;
    const mm = k in MIN_MEAN ? MIN_MEAN[k] : MIN_BASE_MEAN;
    return mm == null || bb.mean >= mm;
  };
  const zB = [], cats = {};
  for (const [c, w] of Object.entries(cw)) {
    const keys = D6_CATS[c].keys;
    const zs = keys.filter(usable).map((k) => ({ metric: k, cat: c, value: unit.avg[k], ref: b[k].mean, z: zOf(k, b[k].mean), w: w / keys.length }));
    if (!zs.length) continue;
    const top = zs.reduce((x, y) => (y.z > x.z ? y : x));
    const mean = zs.reduce((s, x) => s + x.z, 0) / zs.length;
    const score = zs.length === 1 ? top.z : BEST_SHARE * top.z + (1 - BEST_SHARE) * mean;
    cats[c] = { score, w, best: top.metric, index: d6Index(score) };
    zB.push(...zs);
  }
  const cl = Object.values(cats);
  const tw = cl.reduce((s, c) => s + c.w, 0);
  const raw = tw ? cl.reduce((s, c) => s + c.w * c.score, 0) / tw : null;
  const bonus = Math.min(BONUS_MAX, cl.filter((c) => c.w >= CORE_W && c.score >= BONUS_Z).length * BONUS);
  // 카드 대비: 랭커가 이 카드를 같은 포지션에 쓴 평균 — 이 포지션 묶음에 들어가는 지표만
  const zA = [];
  if (rankerCard && unit.group !== "GK") {
    for (const [k, rk] of Object.entries(RANKER_KEY)) {
      const c = Object.keys(cw).find((cc) => D6_CATS[cc].keys.includes(k));
      const ref = rankerCard[rk];
      if (!c || ref == null || ref < MIN_BASE_MEAN || !usable(k)) continue;
      zA.push({ metric: k, cat: c, value: unit.avg[k], ref, z: zOf(k, ref), w: cw[c] / D6_CATS[c].keys.length });
    }
  }
  const rawA = zA.length >= 2 ? wmean(zA) : null;
  const scoreB = raw == null ? null : (raw + bonus) * shrink;
  const scoreA = rawA == null ? null : rawA * shrink;
  return { ...unit, zA, zB, cats, bonus, scoreA, scoreB, index: d6Index(scoreB), role: roleOf(unit.group, cats),
    rankerGames: rankerCard ? rankerCard.matchCount ?? null : null,
    verdict: verdictOf(unit.games, scoreA, scoreB) };
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
