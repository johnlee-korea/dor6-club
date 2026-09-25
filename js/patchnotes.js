/* patchnotes.js — 패치노트 (v2.1.0)
   데이터: data/patchnotes.json — 날짜별, type: new(새 기능) · improve(개선) · fix(수정). 최신 날짜가 위 */

const PN_TYPE = { new: ["✨", "새 기능"], improve: ["🔧", "개선"], fix: ["🐛", "수정"] };

async function initPatchnotes() {
  const root = document.getElementById("pn-root");
  const data = await loadJSON("data/patchnotes.json").catch((e) => { console.error("패치노트 로딩 실패:", e); return null; });
  if (!data || !data.days || !data.days.length) {
    root.innerHTML = emptyState("패치노트를 불러오지 못했어요.", "📝");
    return;
  }
  root.innerHTML = data.days.map((d) => {
    const [y, m, day] = d.date.split("-").map(Number);
    const wk = "일월화수목금토"[new Date(y, m - 1, day).getDay()];
    return `
      <section class="pn-day">
        <div class="pn-date">${m}월 ${day}일 (${wk}) <span class="in-note">${escapeHtml(d.version || "")}</span></div>
        <div class="card">
          <div class="pn-title">${escapeHtml(d.title)}</div>
          <ul class="pn-list">${d.items.map((it) => {
            const [emo, label] = PN_TYPE[it.type] || ["•", ""];
            return `<li><span class="pn-tag ${it.type}">${emo} ${label}</span><span>${escapeHtml(it.text)}</span></li>`;
          }).join("")}</ul>
        </div>
      </section>`;
  }).join("");
}

initPatchnotes();
