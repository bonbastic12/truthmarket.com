'use strict';
/**
 * TEST DOUBLE for the parts of Mongoose that Truth Market uses, backed by in-memory arrays.
 * It exists because the build sandbox cannot download the real packages. It is NOT MongoDB:
 * it implements the query/update/aggregation operators this project uses, unique indexes, upserts, populate,
 * and transactions (one at a time, with rollback), and nothing else. Run the same tests against a real MongoDB
 * replica set before trusting them with real money (see TESTING.md).
 */
const crypto = require('crypto');

class ObjectId {
  constructor(v) {
    if (v instanceof ObjectId) this.hex = v.hex;
    else if (typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v)) this.hex = v.toLowerCase();
    else if (v === undefined) this.hex = crypto.randomBytes(12).toString('hex');
    else throw new TypeError('Cast to ObjectId failed for value ' + String(v));
  }
  toString() { return this.hex; }
  toHexString() { return this.hex; }
  toJSON() { return this.hex; }
  equals(o) { return String(o) === this.hex; }
}
const isOid = (v) => v instanceof ObjectId;
const isValidObjectId = (v) => (typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v)) || isOid(v);

// ---------------------------------------------------------------- helpers
const clone = (v) => {
  if (v === null || typeof v !== 'object') return v;
  if (isOid(v)) return v; // immutable
  if (v instanceof Date) return new Date(v.getTime());
  if (Buffer.isBuffer(v)) return Buffer.from(v);
  if (Array.isArray(v)) return v.map(clone);
  const o = {};
  for (const k of Object.keys(v)) o[k] = clone(v[k]);
  return o;
};
const getPath = (o, p) => p.split('.').reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o);
const setPath = (o, p, v) => {
  const ks = p.split('.');
  let c = o;
  for (let i = 0; i < ks.length - 1; i++) {
    if (c[ks[i]] === undefined || c[ks[i]] === null) c[ks[i]] = {};
    c = c[ks[i]];
  }
  c[ks[ks.length - 1]] = v;
};
const unsetPath = (o, p) => {
  const ks = p.split('.');
  let c = o;
  for (let i = 0; i < ks.length - 1; i++) { if (!c[ks[i]]) return; c = c[ks[i]]; }
  delete c[ks[ks.length - 1]];
};
const norm = (v) => (isOid(v) ? v.hex : v instanceof Date ? v.getTime() : v);
const eq = (a, b) => {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (isOid(a) || isOid(b)) return String(a) === String(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a)) return a.some((x) => eq(x, b));
  return a === b;
};
const cmp = (a, b) => { const x = norm(a), y = norm(b); return x < y ? -1 : x > y ? 1 : 0; };

// ---------------------------------------------------------------- query matching
const isOpObject = (v) => v && typeof v === 'object' && !Array.isArray(v) && !isOid(v) && !(v instanceof Date) && !(v instanceof RegExp) && Object.keys(v).some((k) => k.startsWith('$'));

function matchField(val, cond) {
  if (cond instanceof RegExp) return typeof val === 'string' && cond.test(val);
  if (!isOpObject(cond)) return eq(val, cond);
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case '$in': return arg.some((x) => (x instanceof RegExp ? typeof val === 'string' && x.test(val) : eq(val, x)));
      case '$nin': return !arg.some((x) => eq(val, x));
      case '$ne': return !eq(val, arg);
      case '$gt': return val !== undefined && val !== null && cmp(val, arg) > 0;
      case '$gte': return val !== undefined && val !== null && cmp(val, arg) >= 0;
      case '$lt': return val !== undefined && val !== null && cmp(val, arg) < 0;
      case '$lte': return val !== undefined && val !== null && cmp(val, arg) <= 0;
      case '$exists': return (val !== undefined) === !!arg;
      case '$regex': return typeof val === 'string' && new RegExp(arg, cond.$options).test(val);
      default: throw new Error('fakeMongoose: unsupported query operator ' + op);
    }
  });
}
function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, cond]) => {
    if (k === '$or') return cond.some((f) => matches(doc, f));
    if (k === '$and') return cond.every((f) => matches(doc, f));
    return matchField(getPath(doc, k), cond);
  });
}

// ---------------------------------------------------------------- store + transactions
const store = new Map(); // model name -> docs
const models = new Map();
const rows = (name) => { if (!store.has(name)) store.set(name, []); return store.get(name); };
let txChain = Promise.resolve(); // transactions run one at a time
const hooks = []; // failure injection for tests

