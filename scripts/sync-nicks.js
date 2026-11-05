/* ============================================================
   sync-nicks.js — 인게임 닉네임 변경 자동 반영 (v2.29.1, 사용자 요청 "닉 바꾼 사람 캐치 못하나?")
   - 모든 수집·집계는 ouid(넥슨 계정 고유값) 기준이라 닉을 바꿔도 경기 기록은 계속 쌓임.
     다만 화면 표시 닉은 members.json ingameNick(등록 당시 닉)이라 바뀐 닉이 반영되지 않았음.
   - collect.js가 2시간마다 넥슨 basic API로 받은 현재 닉(data/profiles.json)과 비교해
     다르면 members.json ingameNick을 바꾸고 예전 닉은 prevNicks(최근 5개)에 남김 → 예전 닉으로도 검색됨
   - collect.yml: 수집 → 이 스크립트 → 집계(바뀐 닉으로 집계) 순서로 실행
   - 실행: node scripts/sync-nicks.js [--dry]
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREV_MAX = 5;

/* membersFile·profilesFile(객체) → 바뀐 목록 [{ ouid, from, to }] (membersFile을 직접 수정) */
export function syncNicks(membersFile, profilesFile) {
  const profiles = (profilesFile && profilesFile.profiles) || {};
  const changes = [];
  for (const m of (membersFile && membersFile.members) || []) {
    const now = m.ouid && profiles[m.ouid] && profiles[m.ouid].nickname;
    if (!now || typeof now !== "string" || now === m.ingameNick) continue;   // 조회 실패(닉 없음)면 그대로
    const prev = [m.ingameNick, ...(m.prevNicks || [])].filter((n) => n && n !== now);
    m.prevNicks = [...new Set(prev)].slice(0, PREV_MAX);
    changes.push({ ouid: m.ouid, from: m.ingameNick, to: now });
    m.ingameNick = now;
  }
  return changes;
}

function main() {
  const mf = path.join(ROOT, "data/members.json");
  const members = JSON.parse(fs.readFileSync(mf, "utf8"));
  let profiles = null;
  try { profiles = JSON.parse(fs.readFileSync(path.join(ROOT, "data/profiles.json"), "utf8")); }
  catch (e) { console.warn("profiles.json 없음 — 닉 동기화 건너뜀:", e.message); return; }
  const changes = syncNicks(members, profiles);
  if (!changes.length) { console.log("닉네임 변경 없음"); return; }
  changes.forEach((c) => console.log(`✏️ 닉 변경: ${c.from} → ${c.to} (${c.ouid.slice(0, 8)})`));
  if (process.argv.includes("--dry")) return;
  members.meta = members.meta || {};
  members.meta.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(mf, JSON.stringify(members, null, 2) + "\n");
  console.log(`✅ members.json 갱신 — ${changes.length}명`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
