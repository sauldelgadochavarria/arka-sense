'use strict';

function readEnvOrFile(name) {
  const fileVar = `${name}_FILE`;
  if (process.env[fileVar]) {
    try {
      const fs = require('fs');
      return fs.readFileSync(process.env[fileVar], 'utf8').trim();
    } catch {
      return '';
    }
  }
  return String(process.env[name] || '').trim();
}

const connectionStringConfig =
  readEnvOrFile('MONGO_URI') ||
  readEnvOrFile('BASE_MONGO_URI') ||
  'mongodb://localhost:27020/config';

module.exports = {
  connectionStringConfig
};
