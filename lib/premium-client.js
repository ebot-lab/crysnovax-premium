const { createHmac, randomUUID } = require('crypto');

class PremiumApiError extends Error {
  constructor(message, status = 0, code = 'premium_api_error') { super(message); this.name = 'PremiumApiError'; this.status = status; this.code = code; }
}

class PremiumClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || process.env.PREMIUM_API_URL || 'https://premium.crysnovax.link').replace(/\/$/, '');
    this.clientId = options.clientId || process.env.PREMIUM_CLIENT_ID || 'ebot';
    this.secret = options.secret || process.env.PREMIUM_API_SECRET || '';
    this.timeout = Number(options.timeout || 7000);
  }
  configured() { return Boolean(this.baseUrl && this.clientId && this.secret); }
  async request(path, { method = 'GET', body, idempotencyKey, retries = 1 } = {}) {
    if (!this.configured()) throw new PremiumApiError('Premium service is not configured', 503, 'not_configured');
    const payload = body === undefined ? '' : JSON.stringify(body);
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const timestamp = String(Math.floor(Date.now() / 1000)); const nonce = randomUUID();
      const signature = createHmac('sha256', this.secret).update(`${timestamp}.${nonce}.${method}.${path}.${payload}`).digest('hex');
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const response = await fetch(`${this.baseUrl}${path}`, { method, body: payload || undefined, signal: controller.signal, headers: { 'content-type': 'application/json', 'x-premium-client': this.clientId, 'x-premium-timestamp': timestamp, 'x-premium-nonce': nonce, 'x-premium-signature': signature, ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new PremiumApiError(data.error || `Premium API returned ${response.status}`, response.status, data.code);
        return data;
      } catch (error) {
        if (attempt === retries || (error.status && error.status < 500)) throw error instanceof PremiumApiError ? error : new PremiumApiError('Premium service is temporarily unavailable', 503, 'unavailable');
        await new Promise(resolve => setTimeout(resolve, 200 * (2 ** attempt) + Math.floor(Math.random() * 100)));
      } finally { clearTimeout(timer); }
    }
  }
  plans() { return this.request('/api/v1/plans'); }
  status(userId, chatId) { return this.request(`/api/v1/status?userId=${encodeURIComponent(userId)}${chatId ? `&chatId=${encodeURIComponent(chatId)}` : ''}`); }
  consume(input) { return this.request('/api/v1/usage/consume', { method: 'POST', body: input, retries: 0, idempotencyKey: input.requestId }); }
  refundUsage(input) { return this.request('/api/v1/usage/refund', { method: 'POST', body: input, idempotencyKey: input.requestId }); }
  createIntent(input) { return this.request('/api/v1/invoices', { method: 'POST', body: input, idempotencyKey: input.idempotencyKey }); }
  validateIntent(input) { return this.request('/api/v1/invoices/validate', { method: 'POST', body: input, retries: 0 }); }
  payment(input) { return this.request('/api/v1/payments', { method: 'POST', body: input, idempotencyKey: input.idempotencyKey, retries: 3 }); }
  manage(action, input) { return this.request(`/api/v1/admin/${action}`, { method: 'POST', body: input, idempotencyKey: input.idempotencyKey }); }
}
module.exports = { PremiumClient, PremiumApiError };
