// Query Explorer: so sánh execution plan có index vs ép COLLSCAN ($natural hint)
const router = require('express').Router();
const { BSON } = require('mongodb');
const { mflix } = require('../db');
const { bad, notFound, toInt, describe, requireBody } = require('../utils/validate');

let sampleMovieId = null;

async function getSamples() {
  if (!sampleMovieId) {
    // Phim có nhiều comment nhất -> query comments theo movie_id cho kết quả đáng xem
    const top = await mflix().collection('movies')
      .find({ num_mflix_comments: { $type: 'number' } }, { projection: { _id: 1 } })
      .sort({ num_mflix_comments: -1 }).limit(1).next();
    sampleMovieId = top?._id;
  }
  return [
    {
      key: 'year', title: 'Phim phát hành năm 1999', collection: 'movies',
      filter: { year: 1999 }, note: 'Dùng index { year: -1 }',
    },
    {
      key: 'genre-rating', title: 'Phim Comedy có IMDb ≥ 8, sort theo rating', collection: 'movies',
      filter: { genres: 'Comedy', 'imdb.rating': { $gte: 8 } }, sort: { 'imdb.rating': -1 },
      note: 'Compound index { genres: 1, imdb.rating: -1 }: lọc và sort đều dùng index, không cần SORT stage',
    },
    {
      key: 'runtime', title: 'Phim dài hơn 200 phút', collection: 'movies',
      filter: { runtime: { $gt: 200 } }, note: 'Range query trên index { runtime: 1 }',
    },
    {
      key: 'comments', title: 'Comments của một phim, mới nhất trước', collection: 'comments',
      filter: { movie_id: sampleMovieId }, sort: { date: -1 },
      note: 'Index { movie_id: 1, date: -1 } trên 41k comments',
    },
    {
      key: 'email', title: 'Tìm user theo email', collection: 'users',
      filter: { email: 'sean_bean@gameofthron.es' }, note: 'Index { email: 1 }',
    },
    {
      key: 'country', title: 'Phim sản xuất tại Vietnam', collection: 'movies',
      filter: { countries: 'Vietnam' }, note: 'KHÔNG có index trên countries → luôn là COLLSCAN',
    },
  ];
}

// Rút gọn output explain() thành vài chỉ số chính
function summarize(ex) {
  let root = ex.queryPlanner?.winningPlan;
  if (root?.queryPlan) root = root.queryPlan; // định dạng của SBE engine
  const stages = [];
  const indexes = new Set();
  (function walk(n) {
    if (!n) return;
    stages.push(n.stage);
    if (n.indexName) indexes.add(n.indexName);
    if (n.inputStage) walk(n.inputStage);
    if (n.inputStages) n.inputStages.forEach(walk);
  })(root);
  const es = ex.executionStats || {};
  return {
    plan: stages.join(' ← '),
    index: indexes.size ? [...indexes].join(', ') : null,
    nReturned: es.nReturned,
    totalKeysExamined: es.totalKeysExamined,
    totalDocsExamined: es.totalDocsExamined,
    executionTimeMillis: es.executionTimeMillis,
  };
}

function explainFind(collection, filter, sort, hint) {
  let cursor = mflix().collection(collection).find(filter, { maxTimeMS: 10000 });
  if (sort) cursor = cursor.sort(sort);
  if (hint) cursor = cursor.hint(hint);
  return cursor.explain('executionStats');
}

router.get('/samples', async (req, res) => {
  const samples = await getSamples();
  res.json({ data: samples.map((s) => ({ ...s, ...BSON.EJSON.serialize({ filter: s.filter, sort: s.sort }, { relaxed: true }) })) });
});

router.get('/run/:key', async (req, res) => {
  const s = (await getSamples()).find((x) => x.key === req.params.key);
  if (!s) throw notFound('Không có query mẫu này');
  const [withIndex, collscan] = await Promise.all([
    explainFind(s.collection, s.filter, s.sort),
    explainFind(s.collection, s.filter, s.sort, { $natural: 1 }),
  ]);
  res.json({
    data: { indexed: summarize(withIndex), collscan: summarize(collscan) },
    query: describe(s.collection, 'find', { filter: s.filter, sort: s.sort }),
  });
});

// Chạy find() tùy ý (chỉ đọc) trên các collection cho phép
const ALLOWED = ['movies', 'comments', 'users', 'theaters'];
const FORBIDDEN = new Set(['$where', '$function', '$accumulator']);

function parseJson(text, label) {
  if (!text || !String(text).trim()) return {};
  let v;
  try {
    v = BSON.EJSON.parse(String(text), { relaxed: true });
  } catch (e) {
    throw bad(`${label} không phải JSON hợp lệ: ${e.message}`);
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(`${label} phải là một object`);
  (function check(o) {
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (FORBIDDEN.has(k)) throw bad(`Không cho phép toán tử ${k}`);
        check(o[k]);
      }
    }
  })(v);
  return v;
}

router.post('/custom', async (req, res) => {
  requireBody(req.body);
  const { collection } = req.body;
  if (!ALLOWED.includes(collection)) throw bad('Collection không hợp lệ');
  const filter = parseJson(req.body.filter, 'Filter');
  const sort = parseJson(req.body.sort, 'Sort');
  const limit = toInt(req.body.limit, 10, 1, 50);
  const hasSort = Object.keys(sort).length > 0;
  const projection = collection === 'users' ? { password: 0 } : undefined;

  const t = Date.now();
  let cursor = mflix().collection(collection).find(filter, { projection, maxTimeMS: 10000 });
  if (hasSort) cursor = cursor.sort(sort);
  const data = await cursor.limit(limit).toArray();
  const ms = Date.now() - t;
  const ex = await explainFind(collection, filter, hasSort ? sort : undefined);
  res.json({
    data: BSON.EJSON.serialize(data, { relaxed: true }),
    explain: summarize(ex),
    query: { ...describe(collection, 'find', { filter, projection, sort: hasSort ? sort : undefined, limit }), ms },
  });
});

module.exports = router;
