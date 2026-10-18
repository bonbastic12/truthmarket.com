'use strict';
/** TEST DOUBLE for the slice of Express used by the routes: Router, json, raw, and a dispatcher that runs a request through a router. */
class Router {
  constructor() { this.stack = []; }
  _add(method, path, handlers) { this.stack.push({ method, path, handlers: handlers.flat() }); return this; }
  use(...a) { const path = typeof a[0] === 'string' ? a.shift() : null; this.stack.push({ method: null, path, handlers: a.flat(), isUse: true }); return this; }
  get(p, ...h) { return this._add('GET', p, h); }
  post(p, ...h) { return this._add('POST', p, h); }
  put(p, ...h) { return this._add('PUT', p, h); }
  patch(p, ...h) { return this._add('PATCH', p, h); }
  delete(p, ...h) { return this._add('DELETE', p, h); }
}
const routerFactory = () => new Router();
function express() { throw new Error('the fake express() app is not available; use Router'); }
express.Router = routerFactory;
express.json = () => function json(req, _res, next) { if (req.rawBody !== undefined && req.body === undefined) req.body = JSON.parse(req.rawBody); next(); };
express.raw = () => function raw(req, _res, next) { req.body = Buffer.from(req.rawBody ?? ''); next(); };

const compile = (pattern) => {
  const names = [];
  const re = new RegExp('^' + pattern.replace(/\/:([A-Za-z]+)/g, (_, n) => { names.push(n); return '/([^/]+)'; }) + '/?$');
  return { re, names };
};

/** Runs a request through the router like Express would (sequential middleware, next(err), error handler). */
async function dispatch(router, input, errorHandler) {
  const url = new URL(input.url, 'http://x');
  const req = {
    method: input.method || 'GET', originalUrl: input.url, url: url.pathname,
    headers: Object.fromEntries(Object.entries(input.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
    query: Object.fromEntries(url.searchParams), params: {}, body: input.body, rawBody: input.rawBody,
  };
  const out = { status: 200, headers: {}, body: undefined, sent: false, handled: false };
  let finish;
  const done = new Promise((r) => { finish = r; });
  const res = {
    status(c) { out.status = c; return res; },
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; return res; },
    json(b) { out.body = b; out.sent = true; finish(); return res; },
    send(b) { out.body = b; out.sent = true; finish(); return res; },
    end() { out.sent = true; finish(); return res; },
    get headersSent() { return out.sent; },
  };
  const chain = [];
  for (const layer of router.stack) {
    if (layer.isUse) { chain.push({ fns: layer.handlers, params: {} }); continue; }
    if (layer.method !== req.method) continue;
    const { re, names } = compile(layer.path);
    const m = re.exec(req.url);
    if (!m) continue;
    chain.push({ fns: layer.handlers, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])), terminal: true });
  }
  const fns = [];
  for (const c of chain) for (const f of c.fns) fns.push({ f, params: c.params });
  out.handled = chain.some((c) => c.terminal);
  let i = 0;
  const next = async (err) => {
    if (err) {
      if (!errorHandler) { out.error = err; return finish(); }
      await errorHandler(err, req, res, () => {});
      return finish();
    }
    if (out.sent) return;
    if (i >= fns.length) return finish(); // nothing answered: Express would fall through to 404
    const { f, params } = fns[i++];
    Object.assign(req.params, params);
    try { await f(req, res, next); } catch (e) { await next(e); }
  };
  await next();
  // Handlers wrapped by asyncHandler return before their work is done, so wait until something answers.
  await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('fakeExpress: request never finished: ' + req.method + ' ' + req.originalUrl)), 10_000).unref())]);
  return out;
}

module.exports = express;
module.exports.default = express;
module.exports.Router = routerFactory;
module.exports.Request = undefined;
module.exports.__dispatch = dispatch;
