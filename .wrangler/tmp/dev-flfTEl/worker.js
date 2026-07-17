var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
var encoder = new TextEncoder();
var json = /* @__PURE__ */ __name((data, status2 = 200, headers = {}) => new Response(JSON.stringify(data), { status: status2, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } }), "json");
var now = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
var id = /* @__PURE__ */ __name(() => crypto.randomUUID(), "id");
var parseJson = /* @__PURE__ */ __name(async (request) => {
  const text = await request.text();
  if (text.length > 1e5) throw new ApiError("Payload too large", 413);
  return text ? JSON.parse(text) : {};
}, "parseJson");
var ApiError = class extends Error {
  static {
    __name(this, "ApiError");
  }
  constructor(message, status2 = 400, code = "bad_request") {
    super(message);
    this.status = status2;
    this.code = code;
  }
};
var safe = /* @__PURE__ */ __name((value) => String(value ?? "").slice(0, 500), "safe");
var decode = /* @__PURE__ */ __name((value) => JSON.parse(value || "[]"), "decode");
var hex = /* @__PURE__ */ __name((buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join(""), "hex");
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
__name(hmac, "hmac");
function constantEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(constantEqual, "constantEqual");
async function authenticateBot(request, env, bodyText = "") {
  const client = request.headers.get("x-premium-client");
  const timestamp = request.headers.get("x-premium-timestamp");
  const nonce = request.headers.get("x-premium-nonce");
  const signature = request.headers.get("x-premium-signature");
  if (!env.API_SECRET || !client || !timestamp || !nonce || !signature) throw new ApiError("Unauthorized", 401, "unauthorized");
  if (Math.abs(Date.now() / 1e3 - Number(timestamp)) > 300) throw new ApiError("Stale request", 401, "stale");
  const existing = await env.DB.prepare("SELECT value FROM nonces WHERE value=?").bind(nonce).first();
  if (existing) throw new ApiError("Replay detected", 409, "replay");
  const url = new URL(request.url);
  const expected = await hmac(env.API_SECRET, `${timestamp}.${nonce}.${request.method}.${url.pathname}${url.search}.${bodyText}`);
  if (!constantEqual(signature, expected)) throw new ApiError("Invalid signature", 401, "bad_signature");
  await env.DB.prepare("INSERT INTO nonces(value,expires_at) VALUES(?,?)").bind(nonce, Date.now() + 3e5).run();
  return { id: client, role: "bot" };
}
__name(authenticateBot, "authenticateBot");
async function telegramHash(data, token) {
  const secret = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}
__name(telegramHash, "telegramHash");
async function telegramLogin(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new ApiError("TELEGRAM_BOT_TOKEN secret is not set on the worker", 503, "not_configured");
  if (!String(env.ADMIN_TELEGRAM_IDS || "").trim()) throw new ApiError("ADMIN_TELEGRAM_IDS secret is not set on the worker", 503, "not_configured");
  const body = await parseJson(request);
  const { hash, ...fields } = body;
  const check = Object.entries(fields).filter(([, value]) => value !== void 0 && value !== "").sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  if (!hash || !constantEqual(hash, await telegramHash(check, env.TELEGRAM_BOT_TOKEN))) throw new ApiError("Invalid Telegram login", 401);
  if (Date.now() / 1e3 - Number(fields.auth_date) > 86400) throw new ApiError("Login expired", 401);
  const allowed = String(env.ADMIN_TELEGRAM_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!allowed.includes(String(fields.id))) throw new ApiError("Not allowlisted", 403);
  const session = id();
  const csrf = id();
  await env.DB.prepare("INSERT OR IGNORE INTO admins VALUES(?,?,?,?)").bind(String(fields.id), "owner", fields.first_name || fields.username || "Admin", now()).run();
  await env.DB.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)").bind(session, String(fields.id), csrf, new Date(Date.now() + 6048e5).toISOString(), now()).run();
  return json({ ok: true, csrf }, 200, { "set-cookie": `premium_session=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800` });
}
__name(telegramLogin, "telegramLogin");
function cookie(request, name) {
  return (request.headers.get("cookie") || "").split(";").map((x) => x.trim()).find((x) => x.startsWith(`${name}=`))?.slice(name.length + 1);
}
__name(cookie, "cookie");
async function admin(request, env, mutate = false) {
  const sessionId = cookie(request, "premium_session");
  const record = sessionId && await env.DB.prepare("SELECT sessions.*,admins.role FROM sessions JOIN admins USING(telegram_id) WHERE sessions.id=? AND sessions.expires_at>datetime('now')").bind(sessionId).first();
  if (!record) throw new ApiError("Sign in required", 401);
  if (mutate && request.headers.get("x-csrf-token") !== record.csrf) throw new ApiError("Invalid CSRF token", 403);
  return record;
}
__name(admin, "admin");
async function audit(env, actor, action, targetType, targetId, before, after, reason, requestId) {
  await env.DB.prepare("INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id(), String(actor), action, targetType || null, targetId ? String(targetId) : null, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason || null, requestId || null, now()).run();
}
__name(audit, "audit");
async function plans(env) {
  const { results } = await env.DB.prepare("SELECT * FROM plans WHERE enabled=1 ORDER BY display_order").all();
  return results.map((plan) => ({ ...plan, recurring: Boolean(plan.recurring), enabled: Boolean(plan.enabled), benefits: decode(plan.benefits) }));
}
__name(plans, "plans");
async function activeEntitlement(env, scope, target) {
  return env.DB.prepare("SELECT e.*,p.name,p.duration_seconds FROM entitlements e LEFT JOIN plans p ON p.id=e.plan_id WHERE e.scope=? AND e.telegram_id=? AND e.status='active' AND e.expires_at>datetime('now') ORDER BY e.expires_at DESC LIMIT 1").bind(scope, String(target)).first();
}
__name(activeEntitlement, "activeEntitlement");
async function restriction(env, userId, chatId, command) {
  return env.DB.prepare("SELECT * FROM restrictions WHERE active=1 AND ((scope='user' AND telegram_id=?) OR (scope='group' AND telegram_id=?)) AND (expires_at IS NULL OR expires_at>datetime('now')) AND (command IS NULL OR command=?) ORDER BY created_at DESC LIMIT 1").bind(String(userId), String(chatId || ""), command || "").first();
}
__name(restriction, "restriction");
async function status(env, userId, chatId) {
  const personal = await activeEntitlement(env, "user", userId);
  const group = chatId ? await activeEntitlement(env, "group", chatId) : null;
  const blocked = await restriction(env, userId, chatId);
  return { userId, chatId, premium: Boolean(personal || group), source: personal ? "personal" : group ? "group" : "free", personal, group, restriction: blocked };
}
__name(status, "status");
async function consume(env, input) {
  const command = safe(input.command).toLowerCase();
  const policy = await env.DB.prepare("SELECT * FROM commands WHERE name=?").bind(command).first();
  if (!policy) return { allowed: true, metered: false, source: "free" };
  if (!policy.enabled) return { allowed: false, reason: "disabled" };
  const blocked = await restriction(env, input.userId, input.chatId, command);
  if (blocked && !input.owner) return { allowed: false, reason: blocked.kind, restriction: blocked };
  if (input.owner) return { allowed: true, metered: false, source: "owner" };
  const access = await status(env, input.userId, input.chatId);
  if (policy.premium_only && !access.premium) return { allowed: false, reason: "premium_required" };
  let scope = "user";
  let target = String(input.userId);
  let member = "";
  let limit = policy.free_limit;
  if (access.personal) limit = policy.category === "light" ? null : policy.premium_limit;
  else if (access.group) {
    scope = "group";
    target = String(input.chatId);
    member = String(input.userId);
    limit = policy.category === "light" ? null : policy.group_limit;
  }
  if (limit == null) return { allowed: true, metered: false, source: access.source };
  const day = now().slice(0, 10);
  const stamp = now();
  await env.DB.prepare("INSERT INTO usage_daily(day,scope,telegram_id,member_id,command,category,count,denied,updated_at) VALUES(?,?,?,?,?,?,1,0,?) ON CONFLICT(day,scope,telegram_id,member_id,command) DO UPDATE SET count=count+1,updated_at=excluded.updated_at").bind(day, scope, target, member, command, policy.category, stamp).run();
  const usage = await env.DB.prepare("SELECT count FROM usage_daily WHERE day=? AND scope=? AND telegram_id=? AND member_id=? AND command=?").bind(day, scope, target, member, command).first();
  let allowed = usage.count <= limit;
  if (allowed && scope === "group" && policy.member_limit != null) allowed = usage.count <= policy.member_limit;
  if (!allowed) await env.DB.prepare("UPDATE usage_daily SET denied=denied+1 WHERE day=? AND scope=? AND telegram_id=? AND member_id=? AND command=?").bind(day, scope, target, member, command).run();
  return { allowed, metered: true, source: access.source, used: Math.min(usage.count, limit), limit, remaining: Math.max(0, limit - usage.count), reason: allowed ? null : "rate_limited", reservationId: `${day}:${scope}:${target}:${member}:${command}` };
}
__name(consume, "consume");
async function refundUsage(env, input) {
  const [day, scope, target, member, command] = String(input.reservationId || "").split(":");
  if (!command) throw new ApiError("Invalid reservation");
  await env.DB.prepare("UPDATE usage_daily SET count=MAX(0,count-1),updated_at=? WHERE day=? AND scope=? AND telegram_id=? AND member_id=? AND command=?").bind(now(), day, scope, target, member, command).run();
  return { refunded: true };
}
__name(refundUsage, "refundUsage");
async function createIntent(env, input) {
  const plan = input.kind === "donation" ? null : await env.DB.prepare("SELECT * FROM plans WHERE id=? AND enabled=1").bind(input.planId).first();
  const stars = plan ? plan.stars : Number(input.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 1e5) throw new ApiError("Invalid Stars amount");
  if (plan && plan.scope !== input.targetScope) throw new ApiError("Plan scope mismatch");
  const nonce = id();
  await env.DB.prepare("INSERT INTO invoice_intents VALUES(?,?,?,?,?,?,?,?,?,?)").bind(nonce, input.kind || "plan", plan?.id || null, String(input.buyerId), input.targetScope || "user", String(input.targetId || input.buyerId), stars, new Date(Date.now() + 6e5).toISOString(), null, now()).run();
  return { nonce, stars, plan: plan ? { ...plan, benefits: decode(plan.benefits) } : null, payload: `premium:${nonce}`, expiresAt: new Date(Date.now() + 6e5).toISOString() };
}
__name(createIntent, "createIntent");
async function validateIntent(env, input) {
  const intent = await env.DB.prepare("SELECT * FROM invoice_intents WHERE nonce=? AND consumed_at IS NULL AND expires_at>datetime('now')").bind(input.nonce).first();
  if (!intent || String(intent.buyer_id) !== String(input.buyerId) || Number(intent.stars) !== Number(input.stars)) throw new ApiError("Invalid or expired invoice", 409);
  return { valid: true, intent };
}
__name(validateIntent, "validateIntent");
async function recordPayment(env, input) {
  const intent = await env.DB.prepare("SELECT * FROM invoice_intents WHERE nonce=?").bind(input.nonce).first();
  if (!intent) throw new ApiError("Unknown invoice", 404);
  const existing = await env.DB.prepare("SELECT * FROM payments WHERE idempotency_key=?").bind(input.idempotencyKey).first();
  if (existing) return { duplicate: true, payment: existing };
  if (String(intent.buyer_id) !== String(input.buyerId) || Number(intent.stars) !== Number(input.stars)) throw new ApiError("Payment mismatch", 409);
  const paymentId = id();
  const stamp = now();
  await env.DB.batch([env.DB.prepare("INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(paymentId, input.idempotencyKey, input.telegramChargeId || null, input.providerChargeId || null, intent.kind, intent.plan_id, intent.buyer_id, intent.target_scope, intent.target_id, intent.stars, "XTR", "paid", Number(input.recurring || 0), JSON.stringify(input.raw || {}), stamp, stamp), env.DB.prepare("UPDATE invoice_intents SET consumed_at=? WHERE nonce=?").bind(stamp, input.nonce)]);
  if (intent.kind === "plan") {
    const plan = await env.DB.prepare("SELECT * FROM plans WHERE id=?").bind(intent.plan_id).first();
    const current = await activeEntitlement(env, intent.target_scope, intent.target_id);
    const base = current && new Date(current.expires_at) > /* @__PURE__ */ new Date() ? new Date(current.expires_at) : /* @__PURE__ */ new Date();
    const expires = new Date(base.getTime() + plan.duration_seconds * 1e3).toISOString();
    await env.DB.prepare("INSERT INTO entitlements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id(), intent.target_scope, intent.target_id, plan.id, stamp, expires, plan.recurring, "active", "payment", null, null, stamp).run();
  }
  return { duplicate: false, paymentId };
}
__name(recordPayment, "recordPayment");
async function overview(env) {
  const row = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM entitlements WHERE status='active' AND expires_at>datetime('now') AND scope='user') personal,(SELECT COUNT(*) FROM entitlements WHERE status='active' AND expires_at>datetime('now') AND scope='group') groups,(SELECT COALESCE(SUM(stars),0) FROM payments WHERE status='paid' AND kind='plan') revenue,(SELECT COALESCE(SUM(stars),0) FROM payments WHERE status='paid' AND kind='donation') donations,(SELECT COALESCE(SUM(count),0) FROM usage_daily WHERE day=date('now')) usage,(SELECT COALESCE(SUM(denied),0) FROM usage_daily WHERE day=date('now')) denied").first();
  const commands = (await env.DB.prepare("SELECT command,SUM(count) usage,SUM(denied) denied FROM usage_daily WHERE day>=date('now','-7 days') GROUP BY command ORDER BY usage DESC LIMIT 10").all()).results;
  return { ...row, commands };
}
__name(overview, "overview");
async function listData(env, type, url) {
  const allowed = { users: "subjects", plans: "plans", entitlements: "entitlements", payments: "payments", commands: "commands", restrictions: "restrictions", audit: "audit_logs" };
  if (!allowed[type]) throw new ApiError("Unknown resource");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const { results } = await env.DB.prepare(`SELECT * FROM ${allowed[type]} ORDER BY ${type === "commands" ? "name" : "rowid"} DESC LIMIT ?`).bind(limit).all();
  return results;
}
__name(listData, "listData");
async function mutateAdmin(env, actor, action, input, request) {
  const requestId = request.headers.get("idempotency-key") || id();
  let before = null, after = null;
  if (action === "plan") {
    before = await env.DB.prepare("SELECT * FROM plans WHERE id=?").bind(input.id).first();
    await env.DB.prepare("UPDATE plans SET stars=?,enabled=?,benefits=?,updated_at=? WHERE id=?").bind(Number(input.stars), input.enabled ? 1 : 0, JSON.stringify(input.benefits || decode(before.benefits)), now(), input.id).run();
    after = await env.DB.prepare("SELECT * FROM plans WHERE id=?").bind(input.id).first();
  } else if (action === "command") {
    before = await env.DB.prepare("SELECT * FROM commands WHERE name=?").bind(input.name).first();
    await env.DB.prepare("UPDATE commands SET enabled=?,premium_only=?,free_limit=?,premium_limit=?,group_limit=?,member_limit=?,updated_at=? WHERE name=?").bind(input.enabled ? 1 : 0, input.premiumOnly ? 1 : 0, input.freeLimit ?? null, input.premiumLimit ?? null, input.groupLimit ?? null, input.memberLimit ?? null, now(), input.name).run();
    after = await env.DB.prepare("SELECT * FROM commands WHERE name=?").bind(input.name).first();
  } else if (action === "gift") {
    const plan = await env.DB.prepare("SELECT * FROM plans WHERE id=?").bind(input.planId).first();
    if (!plan || plan.scope !== input.scope) throw new ApiError("Invalid plan");
    const start = now(), expires = new Date(Date.now() + plan.duration_seconds * 1e3).toISOString();
    after = { id: id(), scope: input.scope, telegram_id: String(input.telegramId), plan_id: plan.id, starts_at: start, expires_at: expires, recurring: 0, status: "active", source: "gift", gifted_by: String(actor.telegram_id), reason: safe(input.reason), created_at: start };
    await env.DB.prepare("INSERT INTO entitlements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(...Object.values(after)).run();
  } else if (action === "restrict") {
    after = { id: id(), scope: input.scope, telegram_id: String(input.telegramId), kind: input.kind || "ban", command: input.command || null, reason: safe(input.reason), expires_at: input.expiresAt || null, active: 1, actor_id: String(actor.telegram_id), created_at: now() };
    await env.DB.prepare("INSERT INTO restrictions VALUES(?,?,?,?,?,?,?,?,?,?)").bind(...Object.values(after)).run();
  } else if (action === "revoke") {
    before = await env.DB.prepare("SELECT * FROM entitlements WHERE id=?").bind(input.id).first();
    await env.DB.prepare("UPDATE entitlements SET status='revoked' WHERE id=?").bind(input.id).run();
    after = { ...before, status: "revoked" };
  } else if (action === "reset") {
    const scope = input.scope || "user", target = String(input.telegramId);
    before = { scope, target };
    await env.DB.prepare("DELETE FROM usage_daily WHERE scope=? AND telegram_id=?").bind(scope, target).run();
    after = { scope, target, reset: true };
  } else throw new ApiError("Unknown action");
  await audit(env, actor.telegram_id, action, input.scope || action, input.telegramId || input.id || input.name, before, after, input.reason, requestId);
  return after;
}
__name(mutateAdmin, "mutateAdmin");
async function route(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (path === "/health") return json({ ok: true, service: "crysnovax-premium", time: now() });
  if (path === "/api/public-config") return json({ botUsername: env.TELEGRAM_BOT_USERNAME || "" });
  if (path === "/api/auth/telegram" && request.method === "POST") return telegramLogin(request, env);
  if (path === "/api/auth/me") {
    const who = await admin(request, env);
    return json({ telegramId: who.telegram_id, role: who.role, csrf: who.csrf });
  }
  if (path.startsWith("/api/dashboard/")) {
    const who = await admin(request, env, request.method !== "GET");
    if (path === "/api/dashboard/overview") return json(await overview(env));
    if (path.startsWith("/api/dashboard/list/")) return json({ items: await listData(env, path.split("/").pop(), url) });
    if (path.startsWith("/api/dashboard/action/")) return json({ result: await mutateAdmin(env, who, path.split("/").pop(), await parseJson(request), request) });
  }
  if (path.startsWith("/api/v1/")) {
    const bodyText = ["POST", "PUT", "PATCH"].includes(request.method) ? await request.clone().text() : "";
    await authenticateBot(request, env, bodyText);
    const input = bodyText ? JSON.parse(bodyText) : {};
    if (path === "/api/v1/plans") return json({ plans: await plans(env) });
    if (path === "/api/v1/status") return json(await status(env, url.searchParams.get("userId"), url.searchParams.get("chatId")));
    if (path === "/api/v1/usage/consume") return json(await consume(env, input));
    if (path === "/api/v1/usage/refund") return json(await refundUsage(env, input));
    if (path === "/api/v1/invoices") return json(await createIntent(env, input));
    if (path === "/api/v1/invoices/validate") return json(await validateIntent(env, input));
    if (path === "/api/v1/payments") return json(await recordPayment(env, input));
    if (path.startsWith("/api/v1/admin/")) {
      const allowed = String(env.ADMIN_TELEGRAM_IDS || "").split(",").map((x) => x.trim());
      if (!allowed.includes(String(input.actorId))) throw new ApiError("Owner authorization required", 403);
      const actor = { telegram_id: String(input.actorId), role: "owner" };
      return json({ result: await mutateAdmin(env, actor, path.split("/").pop(), input, request) });
    }
  }
  if (path === "/" || path === "/dashboard") return env.ASSETS ? env.ASSETS.fetch(new Request(new URL("/", request.url), request)) : new Response("Premium dashboard assets are not configured", { status: 503 });
  return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: "Not found" }, 404);
}
__name(route, "route");
var worker_default = { async fetch(request, env) {
  try {
    return await route(request, env);
  } catch (error) {
    console.error(JSON.stringify({ event: "request_error", message: error.message, path: new URL(request.url).pathname }));
    return json({ error: error.message || "Internal error", code: error.code || "internal_error" }, error.status || 500);
  }
}, async scheduled(_event, env) {
  await env.DB.batch([env.DB.prepare("DELETE FROM nonces WHERE expires_at<?").bind(Date.now()), env.DB.prepare("DELETE FROM sessions WHERE expires_at<datetime('now')"), env.DB.prepare("UPDATE entitlements SET status='expired' WHERE status='active' AND expires_at<=datetime('now')")]);
} };

// node_modules/.pnpm/wrangler@4.111.0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
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

// node_modules/.pnpm/wrangler@4.111.0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
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
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-0ipfIc/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/.pnpm/wrangler@4.111.0/node_modules/wrangler/templates/middleware/common.ts
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

// .wrangler/tmp/bundle-0ipfIc/middleware-loader.entry.ts
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
//# sourceMappingURL=worker.js.map
