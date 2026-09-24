/* ============================================================
   playstyle.js — 플레이스타일 지표·판정 공용 로직
   - collect.js: 매치 상세 → 경기별 원본 카운트(styleRaw) 저장
   - ranker-baseline.js: 랭커 샘플 지표 → 평균·표준편차(기준값)
   - aggregate.js: 클럽원 지표를 기준값과 비교(Z점수) → 높은/낮은 지표 3개씩 + 스타일 판정
   설계: 비율 지표는 '경기별 비율의 평균'이 아니라 '합계 ÷ 합계'로 계산(표본 적은 경기의 왜곡 방지)
   ============================================================ */

/* 매치 상세의 한쪽(me) + 상대(opp) → 저장용 원본 카운트 (키를 짧게 해 파일 크기 절약) */
export function styleRaw(me, opp) {
  if (!me) return null;
  const md = me.matchDetail || {}, sh = me.shoot || {}, ps = me.pass || {}, df = me.defence || {};
  return {
    end: md.matchEndType ?? 0,                       // 0 정상 종료, 1·2 몰수(집계 제외)
    pos: md.possession ?? 0, rt: md.averageRating ?? 0, dr: md.dribble ?? 0,
    off: md.offsideCount ?? 0, ck: md.cornerKick ?? 0, fl: md.foul ?? 0,
    cd: (md.yellowCards ?? 0) + (md.redCards ?? 0),
    pT: ps.passTry ?? 0, pS: ps.passSuccess ?? 0, spT: ps.shortPassTry ?? 0, lpT: ps.longPassTry ?? 0,
    tpT: ps.throughPassTry ?? 0, lobT: (ps.bouncingLobPassTry ?? 0) + (ps.lobbedThroughPassTry ?? 0),
    sT: sh.shootTotal ?? 0, eS: sh.effectiveShootTotal ?? 0, g: sh.goalTotal ?? 0,
    gH: sh.goalHeading ?? 0, sO: sh.shootOutPenalty ?? 0, gO: sh.goalOutPenalty ?? 0, gI: sh.goalInPenalty ?? 0,
    gSet: (sh.goalFreekick ?? 0) + (sh.goalPenaltyKick ?? 0),
    tT: df.tackleTry ?? 0, tS: df.tackleSuccess ?? 0, bT: df.blockTry ?? 0,
    ga: (opp && opp.shoot && opp.shoot.goalTotal) ?? 0
  };
}

/* 지표 정의 — unit '%'는 0~1 비율(화면에서 ×100), 나머지는 경기당 수치 */
export const METRICS = {
  poss:        { label: "점유율",         unit: "avg%" },
  passRate:    { label: "패스 성공률",    unit: "%" },
  shortRatio:  { label: "짧은 패스 비율", unit: "%" },
  longRatio:   { label: "롱패스 비율",    unit: "%" },
  throughRatio:{ label: "스루패스 비율",  unit: "%" },
  lobRatio:    { label: "띄우는 패스 비율", unit: "%" },
  shots:       { label: "경기당 슈팅",    unit: "" },
  effRate:     { label: "유효슈팅 비율",  unit: "%" },
  finish:      { label: "결정력",         unit: "%" },
  headGoal:    { label: "헤더골 비율",    unit: "%" },
  longShot:    { label: "중거리 슈팅 비율", unit: "%" },
  longGoal:    { label: "중거리골 비율",  unit: "%" },
  boxGoal:     { label: "박스안골 비율",  unit: "%" },
  setGoal:     { label: "세트피스골",     unit: "" },
  dribble:     { label: "경기당 드리블",  unit: "" },
  offside:     { label: "오프사이드",     unit: "" },
  corner:      { label: "코너킥",         unit: "" },
  tackleTry:   { label: "태클 시도",      unit: "" },
  tackleRate:  { label: "태클 성공률",    unit: "%" },
  block:       { label: "블락 시도",      unit: "" },
  foul:        { label: "파울",           unit: "" },
  cards:       { label: "카드",           unit: "" },
  gf:          { label: "경기당 득점",    unit: "" },
  ga:          { label: "경기당 실점",    unit: "" },
  rating:      { label: "평균 평점",      unit: "" }
};

