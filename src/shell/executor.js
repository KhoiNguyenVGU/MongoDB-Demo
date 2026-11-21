// Thực thi lệnh mongosh đã parse bằng MongoDB Node.js driver, kèm các rào chắn an toàn.
const { BSON } = require('mongodb');
const { parse } = require('./parser');
const { summarize } = require('../utils/explain');

const BATCH = 20; // như mongosh: mỗi lần in 20 documents, gõ "it" để xem tiếp
const MAX_TIME_MS = 15000;
const SYSTEM_DBS = new Set(['admin', 'local', 'config']);
const FORBIDDEN_OPS = new Set(['$where', '$function', '$accumulator']);
const RUN_COMMANDS = new Set([
  'ping', 'buildInfo', 'buildinfo', 'hello', 'isMaster', 'ismaster', 'dbStats', 'dbstats', 'collStats', 'collstats',
  'listCollections', 'listIndexes', 'count', 'distinct', 'connectionStatus', 'hostInfo', 'serverStatus',
]);

class ShellError extends Error {
  constructor(message, name = 'Error') { super(message); this.name = name; }
}
const blocked = (msg) => new ShellError(msg, 'Bị chặn');

const isSample = (db) => /^sample_/i.test(db);
const isEmptyFilter = (f) => f === undefined || f === null || (typeof f === 'object' && !Array.isArray(f) && Object.keys(f).length === 0);

function checkDbName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(name)) {
    throw new ShellError(`Tên database không hợp lệ: "${name}"`, 'MongoInvalidArgumentError');
  }
  if (SYSTEM_DBS.has(name.toLowerCase())) throw blocked(`database hệ thống "${name}" bị khóa trong console demo`);
  return name;
}
function checkCollName(name) {
  if (typeof name !== 'string' || !name || name.length > 120 || name.includes('$') || name.startsWith('system.')) {
    throw new ShellError(`Tên collection không hợp lệ: "${name}"`, 'MongoInvalidArgumentError');
  }
  return name;
}
function checkNoServerJs(value) {
  (function walk(v) {
    if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof RegExp) && !v._bsontype) {
      for (const k of Object.keys(v)) {
        if (FORBIDDEN_OPS.has(k)) throw blocked(`toán tử ${k} (chạy JavaScript phía server) không được phép`);
        walk(v[k]);
      }
    }
  })(value);
}
function sampleGuard(db, what) {
  if (isSample(db)) throw blocked(`${what} trên dữ liệu mẫu "${db}" không được phép (để demo không bị hỏng)`);
}
function guardWriteFilter(db, method, filter) {
  if (isSample(db) && isEmptyFilter(filter)) {
    throw blocked(`${method}({}) trên "${db}" sẽ tác động toàn bộ collection mẫu. Hãy thêm điều kiện lọc`);
  }
}
// $out / $merge không được ghi vào database hệ thống hoặc sample_*
function guardPipeline(db, pipeline) {
  if (!Array.isArray(pipeline)) throw new ShellError('aggregate() cần một mảng pipeline [ {...}, ... ]', 'MongoInvalidArgumentError');
  for (const stage of pipeline) {
    if (!stage || typeof stage !== 'object') continue;
    let target = null;
    if ('$out' in stage) target = typeof stage.$out === 'string' ? db : stage.$out?.db || db;
    if ('$merge' in stage) {
      const into = typeof stage.$merge === 'string' ? stage.$merge : stage.$merge?.into;
      target = into && typeof into === 'object' ? into.db || db : db;
    }
    if (target && (SYSTEM_DBS.has(String(target).toLowerCase()) || isSample(target))) {
      throw blocked(`$out/$merge vào database "${target}" không được phép`);
    }
  }
}

const COLL_METHODS = new Set([
  'find', 'findOne', 'aggregate', 'countDocuments', 'estimatedDocumentCount', 'count', 'distinct',
  'insertOne', 'insertMany', 'insert', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'remove',
  'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'bulkWrite',
  'createIndex', 'createIndexes', 'getIndexes', 'indexes', 'dropIndex', 'dropIndexes', 'drop', 'renameCollection',
  'stats', 'explain', 'getName', 'getFullName', 'exists', 'isCapped',
]);
const CURSOR_METHODS = new Set(['sort', 'limit', 'skip', 'project', 'projection', 'hint', 'collation', 'maxTimeMS',
  'comment', 'allowDiskUse', 'batchSize', 'pretty', 'toArray', 'count', 'size', 'itcount', 'explain', 'readPref', 'noCursorTimeout']);

