import { randomUUID } from 'crypto';
import { AlertObject, NormalizedAlert } from '../types';

const ALERT_SCHEMA_VERSION = '1.0.0';

function toOptionalNumber(value: unknown): number | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeAlert(input: AlertObject): NormalizedAlert {
	const nowIso = new Date().toISOString();
	const leverage =
		toOptionalNumber(input.leverage) ??
		toOptionalNumber(input.levrage) ??
		toOptionalNumber(input.Levrage);

	const normalized: NormalizedAlert = {
		...input,
		alertId: randomUUID(),
		schemaVersion: ALERT_SCHEMA_VERSION,
		sourceTimestamp: nowIso,
		receivedAt: nowIso,
		exchange: (input.exchange || 'gains').toLowerCase(),
		order: input.order as 'buy' | 'sell',
		position: input.position as 'long' | 'short' | 'flat',
		leverage
	};

	if (normalized.size !== undefined) normalized.size = Number(normalized.size);
	if (normalized.sizeUsd !== undefined)
		normalized.sizeUsd = Number(normalized.sizeUsd);
	if (normalized.sizeByLeverage !== undefined)
		normalized.sizeByLeverage = Number(normalized.sizeByLeverage);
	if (normalized.price !== undefined) normalized.price = Number(normalized.price);
	if (normalized.tp !== undefined) normalized.tp = Number(normalized.tp);
	if (normalized.sl !== undefined) normalized.sl = Number(normalized.sl);

	return normalized;
}
