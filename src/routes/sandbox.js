// Sandbox: duyệt và CRUD trên các database do người dùng tự tạo trong cluster.
// Ẩn database hệ thống (admin/local/config) và dữ liệu mẫu của Atlas (sample_*).
const router = require('express').Router();
const { BSON } = require('mongodb');
const { getClient } = require('../db');
const {
  bad, notFound, HttpError, isUserDb, userDbName, collName, parseEJSON, pageParams, describe, requireBody,
} = require('../utils/validate');

const toEJSON = (v) => BSON.EJSON.serialize({ v }, { relaxed: true }).v;
const fromEJSON = (v) => BSON.EJSON.deserialize({ v }, { relaxed: true }).v;
const client = () => getClient();

async function databaseNames() {
  const { databases } = await client().db().admin().listDatabases({ nameOnly: true });
  return databases.map((d) => d.name);
}
async function collectionNames(db) {
  const cols = await client().db(db).listCollections({}, { nameOnly: true }).toArray();
  return cols.filter((c) => c.type !== 'view' && !c.name.startsWith('system.')).map((c) => c.name);
}
async function requireDb(db) {
  if (!(await databaseNames()).includes(db)) throw notFound(`Database "${db}" không tồn tại`);
}
async function requireCollection(db, coll) {
  if (!(await collectionNames(db)).includes(coll)) throw notFound(`Collection "${db}.${coll}" không tồn tại`);
}
// Lấy db + collection từ URL, đã validate
function target(req) {
  const db = userDbName(req.params.db);
  const coll = req.params.coll !== undefined ? collName(req.params.coll) : undefined;
  return { db, coll, collection: coll && client().db(db).collection(coll) };
}

/* ---------- Databases ---------- */
router.get('/databases', async (req, res) => {
  const { databases } = await client().db().admin().listDatabases();
  const mine = databases.filter((d) => isUserDb(d.name));
  const data = await Promise.all(mine.map(async (d) => {
    const names = await collectionNames(d.name);
    const collections = await Promise.all(names.map(async (name) => ({
      name, count: await client().db(d.name).collection(name).estimatedDocumentCount(),
    })));
    collections.sort((a, b) => a.name.localeCompare(b.name));
    return { name: d.name, sizeOnDisk: d.sizeOnDisk, collections };
  }));
  data.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ data, hidden: databases.filter((d) => !isUserDb(d.name)).map((d) => d.name) });
});

// Tạo database = tạo collection đầu tiên trong nó (MongoDB tạo database khi có collection)
router.post('/databases', async (req, res) => {
  requireBody(req.body);
  const db = userDbName(req.body.db);
  const coll = collName(req.body.collection);
  if ((await collectionNames(db)).includes(coll)) throw new HttpError(409, `Collection "${db}.${coll}" đã tồn tại`);
  const t = Date.now();
  await client().db(db).createCollection(coll);
  res.status(201).json({
    data: { db, collection: coll },
    query: { ...describe(coll, 'createCollection', {}, t), database: db, args: [coll] },
  });
});

router.delete('/databases/:db', async (req, res) => {
  const { db } = target(req);
  await requireDb(db);
  const t = Date.now();
  await client().db(db).dropDatabase();
  res.json({ data: { dropped: db }, query: { ...describe('', 'dropDatabase', {}, t), database: db } });
});

/* ---------- Collections ---------- */
router.post('/databases/:db/collections', async (req, res) => {
  const { db } = target(req);
  requireBody(req.body);
  const coll = collName(req.body.name);
  if ((await collectionNames(db)).includes(coll)) throw new HttpError(409, `Collection "${db}.${coll}" đã tồn tại`);
  const t = Date.now();
  await client().db(db).createCollection(coll);
  res.status(201).json({ data: { db, collection: coll }, query: { ...describe(coll, 'createCollection', {}, t), database: db, args: [coll] } });
});

router.delete('/databases/:db/collections/:coll', async (req, res) => {
  const { db, coll, collection } = target(req);
  await requireCollection(db, coll);
  const t = Date.now();
  await collection.drop();
  res.json({ data: { dropped: `${db}.${coll}` }, query: { ...describe(coll, 'drop', {}, t), database: db } });
});

/* ---------- Documents ---------- */
const DOCS = '/databases/:db/collections/:coll/docs';

router.get(DOCS, async (req, res) => {
  const { db, coll, collection } = target(req);
  await requireCollection(db, coll);
  const filter = parseEJSON(req.query.filter, 'Filter');
  const sortIn = parseEJSON(req.query.sort, 'Sort');
  const sort = Object.keys(sortIn).length ? sortIn : { _id: 1 };
  const { page, limit, skip } = pageParams(req.query, 20);
  const t = Date.now();
  const [docs, total] = await Promise.all([
    collection.find(filter, { maxTimeMS: 10000 }).sort(sort).skip(skip).limit(limit).toArray(),
    collection.countDocuments(filter, { maxTimeMS: 10000 }),
  ]);
  res.json({
    data: toEJSON(docs), total, page, limit, pages: Math.ceil(total / limit),
    query: { ...describe(coll, 'find', { filter, sort, skip, limit }, t), database: db },
  });
});

function parseDoc(text) {
  return parseEJSON(text, 'Document', { allowEmpty: false });
}

router.post(DOCS, async (req, res) => {
  const { db, coll, collection } = target(req);
  requireBody(req.body);
  await requireCollection(db, coll);
  const doc = parseDoc(req.body.doc);
  const t = Date.now();
  const r = await collection.insertOne(doc);
  res.status(201).json({
    data: toEJSON({ _id: r.insertedId, ...doc }),
    query: { ...describe(coll, 'insertOne', { document: doc }, t), database: db },
  });
});

// Sửa document: replaceOne (giữ nguyên _id)
router.put(DOCS, async (req, res) => {
  const { db, coll, collection } = target(req);
  requireBody(req.body);
  if (req.body.id === undefined) throw bad('Thiếu _id của document');
  const _id = fromEJSON(req.body.id);
  const doc = parseDoc(req.body.doc);
  if ('_id' in doc) {
    if (JSON.stringify(toEJSON(doc._id)) !== JSON.stringify(toEJSON(_id))) throw bad('Không được đổi _id của document');
    delete doc._id;
  }
  const t = Date.now();
  const r = await collection.replaceOne({ _id }, doc);
  if (!r.matchedCount) throw notFound('Không tìm thấy document');
  res.json({
    data: toEJSON({ _id, ...doc }),
    query: { ...describe(coll, 'replaceOne', { filter: { _id }, document: doc }, t), database: db },
  });
});

router.delete(DOCS, async (req, res) => {
  const { db, coll, collection } = target(req);
  requireBody(req.body);
  if (req.body.id === undefined) throw bad('Thiếu _id của document');
  const _id = fromEJSON(req.body.id);
  const t = Date.now();
  const r = await collection.deleteOne({ _id });
  if (!r.deletedCount) throw notFound('Không tìm thấy document');
  res.json({ data: { deleted: 1 }, query: { ...describe(coll, 'deleteOne', { filter: { _id } }, t), database: db } });
});

module.exports = router;