// ---------- Chuyển AST thành chuỗi các bước ----------
function flatten(node) {
  const segs = [];
  let n = node;
  while (n.type === 'member' || n.type === 'call') {
    if (n.type === 'call') {
      if (n.callee.type !== 'member') throw new ShellError('Không gọi được giá trị này như một hàm', 'TypeError');
      segs.unshift({ name: n.callee.name, args: n.args });
      n = n.callee.object;
    } else {
      segs.unshift({ name: n.name });
      n = n.object;
    }
  }
  return { root: n, segs };
}

function literalArgs(args = []) {
  return args.map((a) => {
    if (a.type !== 'lit') throw new ShellError('Tham số phải là giá trị cố định, không được lồng lệnh db', 'SyntaxError');
    return a.value;
  });
}

// Bỏ các field nhiễu trong output explain
function pruneExplain(ex) {
  const { command, serverInfo, serverParameters, $clusterTime, operationTime, ...rest } = ex;
  return rest;
}

function writeResult(r) {
  if (!r || typeof r !== 'object') return r;
  const out = { acknowledged: r.acknowledged ?? true };
  if ('upsertedId' in r) out.insertedId = r.upsertedId; // mongosh hiển thị upsertedId là insertedId
  for (const k of ['insertedId', 'insertedIds', 'insertedCount', 'matchedCount', 'modifiedCount', 'deletedCount', 'upsertedCount', 'upsertedIds']) {
    if (r[k] !== undefined) out[k] = r[k];
  }
  return out;
}

class Executor {
  constructor(client, dbName) {
    this.client = client;
    this.dbName = dbName;
  }
  coll(db, name) { return this.client.db(checkDbName(db)).collection(checkCollName(name)); }

  async run(code, { itSkip = 0 } = {}) {
    const outputs = [];
    let stmts;
    try {
      stmts = parse(code);
    } catch (e) {
      outputs.push({ source: code.trim(), kind: 'error', error: `${e.name}: ${e.message}` });
      return { db: this.dbName, outputs };
    }
    for (const stmt of stmts) {
      const t = Date.now();
      try {
        const res = await this.statement(stmt, itSkip);
        outputs.push({ source: stmt.source, db: this.dbName, ms: Date.now() - t, ...res });
      } catch (e) {
        const name = e.name === 'MongoServerError' || e.name === 'Bị chặn' || e.name === 'SyntaxError' || e.name === 'TypeError' || e.name?.startsWith('Mongo') ? e.name : 'Error';
        outputs.push({ source: stmt.source, db: this.dbName, kind: 'error', error: `${name}: ${e.message}`, ms: Date.now() - t });
        break; // dừng script ở lệnh lỗi đầu tiên, như mongosh
      }
    }
    return { db: this.dbName, outputs };
  }

  async statement(stmt, itSkip) {
    switch (stmt.type) {
      case 'use': {
        if (!stmt.arg) throw new ShellError('Cú pháp: use <tên database>', 'SyntaxError');
        this.dbName = checkDbName(stmt.arg);
        return { kind: 'text', text: `switched to db ${this.dbName}` };
      }
      case 'show': return this.show(stmt.arg);
      case 'it': return { kind: 'text', text: 'no cursor' };
      case 'cls': return { kind: 'clear' };
      case 'help': return { kind: 'help' };
      default: return this.expression(stmt.expr, itSkip);
    }
  }

