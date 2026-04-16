import express, { Router } from 'express';
import { validateAlert } from '../services';
import { DexRegistry } from '../services/dexRegistry';
import { normalizeAlert } from '../alerts/normalizeAlert';
import { buildIdempotencyKey } from '../alerts/idempotency';
import { enqueueAlert } from '../queue/alertsQueue';
import {
	createInitialAlertState,
	getAlertByIdempotency,
	getAlertState,
	transitionAlertState
} from '../state/alertStateStore';
import { AlertObject } from '../types';
import { validateWebhookAuth } from '../security/webhookAuth';
import { alertsAcceptedTotal, alertsDeduplicatedTotal, metricsContentType, renderMetrics } from '../observability/metrics';
import { pingRedis } from '../queue/connection';
import { logInfo, logWarn } from '../observability/logContext';

const router: Router = express.Router();

router.get('/', (_req, res) => {
	res.send('OK');
});

router.get('/health', (_req, res) => {
	res.status(200).json({ ok: true });
});

router.get('/ready', async (_req, res) => {
	const redisOk = await pingRedis();
	if (!redisOk) {
		res.status(503).json({ ok: false, redis: false });
		return;
	}
	res.status(200).json({ ok: true, redis: true });
});

router.get('/metrics', async (_req, res) => {
	res.setHeader('Content-Type', metricsContentType());
	res.status(200).send(await renderMetrics());
});

router.get('/accounts', async (_req, res) => {
	console.log('Received GET request.');

	const dexRegistry = new DexRegistry();
	const client = dexRegistry.getDex('gains');

	try {
		const ready = await client.getIsAccountReady();
		res.send({ Gains_gTrade: ready });
	} catch (error) {
		console.error('Failed to get account readiness:', error);
		res.status(500).send('Internal server error');
	}
});

router.get('/alerts/:alertId', async (req, res) => {
	const state = await getAlertState(req.params.alertId);
	if (!state) {
		res.status(404).json({ error: 'Alert not found' });
		return;
	}
	res.status(200).json(state);
});

async function enqueueAlertRequest(req: express.Request, res: express.Response) {
	const inbound = {
		rawBody: req.rawBody,
		rawBodyTrimmed: req.rawBodyTrimmed,
		parsed: req.body,
		strategyOrderAction:
			req.body && typeof (req.body as { strategyOrderAction?: unknown }).strategyOrderAction === 'string'
				? (req.body as { strategyOrderAction: string }).strategyOrderAction
				: undefined
	};
	console.log('[alert] inbound schema:', JSON.stringify(inbound));

	// Set WEBHOOK_SCHEMA_PROBE=true in .env to skip validateAlert + trading and return JSON (inspect payload shape).
	if (process.env.WEBHOOK_SCHEMA_PROBE === 'true') {
		res.status(200).json({ ok: true, ...inbound });
		return;
	}

	const auth = validateWebhookAuth(req);
	if (!auth.ok) {
		res.status(401).json({ error: auth.reason || 'Unauthorized webhook request' });
		return;
	}

	const validated = await validateAlert(req.body as AlertObject);
	if (!validated) {
		res.status(400).send('Error. alert message is not valid');
		return;
	}

	const normalized = normalizeAlert(req.body as AlertObject);
	const exchange = normalized.exchange;

	const dexClient = new DexRegistry().getDex(exchange);

	if (!dexClient) {
		res.status(400).send(`Error. Exchange: ${exchange} is not supported`);
		return;
	}

	try {
		const idempotencyKey = buildIdempotencyKey(normalized);
		const existing = await getAlertByIdempotency(idempotencyKey);
		if (existing) {
			alertsDeduplicatedTotal.inc();
			logWarn('api.alert.deduplicated', {
				requestId: req.requestId,
				alertId: existing.alertId,
				idempotencyKey
			});
			res.status(202).json({
				alertId: existing.alertId,
				idempotencyKey,
				status: existing.status,
				deduplicated: true
			});
			return;
		}

		if (normalized.position === 'flat') {
			await createInitialAlertState({
				alert: normalized,
				idempotency: idempotencyKey
			});
			await transitionAlertState(normalized.alertId, 'VALIDATED');
			await transitionAlertState(normalized.alertId, 'SKIPPED', {
				lastError: 'Skipped flat signal (accept-but-no-enqueue)'
			});
			logInfo('api.alert.skipped', {
				requestId: req.requestId,
				alertId: normalized.alertId,
				idempotencyKey,
				reason: 'flat'
			});
			res.status(202).json({
				alertId: normalized.alertId,
				idempotencyKey,
				status: 'SKIPPED',
				skipped: true
			});
			return;
		}

		const job = await enqueueAlert({
			alertId: normalized.alertId,
			idempotencyKey,
			normalizedAlert: normalized,
			requestId: req.requestId || 'unknown'
		});

		await createInitialAlertState({
			alert: normalized,
			idempotency: idempotencyKey,
			jobId: job.id?.toString()
		});
		await transitionAlertState(normalized.alertId, 'VALIDATED');
		await transitionAlertState(normalized.alertId, 'ENQUEUED');

		alertsAcceptedTotal.inc();
		logInfo('api.alert.accepted', {
			requestId: req.requestId,
			alertId: normalized.alertId,
			idempotencyKey,
			jobId: job.id
		});

		res.status(202).json({
			alertId: normalized.alertId,
			idempotencyKey,
			status: 'RECEIVED'
		});
	} catch (e) {
		res.status(500).json({
			error: e instanceof Error ? e.message : 'Error while accepting alert'
		});
	}
}

router.post('/', enqueueAlertRequest);
router.post('/alerts', enqueueAlertRequest);

export default router;
