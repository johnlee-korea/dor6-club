/* ============================================================
   playstyle.js — 플레이스타일 지표·판정 공용 로직
   - collect.js: 매치 상세 → 경기별 원본 카운트(styleRaw) 저장
   - ranker-baseline.js: 랭커 샘플 지표 → 평균·표준편차(기준값)
   - aggregate.js: 클럽원 지표를 기준값과 비교(Z점수) → 높은/낮은 지표 3개씩 + 스타일 판정
   설계: 비율 지표는 '경기별 비율의 평균'이 아니라 '합계 ÷ 합계'로 계산(표본 적은 경기의 왜곡 방지)
   스타일은 화면에 보이는 ▲3·▼3 지표 안에서만 판정 → 칩과 스타일 문구가 항상 일치
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

/* 지표 정의 — unit '%'는 0~1 비율(화면에서 ×100), 'avg%'는 이미 % 값, 나머지는 경기당 수치
   desc: 화면 '지표 기준' 안내에 그대로 노출되는 계산식 */
export const METRICS = {
  poss:        { label: "점유율",           unit: "avg%", desc: "경기별 볼 점유율 평균" },
  passRate:    { label: "패스 성공률",      unit: "%", desc: "패스 성공 ÷ 패스 시도" },
  shortRatio:  { label: "짧은 패스 비율",   unit: "%", desc: "짧은 패스 시도 ÷ 전체 패스 시도" },
  longRatio:   { label: "롱패스 비율",      unit: "%", desc: "롱패스 시도 ÷ 전체 패스 시도" },
  throughRatio:{ label: "스루패스 비율",    unit: "%", desc: "스루패스 시도 ÷ 전체 패스 시도" },
  lobRatio:    { label: "띄우는 패스 비율", unit: "%", desc: "(로빙 패스 + 로빙 스루) 시도 ÷ 전체 패스 시도 — 넥슨 API에 크로스 수치가 없어 대신 사용" },
  shots:       { label: "경기당 슈팅",      unit: "", desc: "슈팅 수 ÷ 경기 수" },
  effRate:     { label: "유효슈팅 비율",    unit: "%", desc: "유효슈팅 ÷ 슈팅" },
  finish:      { label: "결정력",           unit: "%", desc: "골 ÷ 슈팅" },
  headGoal:    { label: "헤더골 비율",      unit: "%", desc: "헤더골 ÷ 전체 골" },
  longShot:    { label: "중거리 슈팅 비율", unit: "%", desc: "박스 밖 슈팅 ÷ 전체 슈팅" },
  longGoal:    { label: "중거리골 비율",    unit: "%", desc: "박스 밖 골 ÷ 전체 골" },
  boxGoal:     { label: "박스안골 비율",    unit: "%", desc: "박스 안 골 ÷ 전체 골" },
  setGoal:     { label: "세트피스골",       unit: "", desc: "(프리킥 골 + PK 골) ÷ 경기 수" },
  dribble:     { label: "경기당 드리블",    unit: "", desc: "드리블 거리(넥슨 dribble 값) ÷ 경기 수" },
  offside:     { label: "오프사이드",       unit: "", desc: "오프사이드 ÷ 경기 수" },
  corner:      { label: "코너킥",           unit: "", desc: "코너킥 ÷ 경기 수" },
  tackleTry:   { label: "태클 시도",        unit: "", desc: "태클 시도 ÷ 경기 수" },
  tackleRate:  { label: "태클 성공률",      unit: "%", desc: "태클 성공 ÷ 태클 시도" },
  block:       { label: "블락 시도",        unit: "", desc: "블락 시도 ÷ 경기 수" },
  foul:        { label: "파울",             unit: "", desc: "파울 ÷ 경기 수" },
  cards:       { label: "카드",             unit: "", desc: "(옐로 + 레드) ÷ 경기 수" },
  gf:          { label: "경기당 득점",      unit: "", desc: "득점 ÷ 경기 수" },
  ga:          { label: "경기당 실점",      unit: "", desc: "실점 ÷ 경기 수" },
  rating:      { label: "평균 평점",        unit: "", desc: "경기별 선수 평균 평점의 평균" }
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

/* ---------- 스타일 규칙 ----------
   표기: '지표+' = 랭커보다 높음(▲ 칩), '지표-' = 낮음(▼ 칩)
   ① COMBO_STYLES: 두 조건이 모두 화면의 ▲3·▼3 칩에 있을 때만 후보 — 단일보다 우선
   ② SINGLE_STYLES: 25개 지표 × 높음/낮음 = 50개 — 조합이 없을 때 편차가 가장 큰 칩 하나로 판정(항상 매칭 보장)
   문구 수정·추가는 이 두 표만 편집하면 됨 */
export const SINGLE_STYLES = {
  "poss+": ["점유율 지배자", "공은 내 거, 상대는 90분 구경꾼"],
  "poss-": ["공 양보왕", "점유율은 상대 줘, 난 결과만 가져간다"],
  "passRate+": ["정밀 배송기사", "패스 하나하나가 택배처럼 정확 배송"],
  "passRate-": ["패스 복권러", "이 패스… 받으면 좋고 아님 말고"],
  "shortRatio+": ["발밑 패스 장인", "한 칸씩 또박또박, 짧은 패스 성애자"],
  "shortRatio-": ["짧은 패스 거부자", "옆으로 툭툭 주는 건 성미에 안 맞아"],
  "longRatio+": ["대포알 롱패스", "하프라인 넘기는 건 기본, 전환의 달인"],
  "longRatio-": ["롱패스 금지령", "멀리 차는 건 불안해, 가까운 동료부터"],
  "throughRatio+": ["스루패스 중독자", "틈만 보이면 찔러 넣는 스루 성애자"],
  "throughRatio-": ["스루 아끼는 신중파", "찔러줄 타이밍? 아직 아니야"],
  "lobRatio+": ["공중 배달부", "공은 하늘로, 크로스·로빙이 주무기"],
  "lobRatio-": ["땅볼 신봉자", "공이 뜨면 불안해, 크로스는 사치"],
  "shots+": ["슈팅 머신", "기회만 나면 일단 때리고 본다"],
  "shots-": ["슈팅 아끼는 수도승", "확실할 때만 쏜다, 슈팅은 신중하게"],
  "effRate+": ["골문 저격수", "쏘면 일단 골문 안으로, 유효슈팅 장인"],
  "effRate-": ["관중석 기념품 배달부", "오늘도 관중석에 공 한 개 선물"],
  "finish+": ["원샷원킬", "한 번 쏘면 골, 냉혈 피니셔"],
  "finish-": ["골대 수집가", "만들긴 잘하는데 마무리가 아쉬운 형"],
  "headGoal+": ["뚝배기 원툴", "골은 머리로 넣는 것"],
  "headGoal-": ["헤더 포기자", "머리는 생각할 때만 쓴다"],
  "longShot+": ["중거리 애호가", "박스 밖이 곧 내 슈팅 존"],
  "longShot-": ["박스 입장 필수", "박스 안 아니면 안 쏜다"],
  "longGoal+": ["원더골 제조기", "골 하이라이트는 늘 박스 밖에서"],
  "longGoal-": ["중거리 무득점", "중거리골은 남의 얘기"],
  "boxGoal+": ["박스 안 포식자", "골대 앞 3m만 믿는 사냥꾼"],
  "boxGoal-": ["박스 밖 해결사", "골은 멀리서도 터진다"],
  "setGoal+": ["데드볼 장인", "프리킥·PK만 얻으면 반은 골"],
  "setGoal-": ["필드골 순수주의자", "세트피스? 골은 흐름 속에서 넣는 것"],
  "dribble+": ["드리블 메시", "패스? 내가 직접 들고 간다"],
  "dribble-": ["원터치 플레이어", "공 오래 끄는 건 질색, 바로바로 처리"],
  "offside+": ["오프사이드 제조기", "라인 끝에서 늘 한 발 먼저 출발"],
  "offside-": ["라인 지킴이", "침투 타이밍 칼같이 지키는 모범생"],
  "corner+": ["코너킥 공장장", "측면을 파고들어 코너킥을 뽑아낸다"],
  "corner-": ["코너킥 무소식", "코너킥? 그게 뭐죠"],
  "tackleTry+": ["태클 광전사", "보이면 일단 발부터 넣는다"],
  "tackleTry-": ["태클 절약형", "태클은 아껴두는 거야"],
  "tackleRate+": ["수비 교과서", "발만 쏙, 깔끔하게 뺏는 정석 수비"],
  "tackleRate-": ["헛발 태클러", "태클은 했는데 공은 그대로"],
  "block+": ["몸빵 수비수", "슈팅은 내 몸으로 막는다"],
  "block-": ["블락 면제", "슈팅 막는 건 키퍼 몫"],
  "foul+": ["파울 트러블메이커", "공 아니면 발목, 도륙 정신 계승자"],
  "foul-": ["신사 플레이어", "심판이 필요 없는 매너 축구"],
  "cards+": ["카드 수집가", "옐로카드도 소중한 수집품"],
  "cards-": ["클린 플레이어", "카드 한 장 없는 깨끗한 축구"],
  "gf+": ["득점 기계", "경기마다 골이 쏟아지는 화력 담당"],
  "gf-": ["골 가뭄", "골 넣기가 이렇게 어렵다니"],
  "ga+": ["24시 무인 자동문", "우리 골문은 연중무휴 개방"],
  "ga-": ["통곡의 벽", "우리 골문은 좀처럼 열리지 않는다"],
  "rating+": ["평점 에이스", "선수 평점이 증명하는 경기력"],
  "rating-": ["평점 테러범", "선수들이 울고 있다"]
};

export const COMBO_STYLES = [
  // 빌드업
  ["티키타카 장인", "공은 내 거, 패스는 정확, 상대는 구경꾼", ["poss+", "passRate+"]],
  ["원터치 티키타카", "짧게 주고 바로 뿌리는 원터치 패스 축구", ["shortRatio+", "dribble-"]],
  ["점유율 수집가", "공은 실컷 돌리는데 슈팅은 아끼는 박물관 축구", ["poss+", "shots-"]],
  ["공 돌리다 한 방", "점유하다 틈이 보이면 바로 찔러 넣는다", ["poss+", "throughRatio+"]],
  ["빌드업 생략파", "미드필더 생략, 골키퍼에서 공격수로 직행", ["longRatio+", "shortRatio-"]],
  ["역습 대포", "공은 넘겨주고, 뺏으면 롱패스로 한 번에", ["poss-", "longRatio+"]],
  ["역습 저격수", "공 주고 기다리다 한 방에 끝낸다", ["poss-", "finish+"]],
  ["선수비 후역습", "내주는 점유율, 안 내주는 골문", ["poss-", "ga-"]],
  ["점유율 롱볼러", "공은 오래 갖고, 찰 땐 멀리 찬다", ["poss+", "longRatio+"]],
  ["안전제일 공무원", "리스크 제로, 칼퇴 보장 공무원 축구", ["passRate+", "dribble-"]],
  ["패스보다 발", "패스는 불안해도 드리블은 자신 있다", ["dribble+", "passRate-"]],
  // 침투·스루
  ["오프사이드 공장", "스루패스 버튼 닳는 오프사이드 제조기", ["throughRatio+", "offside+"]],
  ["킬패스 마에스트로", "스루패스 한 번에 수비 라인 해체", ["throughRatio+", "finish+"]],
  ["스루 난사범", "찔러는 주는데 절반은 상대 발 앞", ["throughRatio+", "passRate-"]],
  ["반 박자 빠른 사나이", "라인 끝에서 늘 한 발 먼저, 마무리는 한 발 늦게", ["offside+", "finish-"]],
  ["깃발 무시 득점기", "오프사이드 몇 번 걸려도 결국 넣는다", ["offside+", "gf+"]],
  // 공중·측면
  ["뚝배기 크로스형", "패스보다 크로스, 골은 머리로", ["lobRatio+", "headGoal+"]],
  ["뚝배기 원툴", "그냥 패스보다 크로스를 잘하는 뚝배기 원툴", ["headGoal+", "passRate-"]],
  ["데드볼 헤더", "코너킥 뽑고 머리로 마무리", ["corner+", "headGoal+"]],
  ["측면 크랙", "측면 끝까지 파고들어 올려주는 윙어 장인", ["lobRatio+", "corner+"]],
  ["로빙스루 마술사", "머리 위로 넘기는 한 방 로빙스루", ["lobRatio+", "finish+"]],
  ["땅볼 중거리파", "크로스는 사치, 박스 밖에서 깔아 차는 낮은 탄도 장인", ["longShot+", "lobRatio-"]],
  ["발로만 해결", "머리 대신 발, 박스 밖에서도 해결한다", ["longShot+", "headGoal-"]],
  // 슈팅·마무리
  ["중거리 스나이퍼", "박스 밖이 곧 내 슈팅 존, 실제로 들어간다", ["longShot+", "longGoal+"]],
  ["중거리 대포", "박스 밖에서도 골문 안으로 꽂는다", ["longShot+", "effRate+"]],
  ["관중석 기념품 배달부", "중거리 한 방이 관중석으로 선물", ["longShot+", "finish-"]],
  ["관중석 VIP 배송", "박스 밖에서 쏘고 관중석으로 배송 완료", ["longShot+", "effRate-"]],
  ["박스 안 포식자", "골대 앞 3m만 믿는 냉혈 사냥꾼", ["boxGoal+", "longShot-"]],
  ["박스 안 결정자", "박스 안에 들어오면 반드시 넣는다", ["boxGoal+", "finish+"]],
  ["프리킥 스페셜리스트", "파울만 얻으면 반은 골, 멀리서도 넣는다", ["setGoal+", "longGoal+"]],
  ["슈팅 난사범", "열 번 쏘면 한 번은 들어간다는 믿음", ["shots+", "finish-"]],
  ["막 쏘는 형", "일단 쏘고 본다, 방향은 운에 맡긴다", ["shots+", "effRate-"]],
  ["가성비 스트라이커", "적게 쏘고 많이 넣는 원샷원킬", ["shots-", "finish+"]],
  ["신중한 저격수", "아껴 쏘는 만큼 골문 안으로", ["shots-", "effRate+"]],
  ["냉혈 피니셔", "골문 안으로 쏘고, 쏘면 들어간다", ["effRate+", "finish+"]],
  ["화력 폭격기", "쉴 새 없이 쏘고 쉴 새 없이 넣는다", ["shots+", "gf+"]],
  ["파상공세", "슈팅에 코너킥까지, 쉴 새 없이 두드린다", ["shots+", "corner+"]],
  ["닥공 노수비", "공격은 최선의 방어… 는 아니었다", ["shots+", "ga+"]],
  ["앞만 보는 공격수", "쏘고 또 뛰어들고, 라인은 신경 안 쓴다", ["shots+", "offside+"]],
  ["박스 밖 전문가", "박스 밖에서 쏘고, 박스 밖에서 넣는다", ["longShot+", "boxGoal-"]],
  ["돌격대장", "드리블로 밀고 들어가 일단 쏜다", ["dribble+", "shots+"]],
  ["원맨쇼", "패스는 필요 없다, 혼자 들고 가서 넣는다", ["dribble+", "throughRatio-"]],
  ["골 가뭄 심화", "쏴도 안 들어가고 골도 안 난다", ["gf-", "finish-"]],
  ["순수 골잡이", "골만 넣고 패스는 모르는 공격수", ["gf+", "passRate-"]],
  // 수비·매너
  ["도륙 정신 계승자", "공 아니면 발목, 클럽명에 충실한 수비", ["tackleTry+", "foul+"]],
  ["카드 컬렉터", "파울에 카드까지, 심판과 친한 사이", ["foul+", "cards+"]],
  ["태클 장인", "많이 들어가고 많이 뺏는 진짜 수비", ["tackleTry+", "tackleRate+"]],
  ["신사 수비수", "파울 없이 깔끔하게 뺏는 매너 수비", ["tackleRate+", "foul-"]],
  ["버스 기사", "골문 앞에 버스 세우고 몸으로 막는다", ["block+", "ga-"]],
  ["무인 자동문", "태클은 헛발, 골문은 활짝", ["ga+", "tackleRate-"]],
  ["블락 없는 골문", "슈팅 막는 사람이 없는 오픈 골대", ["ga+", "block-"]],
  ["불꽃 난타전", "5:4 아니면 재미없는 공격 축구", ["gf+", "ga+"]],
  ["짠물 1:0 장인", "1:0이면 충분, 재미는 상대 몫", ["ga-", "gf-"]],
  ["짠물 수비", "적게 쏘고 적게 먹는 실리 축구", ["ga-", "shots-"]],
  // 종합
  ["육각형 올라운더", "패스도 평점도 되는 사기캐", ["rating+", "passRate+"]],
  ["평점 캐리", "골로 평점까지 끌어올리는 에이스", ["rating+", "gf+"]],
  ["평점 폭락장", "실점에 평점까지 우울한 날들", ["rating-", "ga+"]]
];

export const DEFAULT_STYLE = ["무난함의 정석", "모든 지표가 랭커 평균, 무난함 그 자체"];
const MIN_Z = 0.5; // 칩 중 가장 큰 편차가 이보다 작으면(=전부 평균 근처) 기본 스타일

/* 지표 값 + 기준값 → 높은/낮은 지표 3개씩과 스타일(반드시 이 6개 칩 안에서 판정) */
export function judge(metrics, baseline) {
  const zs = Object.keys(METRICS).map((k) => ({
    k, v: metrics[k], avg: baseline[k].mean, z: (metrics[k] - baseline[k].mean) / baseline[k].sd
  })).sort((a, b) => b.z - a.z);
  const highs = zs.slice(0, 3), lows = zs.slice(-3).reverse();

  // 화면 칩 6개 → { '지표+': |z| } (▲는 z>0일 때만, ▼는 z<0일 때만 유효한 방향)
  const shown = {};
  for (const x of highs) if (x.z > 0) shown[x.k + "+"] = x.z;
  for (const x of lows) if (x.z < 0) shown[x.k + "-"] = -x.z;

  let pick = null;
  // ① 조합: 두 조건 모두 칩에 있는 것 중 편차 합이 가장 큰 스타일
  for (const [name, line, conds] of COMBO_STYLES) {
    if (!conds.every((c) => c in shown)) continue;
    const score = conds.reduce((a, c) => a + shown[c], 0);
    if (!pick || score > pick.score) pick = { name, line, basis: conds, score };
  }
  // ② 단일: 편차가 가장 큰 칩 하나
  if (!pick) {
    const [key, z] = Object.entries(shown).sort((a, b) => b[1] - a[1])[0] || [];
    if (key && z >= MIN_Z) pick = { name: SINGLE_STYLES[key][0], line: SINGLE_STYLES[key][1], basis: [key] };
  }
  if (!pick) pick = { name: DEFAULT_STYLE[0], line: DEFAULT_STYLE[1], basis: [] };

  const round = (x) => Math.round(x * 1000) / 1000;
  // label·unit도 함께 담아 화면(js/members.js)이 지표 정의를 중복 보유하지 않게 함, key=스타일 근거 칩 여부
  const slim = (x, dir) => ({ k: x.k, label: METRICS[x.k].label, unit: METRICS[x.k].unit,
    v: round(x.v), avg: round(x.avg), z: Math.round(x.z * 100) / 100, key: pick.basis.includes(x.k + dir) });
  return {
    style: { name: pick.name, line: pick.line, basis: pick.basis },
    highs: highs.map((x) => slim(x, "+")),
    lows: lows.map((x) => slim(x, "-"))
  };
}
