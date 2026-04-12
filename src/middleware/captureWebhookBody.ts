import type { NextFunction, Request, Response } from 'express';

const MAX_LOG_CHARS = 16 * 1024;

function parsePayload(text: string, contentType: string): Record<string, unknown> {
	const trimmed = text.trim();
	if (!trimmed) {
		return {};
	}

	const ct = (contentType || '').toLowerCase();

	if (ct.includes('application/x-www-form-urlencoded')) {
		const params = Object.fromEntries(new URLSearchParams(trimmed));
		if (Object.keys(params).length > 0) {
			return { _payloadKind: 'form-urlencoded', ...params };
		}
	}

	const first = trimmed[0];
	if (first === '{' || first === '[') {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (parsed !== null && typeof parsed === 'object') {
				if (Array.isArray(parsed)) {
					return { _payloadKind: 'json-array', _items: parsed };
				}
				return parsed as Record<string, unknown>;
			}
			return { _payloadKind: 'json-primitive', _value: parsed };
		} catch {
			// not valid JSON despite looking like it
		}
	}

	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			return { _payloadKind: 'json-string', _value: parsed };
		} catch {
			// fall through to plain text
		}
	}

	return { _payloadKind: 'text', _raw: text };
}

/**
 * After `express.raw`, turns the buffer into `req.rawBody` (string), logs it,
 * and sets `req.body` to a parsed object when possible; otherwise wraps plain
 * text or malformed content without throwing.
 */
export function captureWebhookBody(
	req: Request,
	res: Response,
	next: NextFunction
): void {
	const buf = req.body as Buffer | undefined;
	if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
		req.rawBody = '';
		req.body = {};
		next();
		return;
	}

	const text = buf.toString('utf8');
	req.rawBody = text;

	const preview =
		text.length > MAX_LOG_CHARS
			? `${text.slice(0, MAX_LOG_CHARS)}... [truncated, ${text.length} chars total]`
			: text;

	console.log(
		`[webhook] ${req.method} ${req.originalUrl} content-type=${req.headers['content-type'] ?? '(none)'} bytes=${buf.length}`
	);
	console.log('[webhook] raw payload:', preview);

	req.body = parsePayload(text, req.headers['content-type'] || '');
	next();
}
