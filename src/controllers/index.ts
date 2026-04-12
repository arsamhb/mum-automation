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
	const dexNames = [
		'dydxv4',
		'perpetual',
		'gmx',
		'bluefin',
		'hyperliquid',
		'grvt',
		'gains'
	];
	const dexClients = dexNames.map((name) => dexRegistry.getDex(name));

	try {
		const accountStatuses = await Promise.all(
			dexClients.map((client) => client.getIsAccountReady())
		);

		const message = {
			dYdX_v4: accountStatuses[0], // dydxv4
			PerpetualProtocol: accountStatuses[1], // perpetual
			GMX: accountStatuses[2], // gmx
			Bluefin: accountStatuses[3], // bluefin
			Hyperliquid: accountStatuses[4], // hyperliquid
			GRVT: accountStatuses[5], // grvt
			Gains_gTrade: accountStatuses[6] // gains
		};
		res.send(message);
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
		
	const exchange = req.body['exchange']?.toLowerCase() || 'dydx';

	const dexClient = new DexRegistry().getDex(exchange);

	if (!dexClient) {
		res.send(`Error. Exchange: ${exchange} is not supported`);
		return;
	}

	// TODO: add check if dex client isReady 

	try {
		const result = await dexClient.placeOrder(req.body);

		res.send('OK');
		// checkAfterPosition(req.body);
	} catch (e) {
		res.send('error');
	}
});

router.get('/debug-sentry', function mainHandler(req, res) {
	throw new Error('My first Sentry error!');
});

export default router;
