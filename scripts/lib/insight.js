/* ============================================================
   insight.js — 경기 상세 인사이트 공용 로직 (v1.9.0)
   - collect.js : 매치 상세 → 경기별 저장 필드(ctrl·cards·pStats·shots·oppGoals) 추출
   - aggregate.js: 저장 필드 → 에이스 선수·골 시간대·역전승·극장골·매너 집계
   설계: 넥슨 호출 추가 없이 이미 받는 매치 상세에서 필요한 값만 짧은 배열로 저장(용량 절약)
   ============================================================ */

/* 넥슨 goalTime = 하프 오프셋(2^24 단위) + 해당 하프 경과 초
   0 전반 · 1 후반 · 2 연장 전반 · 3 연장 후반 · 4 승부차기 */
const HALF = 2 ** 24;
const HALF_START_SEC = [0, 45 * 60, 90 * 60, 105 * 60];
export const SHOOTOUT = 4;

/* goalTime → 경기 시각(초, 킥오프 기준). 승부차기는 null(시간대·역전 판정에서 제외) */
export function gameSec(goalTime) {
  const half = Math.floor(goalTime / HALF);
  if (half >= SHOOTOUT) return null;
  return HALF_START_SEC[half] + (goalTime % HALF);
}

/* 슈팅 결과 코드 (넥슨 shootDetail.result) */
export const SHOT_RESULT = { ON: 1, OFF: 2, GOAL: 3 };

/* ---------- 선수별 기록(pStats) — v1.10.0 포지션 스페셜리스트 ----------
   pStats 한 행 = P_KEYS 순서의 배열 (키를 반복 저장하지 않아 용량 절약)
   넥슨 status.tackle은 intercept와 값이 같아(실측) int 하나만 저장 */
export const P_KEYS = ["spId", "pos", "gol", "ast", "rt", "sht", "pas", "drb", "int", "win", "blk", "air", "sav"];
export const PI = Object.fromEntries(P_KEYS.map((k, i) => [k, i]));

function pRow(pl) {
  const s = pl.status || {};
  return [pl.spId, pl.spPosition, s.goal ?? 0, s.assist ?? 0, s.spRating ?? 0, s.shoot ?? 0,
    s.passSuccess ?? 0, s.dribbleSuccess ?? 0, s.intercept ?? 0, s.ballPossesionSuccess ?? 0,
    s.block ?? 0, s.aerialSuccess ?? 0, s.defending ?? 0];
}

/* 포지션 코드 → 8그룹 (교체 28은 출전 시간을 알 수 없어 null = 비교 제외) */
const GROUP_OF = {};
const GROUP_CODES = {
  GK: [0], CB: [1, 4, 5, 6], FB: [2, 3, 7, 8], DM: [9, 10, 11], CM: [13, 14, 15],
  W: [12, 16, 23, 27], AM: [17, 18, 19], ST: [20, 21, 22, 24, 25, 26]
};
for (const [g, codes] of Object.entries(GROUP_CODES)) for (const c of codes) GROUP_OF[c] = g;
export const posGroup = (pos) => GROUP_OF[pos] ?? null;
export const GROUP_LABEL = { GK: "골키퍼", CB: "센터백", FB: "풀백", DM: "수비형 미드필더", CM: "중앙 미드필더",
  W: "측면", AM: "공격형 미드필더", ST: "스트라이커" };

/* 비교 지표 (경기당). GK는 선방·패스·평점만, 필드 플레이어는 선방 제외 */
export const P_METRICS = {
  int: "가로채기·태클", win: "볼 획득", blk: "슈팅 블록", air: "공중볼 경합 성공", pas: "패스 성공",
  drb: "드리블 성공", sht: "슈팅", gol: "골", ast: "도움", sav: "선방", rt: "평점"
};
const GROUP_METRICS = (g) => g === "GK" ? ["sav", "pas", "rt"] : Object.keys(P_METRICS).filter((k) => k !== "sav");
export const MIN_BASE_MEAN = 0.3;   // 랭커 평균이 이보다 작은 지표는 제외(1~2개로 튀는 노이즈)
export const MIN_UNIT_GAMES = 5;    // (선수·포지션그룹) 단위 최소 선발 경기
export const TITLE_Z = 1.0;         // 칭호 부여 기준 (랭커 선수 분포 대비 표준편차)

