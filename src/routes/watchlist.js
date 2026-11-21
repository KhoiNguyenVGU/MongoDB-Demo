// Watchlist: collection ở database thứ hai (movie_demo) trong cùng cluster
const router = require('express').Router();
const { demo } = require('../db');
const { bad, notFound, has, toObjectId, toList, describe, str, num, requireBody } = require('../utils/validate');

const watchlist = () => demo().collection('watchlist');

function validate(body, partial) {
  requireBody(body);
  const out = {};
  if (!partial || has(body, 'title')) out.title = str(body, 'title', { required: true, max: 300, label: 'Tiêu đề' });
  if (has(body, 'year')) out.year = num(body, 'year', { label: 'Năm', int: true, min: 1880, max: 2030 });
  if (has(body, 'genres')) out.genres = toList(body.genres).slice(0, 20);
  if (has(body, 'watched')) {
    if (typeof body.watched !== 'boolean') throw bad('watched phải là true/false');
    out.watched = body.watched;
  } else if (!partial) out.watched = false;
  if (has(body, 'myRating')) out.myRating = num(body, 'myRating', { label: 'Điểm của tôi', int: true, min: 1, max: 10 });
  return out;
}

router.get('/', async (req, res) => {
  const sort = { watched: 1, title: 1 };
  const pipeline = [
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        watched: { $sum: { $cond: ['$watched', 1, 0] } },
        avgRating: { $avg: '$myRating' },
      },
    },
  ];
  const t = Date.now();
  const [data, summary] = await Promise.all([
    watchlist().find({}).sort(sort).toArray(),
    watchlist().aggregate(pipeline).toArray(),
  ]);
  res.json({
    data,
    summary: summary[0] || { total: 0, watched: 0, avgRating: null },
    query: describe('movie_demo.watchlist', 'find', { filter: {}, sort }, t),
  });
});

router.post('/', async (req, res) => {
  const v = validate(req.body, false);
  const doc = Object.fromEntries(Object.entries(v).filter(([, val]) => val !== null));
  const t = Date.now();
  const r = await watchlist().insertOne(doc);
  res.status(201).json({ data: { ...doc, _id: r.insertedId }, query: describe('movie_demo.watchlist', 'insertOne', { document: doc }, t) });
});

router.put('/:id', async (req, res) => {
  const _id = toObjectId(req.params.id);
  const v = validate(req.body, true);
  if (!Object.keys(v).length) throw bad('Không có thay đổi nào');
  const $set = {};
  const $unset = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === null) $unset[k] = '';
    else $set[k] = val;
  }
  const update = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  const t = Date.now();
  const data = await watchlist().findOneAndUpdate({ _id }, update, { returnDocument: 'after' });
  if (!data) throw notFound('Không tìm thấy mục watchlist');
  res.json({ data, query: describe('movie_demo.watchlist', 'findOneAndUpdate', { filter: { _id }, update }, t) });
});

router.delete('/:id', async (req, res) => {
  const _id = toObjectId(req.params.id);
  const t = Date.now();
  const r = await watchlist().deleteOne({ _id });
  if (!r.deletedCount) throw notFound('Không tìm thấy mục watchlist');
  res.json({ data: { deleted: 1 }, query: describe('movie_demo.watchlist', 'deleteOne', { filter: { _id } }, t) });
});

module.exports = router;
