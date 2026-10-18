'use strict';
/**
 * Preloaded with `node --require` before the tests. It points `mongoose`, `express`, `jsonwebtoken`, `express-rate-limit`
 * and `dotenv/config` at the test doubles in this folder, and sets the environment the server needs. Everything else
 * (zod, Node itself, all of Truth Market's own code) is the real thing.
 */
const Module = require('module');
const path = require('path');
const fakes = {
  mongoose: 'fakeMongoose.cjs',
  express: 'fakeExpress.cjs',
  jsonwebtoken: 'fakeJwt.cjs',
  'express-rate-limit': 'fakeRateLimit.cjs',
  'dotenv/config': 'fakeRateLimit.cjs',
};
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (fakes[request]) return path.join(__dirname, fakes[request]);
  return orig.call(this, request, ...rest);
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret-test-secret-test-secret-123456',
  MONGODB_URI: 'mongodb://fake/test',
  CHAPA_SECRET_KEY: 'CHASECK_TEST-unit-test-key',
  CHAPA_WEBHOOK_SECRET: 'whsec-unit-test',
});

// zod is the real library. If this machine has no node_modules (the build sandbox), look in the shared tools folder.
try {
  require.resolve('zod');
} catch {
  process.env.NODE_PATH = [process.env.NODE_PATH, '/opt/npm-tools/node_modules'].filter(Boolean).join(path.delimiter);
  Module._initPaths();
}