/* 칭호 — [포지션 그룹 목록 | "*", 이모지, 이름], 위에서부터 먼저 맞는 것 */
const TITLES = {
  int: [[["DM", "CM"], "🧹", "진공청소기"], [["CB"], "🚧", "길목 차단기"], ["*", "🦅", "볼 사냥꾼"]],
  win: [["*", "🥷", "볼 탈취왕"]],
  blk: [["*", "🧱", "통곡의 벽"]],
  air: [[["CB"], "✈️", "제공권의 지배자"], [["ST"], "🗼", "타깃맨"], ["*", "🙆", "헤더 장인"]],
  pas: [[["DM", "CM"], "🎼", "중원의 지휘자"], [["CB", "FB"], "⚙️", "빌드업 엔진"], ["*", "📨", "패스 마스터"]],
  drb: [[["W", "FB"], "🏃", "측면 돌파왕"], [["CB"], "🚜", "전진하는 수비수"], ["*", "🪄", "드리블 마법사"]],
  ast: [["*", "🎯", "킬패스 장인"]],
  gol: [[["ST", "AM", "W"], "🔫", "골 사냥꾼"], [["CB", "FB"], "💥", "골 넣는 수비수"], [["DM", "CM"], "🚀", "골 넣는 미드필더"]],
  sht: [["*", "🏹", "슈팅 머신"]],
  sav: [["*", "🧤", "수호신"]],
  rt:  [["*", "⭐", "믿을맨"]]
};
export function titleFor(metric, group) {
  const t = (TITLES[metric] || []).find(([gs]) => gs === "*" || gs.includes(group));
  return t ? { emoji: t[1], name: t[2] } : null;
}

/* pStats 행 목록 → (spId, 포지션그룹) 단위 경기당 평균. 교체(그룹 null)는 제외
   반환: Map key "spId|group" → { spId, group, games, posCount:{pos:n}, avg:{metric:v} } */
export function unitAverages(rows) {
  const units = new Map();
  for (const r of rows) {
    const group = posGroup(r[PI.pos]);
    if (!group) continue;
    const key = `${r[PI.spId]}|${group}`;
    const u = units.get(key) || { spId: r[PI.spId], group, games: 0, posCount: {}, sum: {} };
    u.games++;
    u.posCount[r[PI.pos]] = (u.posCount[r[PI.pos]] || 0) + 1;
    for (const k of Object.keys(P_METRICS)) u.sum[k] = (u.sum[k] || 0) + r[PI[k]];
    units.set(key, u);
  }
  for (const u of units.values()) {
    u.avg = Object.fromEntries(Object.entries(u.sum).map(([k, v]) => [k, v / u.games]));
    delete u.sum;
  }
  return units;
}

/* 랭커 선수 단위 평균들 → 그룹×지표 평균·표준편차 (ranker-baseline.js) */
export function positionBaseline(unitList) {
  const out = {};
  for (const g of Object.keys(GROUP_CODES)) {
    const us = unitList.filter((u) => u.group === g && u.games >= MIN_UNIT_GAMES);
    if (us.length < 5) continue;
    out[g] = { n: us.length };
    for (const k of GROUP_METRICS(g)) {
      const vals = us.map((u) => u.avg[k]);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      out[g][k] = { mean: Math.round(mean * 1000) / 1000, sd: Math.round(sd * 1000) / 1000 };
    }
  }
  return out;
}

