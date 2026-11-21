const router = require('express').Router();
const { mflix, getClient } = require('../db');
const {
  bad, notFound, has, toObjectId, toInt, toNum, toList, pageParams, describe, str, num, requireBody,
} = require('../utils/validate');

const movies = () => mflix().collection('movies');
const LIST_FIELDS = ['genres', 'cast', 'directors', 'writers', 'languages', 'countries'];

// Validate body. partial=true khi update: chỉ xử lý các field được gửi lên.
// Trả về object phẳng; giá trị null = xóa field ($unset).
function validateMovie(body, partial) {
  requireBody(body);
  const out = {};
  const want = (k) => !partial || has(body, k);

  if (want('title')) out.title = str(body, 'title', { required: true, max: 300, label: 'Tiêu đề' });
  for (const k of ['plot', 'fullplot', 'rated']) if (has(body, k)) out[k] = str(body, k, { max: 5000 });
  if (has(body, 'poster')) {
    const p = str(body, 'poster', { max: 1000 });
    if (p && !/^https?:\/\//i.test(p)) throw bad('Poster phải là URL http(s)');
    out.poster = p || null;
  }
  if (has(body, 'year')) out.year = num(body, 'year', { label: 'Năm', int: true, min: 1880, max: 2030 });
  if (has(body, 'runtime')) out.runtime = num(body, 'runtime', { label: 'Thời lượng', int: true, min: 1, max: 1000 });
  if (has(body, 'imdbRating')) out['imdb.rating'] = num(body, 'imdbRating', { label: 'IMDb rating', min: 0, max: 10 });
  if (want('type')) {
    const t = body.type ?? 'movie';
    if (!['movie', 'series'].includes(t)) throw bad('type phải là "movie" hoặc "series"');
    out.type = t;
  }
  for (const k of LIST_FIELDS) {
    if (has(body, k)) {
      if (body[k] !== null && !Array.isArray(body[k]) && typeof body[k] !== 'string') throw bad(`${k} phải là mảng`);
      out[k] = toList(body[k]).map((s) => s.slice(0, 200)).slice(0, 100);
    }
  }
  return out;
}

// Danh sách thể loại (cho dropdown / chips)
router.get('/genres', async (req, res) => {
  const genres = await movies().distinct('genres');
  res.json({ data: genres.filter(Boolean).sort() });
});

// LIST: search + filter + sort + phân trang server-side
router.get('/', async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 24);
  const filter = {};
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q) filter.$text = { $search: q };

  const genres = toList(req.query.genres);
  if (genres.length) filter.genres = { $in: genres };
  const from = toInt(req.query.yearFrom);
  const to = toInt(req.query.yearTo);
  if (from !== undefined || to !== undefined) {
    filter.year = {};
    if (from !== undefined) filter.year.$gte = from;
    if (to !== undefined) filter.year.$lte = to;
  }
  const minRating = toNum(req.query.minRating);
  if (minRating !== undefined) filter['imdb.rating'] = { $gte: minRating };
  if (['movie', 'series'].includes(req.query.type)) filter.type = req.query.type;

  const SORTS = {
    relevance: { score: { $meta: 'textScore' } },
    year_desc: { year: -1, _id: 1 },
    year_asc: { year: 1, _id: 1 },
    rating_desc: { 'imdb.rating': -1, _id: 1 },
    comments_desc: { num_mflix_comments: -1, _id: 1 },
    title_asc: { title: 1, _id: 1 },
  };
  let sortKey = has(SORTS, req.query.sort) ? req.query.sort : q ? 'relevance' : 'year_desc';
  if (sortKey === 'relevance' && !q) sortKey = 'year_desc';
  // Khi sort theo year/rating: bỏ các giá trị bẩn kiểu chuỗi (chuỗi luôn đứng sau số trong thứ tự BSON)
  if (sortKey.startsWith('year')) filter.year = { ...(filter.year || {}), $type: 'number' };
  if (sortKey === 'rating_desc') filter['imdb.rating'] = { ...(filter['imdb.rating'] || {}), $type: 'number' };

  const projection = {
    title: 1, year: 1, genres: 1, poster: 1, 'imdb.rating': 1, type: 1, runtime: 1, num_mflix_comments: 1,
  };
  if (q) projection.score = { $meta: 'textScore' };
  const sort = SORTS[sortKey];

  const t = Date.now();
  const [data, total] = await Promise.all([
    movies().find(filter, { projection, maxTimeMS: 15000 }).sort(sort).skip(skip).limit(limit).toArray(),
    movies().countDocuments(filter, { maxTimeMS: 15000 }),
  ]);
  res.json({
    data, total, page, limit, pages: Math.ceil(total / limit), sort: sortKey,
    query: describe('movies', 'find', { filter, projection, sort, skip, limit }, t),
  });
});

// DETAIL
router.get('/:id', async (req, res) => {
  const _id = toObjectId(req.params.id);
  const t = Date.now();
  const data = await movies().findOne({ _id });
  if (!data) throw notFound('Không tìm thấy phim');
  res.json({ data, query: describe('movies', 'findOne', { filter: { _id } }, t) });
});

// CREATE
router.post('/', async (req, res) => {
  const v = validateMovie(req.body, false);
  const doc = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === null) continue;
    if (k === 'imdb.rating') doc.imdb = { rating: val };
    else doc[k] = val;
  }
  doc.num_mflix_comments = 0;
  doc.lastupdated = new Date();
  const t = Date.now();
  const r = await movies().insertOne(doc);
  res.status(201).json({
    data: { ...doc, _id: r.insertedId },
    query: describe('movies', 'insertOne', { document: doc }, t),
  });
});

// UPDATE: chỉ $set các field client gửi lên (client gửi phần đã thay đổi)
router.put('/:id', async (req, res) => {
  const _id = toObjectId(req.params.id);
  const v = validateMovie(req.body, true);
  if (Object.keys(v).length === 0) throw bad('Không có thay đổi nào');
  const $set = { lastupdated: new Date() };
  const $unset = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === null) $unset[k] = '';
    else $set[k] = val;
  }
  const update = { $set };
  if (Object.keys($unset).length) update.$unset = $unset;
  const t = Date.now();
  const data = await movies().findOneAndUpdate({ _id }, update, { returnDocument: 'after' });
  if (!data) throw notFound('Không tìm thấy phim');
  res.json({ data, query: describe('movies', 'findOneAndUpdate', { filter: { _id }, update }, t) });
});

// DELETE: xóa phim + toàn bộ comments trong 1 transaction
router.delete('/:id', async (req, res) => {
  const _id = toObjectId(req.params.id);
  const session = getClient().startSession();
  let deleted = 0;
  let removedComments = 0;
  const t = Date.now();
  try {
    await session.withTransaction(async () => {
      const r = await movies().deleteOne({ _id }, { session });
      deleted = r.deletedCount;
      removedComments = 0;
      if (!deleted) return;
      const c = await mflix().collection('comments').deleteMany({ movie_id: _id }, { session });
      removedComments = c.deletedCount;
    });
  } finally {
    await session.endSession();
  }
  if (!deleted) throw notFound('Không tìm thấy phim');
  res.json({
    data: { deleted, removedComments },
    query: {
      op: 'transaction',
      collection: 'movies + comments',
      ms: Date.now() - t,
      steps: [
        describe('movies', 'deleteOne', { filter: { _id } }),
        describe('comments', 'deleteMany', { filter: { movie_id: _id } }),
      ],
    },
  });
});

module.exports = router;
