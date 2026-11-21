// Comments: thêm/xóa đồng thời cập nhật movies.num_mflix_comments ($inc) trong transaction
const router = require('express').Router();
const { mflix, getClient } = require('../db');
const { notFound, toObjectId, pageParams, describe, str, email, requireBody } = require('../utils/validate');

const comments = () => mflix().collection('comments');
const movies = () => mflix().collection('movies');

async function inTransaction(fn) {
  const session = getClient().startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

router.get('/movies/:id/comments', async (req, res) => {
  const movie_id = toObjectId(req.params.id);
  const { page, limit, skip } = pageParams(req.query, 10);
  const filter = { movie_id };
  const sort = { date: -1 };
  const t = Date.now();
  const [data, total] = await Promise.all([
    comments().find(filter).sort(sort).skip(skip).limit(limit).toArray(), // dùng index { movie_id: 1, date: -1 }
    comments().countDocuments(filter),
  ]);
  res.json({
    data, total, page, limit, pages: Math.ceil(total / limit),
    query: describe('comments', 'find', { filter, sort, skip, limit }, t),
  });
});

router.post('/movies/:id/comments', async (req, res) => {
  const movie_id = toObjectId(req.params.id);
  requireBody(req.body);
  const doc = {
    name: str(req.body, 'name', { required: true, max: 100, label: 'Tên' }),
    email: email(req.body),
    movie_id,
    text: str(req.body, 'text', { required: true, max: 2000, label: 'Nội dung' }),
    date: new Date(),
  };
  const t = Date.now();
  const insertedId = await inTransaction(async (session) => {
    const exists = await movies().findOne({ _id: movie_id }, { projection: { _id: 1 }, session });
    if (!exists) throw notFound('Không tìm thấy phim');
    const r = await comments().insertOne(doc, { session });
    await movies().updateOne({ _id: movie_id }, { $inc: { num_mflix_comments: 1 } }, { session });
    return r.insertedId;
  });
  res.status(201).json({
    data: { ...doc, _id: insertedId },
    query: {
      op: 'transaction', collection: 'comments + movies', ms: Date.now() - t,
      steps: [
        describe('comments', 'insertOne', { document: doc }),
        describe('movies', 'updateOne', { filter: { _id: movie_id }, update: { $inc: { num_mflix_comments: 1 } } }),
      ],
    },
  });
});

router.put('/comments/:id', async (req, res) => {
  const _id = toObjectId(req.params.id);
  requireBody(req.body);
  const update = { $set: { text: str(req.body, 'text', { required: true, max: 2000, label: 'Nội dung' }) } };
  const t = Date.now();
  const data = await comments().findOneAndUpdate({ _id }, update, { returnDocument: 'after' });
  if (!data) throw notFound('Không tìm thấy comment');
  res.json({ data, query: describe('comments', 'findOneAndUpdate', { filter: { _id }, update }, t) });
});

router.delete('/comments/:id', async (req, res) => {
  const _id = toObjectId(req.params.id);
  const t = Date.now();
  const removed = await inTransaction(async (session) => {
    const c = await comments().findOneAndDelete({ _id }, { session });
    if (!c) throw notFound('Không tìm thấy comment');
    await movies().updateOne({ _id: c.movie_id }, { $inc: { num_mflix_comments: -1 } }, { session });
    return c;
  });
  res.json({
    data: { deleted: 1 },
    query: {
      op: 'transaction', collection: 'comments + movies', ms: Date.now() - t,
      steps: [
        describe('comments', 'findOneAndDelete', { filter: { _id } }),
        describe('movies', 'updateOne', { filter: { _id: removed.movie_id }, update: { $inc: { num_mflix_comments: -1 } } }),
      ],
    },
  });
});

module.exports = router;
