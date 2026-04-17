import express from 'express';
import request from 'supertest';
import { captureWebhookBody } from '../src/middleware/captureWebhookBody';
import { attachRequestContext } from '../src/middleware/requestContext';

const stateById = new Map<string, any>();
const stateByKey = new Map<string, any>();

jest.mock('../src/services', () => ({
	validateAlert: jest.fn(async () => true)
}));

jest.mock('../src/services/dexRegistry', () => ({
	DexRegistry: jest.fn().mockImplementation(() => ({
		getDex: jest.fn(() => ({}))
	}))
}));

jest.mock('../src/queue/alertsQueue', () => ({
	enqueueAlert: jest.fn(async () => ({ id: 'job-1' }))
}));

jest.mock('../src/state/alertStateStore', () => ({
	createInitialAlertState: jest.fn(async ({ alert, idempotency, jobId }) => {
		const row = {
			alertId: alert.alertId,
			idempotencyKey: idempotency,
			jobId,
			status: 'RECEIVED'
		};
		stateById.set(alert.alertId, row);
		stateByKey.set(idempotency, row);
		return row;
	}),
	getAlertByIdempotency: jest.fn(async (key: string) => stateByKey.get(key) || null),
	getAlertState: jest.fn(async (id: string) => stateById.get(id) || null),
	transitionAlertState: jest.fn(async (alertId: string, status: string) => {
		const row = stateById.get(alertId);
		if (!row) return;
		stateById.set(alertId, { ...row, status });
	})
}));

jest.mock('../src/queue/connection', () => ({
	pingRedis: jest.fn(async () => true)
}));

jest.mock('../src/observability/metrics', () => ({
	alertsAcceptedTotal: { inc: jest.fn() },
	alertsDeduplicatedTotal: { inc: jest.fn() },
	metricsContentType: jest.fn(() => 'text/plain'),
	renderMetrics: jest.fn(async () => 'ok')
}));

describe('async webhook contract', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		stateById.clear();
		stateByKey.clear();
	});

	test('accepts webhook and returns 202 with IDs', async () => {
		const router = (await import('../src/controllers/index')).default;
		const app = express();
		app.use(express.text({ type: () => true }));
		app.use(captureWebhookBody);
		app.use(attachRequestContext);
		app.use(router);

		const payload = {
			exchange: 'gains',
			strategy: 'Aura',
			market: 'XAUUSD',
			sizeUsd: '1000',
			order: 'buy',
			position: 'long',
			price: '4776.610',
			reverse: false
		};

		const res = await request(app)
			.post('/alerts')
			.set('Content-Type', 'text/plain')
			.send(JSON.stringify(payload));
		expect(res.status).toBe(202);
		expect(res.body.alertId).toBeTruthy();
		expect(res.body.idempotencyKey).toBeTruthy();

		const status = await request(app).get(`/alerts/${res.body.alertId}`);
		expect(status.status).toBe(200);
		expect(status.body.status).toBe('ENQUEUED');
	});

	test('accepts flat signal and enqueues async execution', async () => {
		const { enqueueAlert } = await import('../src/queue/alertsQueue');
		const router = (await import('../src/controllers/index')).default;
		const app = express();
		app.use(express.text({ type: () => true }));
		app.use(captureWebhookBody);
		app.use(attachRequestContext);
		app.use(router);

		const payload = {
			exchange: 'gains',
			strategy: 'Aura',
			market: 'XAUUSD',
			order: 'buy',
			position: 'flat',
			price: '4776.610',
			reverse: false
		};

		const res = await request(app)
			.post('/alerts')
			.set('Content-Type', 'text/plain')
			.send(JSON.stringify(payload));
		expect(res.status).toBe(202);
		expect(res.body.status).toBe('RECEIVED');
		expect(enqueueAlert).toHaveBeenCalledTimes(1);

		const status = await request(app).get(`/alerts/${res.body.alertId}`);
		expect(status.status).toBe(200);
		expect(status.body.status).toBe('ENQUEUED');
	});

	test('deduplicates repeated alert payload', async () => {
		const router = (await import('../src/controllers/index')).default;
		const app = express();
		app.use(express.text({ type: () => true }));
		app.use(captureWebhookBody);
		app.use(attachRequestContext);
		app.use(router);

		const payload = {
			exchange: 'gains',
			strategy: 'Aura',
			market: 'XAUUSD',
			sizeUsd: '1000',
			order: 'buy',
			position: 'long',
			price: '4776.610',
			reverse: false
		};

		const first = await request(app)
			.post('/alerts')
			.set('Content-Type', 'text/plain')
			.send(JSON.stringify(payload));
		const second = await request(app)
			.post('/alerts')
			.set('Content-Type', 'text/plain')
			.send(JSON.stringify(payload));

		expect(first.status).toBe(202);
		expect(second.status).toBe(202);
		expect(second.body.deduplicated).toBe(true);
		expect(second.body.alertId).toBe(first.body.alertId);
	});
});
