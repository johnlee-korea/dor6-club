/* ============================================================
   lib/scout.js — ⚔️ 상대 분석 (v2.28.0, 사용자 요청 "매칭되는 찰나에 상대 닉 넣고 바로 참고할 장표")
   - 입력은 Worker /search의 analysis.guideRows(공식경기 최근 30경기, 정상 종료) — 상대·나 둘 다 같은 형식
   - 규칙·문장 템플릿만 사용 (AI 문장 없음). 모든 항목에 근거 숫자(상대 값 · 랭커 평균 · 내 값)
   - 기준은 '랭커 대비 Z' (ranker-baseline stats) — 승패에 따른 당연한 차이는 쓰지 않음 (v2.18.1 사용자 원칙)
   - 구성
     tactics : 🧠 전술 추정 (빌드업·점유·마무리·수비 성향) — 넥슨 API에 팀 전술 설정이 없어 플레이 지표로 추정
     threats : 🛡 이것만 막아라 (상대가 랭커보다 확실히 많이 쓰는 공격 무기 + 득점 최다 시간대)
     holes   : 🎯 여길 노려라 (상대 약점 + 실점 최다 시간대)
     vs      : ⚔️ 나와 비교 — 지표 막대 + 상대 강점 × 내 약점이 맞물리는 조합(cautions) / 반대(chances)
   - 화면(js/scout.js)은 그리기만 한다. 포메이션·맞대결은 라인업·닉이 필요해 화면 쪽에서 계산
   ============================================================ */
import { computeMetrics, METRICS } from "./playstyle.js";
import { GOAL_BUCKETS, bucketOf } from "./insight.js";

export const SCOUT_VERSION = 1;
export const SCOUT_MIN_GAMES = 10;   // 이보다 적으면 '표본 부족' (플레이스타일 최소 경기와 같음)
const Z_HI = 0.75;                   // 상대 강점·약점 판정 (0.5는 패스 성공률 88% vs 89%처럼 체감 없는 차이까지 잡혀 올림)
const Z_ME = 0.3;                    // 나와 맞물림 판정(내 쪽은 조금 느슨하게 — 30경기 표본)
const MAX_ITEMS = 3;
const TIME_SHARE = 0.25;             // 시간대 쏠림: 6구간 중 한 구간이 25% 이상
const TIME_MIN_GOALS = 6;            // 시간대 판정 최소 골 수

/* 값 표시 (guide.js fmtV와 같은 규칙) */
export const fmtV = (k, v) => {
  if (v == null || !isFinite(v)) return "-";
  const u = METRICS[k].unit;
  if (u === "%") return (v < 0.1 ? (v * 100).toFixed(1) : Math.round(v * 100)) + "%";
  if (u === "avg%") return Math.round(v) + "%";
  return Math.abs(v) < 1 ? v.toFixed(2) : (Math.round(v * 10) / 10).toFixed(1);   // 세트피스골 0.08처럼 1 미만은 소수 2자리
};

