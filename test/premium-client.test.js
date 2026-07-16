const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('crypto');
const { PremiumClient, PremiumApiError } = require('../lib/premium-client');

test('signs Worker requests with timestamp, nonce, method, path and body', async () => {
  const original = global.fetch; let captured;
  global.fetch = async (url, options) => { captured = { url, options }; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const client = new PremiumClient({ baseUrl: 'https://premium.example', clientId: 'bot', secret: 'secret', timeout: 1000 });
    await client.consume({ requestId: 'request-1', command: 'ask', userId: 7 });
    assert.equal(captured.url, 'https://premium.example/api/v1/usage/consume');
    const headers = captured.options.headers;
    const expected = createHmac('sha256', 'secret').update(`${headers['x-premium-timestamp']}.${headers['x-premium-nonce']}.POST./api/v1/usage/consume.${captured.options.body}`).digest('hex');
    assert.equal(headers['x-premium-signature'], expected);
    assert.equal(headers['idempotency-key'], 'request-1');
  } finally { global.fetch = original; }
});

test('fails closed when service is not configured', async () => {
  const client = new PremiumClient({ baseUrl: '', clientId: '', secret: '' });
  client.baseUrl = ''; client.clientId = ''; client.secret = '';
  await assert.rejects(() => client.status(1), error => error instanceof PremiumApiError && error.code === 'not_configured');
});

test('does not retry client errors', async () => {
  const original = global.fetch; let calls = 0;
  global.fetch = async () => { calls += 1; return new Response(JSON.stringify({ error: 'bad', code: 'bad_request' }), { status: 400 }); };
  try {
    const client = new PremiumClient({ baseUrl: 'https://premium.example', clientId: 'bot', secret: 'secret' });
    await assert.rejects(() => client.createIntent({}), error => error.status === 400);
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});