function maybeFail(modelName, method) {
  for (const h of hooks) {
    if (h.model === modelName && h.method === method && !h.done && h.when()) { h.done = true; throw new Error(h.message || 'injected failure'); }
  }
}

// ---------------------------------------------------------------- schema
class Schema {
  constructor(def, opts) { this.def = def || {}; this.opts = opts || {}; this.indexes = []; }
  index(spec, options) { this.indexes.push({ spec, options: options || {} }); return this; }
}
Schema.Types = { ObjectId: 'ObjectId', Mixed: 'Mixed' };

function defaultsFor(def, target) {
  for (const [k, f] of Object.entries(def)) {
    if (k === '_id') { if (f && f.default !== undefined && target._id === undefined) target._id = typeof f.default === 'function' ? f.default() : f.default; continue; }
    if (f && typeof f === 'object' && !Array.isArray(f) && !(f instanceof Schema) && 'default' in f && target[k] === undefined) {
      target[k] = typeof f.default === 'function' ? f.default() : clone(f.default);
    }
  }
}
const refOf = (schema, path) => { const f = schema.def[path]; return f && typeof f === 'object' ? f.ref : undefined; };

function uniqueSpecs(schema) {
  const out = [];
  for (const [k, f] of Object.entries(schema.def)) if (f && f.unique) out.push([k]);
  for (const ix of schema.indexes) if (ix.options.unique) out.push(Object.keys(ix.spec));
  return out;
}

// ---------------------------------------------------------------- query
class Query {
  constructor(model, op, args) { this.model = model; this.op = op; this.args = args; this._sel = null; this._pop = []; this._sort = null; this._skip = 0; this._limit = Infinity; }
  sort(s) { this._sort = s; return this; }
  skip(n) { this._skip = n; return this; }
  limit(n) { this._limit = n; return this; }
  select(s) { this._sel = s; return this; }
  populate(path, sel) { this._pop.push([path, sel]); return this; }
  lean() { return this; }
  session() { return this; }
  exec() { return this._run(); }
  then(a, b) { return this._run().then(a, b); }
  catch(b) { return this._run().catch(b); }
  async _run() {
    maybeFail(this.model.modelName, this.op);
    let res = this.model._exec(this.op, this.args, this);
    return res;
  }
}

function project(doc, sel) {
  if (!sel) return doc;
  const names = String(sel).split(/\s+/).filter(Boolean);
  const inc = names.filter((n) => !n.startsWith('-') && !n.startsWith('+'));
  if (!inc.length) return doc;
  const out = { _id: doc._id };
  for (const n of inc) { const v = getPath(doc, n); if (v !== undefined) setPath(out, n, v); }
  return out;
}

function sortDocs(list, sort) {
  if (!sort) return list;
  const keys = Object.entries(sort);
  return [...list].sort((a, b) => { for (const [k, d] of keys) { const c = cmp(getPath(a, k), getPath(b, k)); if (c) return c * d; } return 0; });
}

