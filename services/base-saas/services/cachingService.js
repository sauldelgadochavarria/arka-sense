const mongoose = require('mongoose');
const dbConfig = require('../config/db');

const FIXED_CONNECTIONS = { CONFIG: 'config' };
const connectionCache = new Map();

async function getFixedMongooseConnection(connectionType) {
  if (connectionType !== FIXED_CONNECTIONS.CONFIG) {
    throw new Error(`Conexión no soportada: ${connectionType}`);
  }

  const cacheKey = 'fixed_config';
  if (connectionCache.has(cacheKey)) {
    const cached = connectionCache.get(cacheKey);
    if (cached.readyState === 1) return cached;
    connectionCache.delete(cacheKey);
  }

  const connection = mongoose.createConnection(dbConfig.connectionStringConfig);
  await new Promise((resolve, reject) => {
    if (connection.readyState === 1) return resolve();
    connection.once('connected', resolve);
    connection.once('error', reject);
  });

  connectionCache.set(cacheKey, connection);
  return connection;
}

module.exports = {
  getFixedMongooseConnection,
  FIXED_CONNECTIONS
};
