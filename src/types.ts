export type AlertObject = {
	exchange: string;
	strategy: string;
	market: string;
	size?: number;
	sizeUsd?: number;
	sizeByLeverage?: number;
	leverage?: number;
	levrage?: number;
	Levrage?: number;
	tp?: number | string;
	sl?: number | string;
	order: string;
	price: number;
	position: string;
	reverse: boolean;
	passphrase?: string;
	collateral?: string;
};

export type AlertLifecycleStatus =
	| 'RECEIVED'
	| 'VALIDATED'
	| 'ENQUEUED'
	| 'EXECUTING'
	| 'SUBMITTED'
	| 'MINED'
	| 'RETRYING'
	| 'CONFIRMED'
	| 'FAILED';

export type NormalizedAlert = AlertObject & {
	alertId: string;
	schemaVersion: string;
	sourceTimestamp: string;
	receivedAt: string;
	exchange: string;
	order: 'buy' | 'sell';
	position: 'long' | 'short' | 'flat';
	leverage?: number;
};

export type AlertStateRecord = {
	alertId: string;
	idempotencyKey: string;
	status: AlertLifecycleStatus;
	createdAt: string;
	updatedAt: string;
	exchange: string;
	strategy: string;
	market: string;
	order: string;
	position: string;
	retryCount: number;
	lastError?: string;
	txHash?: string;
	jobId?: string;
};

export type EnqueuedAlertPayload = {
	alertId: string;
	idempotencyKey: string;
	normalizedAlert: NormalizedAlert;
	requestId: string;
};

export interface OrderResult {
	size: number;
	side: string;
	orderId: string;
}

export type PlaceOrderResult = {
	success: boolean;
	skipped?: boolean;
	message?: string;
	orderId?: string;
};