/* 🛡 상대 공격 무기 → 막는 법. dir: +1 높을 때 무기 · −1 낮을 때 무기(점유율 낮음 = 역습형) */
const THREAT = {
  throughRatio: { dir: 1, head: "스루패스 침투", tip: "수비 라인을 한 칸 내리고, 뒷공간으로 뛰는 선수는 끝까지 붙어 가세요." },
  lobRatio:     { dir: 1, head: "띄우는 패스·크로스", tip: "측면에서 크로스 각을 먼저 막고, 박스 안 공중볼 경합에 키 큰 수비수를 두세요." },
  longRatio:    { dir: 1, head: "롱패스 전개", tip: "세컨볼 싸움이에요. 미드필더를 수비 라인 가까이 두고 떨어지는 공을 먼저 잡으세요." },
  shortRatio:   { dir: 1, head: "짧은 패스 빌드업", tip: "중앙 간격을 좁히세요. 성급한 태클보다 패스 길목을 막는 게 먼저예요." },
  poss:         { dir: 1, head: "점유형 운영", tip: "공을 오래 쥐어요. 조급하게 달려들지 말고, 뺏는 순간 빠른 역습으로 찌르세요." },
  possLow:      { dir: -1, k: "poss", head: "역습형 (점유 낮음)", tip: "공을 내주고 역습을 노려요. 공격할 때도 수비수 2명은 뒤에 남겨 두세요." },
  shots:        { dir: 1, head: "슈팅을 많이 때림", tip: "박스 앞에서 슈팅 각을 주지 마세요. 슈팅하기 전에 몸을 붙이세요." },
  longShot:     { dir: 1, head: "중거리 슈팅", tip: "페널티 아크 앞 공간을 비우지 마세요. 수비수 한 명은 앞으로 나와 슈팅을 막으세요." },
  finesse:      { dir: 1, head: "감아차기", tip: "측면에서 안쪽으로 꺾어 들어오는 감아차기예요. 바깥쪽으로 몰고 안쪽 각을 막으세요." },
  headShot:     { dir: 1, head: "헤더 슈팅", tip: "크로스가 올라오는 측면을 먼저 막고, 박스 안 공중볼에 미리 자리 잡으세요." },
  volley:       { dir: 1, head: "발리 슈팅", tip: "띄운 공이 떨어지는 자리를 먼저 차지하세요. 걷어낼 땐 박스 밖 멀리." },
  lowShot:      { dir: 1, head: "땅볼(깔아 차기) 마무리", tip: "박스 안 1:1·컷백이 많아요. 골키퍼 앞 공간과 컷백 길목을 지키세요." },
  wideShot:     { dir: 1, head: "측면 깊숙이 침투 후 슈팅", tip: "측면 끝까지 파고들어요. 풀백이 쉽게 끌려나가지 않게 하고 컷백을 막으세요." },
  dribble:      { dir: 1, head: "드리블 돌파", tip: "정면 태클 대신 진로를 막고 두 명이 함께 압박하세요." },
  setGoal:      { dir: 1, head: "세트피스 골", tip: "박스 근처 파울 금지 — 프리킥·PK로 골을 잘 넣어요." },
  corner:       { dir: 1, head: "코너킥을 많이 얻음", tip: "측면에서 걷어낼 땐 라인 밖보다 앞으로 길게, 코너킥 수비 위치를 미리 정해 두세요." },
  finish:       { dir: 1, head: "결정력", tip: "찬스를 잘 살려요. 슈팅 한 번도 쉽게 내주지 마세요." },
  lateGoal:     { dir: 1, head: "후반에 강함", tip: "후반에 골이 몰려요. 체력 관리와 교체 타이밍을 미리 준비하세요." }
};

/* 🎯 상대 약점 → 노리는 법. dir: +1 높을 때 약점 · −1 낮을 때 약점 */
const HOLE = {
  ga:         { dir: 1, head: "실점이 많음", tip: "막는 힘이 약해요. 라인을 올려 적극적으로 공격해도 좋아요." },
  tackleRate: { dir: -1, head: "태클 실패가 많음", tip: "1:1 드리블 돌파가 잘 통할 수 있어요." },
  passRate:   { dir: -1, head: "패스 실수가 많음", tip: "전방 압박으로 패스 길을 막으면 공을 자주 뺏을 수 있어요." },
  foul:       { dir: 1, head: "파울이 많음", tip: "박스 근처에서 공을 오래 끌어 프리킥을 얻어 내세요." },
  cards:      { dir: 1, head: "카드가 많음", tip: "경고 받은 수비수 쪽으로 돌파하면 수비가 소극적이 돼요." },
  offside:    { dir: 1, head: "오프사이드가 많음", tip: "수비 라인을 가지런히 유지하면 침투가 자주 걸려요." },
  effRate:    { dir: -1, head: "슈팅이 자주 빗나감", tip: "먼 슈팅은 줘도 덜 위험해요. 박스 안 슈팅만 철저히 막으세요." },
  block:      { dir: -1, head: "슈팅 블락이 적음", tip: "박스 앞 중거리 슈팅을 노려 볼 만해요." },
  tackleTry:  { dir: -1, head: "물러서는 수비 (태클 시도 적음)", tip: "박스 앞까지 공을 쉽게 옮길 수 있어요. 컷백·중거리로 마무리하세요." }
};

