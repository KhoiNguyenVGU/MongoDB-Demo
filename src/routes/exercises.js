// Chạy các bài tập trong tài liệu "MongoDB Demo Exercise" (chỉ những query đã định nghĩa sẵn)
const router = require('express').Router();
const { BSON } = require('mongodb');
const db = require('../db');
const { notFound, userDbName, collName } = require('../utils/validate');
const { QUERY_BY_ID, publicExercises } = require('../exercises');
const { requireAdmin } = require('../utils/role');

const toEJSON = (v) => BSON.EJSON.serialize({ v }, { relaxed: true }).v;
const DEFAULT_DB = 'movie_demo';
const DEFAULT_COLL = 'watchlist';

// Database/collection mà Bài 3 thao tác (người dùng có thể đổi tên). Chặn database hệ thống và sample_*.
function exerciseTarget(src = {}) {
  const dbName = userDbName(src.db || DEFAULT_DB, 'Tên database');
  const coll = collName(src.collection || src.coll || DEFAULT_COLL, 'Tên collection');
  const database = db.getClient().db(dbName);
  return { dbName, collName: coll, db: database, collection: database.collection(coll) };
}

router.get('/', (req, res) => {
  res.json({ data: publicExercises(), defaults: { db: DEFAULT_DB, collection: DEFAULT_COLL } });
});

// Trạng thái hiện tại: collection của Bài 3 có bao nhiêu docs, index runtime còn không
router.get('/state', async (req, res) => {
  const target = exerciseTarget(req.query);
  const [count, indexes] = await Promise.all([
    target.collection.countDocuments(),
    db.mflix().collection('movies').indexes(),
  ]);
  const runtime = indexes.find((i) => i.key && Object.keys(i.key).length === 1 && i.key.runtime === 1);
  res.json({ data: { db: target.dbName, collection: target.collName, count, runtimeIndex: runtime ? runtime.name : null } });
});

router.post('/run/:id', async (req, res) => {
  const q = QUERY_BY_ID.get(req.params.id);
  if (!q) throw notFound('Không có query này trong bài tập');
  if (q.write) requireAdmin(req); // User chỉ được chạy các query đọc
  const ctx = { mflix: db.mflix, demo: db.demo };
  if (q.configurable) ctx.target = exerciseTarget(req.body || {});
  const t = Date.now();
  let out = await q.run(ctx);
  const ms = Date.now() - t;
  if (!(out && typeof out === 'object' && 'kind' in out && 'value' in out)) {
    out = { kind: Array.isArray(out) ? 'docs' : 'value', value: out };
  }
  res.json({ id: q.id, db: ctx.target ? ctx.target.dbName : q.db, kind: out.kind, value: toEJSON(out.value), ms });
});

module.exports = router;