/* 원본 카운트 배열(정상 종료 경기만 넘길 것) → 지표 값 */
export function computeMetrics(raws) {
  const S = {};
  for (const r of raws) for (const [k, v] of Object.entries(r)) S[k] = (S[k] || 0) + (v || 0);
  const n = raws.length;
  const r = (a, b) => (b ? a / b : 0);
  return {
    poss: S.pos / n, passRate: r(S.pS, S.pT), shortRatio: r(S.spT, S.pT), longRatio: r(S.lpT, S.pT),
    throughRatio: r(S.tpT, S.pT), lobRatio: r(S.lobT, S.pT),
    shots: S.sT / n, effRate: r(S.eS, S.sT), finish: r(S.g, S.sT),
    headGoal: r(S.gH, S.g), longShot: r(S.sO, S.sT), longGoal: r(S.gO, S.g), boxGoal: r(S.gI, S.g),
    setGoal: S.gSet / n, dribble: S.dr / n, offside: S.off / n, corner: S.ck / n,
    tackleTry: S.tT / n, tackleRate: r(S.tS, S.tT), block: S.bT / n,
    foul: S.fl / n, cards: S.cd / n, gf: S.g / n, ga: S.ga / n, rating: S.rt / n
  };
}

/* 여러 사람의 지표 → 지표별 평균·표준편차 (기준값) */
export function baselineStats(metricsList) {
  const out = {};
  for (const k of Object.keys(METRICS)) {
    const v = metricsList.map((m) => m[k]);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
    out[k] = { mean, sd: sd || 1 };
  }
  return out;
}

/* 스타일 규칙: [이름, 한 줄 문구, 조건] — '지표+' = 랭커보다 높음, '지표-' = 낮음
   조건의 첫 번째는 '핵심 지표' — 반드시 충족해야 해당 스타일 후보가 됨(부가 조건만으로 이름과 안 맞는 스타일이 붙는 것 방지) */
export const STYLES = [
  ["뚝배기 원툴", "그냥 패스보다 크로스를 잘하는 뚝배기 원툴", ["headGoal+", "lobRatio+", "passRate-"]],
  ["티키타카 장인", "공은 내 거, 상대는 90분 구경꾼", ["poss+", "passRate+", "shortRatio+"]],
  ["점유율 수집가", "공은 실컷 돌리는데 슈팅은 0개인 박물관 축구", ["poss+", "passRate+", "shots-"]],
  ["역습 저격수", "공 주고 기다리다 한 방에 끝낸다", ["poss-", "longRatio+", "finish+"]],
  ["스루패스 중독자", "스루패스 버튼 닳는 오프사이드 제조기", ["throughRatio+", "offside+", "passRate-"]],
  ["킬패스 마에스트로", "스루패스 한 번에 수비 라인 해체", ["throughRatio+", "passRate+", "finish+"]],
  ["중거리 스나이퍼", "박스 밖이 곧 내 슈팅 존", ["longShot+", "longGoal+", "finish+"]],
  ["관중석 기념품 배달부", "오늘도 관중석에 공 한 개 선물", ["longShot+", "effRate-", "finish-"]],
  ["박스 안 포식자", "골대 앞 3m만 믿는 냉혈 사냥꾼", ["boxGoal+", "finish+", "longShot-"]],
  ["슈팅 난사범", "열 번 쏘면 한 번은 들어간다는 믿음", ["shots+", "effRate-", "finish-"]],
  ["가성비 스트라이커", "적게 쏘고 많이 넣는 원샷원킬", ["shots-", "effRate+", "finish+"]],
  ["드리블 메시", "패스? 내가 직접 들고 간다", ["dribble+", "boxGoal+", "throughRatio-"]],
  ["개인기 연구원", "개인기는 화려한데 결과는 미스터리", ["dribble+", "passRate-", "finish-"]],
  ["수비 교과서", "발만 쏙, 깔끔하게 뺏는 정석 수비", ["tackleTry+", "tackleRate+", "foul-"]],
  ["도륙 정신 계승자", "공 아니면 발목, 클럽명에 충실한 남자", ["tackleTry+", "foul+", "cards+"]],
  ["버스 기사", "골문 앞에 버스 두 대 세워두는 텐백 장인", ["block+", "ga-", "poss-"]],
  ["24시 무인 자동문", "우리 골문은 연중무휴 개방", ["ga+", "tackleRate-", "block-"]],
  ["불꽃 난타전", "5:4 아니면 재미없는 공격 축구", ["gf+", "ga+", "shots+"]],
  ["짠물 1:0 장인", "1:0이면 충분, 재미는 상대 몫", ["ga-", "shots-", "gf-"]],
  ["데드볼 장인", "필드골보다 세트피스가 편하다", ["corner+", "headGoal+", "setGoal+"]],
  ["프리킥 스페셜리스트", "파울만 얻으면 반은 골", ["setGoal+", "longGoal+", "boxGoal-"]],
  ["로빙스루 마술사", "머리 위로 넘기는 한 방 로빙스루", ["lobRatio+", "finish+", "shortRatio-"]],
  ["반 박자 빠른 사나이", "라인 끝에서 늘 한 발 먼저 출발", ["offside+", "throughRatio+", "finish-"]],
  ["육각형 올라운더", "공수 다 되는 사기캐", ["rating+", "passRate+", "tackleRate+"]],
  ["순수 골잡이", "골만 넣고 나머지는 모르는 공격수", ["gf+", "passRate-", "tackleTry-"]],
  ["빌드업 생략파", "미드필더 생략, 골키퍼에서 공격수로 직행", ["longRatio+", "shortRatio-", "poss-"]],
  ["측면 크랙", "측면 끝까지 파고들어 올려주는 윙어 장인", ["lobRatio+", "corner+", "dribble+"]],
  ["안전제일 공무원", "리스크 제로, 칼퇴 보장 공무원 축구", ["passRate+", "dribble-", "foul-"]],
  ["돌격대장", "생각보다 발이 먼저 나가는 돌격대장", ["shots+", "dribble+", "passRate-"]],
  ["땅볼 중거리파", "크로스는 사치, 박스 밖에서 깔아 차는 낮은 탄도 장인", ["longShot+", "lobRatio-", "headGoal-"]]
];
export const DEFAULT_STYLE = ["무난함의 정석", "모든 지표가 랭커 평균, 무난함 그 자체"];