/* 경기 목록(guideRows) → 지표·Z·시간대 묶음 */
export function profileOf(rows, base) {
  const list = (rows || []).filter((r) => r && r.raw);
  const n = list.length;
  if (!n) return { games: 0 };
  const m = computeMetrics(list.map((r) => r.raw));
  const z = {};
  for (const k of Object.keys(METRICS)) {
    const b = base && base[k];
    z[k] = m[k] != null && b && b.sd > 0 ? (m[k] - b.mean) / b.sd : null;
  }
  // 득점·실점 시간대 (연장 제외 6구간)
  const gf = Array(GOAL_BUCKETS.length).fill(0), ga = Array(GOAL_BUCKETS.length).fill(0);
  for (const r of list) {
    for (const s of r.shots || []) if (s[3] === 3) gf[bucketOf(s[0])]++;
    for (const t of r.oppGoals || []) ga[bucketOf(t)]++;
  }
  const w = list.filter((r) => r.result === "win").length, l = list.filter((r) => r.result === "lose").length;
  return { games: n, w, d: n - w - l, l, m, z, gf, ga };
}

/* 시간대 쏠림 — 가장 많은 구간이 전체의 TIME_SHARE 이상이고 골이 TIME_MIN_GOALS 이상일 때만 */
function peakBucket(arr) {
  const six = arr.slice(0, 6), total = six.reduce((a, b) => a + b, 0);
  if (total < TIME_MIN_GOALS) return null;
  const i = six.indexOf(Math.max(...six));
  const share = six[i] / total;
  return share >= TIME_SHARE ? { i, label: GOAL_BUCKETS[i], n: six[i], total, share } : null;
}
const pct = (x) => Math.round(x * 100) + "%";

/* 지표 하나의 근거 줄 */
const evid = (k, p, base) => ({ k, label: METRICS[k].label, v: fmtV(k, p.m[k]), avg: base && base[k] ? fmtV(k, base[k].mean) : null });

/* 🧠 전술 추정 — 그룹마다 가장 두드러진(|Z| ≥ Z_HI) 지표 하나, 없으면 '보통/다양' */
const TACTIC_GROUPS = [
  { name: "빌드업", none: "고르게 섞음", opts: { shortRatio: "짧은 패스", longRatio: "롱패스", throughRatio: "스루패스 침투", lobRatio: "띄우는 패스·크로스" } },
  { name: "운영", none: "보통", two: { k: "poss", hi: "점유형", lo: "역습형" } },
  { name: "마무리", none: "다양", opts: { longShot: "중거리", finesse: "감아차기", headShot: "헤더", lowShot: "땅볼 마무리", volley: "발리", wideShot: "측면 각도" } },
  { name: "수비", none: "보통", two: { k: "tackleTry", hi: "적극 태클", lo: "물러서는 수비" } }
];
function tactics(p, base) {
  return TACTIC_GROUPS.map((g) => {
    if (g.two) {
      const z = p.z[g.two.k];
      if (z != null && Math.abs(z) >= Z_HI) return { name: g.name, value: z > 0 ? g.two.hi : g.two.lo, ...evid(g.two.k, p, base) };
      return { name: g.name, value: g.none, ...evid(g.two.k, p, base), plain: true };
    }
    let best = null;
    for (const [k, label] of Object.entries(g.opts)) {
      const z = p.z[k];
      if (z != null && z >= Z_HI && (!best || z > best.z)) best = { k, label, z };
    }
    return best ? { name: g.name, value: best.label, ...evid(best.k, p, base) } : { name: g.name, value: g.none, plain: true };
  });
}

/* 상대 강점·약점 목록 (Z 큰 순, 최대 MAX_ITEMS) */
function pick(table, p, base) {
  const out = [];
  for (const [key, t] of Object.entries(table)) {
    const k = t.k || key, z = p.z[k];
    if (z == null || t.dir * z < Z_HI) continue;
    out.push({ s: t.dir * z, key, head: t.head, tip: t.tip, ...evid(k, p, base) });
  }
  // 같은 성격 중복 정리: 유효슈팅·결정력 같은 말 반복 방지는 표에서 처리, 여기선 정렬만
  return out.sort((a, b) => b.s - a.s);
}

