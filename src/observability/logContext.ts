type LogLevel = 'log' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

function emit(level: LogLevel, event: string, context: LogContext): void {
	const payload = {
		event,
		ts: new Date().toISOString(),
		...context
	};
	console[level](JSON.stringify(payload));
}

export function logInfo(event: string, context: LogContext): void {
	emit('log', event, context);
}

export function logWarn(event: string, context: LogContext): void {
	emit('warn', event, context);
}

export function logError(event: string, context: LogContext): void {
	emit('error', event, context);
}
