'use strict';
const pass = () => (_req, _res, next) => next();
module.exports = { rateLimit: pass };
