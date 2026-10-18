'use strict';
/** TEST DOUBLE for jsonwebtoken (HS256 only), enough for sign/verify with expiry. */
const crypto = require('crypto');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mac = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
module.exports = {
  sign(payload, secret, opts = {}) {
    const now = Math.floor(Date.now() / 1000);
    const body = { ...payload, iat: now, ...(opts.expiresIn ? { exp: now + opts.expiresIn } : {}) };
    const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(body)}`;
    return `${data}.${mac(data, secret)}`;
  },
  verify(token, secret) {
    const [h, p, s] = String(token).split('.');
    if (!h || !p || !s || mac(`${h}.${p}`, secret) !== s) throw new Error('invalid signature');
    const body = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) throw new Error('jwt expired');
    return body;
  },
};
