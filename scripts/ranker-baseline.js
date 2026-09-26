/* ============================================================
   ranker-baseline.js — 랭커 기준값 생성 (모드별)
   실행: node --env-file=.env scripts/ranker-baseline.js [--force] [--mode=official|manager]   (로컬)
         node scripts/ranker-baseline.js                                                      (CI, baseline.yml)
   동작: 데이터센터 랭킹 페이지에서 페이지마다 일정 간격으로 랭커 닉 샘플링 →
         각 랭커의 최근 경기 상세로 지표 계산 → 평균·표준편차 저장
     - official: 1on1 랭킹(rt=1vs1) · 공식경기(50)   → 팀 플레이스타일(stats) + 포지션 기준값 + xG 표
     - manager : 감독모드 랭킹(rt=manager) · 감독모드(52) → 포지션 기준값 + xG 표 (v2.2.0 구단운영)
     ※ v2.2.0 이전에는 공식 기준값을 감독모드 랭킹(rt=manager) 랭커의 공식경기로 만들던 버그가 있었음
   산출
     - data/meta/ranker-baseline.json : stats·positions(= official, 기존 화면 호환) + modes.{official,manager}.positions
     - data/meta/xg-model.json        : modes.{official,manager} = xG 표 + 랭커가 허용한 실점 루트 레인 비중
   주기: 기존 파일이 config.rankerBaseline.refreshDays 이내면 건너뜀(API 호출 절약)
   참고: 넥슨 오픈 API에는 랭킹 목록이 없어 FC온라인 데이터센터 랭킹 페이지(HTML)에서 닉네임을 읽는다
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setCallInterval, getOuidByNickname, getMatchIds, getMatchDetail } from "./lib/nexon-api.js";
import { styleRaw, computeMetrics, baselineStats } from "./lib/playstyle.js";
import { insightRaw, unitAverages, positionBaseline } from "./lib/insight.js";
import { buildXgModel, laneShares } from "./lib/manage.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "meta", "ranker-baseline.json");
const OUT_XG = path.join(ROOT, "data", "meta", "xg-model.json");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const opt = {
  pages: 50,          // 1페이지 = 20명 → 50페이지 = 상위 1000명
  perPage: 3,         // 페이지당 샘플 인원
  matchesPerUser: 15, // 랭커별 최근 경기 수
  minMatches: 5,      // 정상 종료 경기가 이보다 적은 랭커는 제외
  refreshDays: 7,
  ...(config.rankerBaseline || {})
};
const MODE_DEF = {
  official: { rt: "1vs1", matchtype: 50, label: "공식경기 1on1 랭킹", styles: true },
  manager:  { rt: "manager", matchtype: 52, label: "감독모드 랭킹", styles: false }
};
const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } };

/* 랭킹 페이지 한 장 → 닉네임 20개 */
async function rankPage(rt, pg) {
  const res = await fetch(`https://fconline.nexon.com/datacenter/rank_inner?rt=${rt}&n4pageno=${pg}`,
    { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`랭킹 페이지 ${rt} ${pg} 응답 ${res.status}`);
  const html = await res.text();
  return [...html.matchAll(/class="name profile_pointer"[^>]*>([^<]+)/g)].map((m) => m[1].trim());
}

/* 한 모드 샘플 수집 → 기준값. 표본 부족이면 null */
async function buildMode(mode) {
  const def = MODE_DEF[mode];
  const step = Math.floor(20 / opt.perPage);
  const nicks = [];
  for (let pg = 1; pg <= opt.pages; pg++) {
    try {
      const names = await rankPage(def.rt, pg);
      for (let i = 0; i < opt.perPage; i++) if (names[i * step]) nicks.push(names[i * step]);
    } catch (e) { console.warn(`  ${e.message}`); }
  }
  console.log(`▶ [${mode}] 랭커 샘플 ${nicks.length}명 — 최근 ${opt.matchesPerUser}경기씩 조회`);

  const styleList = [], units = [];
  const shots = [];      // xG 표용 — 양쪽 슈팅 전부 (같은 경기 중복 제외)
  const conceded = [];   // 랭커가 허용한 상대 슈팅 (실점 루트 평균)
  const seen = new Set();
  let ok = 0;
  for (const nick of nicks) {
    try {
      const ouid = await getOuidByNickname(nick);
      if (!ouid) continue;
      const ids = await getMatchIds(ouid, def.matchtype, 0, opt.matchesPerUser);
      const raws = [], pRows = [];
      for (const id of ids) {
        const d = await getMatchDetail(id).catch(() => null);
        const info = (d && d.matchInfo) || [];
        const me = info.find((i) => i.ouid === ouid), opp = info.find((i) => i.ouid !== ouid);
        const raw = styleRaw(me, opp);
        if (!raw || raw.end !== 0 || info.length !== 2) continue;
        raws.push(raw);
        pRows.push(...(insightRaw(me, opp).pStats || []));
        const sh = (side) => (side.shootDetail || []).map((x) => [x.x, x.y, x.type, x.result,
          x.assist ? x.assistX : null, x.assist ? x.assistY : null]);
        if (!seen.has(id)) { seen.add(id); shots.push(...sh(me), ...sh(opp)); }
        conceded.push(...sh(opp));
      }
      if (raws.length >= opt.minMatches) {
        ok++;
        if (def.styles) styleList.push(computeMetrics(raws));
        units.push(...unitAverages(pRows).values());   // 랭커끼리 섞지 않도록 랭커마다 따로 평균
      }
    } catch (e) { console.warn(`  [${mode}:${nick}] 실패: ${e.message}`); }
  }
  // 표본이 너무 적으면 이 모드는 기존 값 유지 (랭킹 페이지 구조 변경 등 대비)
  if (ok < 20) { console.warn(`⚠ [${mode}] 유효 랭커 ${ok}명 — 표본 부족, 기존 기준값 유지`); return null; }
  const xg = buildXgModel(shots);
  const lanes = laneShares(conceded, xg).share;
  console.log(`✅ [${mode}] 유효 랭커 ${ok}명 · 경기 ${seen.size} · 슈팅 ${shots.length}`);
  return {
    source: `${def.label} 1~${opt.pages * 20}위 샘플, 최근 ${opt.matchesPerUser}경기`,
    sampleSize: ok, matches: seen.size,
    stats: def.styles ? baselineStats(styleList) : undefined,
    positions: positionBaseline(units),
    xg: { ...xg, lanes }
  };
}

async function main() {
  const modeArg = (process.argv.find((a) => a.startsWith("--mode=")) || "").slice(7);
  const modes = modeArg ? [modeArg] : Object.keys(MODE_DEF);
  const prev = readJSON(OUT, null);
  if (!process.argv.includes("--force") && prev && prev.modes) {
    const ageDays = (Date.now() - new Date(prev.updated).getTime()) / 86400000;
    if (ageDays < opt.refreshDays) {
      console.log(`⏭ 랭커 기준값 최신(${ageDays.toFixed(1)}일 전) — 건너뜀`);
      return;
    }
  }
  setCallInterval(config.apiCallIntervalMs || 250);

  // 모드끼리는 동시에 진행 (각 모드 안에서는 순차 — 넥슨 호출 간격 유지)
  const results = await Promise.all(modes.map((m) => buildMode(m).catch((e) => {
    console.error(`[${m}] 실패:`, e); return null;
  })));

  const base = { ...(prev || {}), modes: { ...((prev && prev.modes) || {}) } };
  const xgFile = readJSON(OUT_XG, { modes: {} });
  let changed = false;
  modes.forEach((m, i) => {
    const r = results[i];
    if (!r) return;
    changed = true;
    base.modes[m] = { source: r.source, sampleSize: r.sampleSize, matches: r.matches, positions: r.positions };
    xgFile.modes[m] = { updated: new Date().toISOString(), source: r.source, ...r.xg };
    if (m === "official") {   // 기존 화면(명단 플레이스타일·에이스·전적 검색) 호환: 최상위 = 공식경기
      base.source = r.source; base.sampleSize = r.sampleSize;
      base.stats = r.stats; base.positions = r.positions;
    }
  });
  if (!changed) { console.warn("⚠ 갱신된 모드 없음 — 파일 유지"); return; }
  base.updated = new Date().toISOString();
  xgFile.updated = base.updated;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(base, null, 2) + "\n");
  fs.writeFileSync(OUT_XG, JSON.stringify(xgFile) + "\n");
  console.log(`✅ 저장 — ${OUT}, ${OUT_XG}`);
}

main().catch((e) => { console.error("랭커 기준값 생성 실패:", e); process.exit(1); });
