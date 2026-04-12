import express from 'express';
import controller from './controllers/index';
import { captureWebhookBody } from './middleware/captureWebhookBody';
import * as Sentry from '@sentry/node';
import * as Tracing from '@sentry/tracing';
import { CaptureConsole as CaptureConsoleIntegration } from '@sentry/integrations';
import helmet from 'helmet';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Load .env from Render secret files path, fallback to local
const renderEnvPath = '/etc/secrets/.env';
if (fs.existsSync(renderEnvPath)) {
	dotenv.config({ path: renderEnvPath });
} else {
	dotenv.config();
}

const app: express.Express = express();
const port = process.env.PORT || 3000;

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

// TradingView usually sends Content-Type: text/plain; the body is a string, not a pre-parsed object.
// Read as UTF-8 text first, then JSON.parse in captureWebhookBody (same idea as express.text + manual parse).
app.use(express.text({ type: () => true, limit: '10mb', defaultCharset: 'utf-8' }));
app.use(captureWebhookBody);

app.use('/', controller);

if (process.env.SENTRY_DNS) {
	app.use(Sentry.Handlers.errorHandler());
}

app.listen(port, () => {
	console.log(`TV-Connector web server listening on port ${port}`);
});
