/* ============================================================
   notices.js — FC온라인 공지사항·개발자 노트 수집 (v2.10.0)
   - 하루 1회 notices.yml(GitHub Actions)에서 실행 → data/notices.json
   - 게시판 목록 1페이지 + 글마다 상세 페이지(게시 시각·본문 전문)
   - 본문은 넥슨이 자주 고쳐서([추가]·점검 연장 등) 매번 다시 받음 — 게시판 2개 × 20건 = 상세 40회, 약 30초
   - 넥슨 API 키 불필요 (공식 홈페이지 HTML)
   - v2.10.1 전문 표시(사용자 결정, 출처 명시) → 본문은 홈 첫 화면이 무거워지지 않게 data/notices-body.json으로 분리
   저장 구조:
     updatedAt: 수집 시각 ISO
     boards[board] = { label, items: [{ sn, category, title, pinned, preview, date, url, hasBody }] }  — 게시 시각 최신순
   data/notices-body.json: { updatedAt, bodies: { "<board>-<sn>": 정리된 본문 HTML } }  — 글을 펼칠 때만 로딩
   실행: node scripts/notices.js
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NOTICE_BOARDS, listUrl, viewUrl, parseNoticeList, parsePublished, parseBody } from "./lib/notice.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "notices.json");
const OUT_BODY = path.join(ROOT, "data", "notices-body.json");
const KEEP = 20;              // 게시판별 보관 개수
const INTERVAL_MS = 300;      // 홈페이지 요청 간격
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } };

async function getHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`응답 ${res.status} (${url})`);
  return res.text();
}

async function collectBoard(board, prevItems, prevBodies, bodies) {
  const known = new Map((prevItems || []).map((it) => [it.sn, it]));
  const list = parseNoticeList(await getHtml(listUrl(board)), board);
  if (!list.length) throw new Error("목록 파싱 결과 0건 — 홈페이지 구조 변경 가능성");

  const items = [];
  for (const it of list) {
    const key = `${board}-${it.sn}`;
    let date = known.get(it.sn) && known.get(it.sn).date;
    let body = null;
    await sleep(INTERVAL_MS);
    try {
      const html = await getHtml(viewUrl(board, it.sn));
      date = parsePublished(html) || date;
      body = parseBody(html);
      if (!body) console.warn(`  [${key}] 본문 구역을 못 찾음 — 이전 본문 유지`);
    } catch (e) { console.warn(`  [${key}] 상세 실패: ${e.message} — 이전 값 유지`); }
    body = body || prevBodies[key] || null;
    if (body) bodies[key] = body;
    // 제목·미리보기는 수정될 수 있으니 항상 최신 목록 값 사용
    items.push({ ...it, date: date || null, url: viewUrl(board, it.sn), hasBody: !!body });
  }
  // 게시 시각 최신순 (시각 모르면 글 번호 순으로 뒤에)
  items.sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.sn - a.sn);
  return items.slice(0, KEEP);
}

async function main() {
  const prev = readJSON(OUT, { boards: {} });
  const prevBodies = readJSON(OUT_BODY, { bodies: {} }).bodies || {};
  const bodies = {};
  const out = { updatedAt: new Date().toISOString(), boards: {} };
  let fail = 0;
  for (const [board, info] of Object.entries(NOTICE_BOARDS)) {
    try {
      const items = await collectBoard(board, prev.boards && prev.boards[board] && prev.boards[board].items, prevBodies, bodies);
      out.boards[board] = { label: info.label, items };
      console.log(`  ${info.label}: ${items.length}건 (최신 ${items[0] && items[0].date})`);
    } catch (e) {
      fail++;
      console.error(`  ${info.label} 수집 실패: ${e.message}`);
      // 실패한 게시판은 이전 데이터 유지 → 화면이 비지 않게
      if (prev.boards && prev.boards[board]) {
        out.boards[board] = prev.boards[board];
        for (const it of out.boards[board].items) { const k = `${board}-${it.sn}`; if (prevBodies[k]) bodies[k] = prevBodies[k]; }
      }
    }
  }
  // 목록에 남은 글의 본문만 저장 (밀려난 글은 자동 정리)
  const keep = new Set(Object.entries(out.boards).flatMap(([b, x]) => x.items.map((it) => `${b}-${it.sn}`)));
  const bodyOut = Object.fromEntries(Object.entries(bodies).filter(([k]) => keep.has(k)));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  fs.writeFileSync(OUT_BODY, JSON.stringify({ updatedAt: out.updatedAt, bodies: bodyOut }) + "\n");
  console.log(`본문: ${Object.keys(bodyOut).length}건 · ${Math.round(fs.statSync(OUT_BODY).size / 1024)}KB`);
  console.log(`저장:${path.relative(ROOT, OUT)}${fail ? ` (실패 ${fail}개 게시판 — 이전 값 유지)` : ""}`);
  if (fail === Object.keys(NOTICE_BOARDS).length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
