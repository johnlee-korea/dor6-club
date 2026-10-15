/* ============================================================
   scripts/career/build-clubs.js — openfootball → data/career/clubs.json (빌드 타임 1회, CLAUDE.md 26-7-1)
   실행: npm run career:clubs  [--cache <폴더>]  (--cache: 내려받은 원본을 그 폴더에 두고 재사용)

   - 출처: openfootball/football.json (CC0, API 키 불필요)
   - 소속 = 2025-26 시즌, 순위 점수 = 2025-26 경기당 승점(+득실 0.1) 60% + 2024-25 40%(같은 리그였을 때)
   - 요구 OVR R = 리그 밴드 안에서 점수 정규화
   - 코치진 특화·감독 성향·배지 색·가상 구단명은 구단 id 시드로 고정 배정
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRng, hashSeed } from "../../js/engine/rng.js";
import { LEAGUES, CATS, STYLES } from "../../js/career/rules.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RAW = "https://raw.githubusercontent.com/openfootball/football.json/master";
const SEASON = "2025-26", PREV = "2024-25";
const args = process.argv.slice(2);
const cacheDir = args.includes("--cache") ? args[args.indexOf("--cache") + 1] : null;
const KO = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/career/ko-names.json"), "utf8"));

async function load(season, lg) {
  const file = cacheDir && path.join(cacheDir, `${season}.${lg}.json`);
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const res = await fetch(`${RAW}/${season}/${lg}.json`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${season}/${lg} 내려받기 실패 (${res.status})`);
  const text = await res.text();
  if (file) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, text); }
  return JSON.parse(text);
}

/* 정규 리그 경기만 (플레이오프·플레이아웃 제외), 같은 홈/원정 조합 중복 제거 */
function table(json) {
  if (!json) return null;
  const t = new Map(), seen = new Set();
  const get = (n) => t.get(n) || (t.set(n, { name: n, p: 0, pts: 0, gd: 0 }), t.get(n));
  for (const m of json.matches) {
    if (/play|final/i.test(String(m.round))) continue;
    get(m.team1); get(m.team2);
    const key = m.team1 + "|" + m.team2;
    const ft = Array.isArray(m.score) ? m.score : m.score && m.score.ft;
    if (!ft || ft.length !== 2 || seen.has(key)) continue;
    seen.add(key);
    const [a, b] = ft, h = get(m.team1), w = get(m.team2);
    h.p++; w.p++; h.gd += a - b; w.gd += b - a;
    if (a > b) h.pts += 3; else if (a < b) w.pts += 3; else { h.pts++; w.pts++; }
  }
  return t;
}

/* 구단 id: 나라 + 실명 해시 6자리 (예 "en-1x9k2a") — 저장 파일에 실명 흔적이 남지 않게(USE_REAL_NAMES 전환 대비), 같은 실명이면 항상 같은 id */
const clubId = (country, name) => `${country}-${hashSeed("club-id|" + name).toString(36).padStart(7, "0").slice(-6)}`;
/* 가상 구단명 (USE_REAL_NAMES=false 대비) — 나라별 지역풍 음절 + 접미사 */
const FICT = {
  en: { a: ["노스", "사우스", "웨스트", "이스트", "브룩", "애시", "킹스", "레드", "하버", "스톤", "밀", "오크", "리버", "글렌", "헤이", "펀", "클리프", "윈드"],
        b: ["필드", "브리지", "포트", "게이트", "우드", "데일", "턴", "햄", "베리", "크로스", "몬트", "홀름"], s: ["FC", "유나이티드", "시티", "타운", "로버스", "애슬레틱", "원더러스"] },
  de: { a: ["슈바르츠", "노이", "알텐", "베르크", "로젠", "하펜", "타일", "발트", "브루크", "아이젠", "론", "펠스"],
        b: ["펠트", "하임", "부르크", "도르프", "슈타트", "탈", "바흐"], s: ["SV", "FC", "SC", "TSV", "포르투나"] },
  es: { a: ["산타", "리오", "비야", "몬테", "로사", "푸에르토", "카미노", "알바", "시에라", "코스타"],
        b: ["마르", "베르데", "알타", "도라다", "플라타", "소르", "블랑카", "누에바"], s: ["CF", "CD", "UD", "데포르티보", "아틀레티코"] },
  it: { a: ["카스텔", "몬테", "포르토", "비아", "산", "루나", "로카", "발레", "피에트라", "코르테"],
        b: ["벨로", "노바", "비앙코", "로소", "마레", "솔레", "베르데", "알타"], s: ["FC", "칼초", "AC", "US", "스포르팅"] },
  fr: { a: ["생", "몽", "포르", "보", "리브", "샤토", "벨", "그랑", "플뢰르", "오트"],
        b: ["마르", "로슈", "리브", "빌", "가르드", "몽", "브리즈"], s: ["FC", "올랭피크", "AS", "RC", "스타드"] }
};
const realKo = new Set(Object.values(KO).filter((v) => typeof v === "string"));
function fictionalName(country, id, used) {
  const f = FICT[country];
  for (let i = 0; ; i++) {
    const r = makeRng(`fict|${id}|${i}`);
    const pick = (a) => a[r.int(a.length)];
    const core = pick(f.a) + pick(f.b);
    const s = pick(f.s);
    const name = /^(SV|FC|SC|TSV|AS|RC|CD|UD|AC|US)$/.test(s) && country !== "en" ? `${s} ${core}` : `${core} ${s}`;
    if (!used.has(name) && !realKo.has(core)) { used.add(name); return name; }
  }
}