function makeModel(name, schema) {
  const M = {
    modelName: name, schema,
    find(filter) { return new Query(M, 'find', [filter]); },
    findOne(filter) { return new Query(M, 'findOne', [filter]); },
    findById(id) { return new Query(M, 'findOne', [{ _id: id }]); },
    findOneAndUpdate(f, u, o) { return new Query(M, 'findOneAndUpdate', [f, u, o || {}]); },
    countDocuments(f) { return new Query(M, 'countDocuments', [f]); },
    exists(f) { return new Query(M, 'exists', [f]); },
    updateOne(f, u, o) { return new Query(M, 'updateOne', [f, u, o || {}]); },
    updateMany(f, u, o) { return new Query(M, 'updateMany', [f, u, o || {}]); },
    deleteMany(f) { return new Query(M, 'deleteMany', [f]); },
    aggregate(p) { return new Query(M, 'aggregate', [p]); },
    async create(docs) {
      maybeFail(name, 'create');
      const arr = Array.isArray(docs) ? docs : [docs];
      const out = arr.map((d) => M._insert(clone(d)));
      return Array.isArray(docs) ? out.map(clone) : clone(out[0]);
    },
    async createIndexes() { return []; },
    _checkUnique(doc, ignore) {
      for (const spec of uniqueSpecs(schema)) {
        const clash = rows(name).find((r) => r !== ignore && spec.every((k) => eq(getPath(r, k), getPath(doc, k))));
        if (clash) { const e = new Error(`E11000 duplicate key error on ${name} ${spec.join('+')}`); e.code = 11000; throw e; }
      }
    },
    _insert(doc) {
      if (doc._id === undefined) doc._id = new ObjectId();
      defaultsFor(schema.def, doc);
      if (schema.opts.timestamps) { doc.createdAt = new Date(); doc.updatedAt = new Date(); }
      for (const [k, f] of Object.entries(schema.def)) {
        if (f && f.required && doc[k] === undefined) { const e = new Error(`${name} validation failed: ${k} is required`); e.name = 'ValidationError'; throw e; }
        if (f && f.min !== undefined && typeof doc[k] === 'number' && doc[k] < f.min) throw new Error(`${name}.${k} below min`);
        if (f && f.max !== undefined && typeof doc[k] === 'number' && doc[k] > f.max) throw new Error(`${name}.${k} above max`);
        if (f && Array.isArray(f.enum) && doc[k] !== undefined && !f.enum.includes(doc[k])) throw new Error(`${name}.${k}: ${doc[k]} is not a valid enum value`);
      }
      M._checkUnique(doc);
      rows(name).push(doc);
      return doc;
    },
    _apply(doc, update, inserting) {
      for (const [op, spec] of Object.entries(update)) {
        for (const [k, v] of Object.entries(spec)) {
          if (op === '$set') setPath(doc, k, clone(v));
          else if (op === '$setOnInsert') { if (inserting) setPath(doc, k, clone(v)); }
          else if (op === '$unset') unsetPath(doc, k);
          else if (op === '$inc') setPath(doc, k, (getPath(doc, k) || 0) + v);
          else if (op === '$push') { const a = getPath(doc, k) || []; a.push(clone(v)); setPath(doc, k, a); }
          else throw new Error('fakeMongoose: unsupported update operator ' + op);
        }
      }
      if (schema.opts.timestamps) doc.updatedAt = new Date();
    },
    _populate(doc, pops) {
      for (const [path, sel] of pops) {
        const ref = refOf(schema, path);
        const target = ref && models.get(ref);
        const id = doc[path];
        if (!target || id === undefined || id === null) continue;
        const found = rows(ref).find((r) => eq(r._id, id));
        if (found) doc[path] = clone(project(found, sel));
      }
      return doc;
    },
    _exec(op, args, q) {
      const R = rows(name);
      const finish = (d) => (d ? M._populate(project(clone(d), q._sel), q._pop) : d);
      switch (op) {
        case 'find': {
          let list = R.filter((d) => matches(d, args[0]));
          list = sortDocs(list, q._sort).slice(q._skip, q._skip + q._limit);
          return list.map(finish);
        }
        case 'findOne': { const d = R.find((x) => matches(x, args[0])); return finish(d) ?? null; }
        case 'countDocuments': return R.filter((d) => matches(d, args[0])).length;
        case 'exists': { const d = R.find((x) => matches(x, args[0])); return d ? { _id: d._id } : null; }
        case 'deleteMany': { const keep = R.filter((d) => !matches(d, args[0])); store.set(name, keep); return { deletedCount: R.length - keep.length }; }
        case 'updateOne': case 'updateMany': case 'findOneAndUpdate': {
          const [filter, update, opts] = args;
          let targets = R.filter((d) => matches(d, filter));
          if (op !== 'updateMany') targets = targets.slice(0, 1);
          let inserted = null;
          const before = targets.length ? clone(targets[0]) : null;
          if (!targets.length && opts.upsert) {
            const seed = {};
            for (const [k, c] of Object.entries(filter)) if (!k.startsWith('$') && !isOpObject(c)) setPath(seed, k, clone(c));
            M._apply(seed, update, true);
            inserted = M._insert(seed);
            targets = [inserted];
          } else for (const d of targets) M._apply(d, update, false);
          for (const d of targets) if (d !== inserted) M._checkUnique(d, d);
          if (op === 'findOneAndUpdate') {
            if (!targets.length) return null;
            if (opts.new) return finish(targets[0]);
            return before ? M._populate(project(before, q._sel), q._pop) : null; // without {new:true} Mongo returns the document as it was
          }
          return { matchedCount: targets.length, modifiedCount: targets.length, upsertedCount: inserted ? 1 : 0 };
        }
        case 'aggregate': return aggregate(R, args[0]);
        default: throw new Error('fakeMongoose: unsupported op ' + op);
      }
    },
  };
  return M;
}

