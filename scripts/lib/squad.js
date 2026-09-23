/* ============================================================
   squad.js — 스쿼드(최근 경기 라인업) 공통 로직
   넥슨 API는 '현재 스쿼드'를 직접 제공하지 않으므로,
   회원의 가장 최근 수집 경기 라인업을 현재 스쿼드로 간주한다.
   collect.js(필요 메타 추출)와 aggregate.js(squads.json 생성)가 같은 기준을 쓰도록 공유.
   ============================================================ */

export const SUB_POSITION = 28; // spposition 28 = SUB(교체)

/* 최신순 정렬된 매치 목록에서 라인업이 있는 가장 최근 경기 */
export function latestLineupMatch(matches) {
  return (matches || []).find((m) => Array.isArray(m.lineup) && m.lineup.length) || null;
}

/* spId 앞 3자리 = 시즌 id, 뒤 6자리 = 선수 고유 pid */
export const seasonIdOf = (spId) => Math.floor(spId / 1000000);
export const pidOf = (spId) => spId % 1000000;

/* "ICON TM (ICON The Moment)" → "ICON TM" (괄호 앞 약칭) */
export function shortSeasonName(className) {
  return String(className || "").split(" (")[0].trim();
}

/* 포지션 라인 → 포메이션 문자열 (예: 4-2-3-1)
   - 수비(1~8) / 수미(9~11) / 중앙미드(13~15) / 측면미드(12,16) / 공미(17~19) / 처진공격(20~22) / 최전방(23~27)
   - 측면미드는 중앙미드가 있으면 그 줄에, 없고 공미가 있으면 공미 줄에 합침
     (LM·CAM·RM → '3', LM·LCM·RCM·RM → '4' 처럼 게임 표기와 맞추기 위함)
   - 처진공격(CF 등)은 최전방(ST·윙)이 3명 이상일 때만 별도 줄(예: CF+RW·ST·LW → 4-2-1-3),
     아니면 최전방 줄에 합침(예: RF+LS 투톱 → 2) */
export function formationOf(starters) {
  const cnt = { def: 0, dm: 0, cm: 0, wide: 0, am: 0, cf: 0, fw: 0 };
  for (const p of starters) {
    const s = p.spPosition;
    if (s >= 1 && s <= 8) cnt.def++;
    else if (s >= 9 && s <= 11) cnt.dm++;
    else if (s === 12 || s === 16) cnt.wide++;
    else if (s >= 13 && s <= 15) cnt.cm++;
    else if (s >= 17 && s <= 19) cnt.am++;
    else if (s >= 20 && s <= 22) cnt.cf++;
    else if (s >= 23 && s <= 27) cnt.fw++;
  }
  if (cnt.cm) cnt.cm += cnt.wide;
  else if (cnt.am) cnt.am += cnt.wide;
  else cnt.cm = cnt.wide;
  if (cnt.fw < 3) { cnt.fw += cnt.cf; cnt.cf = 0; }
  return [cnt.def, cnt.dm, cnt.cm, cnt.am, cnt.cf, cnt.fw].filter((n) => n > 0).join("-");
}
