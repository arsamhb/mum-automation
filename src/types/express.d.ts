import 'express-serve-static-core';

declare module 'express-serve-static-core' {
	interface Request {
		/** UTF-8 body as captured before JSON / text interpretation */
		rawBody?: string;
	}
}
