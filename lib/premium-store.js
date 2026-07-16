const fs = require('fs');
const path = require('path');
const { randomUUID, createHash, timingSafeEqual } = require('crypto');

const ROLE_PERMISSIONS = {
  owner: ['*'],
  super_admin: ['groups:read', 'groups:write', 'users:read', 'moderation:write', 'campaigns:write', 'analytics:read', 'roles:write'],
  moderator: ['groups:read', 'users:read', 'moderation:write'],
  broadcaster: ['groups:read', 'users:read', 'campaigns:write', 'analytics:read'],
  analyst: ['groups:read', 'users:read', 'analytics:read'],
  support: ['groups:read', 'users:read']
};
const COLLECTIONS = ['users', 'groups', 'memberships', 'sessions', 'roles', 'campaigns', 'templates', 'jobs', 'deliveries', 'clicks', 'moderation', 'audits'];
const FILE = path.resolve(process.env.PREMIUM_STORE_FILE || path.join(__dirname, '..', 'data', 'premium-store.json'));
const BACKUP = `${FILE}.bak`;
let writeQueue = Promise.resolve();

function emptyStore() { return Object.fromEntries(COLLECTIONS.map(name => [name, []])); }
function normalize(value) {
  const data = value && typeof value === 'object' ? value : {};
  const blank = emptyStore();
  for (const name of COLLECTIONS) blank[name] = Array.isArray(data[name]) ? data[name] : [];
  return blank;
}
function readFile(file) { return normalize(JSON.parse(fs.readFileSync(file, 'utf8'))); }
function load() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  try { return readFile(FILE); } catch (primaryError) {
    try { const recovered = readFile(BACKUP); fs.copyFileSync(BACKUP, FILE); return recovered; }
    catch (backupError) { const initial = emptyStore(); fs.writeFileSync(FILE, `${JSON.stringify(initial, null, 2)}\n`); return initial; }
  }
}
let data = load();
function snapshot() { return JSON.parse(JSON.stringify(data)); }
function persist() {
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    const temp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
    if (fs.existsSync(FILE)) await fs.promises.copyFile(FILE, BACKUP);
    await fs.promises.writeFile(temp, payload, { mode: 0o600 });
    await fs.promises.rename(temp, FILE);
  });
  return writeQueue;
}
async function mutate(operation) { const result = operation(data); await persist(); return result; }
function now() { return new Date().toISOString(); }
function asTime(value) { const time = new Date(value).getTime(); return Number.isFinite(time) ? time : 0; }
function sortBy(records, field) { return [...records].sort((a, b) => asTime(b[field]) - asTime(a[field])); }
function backend() { return 'json'; }
function available() { return true; }
async function query() { throw new Error('Raw SQL is unavailable in JSON storage mode'); }
async function close() { await writeQueue; }