/* 클럽원 선수 단위 → 가장 돋보이는 지표 1개 (자격 미달이면 null) */
export function bestMetric(unit, baseline) {
  const base = baseline && baseline[unit.group];
  if (!base || unit.games < MIN_UNIT_GAMES) return null;
  let best = null;
  for (const k of GROUP_METRICS(unit.group)) {
    const b = base[k];
    if (!b || !(b.sd > 0) || b.mean < MIN_BASE_MEAN) continue;
    const z = (unit.avg[k] - b.mean) / b.sd;
    if (!best || z > best.z) best = { metric: k, value: unit.avg[k], base: b.mean, z };
  }
  if (!best) return null;
  const pos = +Object.entries(unit.posCount).sort((a, b) => b[1] - a[1])[0][0]; // 가장 많이 선 실제 포지션
  return { spId: unit.spId, group: unit.group, pos, games: unit.games,
    metric: best.metric, value: Math.round(best.value * 100) / 100, base: Math.round(best.base * 100) / 100,
    z: Math.round(best.z * 100) / 100, title: best.z >= TITLE_Z ? titleFor(best.metric, unit.group) : null };
}

/* 매치 상세의 한쪽(me) + 상대(opp) → 저장 필드
   pStats: P_KEYS 순서 배열 — 평점 0(미출전 교체)은 제외, 교체 출전은 pos 28로 남김(골·도움 집계용)
   shots : [초, x, y, 결과, 유형, spId, 도움spId|0] — 승부차기 제외, 좌표 소수 2자리
   oppGoals: 상대 골 시각(초) 배열 */
export function insightRaw(me, opp) {
  if (!me) return { ctrl: null, cards: null, pStats: null, shots: null, oppGoals: null };
  const md = me.matchDetail || {};
  const r2 = (n) => Math.round((n ?? 0) * 100) / 100;
  const shots = [];
  for (const s of me.shootDetail || []) {
    const t = gameSec(s.goalTime);
    if (t == null) continue;
    shots.push([t, r2(s.x), r2(s.y), s.result, s.type, s.spId, s.assist ? s.assistSpId : 0]);
  }
  shots.sort((a, b) => a[0] - b[0]);
  const oppGoals = ((opp && opp.shootDetail) || [])
    .filter((s) => s.result === SHOT_RESULT.GOAL)
    .map((s) => gameSec(s.goalTime))
    .filter((t) => t != null)
    .sort((a, b) => a - b);
  const pStats = (me.player || [])
    .filter((pl) => pl.status && pl.status.spRating > 0)
    .map(pRow);
  return {
    ctrl: md.controller || null,
    cards: { y: md.yellowCards ?? 0, r: md.redCards ?? 0 },
    pStats, shots, oppGoals
  };
}

/* 골 시간대 7구간: 전반 0-15·16-30·31-45+ / 후반 46-60·61-75·76-90+ / 연장 */
export const GOAL_BUCKETS = ["1-15", "16-30", "31-45", "46-60", "61-75", "76-90", "연장"];
export function bucketOf(sec) {
  if (sec >= 90 * 60) return 6;
  const base = sec >= 45 * 60 ? 3 : 0;
  const m = (sec - (base ? 45 * 60 : 0)) / 60;
  return base + (m < 15 ? 0 : m < 30 ? 1 : 2);
}

/* 득실 순서 복원 → 역전승·극장골 판정
   내 골 시각 수·상대 골 시각 수가 최종 스코어와 다르면(자책골 등 기록 누락) 판정 불가 → null */
export const LATE_SEC = 80 * 60;
export function goalFlow(match) {
  const mine = (match.shots || []).filter((s) => s[3] === SHOT_RESULT.GOAL).map((s) => s[0]);
  const theirs = match.oppGoals || [];
  if (mine.length !== match.goalFor || theirs.length !== match.goalAgainst) return null;
  const events = [...mine.map((t) => [t, 1]), ...theirs.map((t) => [t, -1])].sort((a, b) => a[0] - b[0]);
  let diff = 0, trailed = false, lastGoAhead = null;
  for (const [t, d] of events) {
    const before = diff;
    diff += d;
    if (diff < 0) trailed = true;
    if (d === 1 && before === 0 && diff === 1) lastGoAhead = t; // 동점 → 리드 전환 골
  }
  const win = match.result === "win" && diff > 0; // 승부차기 승(동점)은 제외
  return {
    comeback: win && trailed,
    lateWinner: win && lastGoAhead != null && lastGoAhead >= LATE_SEC
  };
}
