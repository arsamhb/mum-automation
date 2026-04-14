export {};

declare global {
	namespace Express {
		interface Request {
			/** UTF-8 body as captured before JSON / text interpretation */
			rawBody?: string;
			/** Same body after trim (TradingView often adds a leading newline) */
			rawBodyTrimmed?: string;
			/** Correlation id for ingress and downstream logs. */
			requestId?: string;
		}
	}
}
