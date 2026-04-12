import express, { Router } from 'express';
import { validateAlert } from '../services';
import { DexRegistry } from '../services/dexRegistry';

const router: Router = express.Router();

router.get('/', async (req, res) => {
	res.send('OK');
});

router.get('/accounts', async (req, res) => {
	console.log('Received GET request.');

	const dexRegistry = new DexRegistry();
	const client = dexRegistry.getDex('gains');

	try {
		const ready = client ? await client.getIsAccountReady() : false;
		res.send({ Gains_gTrade: ready });
	} catch (error) {
		console.error('Failed to get account readiness:', error);
		res.status(500).send('Internal server error');
	}
});

router.post('/', async (req, res) => {
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

	const validated = await validateAlert(req.body);
	if (!validated) {
		res.send('Error. alert message is not valid');
		return;
	}

	const exchange = req.body['exchange']?.toLowerCase() || 'gains';

	const dexClient = new DexRegistry().getDex(exchange);

	if (!dexClient) {
		res.send(`Error. Exchange: ${exchange} is not supported`);
		return;
	}

	try {
		await dexClient.placeOrder(req.body);
		res.send('OK');
	} catch (e) {
		res.send('error');
	}
});

export default router;
