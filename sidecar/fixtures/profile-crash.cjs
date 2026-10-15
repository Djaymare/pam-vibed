const path = require('node:path');
const { createConfigStore } = require('../config-store.cjs');
const { DEFAULT_CONFIG } = require('../config-schema.cjs');
const [directory, boundary] = process.argv.slice(2);
const store = createConfigStore(directory, { checkpoint: async (stage, context) => {
  const target = context.target ? path.basename(context.target) : 'profile';
  if (`${stage}:${target}` === boundary) process.exit(86);
} });
store.write({ ...DEFAULT_CONFIG, language: 'en' }).then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
