import { AlertLifecycleStatus, AlertStateRecord, NormalizedAlert } from '../types';
import { getRedisConnection } from '../queue/connection';

const ALERT_KEY_PREFIX = 'tv:alert:';
const IDEMPOTENCY_KEY_PREFIX = 'tv:idempotency:';
const ALERT_TTL_SECONDS = 60 * 60 * 24 * 14;

function alertKey(alertId: string): string {
	return `${ALERT_KEY_PREFIX}${alertId}`;
}

function idempotencyKey(key: string): string {
	return `${IDEMPOTENCY_KEY_PREFIX}${key}`;
}

export async function createInitialAlertState(params: {
	alert: NormalizedAlert;
	idempotency: string;
	jobId?: string;
}): Promise<AlertStateRecord> {
	const now = new Date().toISOString();
	const record: AlertStateRecord = {
		alertId: params.alert.alertId,
		idempotencyKey: params.idempotency,
		status: 'RECEIVED',
		createdAt: now,
		updatedAt: now,
		exchange: params.alert.exchange,
		strategy: params.alert.strategy,
		market: params.alert.market,
		order: params.alert.order,
		position: params.alert.position,
		retryCount: 0,
		jobId: params.jobId
	};
	const redis = getRedisConnection();
	await redis.hset(alertKey(record.alertId), record as unknown as Record<string, string>);
	await redis.expire(alertKey(record.alertId), ALERT_TTL_SECONDS);
	await redis.set(idempotencyKey(params.idempotency), record.alertId, 'EX', ALERT_TTL_SECONDS);
	return record;
}

export async function getAlertState(alertId: string): Promise<AlertStateRecord | null> {
	const data = await getRedisConnection().hgetall(alertKey(alertId));
	if (!data || Object.keys(data).length === 0) return null;
	return {
		...data,
		retryCount: Number(data.retryCount || 0)
	} as AlertStateRecord;
}

export async function getAlertByIdempotency(
	key: string
): Promise<AlertStateRecord | null> {
	const id = await getRedisConnection().get(idempotencyKey(key));
	if (!id) return null;
	return getAlertState(id);
}

export async function transitionAlertState(
	alertId: string,
	status: AlertLifecycleStatus,
	patch?: Partial<AlertStateRecord>
): Promise<void> {
	const redis = getRedisConnection();
	const now = new Date().toISOString();
	const payload: Record<string, string> = {
		status,
		updatedAt: now
	};
	for (const [key, value] of Object.entries(patch || {})) {
		if (value === undefined || value === null) continue;
		payload[key] = String(value);
	}
	await redis.hset(alertKey(alertId), payload);
	await redis.expire(alertKey(alertId), ALERT_TTL_SECONDS);
}

export async function markRetry(alertId: string, reason: string): Promise<void> {
	const redis = getRedisConnection();
	const retries = await redis.hincrby(alertKey(alertId), 'retryCount', 1);
	await transitionAlertState(alertId, 'RETRYING', {
		lastError: reason,
		retryCount: retries
	});
}