const HIT_Z = 0.5;   // 조건 '충족'으로 보는 최소 편차(표준편차 0.5배)
const MIN_HITS = 2;  // 3개 조건 중 최소 충족 수(핵심 지표 포함) — 미달이면 기본 스타일

/* 지표 값 + 기준값 → 높은/낮은 지표 3개씩과 스타일 */
export function judge(metrics, baseline) {
  const zs = Object.keys(METRICS).map((k) => ({
    k, v: metrics[k], avg: baseline[k].mean, z: (metrics[k] - baseline[k].mean) / baseline[k].sd
  })).sort((a, b) => b.z - a.z);
  const zm = Object.fromEntries(zs.map((x) => [x.k, x.z]));

  // 핵심 지표 충족 스타일 중 조건 충족 수 우선, 동점이면 방향 반영 Z 합이 큰 스타일
  const best = STYLES.map(([name, line, conds]) => {
    const parts = conds.map((c) => (c.endsWith("+") ? 1 : -1) * zm[c.slice(0, -1)]);
    return { name, line, conds, core: parts[0] >= HIT_Z,
      hits: parts.filter((x) => x >= HIT_Z).length, score: parts.reduce((a, b) => a + b, 0) };
  }).filter((x) => x.core).sort((a, b) => b.hits - a.hits || b.score - a.score)[0];

  const pick = best && best.hits >= MIN_HITS ? best : { name: DEFAULT_STYLE[0], line: DEFAULT_STYLE[1], conds: [] };
  const round = (x) => Math.round(x * 1000) / 1000;
  // label·unit도 함께 담아 화면(js/members.js)이 지표 정의를 중복 보유하지 않게 함
  const slim = (x) => ({ k: x.k, label: METRICS[x.k].label, unit: METRICS[x.k].unit,
    v: round(x.v), avg: round(x.avg), z: Math.round(x.z * 100) / 100 });
  return {
    style: { name: pick.name, line: pick.line, conds: pick.conds },
    highs: zs.slice(0, 3).map(slim),
    lows: zs.slice(-3).reverse().map(slim)
  };
}
