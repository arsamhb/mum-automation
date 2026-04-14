import 'dotenv/config';
import { Worker, QueueEvents } from 'bullmq';
import { DexRegistry } from '../services/dexRegistry';
import { buildExecutionLockKey } from '../alerts/idempotency';
import {
	alertExecutionDurationMs,
	alertsTerminalFailedTotal,
	queueLagMs
} from '../observability/metrics';
import { logError, logInfo, logWarn } from '../observability/logContext';
import { enqueueDeadLetter, ALERT_QUEUE_NAME } from '../queue/alertsQueue';
import { getRedisConnection } from '../queue/connection';
import { markRetry, transitionAlertState } from '../state/alertStateStore';
import { EnqueuedAlertPayload } from '../types';
import { validateRuntimeEnv } from '../config/validateEnv';

const WORKER_LOCK_TTL_MS = Number(process.env.ALERT_EXECUTION_LOCK_TTL_MS || '120000');

function classifyFailure(message: string): 'retryable' | 'terminal' {
	const lower = message.toLowerCase();
	if (
		lower.includes('timeout') ||
		lower.includes('network') ||
		lower.includes('temporar') ||
		lower.includes('429') ||
		lower.includes('503') ||
		lower.includes('gateway')
	) {
		return 'retryable';
	}
	if (
		lower.includes('no open trade') ||
		lower.includes('close reconciliation pending') ||
		lower.includes('no open trades visible')
	) {
		return 'retryable';
	}
	return 'terminal';
}

async function acquireExecutionLock(
	key: string,
	owner: string
): Promise<boolean> {
	const result = await getRedisConnection().set(key, owner, 'PX', WORKER_LOCK_TTL_MS, 'NX');
	return result === 'OK';
}

async function releaseExecutionLock(key: string, owner: string): Promise<void> {
	const redis = getRedisConnection();
	if ((await redis.get(key)) === owner) {
		await redis.del(key);
	}
}

async function processAlert(payload: EnqueuedAlertPayload): Promise<void> {
	const { alertId, normalizedAlert, idempotencyKey, requestId } = payload;
	const startedAt = Date.now();
	const lockKey = buildExecutionLockKey(normalizedAlert);
	const lockOwner = `${alertId}:${Date.now()}`;

	await transitionAlertState(alertId, 'EXECUTING');
	const gotLock = await acquireExecutionLock(lockKey, lockOwner);
	if (!gotLock) {
		await markRetry(alertId, `Execution lock busy for ${lockKey}`);
		throw new Error(`Execution lock busy for ${lockKey}`);
	}

	try {
		const lagMs = Date.now() - Date.parse(normalizedAlert.receivedAt);
		queueLagMs.observe(lagMs);
		logInfo('worker.alert.start', {
			requestId,
			alertId,
			idempotencyKey,
			lockKey
		});

		const dexClient = new DexRegistry().getDex(normalizedAlert.exchange);
		if (!dexClient) {
			throw new Error(`Exchange ${normalizedAlert.exchange} is not supported`);
		}

		await transitionAlertState(alertId, 'SUBMITTED');
		const result = await dexClient.placeOrder(normalizedAlert);
		if (!result.success) {
			throw new Error(result.message || 'Order execution failed');
		}
		if (result.orderId) {
			await transitionAlertState(alertId, 'MINED', { txHash: result.orderId });
		}
		await transitionAlertState(alertId, 'CONFIRMED', {
			txHash: result.orderId
		});
		alertExecutionDurationMs.observe(Date.now() - startedAt);
		logInfo('worker.alert.confirmed', {
			requestId,
			alertId,
			idempotencyKey,
			txHash: result.orderId
		});
	} finally {
		await releaseExecutionLock(lockKey, lockOwner);
	}
}

async function main(): Promise<void> {
	validateRuntimeEnv({ requireQueue: true, role: 'worker' });
	const queueEvents = new QueueEvents(ALERT_QUEUE_NAME, {
		connection: getRedisConnection()
	});

	const worker = new Worker<EnqueuedAlertPayload>(
		ALERT_QUEUE_NAME,
		async (job) => {
			try {
				await processAlert(job.data);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Unknown worker failure';
				const failureType = classifyFailure(message);
				const { alertId } = job.data;
				if (failureType === 'retryable' && (job.attemptsMade + 1) < (job.opts.attempts || 1)) {
					await markRetry(alertId, message);
					logWarn('worker.alert.retrying', {
						alertId,
						idempotencyKey: job.data.idempotencyKey,
						attemptsMade: job.attemptsMade + 1,
						message
					});
					throw error;
				}
				await transitionAlertState(alertId, 'FAILED', { lastError: message });
				alertsTerminalFailedTotal.inc();
				await enqueueDeadLetter(job.data);
				logError('worker.alert.failed', {
					alertId,
					idempotencyKey: job.data.idempotencyKey,
					message,
					failureType
				});
				throw error;
			}
		},
		{
			connection: getRedisConnection(),
			concurrency: Number(process.env.ALERT_WORKER_CONCURRENCY || '4')
		}
	);

	worker.on('completed', (job) => {
		logInfo('worker.job.completed', {
			alertId: job.data.alertId,
			idempotencyKey: job.data.idempotencyKey
		});
	});
	worker.on('failed', (job, error) => {
		logWarn('worker.job.failed', {
			alertId: job?.data.alertId,
			idempotencyKey: job?.data.idempotencyKey,
			attemptsMade: job?.attemptsMade,
			message: error.message
		});
	});

	queueEvents.on('error', (error) => {
		logError('worker.queue.events.error', { message: error.message });
	});
	logInfo('worker.started', { queue: ALERT_QUEUE_NAME });
}

void main().catch((error) => {
	logError('worker.bootstrap.failed', {
		message: error instanceof Error ? error.message : String(error)
	});
	process.exitCode = 1;
});
