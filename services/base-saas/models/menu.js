const menuSchemaDefinition = require('./menuSchemaDefinition');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');

async function getMenuModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.Menu || conn.model('Menu', menuSchemaDefinition, 'mainmenu');
}

module.exports = getMenuModel;
