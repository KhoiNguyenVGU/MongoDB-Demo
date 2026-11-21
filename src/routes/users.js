// Users: KHÔNG bao giờ trả field password về client (projection { password: 0 })
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { mflix } = require('../db');
const {
  bad, notFound, HttpError, toObjectId, pageParams, escapeRegex, describe, str, email, requireBody,
} = require('../utils/validate');

const users = () => mflix().collection('users');
const NO_PASSWORD = { projection: { password: 0 } };
const HIDDEN = '<bcrypt hash>';

async function ensureUniqueEmail(mail, exceptId) {
  const filter = { email: mail };
  if (exceptId) filter._id = { $ne: exceptId };
  if (await users().findOne(filter, { projection: { _id: 1 } })) {
    throw new HttpError(409, `Email ${mail} đã được sử dụng`);
  }
}

function password(body, required) {
  const p = String(body.password ?? '');
  if (!p && !required) return null;
  if (p.length < 6) throw bad('Mật khẩu phải có ít nhất 6 ký tự');
  if (p.length > 72) throw bad('Mật khẩu tối đa 72 ký tự');
  return p;
}

router.get('/', async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 20);
  const filter = {};
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const sort = { name: 1 };
  const t = Date.now();
  const [data, total] = await Promise.all([
    users().find(filter, NO_PASSWORD).sort(sort).skip(skip).limit(limit).toArray(),
    users().countDocuments(filter),
  ]);
  res.json({
    data, total, page, limit, pages: Math.ceil(total / limit),
    query: describe('users', 'find', { filter, projection: NO_PASSWORD.projection, sort, skip, limit }, t),
  });
});

router.get('/:id', async (req, res) => {
  const data = await users().findOne({ _id: toObjectId(req.params.id) }, NO_PASSWORD);
  if (!data) throw notFound('Không tìm thấy user');
  res.json({ data });
});

router.post('/', async (req, res) => {
  requireBody(req.body);
  const name = str(req.body, 'name', { required: true, max: 100, label: 'Tên' });
  const mail = email(req.body);
  const pw = password(req.body, true);
  await ensureUniqueEmail(mail);
  const doc = { name, email: mail, password: await bcrypt.hash(pw, 10) };
  const t = Date.now();
  const r = await users().insertOne(doc);
  res.status(201).json({
    data: { _id: r.insertedId, name, email: mail },
    query: describe('users', 'insertOne', { document: { ...doc, password: HIDDEN } }, t),
  });
});

router.put('/:id', async (req, res) => {
  const _id = toObjectId(req.params.id);
  requireBody(req.body);
  const $set = {
    name: str(req.body, 'name', { required: true, max: 100, label: 'Tên' }),
    email: email(req.body),
  };
  await ensureUniqueEmail($set.email, _id);
  const pw = password(req.body, false);
  if (pw) $set.password = await bcrypt.hash(pw, 10);
  const t = Date.now();
  const data = await users().findOneAndUpdate({ _id }, { $set }, { returnDocument: 'after', ...NO_PASSWORD });
  if (!data) throw notFound('Không tìm thấy user');
  const shown = { ...$set, ...(pw ? { password: HIDDEN } : {}) };
  res.json({ data, query: describe('users', 'findOneAndUpdate', { filter: { _id }, update: { $set: shown } }, t) });
});

router.delete('/:id', async (req, res) => {
  const _id = toObjectId(req.params.id);
  const t = Date.now();
  const r = await users().deleteOne({ _id });
  if (!r.deletedCount) throw notFound('Không tìm thấy user');
  res.json({ data: { deleted: 1 }, query: describe('users', 'deleteOne', { filter: { _id } }, t) });
});

module.exports = router;
