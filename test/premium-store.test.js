const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function freshStore(file) {
  process.env.PREMIUM_STORE_FILE = file;
  delete require.cache[require.resolve('../lib/premium-store')];
  return require('../lib/premium-store');
}

test('JSON premium store persists sessions, roles, campaigns, jobs, and analytics', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codye-store-'));
  const file = path.join(directory, 'premium.json');
  let store = freshStore(file);
  assert.equal(store.backend(), 'json');
  assert.equal(store.available(), true);

  await store.observe({ from: { id: 101, username: 'tester', first_name: 'Test' }, chat: { id: -55, type: 'group', title: 'Lab' } });
  await store.observe({ from: { id: 101, username: 'tester', first_name: 'Test' }, chat: { id: -55, type: 'group', title: 'Lab' } });
  const overview = await store.overview();
  assert.deepEqual({ users: overview.users, groups: overview.groups }, { users: 1, groups: 1 });

  const session = await store.createSession(101);
  assert.equal(Number((await store.getSession(session.id)).telegram_id), 101);
  await store.grantRole({ telegramId: 101, role: 'broadcaster' }, 999);
  assert.equal((await store.roleFor(101)).role, 'broadcaster');

  const campaignId = await store.createCampaign({ name: 'Test', document: { text: 'Hello' } }, 101);
  const jobId = await store.scheduleJob('campaign.send', { campaignId }, new Date(Date.now() - 1000));
  const [job] = await store.claimJobs('test-worker');
  assert.equal(job.id, jobId);
  await store.finishJob(jobId);
  await store.createDeliveries(campaignId, [{ telegramId: 101 }, { telegramId: 202 }]);
  await store.deliveryResult(campaignId, 101, 'sent', { messageId: 7 });
  await store.deliveryResult(campaignId, 202, 'failed', { error: 'blocked' });
  await store.recordClick(campaignId, 'primary', 101, 'https://example.com');
  assert.deepEqual(await store.campaignAnalytics(campaignId), { total: 2, sent: 1, failed: 1, pending: 0, clicks: 1, unique_clicks: 1 });
  await store.close();

  store = freshStore(file);
  assert.equal(Number((await store.getSession(session.id)).telegram_id), 101);
  assert.equal((await store.campaign(campaignId)).name, 'Test');
  assert.equal(store._snapshot().jobs.find(item => item.id === jobId).status, 'completed');
  await store.deleteSession(session.id);
  assert.equal(await store.getSession(session.id), null);
  await store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