async function audit(actorId, action, resourceType, resourceId, details = {}, chatId = null) {
  return mutate(store => store.audits.push({ id: randomUUID(), actor_id: actorId || null, action, resource_type: resourceType, resource_id: String(resourceId || ''), chat_id: chatId, details, created_at: now() }));
}
async function observe(msg) {
  if (!msg?.from) return;
  await mutate(store => {
    const stamp = now(); const u = msg.from;
    let user = store.users.find(record => Number(record.telegram_id) === Number(u.id));
    const profile = { isPremium: Boolean(u.is_premium) };
    if (user) Object.assign(user, { username: u.username || null, first_name: u.first_name || null, last_name: u.last_name || null, language: u.language_code || user.language || 'en', last_seen_at: stamp, profile: { ...(user.profile || {}), ...profile } });
    else store.users.push({ telegram_id: u.id, username: u.username || null, first_name: u.first_name || null, last_name: u.last_name || null, language: u.language_code || 'en', first_seen_at: stamp, last_seen_at: stamp, profile });
    if (msg.chat?.type !== 'private') {
      let group = store.groups.find(record => Number(record.chat_id) === Number(msg.chat.id));
      if (group) Object.assign(group, { title: msg.chat.title || group.title || null, updated_at: stamp });
      else store.groups.push({ chat_id: msg.chat.id, title: msg.chat.title || null, language: 'en', settings: {}, created_at: stamp, updated_at: stamp });
      let membership = store.memberships.find(record => Number(record.chat_id) === Number(msg.chat.id) && Number(record.telegram_id) === Number(u.id));
      if (membership) { membership.last_seen_at = stamp; membership.activity_count = Number(membership.activity_count || 0) + 1; }
      else store.memberships.push({ chat_id: msg.chat.id, telegram_id: u.id, activity_count: 1, joined_at: stamp, last_seen_at: stamp });
    }
  });
}
async function overview() { return { connected: true, backend: 'json', users: data.users.length, groups: data.groups.length, campaigns: data.campaigns.length, actions: data.moderation.length }; }
async function list(resource, limit = 50) {
  if (!['users', 'groups', 'campaigns', 'audits', 'moderation'].includes(resource)) throw new Error('Unknown resource');
  const field = resource === 'users' ? 'last_seen_at' : resource === 'groups' ? 'updated_at' : 'created_at';
  return sortBy(data[resource], field).slice(0, Math.min(100, Math.max(1, limit))).map(record => JSON.parse(JSON.stringify(record)));
}
async function createCampaign(input, actorId) {
  const id = randomUUID(); const stamp = now();
  await mutate(store => store.campaigns.push({ id, name: input.name, document: input.document || {}, audience: input.audience || {}, schedule: input.schedule || {}, status: 'draft', created_by: actorId, created_at: stamp, updated_at: stamp, completed_at: null }));
  await audit(actorId, 'campaign.create', 'campaign', id, { name: input.name }); return id;
}
async function scheduleJob(type, payload, runAt, recurringRule = null) {
  const id = randomUUID(); const stamp = now();
  await mutate(store => store.jobs.push({ id, type, payload, run_at: new Date(runAt).toISOString(), recurring_rule: recurringRule, status: 'pending', attempts: 0, max_attempts: 5, lease_owner: null, lease_until: null, last_error: null, created_at: stamp, updated_at: stamp })); return id;
}
function signSession(value, secret) { return createHash('sha256').update(`${value}:${secret}`).digest('hex'); }
function safeEqual(a, b) { const aa = Buffer.from(a || ''); const bb = Buffer.from(b || ''); return aa.length === bb.length && timingSafeEqual(aa, bb); }
async function createSession(telegramId) {
  const id = randomUUID(); const csrf = randomUUID(); const stamp = now();
  await mutate(store => { store.sessions = store.sessions.filter(session => asTime(session.expires_at) > Date.now()); store.sessions.push({ id, telegram_id: telegramId, csrf_token: csrf, created_at: stamp, expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }); });
  return { id, csrf };
}
async function getSession(id) {
  if (!id) return null;
  const session = data.sessions.find(record => record.id === id && asTime(record.expires_at) > Date.now());
  return session ? JSON.parse(JSON.stringify(session)) : null;
}
async function deleteSession(id) { return mutate(store => { const before = store.sessions.length; store.sessions = store.sessions.filter(session => session.id !== id); return before !== store.sessions.length; }); }
async function claimJobs(workerId, limit = 5) {
  const current = Date.now(); const claimed = [];
  await mutate(store => {
    for (const job of [...store.jobs].filter(job => job.status === 'pending' && asTime(job.run_at) <= current && (!job.lease_until || asTime(job.lease_until) < current)).sort((a, b) => asTime(a.run_at) - asTime(b.run_at)).slice(0, limit)) {
      job.status = 'running'; job.lease_owner = workerId; job.lease_until = new Date(current + 120000).toISOString(); job.attempts = Number(job.attempts || 0) + 1; job.updated_at = now(); claimed.push(JSON.parse(JSON.stringify(job)));
    }
  }); return claimed;
}
async function finishJob(id, error = null) {
  return mutate(store => { const job = store.jobs.find(record => record.id === id); if (!job) return null; job.updated_at = now(); job.lease_owner = null; job.lease_until = null; if (error) { job.last_error = String(error).slice(0, 1000); job.status = job.attempts >= job.max_attempts ? 'failed' : 'pending'; job.run_at = new Date(Date.now() + Math.min(job.attempts, 5) * 30000).toISOString(); } else job.status = 'completed'; return job; });
}
async function campaign(id) { const record = data.campaigns.find(item => item.id === id); return record ? JSON.parse(JSON.stringify(record)) : null; }
async function campaignResult(id, status, details = {}) { return mutate(store => { const record = store.campaigns.find(item => item.id === id); if (!record) return null; record.status = status; record.document = { ...(record.document || {}), delivery: details }; record.updated_at = now(); if (['completed', 'failed'].includes(status)) record.completed_at = now(); return record; }); }
async function moderationEvent({ chatId, telegramId, moderatorId, action, reason, expiresAt = null, metadata = {} }) {
  const id = randomUUID(); await mutate(store => store.moderation.push({ id, chat_id: chatId, telegram_id: telegramId, moderator_id: moderatorId || null, action, reason: reason || null, expires_at: expiresAt, metadata, created_at: now() }));
  await audit(moderatorId, `moderation.${action}`, 'user', telegramId, { reason, expiresAt, ...metadata }, chatId); return id;
}
function permissionsFor(role) { return ROLE_PERMISSIONS[role] || []; }
async function roleFor(telegramId, ownerIds = []) {
  if (ownerIds.includes(Number(telegramId))) return { role: 'owner', permissions: ['*'] };
  const records = sortBy(data.roles.filter(record => Number(record.telegram_id) === Number(telegramId) && record.chat_id == null), 'created_at'); const record = records[0];
  return record ? { role: record.role, permissions: [...new Set([...permissionsFor(record.role), ...(record.permissions || [])])] } : null;
}
async function roles() { return sortBy(data.roles, 'created_at').slice(0, 100).map(role => ({ ...role, ...(data.users.find(user => Number(user.telegram_id) === Number(role.telegram_id)) || {}) })); }
async function grantRole(input, actorId) {
  if (!ROLE_PERMISSIONS[input.role]) throw new Error('Unknown role'); let record;
  await mutate(store => { record = store.roles.find(role => Number(role.telegram_id) === Number(input.telegramId) && role.role === input.role && String(role.chat_id || '') === String(input.chatId || '')); if (record) Object.assign(record, { permissions: input.permissions || [], granted_by: actorId, updated_at: now() }); else { record = { id: randomUUID(), telegram_id: Number(input.telegramId), role: input.role, chat_id: input.chatId || null, permissions: input.permissions || [], granted_by: actorId, created_at: now() }; store.roles.push(record); } });
  await audit(actorId, 'role.grant', 'role', record.id, { telegramId: input.telegramId, role: input.role, chatId: input.chatId || null }); return record;
}
async function revokeRole(id, actorId) { let record; await mutate(store => { record = store.roles.find(role => role.id === id); store.roles = store.roles.filter(role => role.id !== id); }); if (record) await audit(actorId, 'role.revoke', 'role', id, { telegramId: record.telegram_id, role: record.role }); return record || null; }
async function templates() { return sortBy(data.templates, 'updated_at').slice(0, 100); }
async function saveTemplate(input, actorId) { const stamp = now(); const record = { id: randomUUID(), name: input.name, kind: input.kind || 'broadcast', document: input.document || {}, language: input.language || 'en', created_by: actorId, created_at: stamp, updated_at: stamp }; await mutate(store => store.templates.push(record)); await audit(actorId, 'template.create', 'template', record.id, { name: record.name }); return record; }
async function campaignAnalytics(id) { const records = data.deliveries.filter(record => record.campaign_id === id); const clicks = data.clicks.filter(record => record.campaign_id === id); return { total: records.length, sent: records.filter(record => record.status === 'sent').length, failed: records.filter(record => record.status === 'failed').length, pending: records.filter(record => record.status === 'pending').length, clicks: clicks.length, unique_clicks: new Set(clicks.map(click => String(click.telegram_id))).size }; }
async function createDeliveries(campaignId, targets) { if (!targets.length) return; await mutate(store => { for (const target of targets) if (!store.deliveries.some(record => record.campaign_id === campaignId && Number(record.telegram_id) === Number(target.telegramId))) store.deliveries.push({ id: randomUUID(), campaign_id: campaignId, telegram_id: Number(target.telegramId), chat_id: target.chatId || null, status: 'pending', attempts: 0, telegram_message_id: null, error: null, sent_at: null, created_at: now(), updated_at: now() }); }); }
async function deliveryResult(campaignId, telegramId, status, result = {}) { return mutate(store => { const record = store.deliveries.find(item => item.campaign_id === campaignId && Number(item.telegram_id) === Number(telegramId)); if (!record) return null; record.status = status; record.attempts += 1; record.telegram_message_id = result.messageId || null; record.error = result.error || null; if (status === 'sent') record.sent_at = now(); record.updated_at = now(); return record; }); }
async function recordClick(campaignId, buttonKey, telegramId, destination, metadata = {}) { return mutate(store => store.clicks.push({ id: randomUUID(), campaign_id: campaignId, button_key: buttonKey, telegram_id: telegramId || null, destination, metadata, clicked_at: now() })); }
async function updateGroup(chatId, patch, actorId) { let group; await mutate(store => { group = store.groups.find(record => Number(record.chat_id) === Number(chatId)); if (!group) { group = { chat_id: Number(chatId), title: null, language: 'en', settings: {}, created_at: now() }; store.groups.push(group); } if (patch.language) group.language = patch.language; group.settings = { ...(group.settings || {}), ...(patch.settings || {}) }; group.updated_at = now(); }); await audit(actorId, 'group.update', 'group', chatId, patch, chatId); return group; }
async function userDetail(id) { const user = data.users.find(record => Number(record.telegram_id) === Number(id)); if (!user) return null; return { ...JSON.parse(JSON.stringify(user)), memberships: sortBy(data.memberships.filter(record => Number(record.telegram_id) === Number(id)).map(record => ({ ...record, title: data.groups.find(group => Number(group.chat_id) === Number(record.chat_id))?.title || null })), 'last_seen_at'), moderation: sortBy(data.moderation.filter(record => Number(record.telegram_id) === Number(id)), 'created_at').slice(0, 30) }; }
function canAccess(role, permission) { const granted = permissionsFor(role); return granted.includes('*') || granted.includes(permission); }
module.exports = { available, backend, query, audit, observe, overview, list, createCampaign, scheduleJob, createSession, getSession, deleteSession, claimJobs, finishJob, campaign, campaignResult, moderationEvent, roleFor, roles, grantRole, revokeRole, templates, saveTemplate, campaignAnalytics, createDeliveries, deliveryResult, recordClick, updateGroup, userDetail, signSession, safeEqual, permissionsFor, canAccess, close, _snapshot: snapshot, pool: null };
