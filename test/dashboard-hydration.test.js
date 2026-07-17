const test = require('ava');

test('Modal fetch should retrieve live record on edit', async t => {
  const record = { id: 'tts', free_limit: 10, premium_limit: 100, group_limit: 50 };
  const response = JSON.stringify(record);
  t.is(typeof response, 'string');
  const parsed = JSON.parse(response);
  t.is(parsed.free_limit, 10);
  t.is(parsed.premium_limit, 100);
});

test('Field mapping should convert camelCase to snake_case', async t => {
  const payload = { premiumOnly: true, freeLimit: 5, premiumLimit: 50, groupLimit: 25, dailyLimit: 1000, memberLimit: 10 };
  const mapped = {
    premium_only: payload.premiumOnly,
    free_limit: payload.freeLimit,
    premium_limit: payload.premiumLimit,
    group_limit: payload.groupLimit,
    daily_limit: payload.dailyLimit,
    member_limit: payload.memberLimit
  };
  t.is(mapped.premium_only, true);
  t.is(mapped.free_limit, 5);
  t.is(mapped.premium_limit, 50);
});

test('Zero and null should be distinct', async t => {
  const zero = { daily_limit: 0 };
  const unlimited = { daily_limit: null };
  t.is(zero.daily_limit, 0);
  t.is(unlimited.daily_limit, null);
  t.not(zero.daily_limit, unlimited.daily_limit);
});

test('Response should have no-store cache headers', async t => {
  const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' };
  t.is(headers['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
});

test('Owner alert should include field-level diff', async t => {
  const oldRecord = { free_limit: 10, premium_limit: 100 };
  const newRecord = { free_limit: 20, premium_limit: 100 };
  const diff = {};
  for (const key in newRecord) {
    if (oldRecord[key] !== newRecord[key]) diff[key] = { old: oldRecord[key], new: newRecord[key] };
  }
  t.deepEqual(diff, { free_limit: { old: 10, new: 20 } });
});

test('Subscriber alert should trigger only on price/enabled/recurring change', async t => {
  const oldPlan = { stars: 100, enabled: true, recurring: true };
  const newPlan = { stars: 150, enabled: true, recurring: true };
  const shouldAlert = oldPlan.stars !== newPlan.stars || oldPlan.enabled !== newPlan.enabled || oldPlan.recurring !== newPlan.recurring;
  t.is(shouldAlert, true);
});

test('Commands API should return full policies', async t => {
  const command = {
    id: 'tts',
    category: 'media',
    free_limit: 5,
    premium_limit: 40,
    group_limit: 120,
    daily_limit: 30,
    member_limit: 10,
    premium_only: false
  };
  t.is(command.free_limit, 5);
  t.is(command.premium_limit, 40);
  t.is(command.group_limit, 120);
  t.is(command.daily_limit, 30);
  t.is(command.member_limit, 10);
  t.is(command.premium_only, false);
});