/* ⚔️ 상대 × 나 맞물림 규칙 — opp: 상대 조건, me: 내 조건 [지표, 방향(+1 높음 · −1 낮음)]
   kind 'caution' = 상대 강점이 내 약점과 맞물림 · 'chance' = 상대 약점을 내 강점으로 찌를 수 있음 */
const MATCHUPS = [
  { kind: "caution", opp: ["dribble", 1], me: ["tackleRate", -1], text: "상대는 드리블 돌파가 많은데 내 태클 성공률이 낮아요 → 태클 버튼 참고 진로만 막으세요." },
  { kind: "caution", opp: ["setGoal", 1], me: ["foul", 1], text: "상대는 세트피스로 골을 잘 넣는데 나는 파울이 많아요 → 박스 근처 몸싸움 조심." },
  { kind: "caution", opp: ["longShot", 1], me: ["block", -1], text: "상대는 중거리 슈팅이 많은데 내 블락 시도가 적어요 → 박스 앞 슈팅 각을 먼저 막으세요." },
  { kind: "caution", opp: ["throughRatio", 1], me: ["ga", 1], text: "상대는 스루패스 침투가 많은데 내 실점도 많은 편이에요 → 수비 라인을 평소보다 내리세요." },
  { kind: "caution", opp: ["finish", 1], me: ["ga", 1], text: "상대 결정력이 높고 내 실점이 많은 편이에요 → 찬스 하나가 곧 실점, 슈팅 허용 자체를 줄이세요." },
  { kind: "caution", opp: ["lobRatio", 1], me: ["tackleRate", -1], text: "상대는 띄우는 패스가 많고 내 수비 경합이 약한 편이에요 → 크로스 시작점(측면)을 먼저 막으세요." },
  { kind: "caution", opp: ["passRate", 1], me: ["passRate", -1], text: "상대는 패스 실수가 적고 나는 많은 편이에요 → 공을 쉽게 잃지 말고 안전한 패스 위주로." },
  { kind: "chance", opp: ["passRate", -1], me: ["tackleTry", 1], text: "상대는 패스 실수가 많고 나는 태클(압박)을 많이 해요 → 전방 압박이 잘 통할 상대예요." },
  { kind: "chance", opp: ["tackleRate", -1], me: ["dribble", 1], text: "상대 태클 성공률이 낮고 나는 드리블이 많아요 → 1:1 돌파로 찢어 보세요." },
  { kind: "chance", opp: ["foul", 1], me: ["setGoal", 1], text: "상대는 파울이 많고 나는 세트피스 골이 많아요 → 박스 근처 프리킥을 얻어 내세요." },
  { kind: "chance", opp: ["block", -1], me: ["longShot", 1], text: "상대는 블락이 적고 나는 중거리 슈팅을 즐겨 써요 → 박스 앞에서 과감하게 때리세요." },
  { kind: "chance", opp: ["ga", 1], me: ["finish", 1], text: "상대 실점이 많고 내 결정력이 좋아요 → 찬스 몇 번이면 충분해요, 서두르지 마세요." },
  { kind: "chance", opp: ["offside", 1], me: ["ga", -1], text: "상대는 오프사이드가 많고 내 수비가 안정적이에요 → 라인을 가지런히 지키면 침투가 걸려요." }
];

/* 비교 막대에 쓰는 지표 (순서 = 화면 순서) */
export const VS_KEYS = ["poss", "passRate", "shots", "finish", "gf", "ga", "throughRatio", "longShot", "dribble", "tackleRate"];

