var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var TOKEN_TTL = 60 * 60 * 6;
var src_default = {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const json = /* @__PURE__ */ __name((obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } }), "json");
    try {
      if (url.pathname === "/login" && request.method === "POST") {
        const { password } = await request.json();
        if (!password || password !== env.ADMIN_PASSWORD)
          return json({ error: "\uBE44\uBC00\uBC88\uD638\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." }, 401);
        const token = await sign({ exp: nowSec() + TOKEN_TTL }, env.JWT_SECRET);
        return json({ token, expiresIn: TOKEN_TTL });
      }
      if (url.pathname === "/search" && request.method === "POST") {
        const { nickname } = await request.json();
        if (!nickname) return json({ error: "\uB2C9\uB124\uC784\uC744 \uC785\uB825\uD558\uC138\uC694." }, 400);
        const ouid = await resolveOuid(nickname, env.NEXON_API_KEY);
        if (!ouid) return json({ error: "\uD574\uB2F9 \uB2C9\uB124\uC784\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. (\uB2C9 \uBCC0\uACBD \uC9C1\uD6C4\uBA74 \uD558\uB8E8 \uC815\uB3C4 \uB4A4 \uC870\uD68C\uB429\uB2C8\uB2E4)" }, 404);
        const data = await publicSearch(ouid, env.NEXON_API_KEY);
        return json(data);
      }
      const payload = await requireAuth(request, env);
      if (!payload) return json({ error: "\uC778\uC99D\uC774 \uD544\uC694\uD569\uB2C8\uB2E4. \uB2E4\uC2DC \uB85C\uADF8\uC778\uD558\uC138\uC694." }, 401);
      if (url.pathname === "/resolve" && request.method === "POST") {
        const { nickname } = await request.json();
        if (!nickname) return json({ error: "\uB2C9\uB124\uC784\uC744 \uC785\uB825\uD558\uC138\uC694." }, 400);
        const ouid = await resolveOuid(nickname, env.NEXON_API_KEY);
        if (!ouid) return json({ error: "\uB125\uC2A8\uC5D0\uC11C \uD574\uB2F9 \uB2C9\uB124\uC784\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 404);
        return json({ ouid });
      }
      if (url.pathname === "/members" && request.method === "POST") {
        const body = await request.json();
        const result = await mutateMembers(body, env);
        return json(result);
      }
      return json({ error: "\uC54C \uC218 \uC5C6\uB294 \uC694\uCCAD" }, 404);
    } catch (e) {
      return json({ error: "\uC11C\uBC84 \uC624\uB958: " + e.message }, 500);
    }
  }
};
var NX = "https://open.api.nexon.com";
var sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");
async function nexonGet(path, key, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(NX + path, { headers: { "x-nxopen-api-key": key } });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && i < retries) {
      await sleep(600 * (i + 1));
      continue;
    }
    throw new Error(`nexon ${res.status} ${path}`);
  }
}
__name(nexonGet, "nexonGet");
async function resolveOuid(nickname, key) {
  try {
    const j = await nexonGet(`/fconline/v1/id?nickname=${encodeURIComponent(nickname)}`, key);
    return j.ouid || null;
  } catch {
    return null;
  }
}
__name(resolveOuid, "resolveOuid");
var _divMeta = null;
async function divisionName(id) {
  if (!_divMeta) {
    try {
      _divMeta = await (await fetch(`${NX}/static/fconline/meta/division.json`)).json();
    } catch {
      _divMeta = [];
    }
  }
  const m = _divMeta.find((d) => d.divisionId === id);
  return m ? m.divisionName : id != null ? String(id) : "-";
}
__name(divisionName, "divisionName");
var R_MAP = { "\uC2B9": "win", "\uBB34": "draw", "\uD328": "lose" };
var toLineup = /* @__PURE__ */ __name((side) => (side && side.player || []).map((pl) => ({
  spId: pl.spId,
  spPosition: pl.spPosition,
  spGrade: pl.spGrade
})), "toLineup");
async function publicSearch(ouid, key) {
  const out = { ouid, nickname: null, level: null, maxDivision: "-", matches: [] };
  try {
    const b = await nexonGet(`/fconline/v1/user/basic?ouid=${ouid}`, key);
    out.nickname = b.nickname;
    out.level = b.level;
  } catch {
  }
  try {
    const divs = await nexonGet(`/fconline/v1/user/maxdivision?ouid=${ouid}`, key);
    const off = divs.find((d) => d.matchType === 50) || divs[0];
    if (off) out.maxDivision = await divisionName(off.division);
  } catch {
  }
  let ids = [];
  try {
    ids = await nexonGet(`/fconline/v1/user/match?ouid=${ouid}&matchtype=50&offset=0&limit=8`, key);
  } catch {
  }
  for (const id of ids) {
    try {
      const d = await nexonGet(`/fconline/v1/match-detail?matchid=${id}`, key);
      const me = (d.matchInfo || []).find((i) => i.ouid === ouid);
      if (!me) continue;
      const opp = (d.matchInfo || []).find((i) => i.ouid !== ouid);
      const md = me.matchDetail || {}, sh = me.shoot || {};
      out.matches.push({
        matchId: d.matchId,
        matchType: 50,
        matchDate: d.matchDate,
        result: R_MAP[md.matchResult] || "draw",
        goalFor: sh.goalTotal ?? 0,
        goalAgainst: (opp && opp.shoot && opp.shoot.goalTotal) ?? 0,
        opponentNick: opp ? opp.nickname : "?",
        possession: md.possession ?? null,
        lineup: toLineup(me),
        // 양팀 스쿼드 모달용 (선수 id·포지션·강화만)
        oppLineup: toLineup(opp)
      });
    } catch {
    }
  }
  const w = out.matches.filter((m) => m.result === "win").length;
  out.summary = {
    games: out.matches.length,
    wins: w,
    winRate: out.matches.length ? Math.round(w / out.matches.length * 100) : null
  };
  return out;
}
__name(publicSearch, "publicSearch");
async function mutateMembers(body, env) {
  const { action, member, ouid } = body;
  const [owner, repo] = (env.GH_REPO || "").split("/");
  const branch = env.GH_BRANCH || "main";
  const path = "data/members.json";
  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const ghHeaders = {
    "Authorization": `Bearer ${env.GH_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "dor6-club-worker"
  };
  const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers: ghHeaders });
  if (!getRes.ok) throw new Error(`members.json \uB85C\uB4DC \uC2E4\uD328 (${getRes.status})`);
  const file = await getRes.json();
  const current = JSON.parse(decodeBase64(file.content));
  current.members = current.members || [];
  let message = "";
  if (action === "add") {
    if (!member || !member.ouid || !member.ingameNick) throw new Error("\uB4F1\uB85D \uC815\uBCF4\uAC00 \uBD80\uC871\uD569\uB2C8\uB2E4.");
    if (current.members.some((m) => m.ouid === member.ouid))
      return { error: "\uC774\uBBF8 \uB4F1\uB85D\uB41C \uD074\uB7FD\uC6D0\uC785\uB2C8\uB2E4." };
    current.members.push({
      ouid: member.ouid,
      ingameNick: member.ingameNick,
      talkNick: member.talkNick || member.ingameNick,
      role: member.role || "\uD074\uB7FD\uC6D0",
      manager: member.manager || null,
      joinDate: member.joinDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      isSub: !!member.isSub,
      parentOuid: member.parentOuid || null,
      restPeriods: []
    });
    message = `[\uAE30\uB2A5] \uD074\uB7FD\uC6D0 \uB4F1\uB85D: ${member.ingameNick}`;
  } else if (action === "delete") {
    const before = current.members.length;
    current.members = current.members.filter((m) => m.ouid !== ouid);
    if (current.members.length === before) return { error: "\uD574\uB2F9 \uD074\uB7FD\uC6D0\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." };
    message = `[\uC218\uC815] \uD074\uB7FD\uC6D0 \uC0AD\uC81C: ${ouid}`;
  } else {
    throw new Error("action\uC740 add \uB610\uB294 delete\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
  }
  current.meta = current.meta || {};
  current.meta.updated = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: encodeBase64(JSON.stringify(current, null, 2) + "\n"),
      sha: file.sha,
      branch
    })
  });
  if (!putRes.ok) throw new Error(`\uCEE4\uBC0B \uC2E4\uD328 (${putRes.status})`);
  return { ok: true, message, count: current.members.length };
}
__name(mutateMembers, "mutateMembers");
function nowSec() {
  return Math.floor(Date.now() / 1e3);
}
__name(nowSec, "nowSec");
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}
__name(hmac, "hmac");
async function sign(payload, secret) {
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(p, secret);
  return `${p}.${sig}`;
}
__name(sign, "sign");
async function verify(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [p, sig] = token.split(".");
  if (await hmac(p, secret) !== sig) return null;
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  if (!payload.exp || payload.exp < nowSec()) return null;
  return payload;
}
__name(verify, "verify");
async function requireAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return verify(token, env.JWT_SECRET);
}
__name(requireAuth, "requireAuth");
function b64url(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(b64url, "b64url");
function fromB64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
__name(fromB64url, "fromB64url");
function decodeBase64(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
__name(decodeBase64, "decodeBase64");
function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => bin += String.fromCharCode(b));
  return btoa(bin);
}
__name(encodeBase64, "encodeBase64");

// ../../../Users/tkddy/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../Users/tkddy/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-L1g15s/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../Users/tkddy/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-L1g15s/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
