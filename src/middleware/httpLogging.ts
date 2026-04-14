import type { NextFunction, Request, Response } from 'express';
import axios, { AxiosError, AxiosHeaders, AxiosRequestConfig } from 'axios';

const MAX_LOG_CHARS = 8 * 1024;
const AXIOS_INTERCEPTORS_INSTALLED = Symbol.for(
	'tv-connector.axios.interceptors.installed'
);

type JsonObject = Record<string, unknown>;

function shouldLogHttpTraffic(): boolean {
	const raw = process.env.HTTP_LOGGING_ENABLED?.trim().toLowerCase();
	return raw !== '0' && raw !== 'false';
}

function shouldLogAxiosBodies(): boolean {
	const raw = process.env.HTTP_LOG_BODY_ENABLED?.trim().toLowerCase();
	return raw !== '0' && raw !== 'false';
}

function truncate(value: string): string {
	if (value.length <= MAX_LOG_CHARS) return value;
	return `${value.slice(0, MAX_LOG_CHARS)}... [truncated ${value.length} chars]`;
}

function safeJson(value: unknown): string {
	if (typeof value === 'string') return truncate(value);
	try {
		return truncate(JSON.stringify(value));
	} catch {
		return truncate(String(value));
	}
}

function redactValue(key: string, value: unknown): unknown {
	const lower = key.toLowerCase();
	if (
		lower.includes('authorization') ||
		lower.includes('api-key') ||
		lower.includes('apikey') ||
		lower.includes('secret') ||
		lower.includes('token') ||
		lower.includes('password') ||
		lower.includes('cookie')
	) {
		return '[REDACTED]';
	}
	return value;
}

function redactObject(input: JsonObject): JsonObject {
	const output: JsonObject = {};
	for (const [key, value] of Object.entries(input)) {
		output[key] = redactValue(key, value);
	}
	return output;
}

function headersToObject(headers: unknown): JsonObject {
	if (!headers) return {};
	if (headers instanceof AxiosHeaders) {
		return redactObject(headers.toJSON() as JsonObject);
	}
	if (typeof headers === 'object') {
		return redactObject(headers as JsonObject);
	}
	return {};
}

function getUrlFromConfig(config?: AxiosRequestConfig): string {
	if (!config) return '(unknown-url)';
	const base = config.baseURL || '';
	const url = config.url || '';
	return `${base}${url}` || '(unknown-url)';
}

function methodToUpper(method?: string): string {
	return (method || 'GET').toUpperCase();
}

export function installAxiosHttpLogging(): void {
	if (!shouldLogHttpTraffic()) return;

	const globalState = globalThis as Record<symbol, boolean>;
	if (globalState[AXIOS_INTERCEPTORS_INSTALLED]) return;
	globalState[AXIOS_INTERCEPTORS_INSTALLED] = true;

	axios.interceptors.request.use(
		(config) => {
			(config as AxiosRequestConfig & { metadataStartMs?: number }).metadataStartMs =
				Date.now();
			const details = {
				method: methodToUpper(config.method),
				url: getUrlFromConfig(config),
				timeoutMs: config.timeout ?? 0,
				headers: headersToObject(config.headers),
				params: config.params
			};
			console.log('[http-out] request:', safeJson(details));
			if (shouldLogAxiosBodies() && config.data !== undefined) {
				console.log('[http-out] request body:', safeJson(config.data));
			}
			return config;
		},
		(error: AxiosError) => {
			console.error('[http-out] request setup error:', error.message);
			return Promise.reject(error);
		}
	);

	axios.interceptors.response.use(
		(response) => {
			const config = response.config as AxiosRequestConfig & {
				metadataStartMs?: number;
			};
			const durationMs = config.metadataStartMs
				? Date.now() - config.metadataStartMs
				: undefined;
			const details = {
				method: methodToUpper(config.method),
				url: getUrlFromConfig(config),
				status: response.status,
				durationMs,
				headers: headersToObject(response.headers as unknown)
			};
			console.log('[http-out] response:', safeJson(details));
			if (shouldLogAxiosBodies() && response.data !== undefined) {
				console.log('[http-out] response body:', safeJson(response.data));
			}
			return response;
		},
		(error: AxiosError) => {
			const config = error.config as AxiosRequestConfig & {
				metadataStartMs?: number;
			};
			const durationMs =
				config?.metadataStartMs !== undefined
					? Date.now() - config.metadataStartMs
					: undefined;
			const details = {
				method: methodToUpper(config?.method),
				url: getUrlFromConfig(config),
				status: error.response?.status,
				durationMs,
				message: error.message,
				responseHeaders: headersToObject(error.response?.headers as unknown)
			};
			console.error('[http-out] error response:', safeJson(details));
			if (shouldLogAxiosBodies() && error.response?.data !== undefined) {
				console.error('[http-out] error response body:', safeJson(error.response.data));
			}
			return Promise.reject(error);
		}
	);
}

export function logExpressHttpTraffic(
	req: Request,
	res: Response,
	next: NextFunction
): void {
	if (!shouldLogHttpTraffic()) {
		next();
		return;
	}

	const startedAt = Date.now();
	let responseBody: unknown;
	const originalSend = res.send.bind(res);
	const originalJson = res.json.bind(res);

	res.send = ((body?: unknown) => {
		responseBody = body;
		return originalSend(body as never);
	}) as Response['send'];

	res.json = ((body?: unknown) => {
		responseBody = body;
		return originalJson(body as never);
	}) as Response['json'];

	const requestDetails = {
		requestId: req.requestId,
		method: req.method,
		path: req.originalUrl || req.url,
		ip: req.ip,
		headers: redactObject(req.headers as JsonObject),
		query: req.query
	};

	console.log('[http-in] request:', safeJson(requestDetails));
	if (req.rawBody) {
		console.log('[http-in] request body raw:', safeJson(req.rawBody));
	} else if (req.body && Object.keys(req.body as JsonObject).length > 0) {
		console.log('[http-in] request body parsed:', safeJson(req.body));
	}

	res.on('finish', () => {
		const responseDetails = {
			requestId: req.requestId,
			method: req.method,
			path: req.originalUrl || req.url,
			status: res.statusCode,
			durationMs: Date.now() - startedAt
		};
		console.log('[http-in] response:', safeJson(responseDetails));
		if (responseBody !== undefined) {
			console.log('[http-in] response body:', safeJson(responseBody));
		}
	});

	next();
}