function versus(op, me, base) {
  const bars = VS_KEYS.filter((k) => op.m[k] != null && me.m[k] != null).map((k) => ({
    k, label: METRICS[k].label, opp: fmtV(k, op.m[k]), me: fmtV(k, me.m[k]),
    oppRaw: op.m[k], meRaw: me.m[k], avg: base && base[k] ? fmtV(k, base[k].mean) : null
  }));
  const items = [];
  for (const r of MATCHUPS) {
    const [ok, od] = r.opp, [mk, md] = r.me;
    const zo = op.z[ok], zm = me.z[mk];
    if (zo == null || zm == null || od * zo < Z_HI || md * zm < Z_ME) continue;
    items.push({ kind: r.kind, s: od * zo + md * zm, text: r.text,
      oppLabel: METRICS[ok].label, oppV: fmtV(ok, op.m[ok]), meLabel: METRICS[mk].label, meV: fmtV(mk, me.m[mk]),
      avgO: base && base[ok] ? fmtV(ok, base[ok].mean) : null, avgM: base && base[mk] ? fmtV(mk, base[mk].mean) : null });
  }
  // 시간대 맞물림
  const oG = peakBucket(op.gf), mA = peakBucket(me.ga), oA = peakBucket(op.ga), mG = peakBucket(me.gf);
  if (oG && mA && oG.i === mA.i)
    items.push({ kind: "caution", s: 3, time: true, text: `${oG.label}분: 상대 득점이 가장 많은 구간이 내 실점 최다 구간과 같아요 → 이 시간엔 무리하게 올라가지 마세요.`,
      oppLabel: "상대 득점", oppV: `${oG.n}/${oG.total}골`, meLabel: "내 실점", meV: `${mA.n}/${mA.total}골` });
  if (oA && mG && oA.i === mG.i)
    items.push({ kind: "chance", s: 3, time: true, text: `${oA.label}분: 상대가 가장 많이 실점하는 구간이 내 득점 최다 구간과 같아요 → 이 시간에 몰아치세요.`,
      oppLabel: "상대 실점", oppV: `${oA.n}/${oA.total}골`, meLabel: "내 득점", meV: `${mG.n}/${mG.total}골` });
  const sort = (kind) => items.filter((x) => x.kind === kind).sort((a, b) => b.s - a.s).slice(0, MAX_ITEMS);
  return { bars, cautions: sort("caution"), chances: sort("chance") };
}

/* 메인 — oppRows/myRows: guideRows, base: 랭커 기준값 stats. myRows 없으면 비교 생략 */
export function buildScout(oppRows, base, myRows) {
  const op = profileOf(oppRows, base);
  if (op.games < SCOUT_MIN_GAMES) return { v: SCOUT_VERSION, games: op.games, minGames: SCOUT_MIN_GAMES };
  const threats = pick(THREAT, op, base).slice(0, MAX_ITEMS);
  const holes = pick(HOLE, op, base).filter((h) => !(h.key === "effRate" && threats.some((t) => t.key === "finish"))).slice(0, MAX_ITEMS);
  // 시간대 항목은 지표 항목 다음에 붙임
  const tG = peakBucket(op.gf), tA = peakBucket(op.ga);
  if (tG) threats.push({ s: 0, key: "timeFor", head: `${tG.label}분에 골이 몰림`, tip: "이 시간대엔 수비 숫자를 줄이지 마세요.", label: "득점 비중", v: `${pct(tG.share)} (${tG.n}/${tG.total}골)`, avg: null });
  if (tA) holes.push({ s: 0, key: "timeAgainst", head: `${tA.label}분에 실점이 몰림`, tip: "이 시간대에 공격 숫자를 늘려 몰아치세요.", label: "실점 비중", v: `${pct(tA.share)} (${tA.n}/${tA.total}골)`, avg: null });
  const me = myRows ? profileOf(myRows, base) : null;
  const n = op.games;
  return {
    v: SCOUT_VERSION, games: n,
    record: { w: op.w, d: op.d, l: op.l, gf: (op.m.gf).toFixed(1), ga: (op.m.ga).toFixed(1), winRate: Math.round((op.w / n) * 100) },
    tactics: tactics(op, base),
    threats,   // 지표 최대 3 + 시간대 1
    holes,
    goalTime: { buckets: GOAL_BUCKETS.slice(0, 6), gf: op.gf.slice(0, 6), ga: op.ga.slice(0, 6) },
    vs: me && me.games >= SCOUT_MIN_GAMES ? { games: me.games, ...versus(op, me, base) } : null,
    myGames: me ? me.games : 0
  };
}
