import IORedis from 'ioredis';

let redisSingleton: IORedis | undefined;

export function getRedisConnection(): IORedis {
	if (redisSingleton) return redisSingleton;
	const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
	redisSingleton = new IORedis(redisUrl, {
		maxRetriesPerRequest: null,
		enableReadyCheck: true
	});
	return redisSingleton;
}

export async function pingRedis(): Promise<boolean> {
	try {
		const pong = await getRedisConnection().ping();
		return pong === 'PONG';
	} catch {
		return false;
	}
}
