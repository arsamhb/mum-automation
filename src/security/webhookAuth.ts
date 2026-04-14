import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

function readHeader(req: Request, key: string): string | undefined {
	const value = req.header(key);
	return value && value.trim().length ? value.trim() : undefined;
}

function isWithinReplayWindow(timestamp: number, maxSkewMs: number): boolean {
	const now = Date.now();
	return Math.abs(now - timestamp) <= maxSkewMs;
}

export function validateWebhookAuth(req: Request): { ok: boolean; reason?: string } {
	const secret = process.env.WEBHOOK_HMAC_SECRET?.trim();
	if (!secret) return { ok: true };

	const signatureHeader =
		readHeader(req, 'x-webhook-signature') || readHeader(req, 'x-tv-signature');
	const timestampHeader =
		readHeader(req, 'x-webhook-timestamp') || readHeader(req, 'x-tv-timestamp');
	if (!signatureHeader || !timestampHeader) {
		return { ok: false, reason: 'Missing webhook signature headers' };
	}

	const timestamp = Number(timestampHeader);
	if (!Number.isFinite(timestamp)) {
		return { ok: false, reason: 'Invalid webhook timestamp header' };
	}
	const replayWindowMs = Number(process.env.WEBHOOK_REPLAY_WINDOW_MS || '300000');
	if (!isWithinReplayWindow(timestamp, replayWindowMs)) {
		return { ok: false, reason: 'Webhook timestamp outside replay window' };
	}

	const body = req.rawBody ?? '';
	const expected = createHmac('sha256', secret)
		.update(`${timestamp}.${body}`)
		.digest('hex');
	const expectedBuffer = Buffer.from(expected);
	const provided = signatureHeader.replace(/^sha256=/i, '');
	const providedBuffer = Buffer.from(provided);
	if (expectedBuffer.length !== providedBuffer.length) {
		return { ok: false, reason: 'Webhook signature mismatch' };
	}
	if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
		return { ok: false, reason: 'Webhook signature mismatch' };
	}
	return { ok: true };
}
