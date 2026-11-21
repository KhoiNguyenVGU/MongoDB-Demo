const router = require('express').Router();
const { mflix } = require('../db');
const {
  bad, notFound, HttpError, has, toObjectId, toNum, pageParams, escapeRegex, describe, str, num, requireBody,
} = require('../utils/validate');

const theaters = () => mflix().collection('theaters');

function validateTheater(body) {
  requireBody(body);
  const state = str(body, 'state', { required: true, max: 2, label: 'State' }).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw bad('State phải gồm 2 chữ cái (vd: CA)');
  const lat = num(body, 'lat', { label: 'Vĩ độ (lat)', min: -90, max: 90 });
  const lng = num(body, 'lng', { label: 'Kinh độ (lng)', min: -180, max: 180 });
  if (lat === null || lng === null) throw bad('Cần nhập tọa độ lat và lng');
  return {
    theaterId: has(body, 'theaterId') ? num(body, 'theaterId', { label: 'Theater ID', int: true, min: 1, max: 1e7 }) : null,
    location: {
      address: {
        street1: str(body, 'street1', { required: true, max: 200, label: 'Địa chỉ' }),
        city: str(body, 'city', { required: true, max: 100, label: 'Thành phố' }),
        state,
        zipcode: str(body, 'zipcode', { required: true, max: 10, label: 'Zipcode' }),
      },
      geo: { type: 'Point', coordinates: [lng, lat] }, // GeoJSON: [lng, lat]
    },
  };
}

router.get('/states', async (req, res) => {
  const data = await theaters().distinct('location.address.state');
  res.json({ data: data.filter(Boolean).sort() });
});

// Tìm rạp gần một điểm: $geoNear (cần index 2dsphere trên location.geo)
router.get('/near', async (req, res) => {
  const lat = toNum(req.query.lat);
  const lng = toNum(req.query.lng);
  if (lat === undefined || lng === undefined || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw bad('lat/lng không hợp lệ');
  }
  const km = Math.min(Math.max(toNum(req.query.km) ?? 10, 0.1), 1000);
  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distance',
        maxDistance: km * 1000,
        spherical: true,
      },
    },
    { $limit: 25 },
  ];
  const t = Date.now();
  const data = await theaters().aggregate(pipeline).toArray();
  res.json({ data, km, query: describe('theaters', 'aggregate', { pipeline }, t) });
});

router.get('/', async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 20);
  const filter = {};
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [
      { 'location.address.city': rx },
      { 'location.address.street1': rx },
      { 'location.address.zipcode': rx },
    ];
    if (/^\d+$/.test(q)) filter.$or.push({ theaterId: Number(q) });
  }
  const state = String(req.query.state || '').toUpperCase();
  if (/^[A-Z]{2}$/.test(state)) filter['location.address.state'] = state;
  const sort = { theaterId: 1 };
  const t = Date.now();
  const [data, total] = await Promise.all([
    theaters().find(filter).sort(sort).skip(skip).limit(limit).toArray(),
    theaters().countDocuments(filter),
  ]);
  res.json({
    data, total, page, limit, pages: Math.ceil(total / limit),
    query: describe('theaters', 'find', { filter, sort, skip, limit }, t),
  });
});

router.get('/:id', async (req, res) => {
  const data = await theaters().findOne({ _id: toObjectId(req.params.id) });
  if (!data) throw notFound('Không tìm thấy rạp');
  res.json({ data });
});

async function ensureUniqueTheaterId(theaterId, exceptId) {
  const filter = { theaterId };
  if (exceptId) filter._id = { $ne: exceptId };
  if (await theaters().findOne(filter, { projection: { _id: 1 } })) {
    throw new HttpError(409, `Theater ID ${theaterId} đã tồn tại`);
  }
}

router.post('/', async (req, res) => {
  const v = validateTheater(req.body);
  if (v.theaterId === null) {
    const last = await theaters().find({}, { projection: { theaterId: 1 } }).sort({ theaterId: -1 }).limit(1).next();
    v.theaterId = (last?.theaterId || 1000) + 1;
  } else {
    await ensureUniqueTheaterId(v.theaterId);
  }
  const t = Date.now();
  const r = await theaters().insertOne(v);
  res.status(201).json({ data: { ...v, _id: r.insertedId }, query: describe('theaters', 'insertOne', { document: v }, t) });
});

router.put('/:id', async (req, res) => {
  const _id = toObjectId(req.params.id);
  const v = validateTheater(req.body);
  const $set = { location: v.location };
  if (v.theaterId !== null) {
    await ensureUniqueTheaterId(v.theaterId, _id);
    $set.theaterId = v.theaterId;
  }
  const t = Date.now();
  const data = await theaters().findOneAndUpdate({ _id }, { $set }, { returnDocument: 'after' });
  if (!data) throw notFound('Không tìm thấy rạp');
  res.json({ data, query: describe('theaters', 'findOneAndUpdate', { filter: { _id }, update: { $set } }, t) });
});

router.delete('/:id', async (req, res) => {
  const _id = toObjectId(req.params.id);
  const t = Date.now();
  const r = await theaters().deleteOne({ _id });
  if (!r.deletedCount) throw notFound('Không tìm thấy rạp');
  res.json({ data: { deleted: 1 }, query: describe('theaters', 'deleteOne', { filter: { _id } }, t) });
});

module.exports = router;
