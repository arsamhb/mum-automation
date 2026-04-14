import { JsonDB } from 'node-json-db';
import { Config } from 'node-json-db/dist/lib/JsonDBConfig';
import config = require('config');

export const _sleep = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms));

export const getStrategiesDB = () => {
	const environment =
		config.util.getEnv('NODE_ENV') == 'production' ? 'mainnet' : 'testnet';
	const dbName = './data/strategies/' + environment + '/myStrategies';
	const db = new JsonDB(new Config(dbName, true, true, '/'));
	const rootData = db.getData('/');
	return [db, rootData];
};