// ---------------------------------------------------------------- aggregation ($match, $group with $sum, $sort, $limit)
const ISO_WEEK = (d) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return [t.getUTCFullYear(), Math.ceil(((t - y0) / 86400000 + 1) / 7)];
};
function dateToString(spec, doc) {
  const date = evalExpr(spec.date, doc);
  if (!(date instanceof Date)) return null;
  if (spec.timezone && spec.timezone !== 'Africa/Addis_Ababa') throw new Error('fakeMongoose: only Africa/Addis_Ababa (UTC+3, no DST) is supported');
  const d = new Date(date.getTime() + 3 * 3600000); // read the UTC fields of the shifted time = Ethiopian wall clock
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const [wy, ww] = ISO_WEEK(d);
  return spec.format.replace(/%Y/g, d.getUTCFullYear()).replace(/%m/g, p(d.getUTCMonth() + 1)).replace(/%d/g, p(d.getUTCDate())).replace(/%G/g, wy).replace(/%V/g, p(ww));
}
function evalExpr(e, doc) {
  if (typeof e === 'string' && e.startsWith('$')) return getPath(doc, e.slice(1));
  if (e && typeof e === 'object' && !Array.isArray(e) && !isOid(e) && !(e instanceof Date)) {
    if (e.$dateToString) return dateToString(e.$dateToString, doc);
    const o = {};
    for (const [k, v] of Object.entries(e)) o[k] = evalExpr(v, doc);
    return o;
  }
  return e;
}
const keyOf = (v) => JSON.stringify(v, (k, x) => (isOid(x) ? { $oid: x.hex } : x));
function aggregate(list, pipeline) {
  let cur = list.map(clone);
  for (const stage of pipeline) {
    const [op, arg] = Object.entries(stage)[0];
    if (op === '$match') cur = cur.filter((d) => matches(d, arg));
    else if (op === '$sort') cur = sortDocs(cur, arg);
    else if (op === '$limit') cur = cur.slice(0, arg);
    else if (op === '$group') {
      const groups = new Map();
      for (const d of cur) {
        const id = evalExpr(arg._id, d);
        const k = keyOf(id);
        if (!groups.has(k)) groups.set(k, { _id: id, _n: 0 });
        const g = groups.get(k);
        for (const [f, acc] of Object.entries(arg)) {
          if (f === '_id') continue;
          if (!('$sum' in acc)) throw new Error('fakeMongoose: only $sum accumulators are supported');
          const add = typeof acc.$sum === 'number' ? acc.$sum : Number(evalExpr(acc.$sum, d)) || 0;
          g[f] = (g[f] || 0) + add;
        }
      }
      cur = [...groups.values()].map(({ _n, ...g }) => g);
    } else throw new Error('fakeMongoose: unsupported aggregation stage ' + op);
  }
  return cur;
}

// ---------------------------------------------------------------- module surface
function model(name, schema) { const m = makeModel(name, schema); models.set(name, m); rows(name); return m; }

async function startSession() {
  return {
    async withTransaction(fn) {
      const run = async () => {
        const snap = new Map([...store.entries()].map(([k, v]) => [k, clone(v)]));
        try { await fn(); } catch (e) { store.clear(); for (const [k, v] of snap) store.set(k, v); throw e; }
      };
      const p = txChain.then(run, run);
      txChain = p.catch(() => {});
      return p;
    },
    async endSession() {},
  };
}

class ValidationError extends Error { constructor(m) { super(m); this.errors = {}; } }
class CastError extends Error {}

const mongoose = {
  Schema, model, startSession, isValidObjectId,
  Types: { ObjectId },
  Error: { ValidationError, CastError },
  models: new Proxy({}, { ownKeys: () => [...models.keys()], getOwnPropertyDescriptor: (_, k) => ({ enumerable: true, configurable: true, value: models.get(k) }), get: (_, k) => models.get(k) }),
  connection: { readyState: 1 },
  set() {}, async connect() {}, async disconnect() {},
  // test-only controls
  __test: {
    reset() { for (const k of [...store.keys()]) store.set(k, []); hooks.length = 0; txChain = Promise.resolve(); },
    all(name) { return rows(name).map(clone); },
    failOnce(modelName, method, when = () => true, message) { hooks.push({ model: modelName, method, when, message, done: false }); },
    ObjectId,
  },
};
mongoose.default = mongoose;
module.exports = mongoose;
