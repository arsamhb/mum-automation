import type { NextFunction, Request, Response } from 'express';

const MAX_LOG_CHARS = 16 * 1024;

/** Plain-text body that is only `buy` or `sell` (typical `{{strategy.order.action}}` output). */
function parsePlainStrategyOrderAction(
	trimmed: string
): 'buy' | 'sell' | null {
	const lower = trimmed.toLowerCase();
	if (lower === 'buy' || lower === 'sell') {
		return lower as 'buy' | 'sell';
	}
	return null;
}

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

	const orderAction = parsePlainStrategyOrderAction(trimmed);
	if (orderAction) {
		return {
			_source: 'plain-text',
			_interpretation: '{{strategy.order.action}}',
			strategyOrderAction: orderAction
		};
	}

	return { _payloadKind: 'text', _raw: trimmed };
}

/**
 * After `express.text`, `req.body` is the raw string TradingView sent. We keep a copy in
 * `req.rawBody`, log it, then JSON.parse when the text looks like JSON — never assume
 * Express already parsed JSON (text/plain bodies are always strings).
 */
export function captureWebhookBody(
	req: Request,
	res: Response,
	next: NextFunction
): void {
	const raw =
		typeof req.body === 'string'
			? req.body
			: Buffer.isBuffer(req.body)
				? (req.body as Buffer).toString('utf8')
				: '';

	if (!raw.length) {
		req.rawBody = '';
		req.rawBodyTrimmed = '';
		req.body = {};
		next();
		return;
	}

	const trimmed = raw.trim();
	req.rawBody = raw;
	req.rawBodyTrimmed = trimmed;

	const preview =
		raw.length > MAX_LOG_CHARS
			? `${raw.slice(0, MAX_LOG_CHARS)}... [truncated, ${raw.length} chars total]`
			: raw;

	console.log(
		`[webhook] ${req.method} ${req.originalUrl} content-type=${req.headers['content-type'] ?? '(none)'} utf8Bytes=${Buffer.byteLength(raw, 'utf8')}`
	);
	console.log('[webhook] raw payload (string):', preview);
	if (trimmed !== raw) {
		console.log('[webhook] raw trimmed (for parse):', JSON.stringify(trimmed));
	}

	req.body = parsePayload(raw, req.headers['content-type'] || '');
	next();
}