/* 배지 색: 시드 HSL(채도·명도 고정 → 어두운 테마에서 읽히는 중간 톤) — 실제 구단 색 미사용 */
function badgeColor(id) {
  const h = hashSeed("color|" + id) % 360;
  const s = 0.42, l = 0.42;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}

async function main() {
  const clubs = [], used = new Set(), ids = new Set(), report = [];
  for (const lg of LEAGUES) {
    const cur = table(await load(SEASON, lg.id));
    if (!cur) throw new Error(`${SEASON}/${lg.id} 없음`);
    const prev = table(await load(PREV, lg.id));
    const rows = [...cur.values()].map((r) => {
      const s1 = r.p ? (r.pts + r.gd * 0.1) / r.p : 1.3;
      const pv = prev && prev.get(r.name);
      let score = s1;
      if (pv && pv.p) {
        const s2 = (pv.pts + pv.gd * 0.1) / pv.p;
        score = (s1 * r.p * 0.6 + s2 * pv.p * 0.4) / (r.p * 0.6 + pv.p * 0.4);
      }
      return { ...r, score };
    });
    const hi = Math.max(...rows.map((r) => r.score)), lo = Math.min(...rows.map((r) => r.score));
    rows.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
    for (const r of rows) {
      let id = clubId(lg.country, r.name);
      while (ids.has(id)) id += "-2";
      ids.add(id);
      const rng = makeRng("club|" + id);
      const coach = rng.shuffle(CATS).slice(0, rng.chance(0.4) ? 2 : 1);
      clubs.push({
        id, league: lg.id, realName: r.name, koName: KO[r.name] || null, fictionalName: fictionalName(lg.country, id, used),
        R: Math.round(lg.band[0] + (lg.band[1] - lg.band[0]) * (r.score - lo) / (hi - lo || 1)),
        score: Math.round(r.score * 1000) / 1000, games: r.p, color: badgeColor(id), coach,
        style: STYLES[rng.int(STYLES.length)], reserve: /\sB$/.test(r.name)
      });
    }
    report.push(`${lg.id.padEnd(5)} ${String(rows.length).padStart(2)}팀 · 최소 ${Math.min(...rows.map((r) => r.p))}경기 · R ${lg.band.join("~")}`);
  }
  const out = {
    _comment: "커리어 시뮬레이터 구단 데이터 — scripts/career/build-clubs.js가 생성 (직접 수정 금지, 한글명은 ko-names.json)",
    version: 1,
    source: { name: "openfootball/football.json", license: "CC0-1.0", url: "https://github.com/openfootball/football.json", seasons: [SEASON, PREV], builtAt: new Date().toISOString().slice(0, 10) },
    leagues: LEAGUES.map((l) => ({ id: l.id, country: l.country, tier: l.tier, label: l.label, teams: clubs.filter((c) => c.league === l.id).length })),
    clubs
  };
  const file = path.join(ROOT, "data/career/clubs.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 0).replace(/\},\{"id"/g, '},\n{"id"') + "\n");

  // ---- 분포 출력 (검수용) ----
  console.log(report.join("\n"));
  const hist = {}; for (const c of clubs) { const b = Math.floor(c.R / 5) * 5; hist[b] = (hist[b] || 0) + 1; }
  console.log(`\n총 ${clubs.length}구단 · 요구 OVR 분포(5단위):`, JSON.stringify(hist));
  const cc = {}; for (const c of clubs) for (const k of c.coach) cc[k] = (cc[k] || 0) + 1;
  const tot = Object.values(cc).reduce((s, v) => s + v, 0);
  console.log("코치진 특화 분포:", Object.entries(cc).map(([k, v]) => `${k} ${(100 * v / tot).toFixed(1)}%`).join(" · "));
  for (const o of [46, 53]) {
    const by = {}; for (const c of clubs) if (c.R <= o + 10) by[c.league] = (by[c.league] || 0) + 1;
    console.log(`16세 OVR ${o} 입단 가능(R ≤ ${o + 10}):`, JSON.stringify(by));
  }
  console.log("한글명 없는 1부 구단:", clubs.filter((c) => c.league.endsWith(".1") && !c.koName).map((c) => c.realName).join(", ") || "없음");
  console.log("B팀(승격 불가):", clubs.filter((c) => c.reserve).map((c) => c.realName).join(", ") || "없음");
  console.log(`→ ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(1)}KB)`);
}
main().catch((e) => { console.error("❌ 구단 데이터 생성 실패:", e); process.exit(1); });
