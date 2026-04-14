import { createHmac } from 'crypto';
import type { Request } from 'express';
import { validateWebhookAuth } from '../src/security/webhookAuth';

function mkReq(headers: Record<string, string>, rawBody: string): Request {
	return {
		header: (name: string) => headers[name.toLowerCase()] || headers[name],
		rawBody
	} as unknown as Request;
}

describe('validateWebhookAuth', () => {
	const originalEnv = process.env;
	beforeEach(() => {
		process.env = { ...originalEnv };
	});
	afterEach(() => {
		process.env = originalEnv;
	});

	test('passes when HMAC secret disabled', () => {
		delete (process.env as any).WEBHOOK_HMAC_SECRET;
		const result = validateWebhookAuth(mkReq({}, '{"ok":true}'));
		expect(result.ok).toBe(true);
	});

	test('rejects malformed signature headers', () => {
		(process.env as any).WEBHOOK_HMAC_SECRET = 'secret';
		const result = validateWebhookAuth(mkReq({}, '{"ok":true}'));
		expect(result.ok).toBe(false);
	});

	test('accepts valid signature and timestamp', () => {
		const secret = 'secret';
		(process.env as any).WEBHOOK_HMAC_SECRET = secret;
		(process.env as any).WEBHOOK_REPLAY_WINDOW_MS = '300000';
		const ts = Date.now();
		const rawBody = '{"ok":true}';
		const sig = createHmac('sha256', secret)
			.update(`${ts}.${rawBody}`)
			.digest('hex');
		const req = mkReq(
			{
				'x-webhook-timestamp': String(ts),
				'x-webhook-signature': `sha256=${sig}`
			},
			rawBody
		);
		const result = validateWebhookAuth(req);
		expect(result.ok).toBe(true);
	});
});