  async show(what) {
    const admin = this.client.db().admin();
    switch ((what || '').toLowerCase()) {
      case 'dbs':
      case 'databases': {
        const { databases } = await admin.listDatabases();
        const w = Math.max(...databases.map((d) => d.name.length));
        const size = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GiB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(2)} MiB` : `${(b / 1024).toFixed(2)} KiB`);
        return { kind: 'text', text: databases.map((d) => `${d.name.padEnd(w + 2)}${size(d.sizeOnDisk)}`).join('\n') };
      }
      case 'collections':
      case 'tables': {
        const cols = await this.client.db(checkDbName(this.dbName)).listCollections({}, { nameOnly: true }).toArray();
        return { kind: 'text', text: cols.map((c) => c.name).sort().join('\n') };
      }
      default:
        throw new ShellError(`Không hỗ trợ "show ${what}". Dùng: show dbs, show collections`, 'SyntaxError');
    }
  }

  async expression(node, itSkip) {
    if (node.type === 'lit') return { kind: 'value', value: node.value };
    if (node.type === 'print') {
      const vals = [];
      for (const a of node.args) vals.push(a.type === 'lit' ? a.value : (await this.expression(a, 0)).value);
      if (node.json) return { kind: 'value', value: vals[0] };
      return { kind: 'text', text: vals.map((v) => (typeof v === 'string' ? v : JSON.stringify(BSON.EJSON.serialize({ v }, { relaxed: true }).v))).join(' ') };
    }
    const { root, segs } = flatten(node);
    if (root.type !== 'db') throw new ShellError('Lệnh phải bắt đầu bằng db', 'SyntaxError');

    let cur = { kind: 'db', name: this.dbName };
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const args = s.args ? literalArgs(s.args) : undefined;
      if (args) checkNoServerJs(args);

      if (cur.kind === 'db') {
        if (!s.args) { cur = { kind: 'coll', db: cur.name, name: s.name }; continue; }
        cur = await this.dbMethod(cur.name, s.name, args);
      } else if (cur.kind === 'coll') {
        if (!s.args) {
          if (COLL_METHODS.has(s.name)) throw new ShellError(`Thiếu "()": viết ${s.name}(...)`, 'SyntaxError');
          cur = { ...cur, name: `${cur.name}.${s.name}` }; // collection có dấu chấm, vd. db.foo.bar
          continue;
        }
        cur = await this.collMethod(cur, s.name, args);
      } else if (cur.kind === 'explainer') {
        if (!s.args) throw new ShellError(`Thiếu "()" sau ${s.name}`, 'SyntaxError');
        cur = await this.explainVia(cur, s.name, args);
      } else if (cur.kind === 'find' || cur.kind === 'agg') {
        if (!s.args) throw new ShellError(`Thiếu "()" sau ${s.name}`, 'SyntaxError');
        cur = await this.cursorMethod(cur, s.name, args);
      } else {
        throw new ShellError(`Không gọi được .${s.name}${s.args ? '()' : ''} trên kết quả này`, 'TypeError');
      }
    }

    if (cur.kind === 'db') return { kind: 'text', text: cur.name };
    if (cur.kind === 'coll') return { kind: 'text', text: `${cur.db}.${cur.name}` };
    if (cur.kind === 'explainer') return { kind: 'text', text: `Explainable(${cur.db}.${cur.name})` };
    if (cur.kind === 'find' || cur.kind === 'agg') return this.printCursor(cur, itSkip);
    return cur.result;
  }

  // ---------- db.<method>() ----------
  async dbMethod(dbName, name, args) {
    const database = () => this.client.db(checkDbName(dbName));
    const value = (v) => ({ kind: 'done', result: { kind: 'value', value: v } });
    switch (name) {
      case 'getName': return value(dbName);
      case 'getCollection': return { kind: 'coll', db: dbName, name: checkCollName(String(args[0] ?? '')) };
      case 'getSiblingDB': return { kind: 'db', name: checkDbName(String(args[0] ?? '')) };
      case 'getCollectionNames': {
        const cols = await database().listCollections({}, { nameOnly: true }).toArray();
        return value(cols.map((c) => c.name).sort());
      }
      case 'getCollectionInfos': return value(await database().listCollections(args[0] || {}).toArray());
      case 'createCollection': {
        await database().createCollection(checkCollName(String(args[0] ?? '')), args[1] || {});
        return value({ ok: 1 });
      }
      case 'dropDatabase': {
        sampleGuard(dbName, 'dropDatabase()');
        await database().dropDatabase();
        return value({ ok: 1, dropped: dbName });
      }
      case 'stats': return value(await database().command({ dbStats: 1, scale: args[0] || 1 }));
      case 'runCommand': {
        const cmd = args[0];
        if (!cmd || typeof cmd !== 'object') throw new ShellError('runCommand() cần một object, vd. { ping: 1 }', 'MongoInvalidArgumentError');
        const verb = Object.keys(cmd)[0];
        if (!RUN_COMMANDS.has(verb)) throw blocked(`runCommand "${verb}" không được phép. Cho phép: ping, buildInfo, hello, dbStats, collStats, listCollections, listIndexes, count, distinct, connectionStatus, serverStatus`);
        const { $clusterTime, operationTime, ...res } = await database().command(cmd);
        return value(res);
      }
      case 'version': return value((await database().admin().buildInfo()).version);
      case 'help': return { kind: 'done', result: { kind: 'help' } };
      default:
        throw new ShellError(`db.${name}() không được hỗ trợ trong console này`, 'TypeError');
    }
  }

  // ---------- db.<coll>.<method>() ----------
  async collMethod(c, name, args) {
    const col = this.coll(c.db, c.name);
    const value = (v) => ({ kind: 'done', result: { kind: 'value', value: v } });
    const read = { maxTimeMS: MAX_TIME_MS };
    switch (name) {
      case 'find':
        return { kind: 'find', db: c.db, name: c.name, filter: args[0] || {}, projection: args[1], mods: [] };
      case 'aggregate': {
        const pipeline = Array.isArray(args[0]) ? args[0] : args.filter((a) => a && typeof a === 'object' && !Array.isArray(a));
        guardPipeline(c.db, pipeline);
        return { kind: 'agg', db: c.db, name: c.name, pipeline, options: Array.isArray(args[0]) ? args[1] || {} : {}, mods: [] };
      }
      case 'findOne': return value(await col.findOne(args[0] || {}, { ...(args[2] || {}), projection: args[1], ...read }));
      case 'countDocuments': return value(await col.countDocuments(args[0] || {}, { ...(args[1] || {}), ...read }));
      case 'count': return value(await col.countDocuments(args[0] || {}, read));
      case 'estimatedDocumentCount': return value(await col.estimatedDocumentCount());
      case 'distinct': return value(await col.distinct(String(args[0] ?? ''), args[1] || {}, read));
      case 'insertOne': {
        if (!args[0] || typeof args[0] !== 'object' || Array.isArray(args[0])) throw new ShellError('insertOne() cần một document { ... }', 'MongoInvalidArgumentError');
        return value(writeResult(await col.insertOne(args[0])));
      }
      case 'insert':
      case 'insertMany': {
        const docs = Array.isArray(args[0]) ? args[0] : [args[0]];
        if (!docs.length || docs.some((d) => !d || typeof d !== 'object' || Array.isArray(d))) throw new ShellError(`${name}() cần mảng các document`, 'MongoInvalidArgumentError');
        if (docs.length > 1000) throw blocked('tối đa 1000 documents mỗi lần insert trong console demo');
        return value(writeResult(await col.insertMany(docs, args[1] || {})));
      }
      case 'updateOne':
      case 'updateMany':
      case 'replaceOne': {
        if (name !== 'updateOne') guardWriteFilter(c.db, name, args[0]);
        if (!args[1] || typeof args[1] !== 'object') throw new ShellError(`${name}() cần filter và ${name === 'replaceOne' ? 'document thay thế' : 'update'}`, 'MongoInvalidArgumentError');
        return value(writeResult(await col[name](args[0] || {}, args[1], args[2] || {})));
      }
      case 'deleteOne': return value(writeResult(await col.deleteOne(args[0] || {})));
      case 'remove':
      case 'deleteMany': {
        guardWriteFilter(c.db, name, args[0]);
        return value(writeResult(await col.deleteMany(args[0] || {})));
      }
      case 'findOneAndUpdate':
      case 'findOneAndReplace':
        return value(await col[name](args[0] || {}, args[1], args[2] || {}));
      case 'findOneAndDelete': return value(await col.findOneAndDelete(args[0] || {}, args[1] || {}));
      case 'bulkWrite': {
        const ops = args[0];
        if (!Array.isArray(ops) || !ops.length) throw new ShellError('bulkWrite() cần mảng các thao tác', 'MongoInvalidArgumentError');
        if (ops.length > 1000) throw blocked('tối đa 1000 thao tác mỗi lần bulkWrite');
        for (const op of ops) {
          if (op?.deleteMany) guardWriteFilter(c.db, 'deleteMany', op.deleteMany.filter);
          if (op?.updateMany) guardWriteFilter(c.db, 'updateMany', op.updateMany.filter);
        }
        return value(writeResult(await col.bulkWrite(ops, args[1] || {})));
      }
      case 'createIndex': return value(await col.createIndex(args[0], args[1] || {}));
      case 'createIndexes': {
        const specs = (args[0] || []).map((key, idx) => ({ key, ...((args[1] || [])[idx] || args[1] || {}) }));
        return value(await col.createIndexes(specs));
      }
      case 'getIndexes':
      case 'indexes': return value(await col.indexes());
      case 'dropIndex':
      case 'dropIndexes': {
        if (isSample(c.db)) {
          if (name === 'dropIndexes' && (args[0] === undefined || args[0] === '*')) sampleGuard(c.db, 'dropIndexes() (xóa mọi index)');
          const targets = Array.isArray(args[0]) ? args[0] : [args[0]];
          const indexes = await col.indexes();
          for (const t of targets) {
            const ix = indexes.find((i) => (typeof t === 'string' ? i.name === t : JSON.stringify(i.key) === JSON.stringify(t)));
            if (ix && Object.values(ix.key).some((v) => v === 'text' || v === '2dsphere')) {
              throw blocked(`index "${ix.name}" là index ${Object.values(ix.key).includes('text') ? 'text' : '2dsphere'} mà ứng dụng cần (tìm kiếm / bản đồ)`);
            }
          }
        }
        if (name === 'dropIndex') {
          const { $clusterTime, operationTime, ...r } = await col.dropIndex(args[0]);
          return value(r);
        }
        if (args[0] === undefined) { await col.dropIndexes(); return value({ ok: 1, msg: 'non-_id indexes dropped for collection' }); }
        for (const t of (Array.isArray(args[0]) ? args[0] : [args[0]])) await col.dropIndex(t);
        return value({ ok: 1 });
      }
      case 'drop': {
        sampleGuard(c.db, 'drop()');
        return value(await col.drop());
      }
      case 'renameCollection': {
        sampleGuard(c.db, 'renameCollection()');
        await col.rename(checkCollName(String(args[0] ?? '')), { dropTarget: !!args[1] });
        return value({ ok: 1 });
      }
      case 'stats': {
        const [s] = await col.aggregate([{ $collStats: { storageStats: {}, count: {} } }]).toArray();
        return value(s);
      }
      case 'explain':
        return { kind: 'explainer', db: c.db, name: c.name, verbosity: args[0] || 'queryPlanner' };
      case 'getName': return value(c.name);
      case 'getFullName': return value(`${c.db}.${c.name}`);
      case 'exists': {
        const [info] = await this.client.db(c.db).listCollections({ name: c.name }).toArray();
        return value(info || null);
      }
      case 'isCapped': return value(!!(await col.isCapped()));
      default:
        throw new ShellError(`db.${c.name}.${name}() không được hỗ trợ trong console này`, 'TypeError');
    }
  }

  async explainVia(e, name, args) {
    const col = this.coll(e.db, e.name);
    const verbosity = e.verbosity === true ? 'allPlansExecution' : e.verbosity === false ? 'queryPlanner' : e.verbosity;
    if (name === 'find') return { kind: 'find', db: e.db, name: e.name, filter: args[0] || {}, projection: args[1], mods: [], explain: verbosity };
    if (name === 'aggregate') {
      guardPipeline(e.db, args[0]);
      return { kind: 'agg', db: e.db, name: e.name, pipeline: args[0], options: args[1] || {}, mods: [], explain: verbosity };
    }
    if (name === 'count' || name === 'countDocuments') {
      const ex = await this.client.db(e.db).command({ explain: { count: e.name, query: args[0] || {} }, verbosity });
      return { kind: 'done', result: this.explainOut(ex) };
    }
    if (name === 'distinct') {
      const ex = await this.client.db(e.db).command({ explain: { distinct: e.name, key: args[0], query: args[1] || {} }, verbosity });
      return { kind: 'done', result: this.explainOut(ex) };
    }
    void col;
    throw new ShellError(`explain() không hỗ trợ .${name}(); dùng find, aggregate, count hoặc distinct`, 'TypeError');
  }

  async cursorMethod(cur, name, args) {
    if (!CURSOR_METHODS.has(name)) throw new ShellError(`cursor.${name}() không được hỗ trợ (forEach/map cần hàm JavaScript)`, 'TypeError');
    if (cur.kind === 'agg' && !['toArray', 'explain', 'pretty', 'itcount', 'batchSize', 'maxTimeMS', 'comment', 'allowDiskUse'].includes(name)) {
      throw new ShellError(`aggregate cursor không có .${name}(); hãy dùng stage $${name === 'project' ? 'project' : name} trong pipeline`, 'TypeError');
    }
    switch (name) {
      case 'pretty':
      case 'batchSize':
      case 'readPref':
      case 'noCursorTimeout':
        return cur;
      case 'explain': {
        const v = args[0] === true ? 'allPlansExecution' : args[0] === false || args[0] === undefined ? 'queryPlanner' : args[0];
        return { kind: 'done', result: this.explainOut(await this.build({ ...cur, explain: undefined }).explain(v)) };
      }
      case 'toArray': {
        // Giới hạn 1000 documents để không làm treo trình duyệt
        const c = cur.kind === 'find' ? this.build(cur).limit(this.capLimit(cur)) : this.build(cur);
        const docs = [];
        try {
          // eslint-disable-next-line no-await-in-loop
          while (docs.length < 1000 && (await c.hasNext())) docs.push(await c.next());
        } finally { await c.close(); }
        return { kind: 'done', result: { kind: 'value', value: docs } };
      }
      case 'count':
      case 'size': {
        const col = this.coll(cur.db, cur.name);
        return { kind: 'done', result: { kind: 'value', value: await col.countDocuments(cur.filter || {}, { maxTimeMS: MAX_TIME_MS }) } };
      }
      case 'itcount': {
        let n = 0;
        const c = this.build(cur);
        // eslint-disable-next-line no-await-in-loop, no-unused-vars
        for await (const _ of c) n++;
        return { kind: 'done', result: { kind: 'value', value: n } };
      }
      default:
        return { ...cur, mods: [...cur.mods, { name: name === 'projection' ? 'project' : name, args }] };
    }
  }

  capLimit(cur) {
    const lim = cur.mods.filter((m) => m.name === 'limit').pop();
    const n = lim ? Number(lim.args[0]) || 0 : 0;
    return n > 0 ? Math.min(n, 1000) : 1000;
  }

  build(cur) {
    const col = this.coll(cur.db, cur.name);
    if (cur.kind === 'agg') {
      let c = col.aggregate(cur.pipeline, { maxTimeMS: MAX_TIME_MS, ...cur.options });
      for (const m of cur.mods) {
        if (m.name === 'maxTimeMS') c = c.maxTimeMS(Number(m.args[0]));
        if (m.name === 'comment') c = col.aggregate(cur.pipeline, { maxTimeMS: MAX_TIME_MS, ...cur.options, comment: m.args[0] });
        if (m.name === 'allowDiskUse') c = col.aggregate(cur.pipeline, { maxTimeMS: MAX_TIME_MS, ...cur.options, allowDiskUse: m.args[0] !== false });
      }
      return c;
    }
    let c = col.find(cur.filter, { maxTimeMS: MAX_TIME_MS });
    if (cur.projection) c = c.project(cur.projection);
    for (const m of cur.mods) {
      const a = m.args;
      switch (m.name) {
        case 'sort': c = c.sort(a[0]); break;
        case 'limit': c = c.limit(Number(a[0]) || 0); break;
        case 'skip': c = c.skip(Number(a[0]) || 0); break;
        case 'project': c = c.project(a[0]); break;
        case 'hint': c = c.hint(a[0]); break;
        case 'collation': c = c.collation(a[0]); break;
        case 'maxTimeMS': c = c.maxTimeMS(Math.min(Number(a[0]) || MAX_TIME_MS, MAX_TIME_MS)); break;
        case 'comment': c = c.comment(a[0]); break;
        case 'allowDiskUse': c = c.allowDiskUse(a[0] !== false); break;
        default: break;
      }
    }
    return c;
  }

  explainOut(ex) {
    let summary = null;
    try { summary = ex.queryPlanner || ex.stages ? summarize(ex.queryPlanner ? ex : ex.stages?.[0]?.$cursor || ex) : null; } catch { summary = null; }
    if (summary && !summary.plan) summary = null;
    return { kind: 'explain', value: pruneExplain(ex), summary };
  }

  async printCursor(cur, itSkip) {
    if (cur.explain) {
      return this.explainOut(await this.build(cur).explain(cur.explain));
    }
    const c = this.build(cur);
    try {
      for (let k = 0; k < itSkip; k++) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await c.hasNext())) break;
        // eslint-disable-next-line no-await-in-loop
        await c.next();
      }
      const docs = [];
      // eslint-disable-next-line no-await-in-loop
      while (docs.length < BATCH && (await c.hasNext())) docs.push(await c.next());
      const more = await c.hasNext();
      return { kind: 'cursor', value: docs, more, shown: itSkip + docs.length };
    } finally {
      await c.close();
    }
  }
}

async function runShell(client, { code, db, itSkip }) {
  let start = 'sample_mflix';
  try { start = checkDbName(db || 'sample_mflix'); } catch { /* dùng mặc định */ }
  const ex = new Executor(client, start);
  const res = await ex.run(String(code), { itSkip: Math.max(0, Math.min(Number(itSkip) || 0, 100000)) });
  // Chuyển BSON -> Extended JSON để gửi về trình duyệt
  res.outputs = res.outputs.map((o) => ('value' in o ? { ...o, value: BSON.EJSON.serialize({ v: o.value }, { relaxed: true }).v } : o));
  return res;
}

module.exports = { runShell };
