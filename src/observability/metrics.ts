import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

const metricsEnabled = process.env.METRICS_ENABLED !== 'false';
const register = new Registry();

if (metricsEnabled) {
	collectDefaultMetrics({ register });
}

export const alertsAcceptedTotal = new Counter({
	name: 'tv_alerts_accepted_total',
	help: 'Number of accepted alerts',
	registers: [register]
});

export const alertsDeduplicatedTotal = new Counter({
	name: 'tv_alerts_deduplicated_total',
	help: 'Number of deduplicated alerts',
	registers: [register]
});

export const alertsTerminalFailedTotal = new Counter({
	name: 'tv_alerts_terminal_failed_total',
	help: 'Number of terminal failed alerts',
	registers: [register]
});

export const alertExecutionDurationMs = new Histogram({
	name: 'tv_alert_execution_duration_ms',
	help: 'Alert execution duration in milliseconds',
	buckets: [100, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000],
	registers: [register]
});

export const queueLagMs = new Histogram({
	name: 'tv_alert_queue_lag_ms',
	help: 'Queue lag from enqueue to worker start',
	buckets: [10, 50, 100, 250, 500, 1000, 5000, 10_000],
	registers: [register]
});

export async function renderMetrics(): Promise<string> {
	return register.metrics();
}

export function metricsContentType(): string {
	return register.contentType;
}
