// Query Explorer: so sánh execution plan có index vs ép COLLSCAN ($natural hint)
const router = require('express').Router();
const { BSON } = require('mongodb');
const { mflix } = require('../db');
const { notFound, describe } = require('../utils/validate');
const { summarize } = require('../utils/explain');

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
      filter: { runtime: { $gt: 200 } }, note: 'Range query trên index runtime_1 (nếu đã drop ở Bài 7 thì planner cũng phải COLLSCAN)',
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

module.exports = router;
