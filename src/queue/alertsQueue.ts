import { JobsOptions, Queue } from 'bullmq';
import { EnqueuedAlertPayload } from '../types';
import { getRedisConnection } from './connection';

export const ALERT_QUEUE_NAME = 'tv-alerts';
export const ALERT_DEAD_LETTER_QUEUE_NAME = 'tv-alerts-dlq';
const ALERT_JOB_NAME = 'execute-alert';

let queueSingleton: Queue<EnqueuedAlertPayload> | undefined;
let dlqSingleton: Queue<EnqueuedAlertPayload> | undefined;

function buildJobOptions(idempotencyKey: string): JobsOptions {
	const attempts = Number(process.env.ALERT_JOB_ATTEMPTS || '5');
	return {
		jobId: idempotencyKey,
		attempts,
		backoff: {
			type: 'exponential',
			delay: Number(process.env.ALERT_JOB_BACKOFF_MS || '1000')
		},
		removeOnComplete: 5000,
		removeOnFail: 5000
	};
}

function getAlertsQueue(): Queue<EnqueuedAlertPayload> {
	if (queueSingleton) return queueSingleton;
	queueSingleton = new Queue<EnqueuedAlertPayload>(ALERT_QUEUE_NAME, {
		connection: getRedisConnection()
	});
	return queueSingleton;
}

function getAlertsDlq(): Queue<EnqueuedAlertPayload> {
	if (dlqSingleton) return dlqSingleton;
	dlqSingleton = new Queue<EnqueuedAlertPayload>(ALERT_DEAD_LETTER_QUEUE_NAME, {
		connection: getRedisConnection()
	});
	return dlqSingleton;
}

export async function enqueueAlert(payload: EnqueuedAlertPayload) {
	return getAlertsQueue().add(ALERT_JOB_NAME, payload, buildJobOptions(payload.idempotencyKey));
}

export async function enqueueDeadLetter(payload: EnqueuedAlertPayload) {
	return getAlertsDlq().add(`dlq-${payload.idempotencyKey}`, payload, {
		removeOnComplete: 5000,
		removeOnFail: 5000
	});
}
