// Dashboard: mọi số liệu đều tính bằng aggregation pipeline ở server
const router = require('express').Router();
const { mflix } = require('../db');
const { toInt, toList, describe } = require('../utils/validate');

// Bộ lọc chung của dashboard -> stage $match đầu pipeline
function movieMatch(q) {
  const m = {};
  const genres = toList(q.genres);
  if (genres.length) m.genres = { $in: genres };
  const from = toInt(q.yearFrom);
  const to = toInt(q.yearTo);
  if (from !== undefined || to !== undefined) {
    m.year = {};
    if (from !== undefined) m.year.$gte = from;
    if (to !== undefined) m.year.$lte = to;
  }
  return m;
}
const isEmpty = (o) => Object.keys(o).length === 0;
const matchStage = (m) => (isEmpty(m) ? [] : [{ $match: m }]);

async function aggregate(coll, pipeline) {
  const t = Date.now();
  const data = await mflix().collection(coll).aggregate(pipeline, { maxTimeMS: 20000 }).toArray();
  return { data, query: describe(coll, 'aggregate', { pipeline }, t) };
}

router.get('/overview', async (req, res) => {
  const m = movieMatch(req.query);
  const db = mflix();
  const pipeline = [
    { $match: { ...m, 'imdb.rating': { $type: 'number' } } },
    { $group: { _id: null, avgRating: { $avg: '$imdb.rating' }, rated: { $sum: 1 } } },
  ];
  const t = Date.now();
  // Năm nhỏ nhất / lớn nhất trong dữ liệu (dùng index year) để gợi ý khi bộ lọc không khớp
  const yearEdge = (dir) => db.collection('movies')
    .find({ year: { $type: 'number' } }, { projection: { _id: 0, year: 1 } }).sort({ year: dir }).limit(1).next();
  const [movies, comments, users, theaters, rating, minY, maxY] = await Promise.all([
    isEmpty(m) ? db.collection('movies').estimatedDocumentCount() : db.collection('movies').countDocuments(m),
    db.collection('comments').estimatedDocumentCount(),
    db.collection('users').estimatedDocumentCount(),
    db.collection('theaters').estimatedDocumentCount(),
    db.collection('movies').aggregate(pipeline).toArray(),
    yearEdge(1),
    yearEdge(-1),
  ]);
  res.json({
    data: {
      movies, comments, users, theaters, avgRating: rating[0]?.avgRating ?? null, filtered: !isEmpty(m),
      yearRange: { min: minY?.year ?? null, max: maxY?.year ?? null },
    },
    query: describe('movies', 'aggregate', { pipeline }, t),
  });
});

router.get('/genres', async (req, res) => {
  const m = movieMatch(req.query);
  res.json(await aggregate('movies', [
    ...matchStage(m),
    { $unwind: '$genres' },
    { $group: { _id: '$genres', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]));
});

router.get('/decades', async (req, res) => {
  const m = movieMatch(req.query);
  res.json(await aggregate('movies', [
    // 35 phim có year là chuỗi bẩn (vd "2012è") -> chỉ lấy year kiểu số
    { $match: { ...m, year: { ...(m.year || {}), $type: 'number' } } },
    {
      $group: {
        _id: { $multiply: [{ $floor: { $divide: ['$year', 10] } }, 10] },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]));
});

router.get('/rating-by-genre', async (req, res) => {
  const m = movieMatch(req.query);
  const minCount = isEmpty(m) ? 100 : 10;
  const result = await aggregate('movies', [
    // 61 phim có imdb.rating = "" -> lọc kiểu số trước khi $avg
    { $match: { ...m, 'imdb.rating': { $type: 'number' } } },
    { $unwind: '$genres' },
    { $group: { _id: '$genres', avgRating: { $avg: '$imdb.rating' }, count: { $sum: 1 } } },
    { $match: { count: { $gte: minCount } } },
    { $sort: { avgRating: -1 } },
    { $limit: 15 },
    { $project: { avgRating: { $round: ['$avgRating', 2] }, count: 1 } },
  ]);
  res.json({ ...result, minCount });
});

router.get('/types', async (req, res) => {
  const m = movieMatch(req.query);
  res.json(await aggregate('movies', [
    ...matchStage(m),
    { $group: { _id: '$type', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]));
});

router.get('/top-commented', async (req, res) => {
  const m = movieMatch(req.query);
  res.json(await aggregate('comments', [
    { $group: { _id: '$movie_id', comments: { $sum: 1 } } },
    { $sort: { comments: -1 } },
    {
      $lookup: {
        from: 'movies',
        localField: '_id',
        foreignField: '_id',
        as: 'movie',
        pipeline: [...matchStage(m), { $project: { title: 1, year: 1, 'imdb.rating': 1, genres: 1 } }],
      },
    },
    { $unwind: '$movie' }, // bỏ các phim không khớp bộ lọc
    { $limit: 10 },
    {
      $project: {
        _id: 0, movieId: '$_id', comments: 1,
        title: '$movie.title', year: '$movie.year', rating: '$movie.imdb.rating', genres: '$movie.genres',
      },
    },
  ]));
});

router.get('/theaters-by-state', async (req, res) => {
  res.json(await aggregate('theaters', [
    { $group: { _id: '$location.address.state', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]));
});

module.exports = router;
