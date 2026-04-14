import express from 'express';
import controller from './controllers/index';
import { captureWebhookBody } from './middleware/captureWebhookBody';
import { installAxiosHttpLogging, logExpressHttpTraffic } from './middleware/httpLogging';
import * as Sentry from '@sentry/node';
import * as Tracing from '@sentry/tracing';
import { CaptureConsole as CaptureConsoleIntegration } from '@sentry/integrations';
import helmet from 'helmet';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { attachRequestContext } from './middleware/requestContext';
import { validateRuntimeEnv } from './config/validateEnv';

// Load .env from Render secret files path, fallback to local
const renderEnvPath = '/etc/secrets/.env';
if (fs.existsSync(renderEnvPath)) {
	dotenv.config({ path: renderEnvPath });
} else {
	dotenv.config();
}

const app: express.Express = express();
const port = process.env.PORT || 3000;
installAxiosHttpLogging();
validateRuntimeEnv({ requireQueue: true, role: 'api' });

if (process.env.SENTRY_DNS) {
	Sentry.init({
		dsn: process.env.SENTRY_DNS,
		integrations: [
			// enable HTTP calls tracing
			new Sentry.Integrations.Http({ tracing: true }),
			// enable Express.js middleware tracing
			new Tracing.Integrations.Express({ app }),
			new CaptureConsoleIntegration({
				// array of methods that should be captured
				// defaults to ['log', 'info', 'warn', 'error', 'debug', 'assert']
				levels: ['error']
			})
		],

		// Set tracesSampleRate to 1.0 to capture 100%
		// of transactions for performance monitoring.
		// We recommend adjusting this value in production
		tracesSampleRate: 1.0
	});

	app.use(Sentry.Handlers.requestHandler());
	app.use(Sentry.Handlers.tracingHandler());

	console.log('initialized Sentry.io');
}

app.use(helmet());
app.use(attachRequestContext);

// TradingView usually sends Content-Type: text/plain; the body is a string, not a pre-parsed object.
// Read as UTF-8 text first, then JSON.parse in captureWebhookBody (same idea as express.text + manual parse).
app.use(express.text({ type: () => true, limit: '10mb', defaultCharset: 'utf-8' }));
app.use(captureWebhookBody);
app.use(logExpressHttpTraffic);

app.use('/', controller);

if (process.env.SENTRY_DNS) {
	app.use(Sentry.Handlers.errorHandler());
}

app.listen(port, () => {
	const p = Number(port);
	console.log(`TV-Connector web server listening on port ${p}`);
	console.log(`Local only:    http://127.0.0.1:${p}/`);
	console.log(
		'TradingView needs a public HTTPS URL. Run a tunnel in another terminal, e.g.: npx ngrok http ' +
			p +
			'  — then paste the https://… URL + trailing slash as the alert webhook.'
	);

	const expose = process.env.WEBHOOK_EXPOSE_NGROK;
	if (expose === '1' || expose === 'true') {
		void (async () => {
			try {
				const ngrok = (await import('ngrok')).default;
				const url = await ngrok.connect({
					addr: p,
					...(process.env.NGROK_AUTHTOKEN
						? { authtoken: process.env.NGROK_AUTHTOKEN }
						: {})
				});
				const base = url.endsWith('/') ? url : `${url}/`;
				console.log(`>>> TradingView webhook URL: ${base}`);
			} catch (e) {
				console.error(
					'WEBHOOK_EXPOSE_NGROK: could not start ngrok (install deps, run ngrok config add-authtoken, or use a manual tunnel).',
					e
				);
			}
		})();
	}
});
