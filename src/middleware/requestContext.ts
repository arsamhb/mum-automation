import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export function attachRequestContext(
	req: Request,
	res: Response,
	next: NextFunction
): void {
	const existing = req.header('x-request-id');
	const requestId = existing && existing.trim().length > 0 ? existing : randomUUID();
	req.requestId = requestId;
	res.setHeader('x-request-id', requestId);
	next();
}
