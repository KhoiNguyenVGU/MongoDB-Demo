// Demo "chi phí của index khi ghi": insert cùng một bộ dữ liệu vào collection có 0 / 3 / 5 index.
// Chạy trong database tạm zz_index_demo và luôn dọn sạch, không đụng tới dữ liệu thật.
const { ObjectId } = require('mongodb');
const { getClient } = require('./db');

const DB = 'zz_index_demo';
const DOCS = 20000;
const BATCH = 1000;
const ROUNDS = 2; // chạy 2 vòng, lấy lần nhanh nhất để giảm nhiễu mạng/cluster dùng chung

const CONFIGS = [
  { key: 'none', label: '0 index', indexes: [] },
  {
    key: 'three', label: '3 index',
    indexes: [{ key: { qty: 1 } }, { key: { category: 1, price: -1 } }, { key: { createdAt: -1 } }],
  },
  {
    key: 'five', label: '5 index',
    indexes: [
      { key: { qty: 1 } }, { key: { category: 1, price: -1 } }, { key: { createdAt: -1 } },
      { key: { name: 1 } }, { key: { tags: 1 } }, // tags là mảng nên là multikey index (tốn thêm)
    ],
  },
];

const CATS = ['Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Romance', 'Thriller', 'Western', 'Music', 'War'];
const TAGS = ['new', 'classic', 'indie', 'hit', 'cult', 'short', 'long', 'remake'];
const rnd = (n) => Math.floor(Math.random() * n);

function makeDocs() {
  const base = Date.now() - 365 * 24 * 3600 * 1000;
  return Array.from({ length: DOCS }, (_, i) => ({
    _id: new ObjectId(),
    name: `item-${i}-${rnd(1e6)}`,
    qty: rnd(500),
    price: Math.round(Math.random() * 10000) / 10,
    category: CATS[rnd(CATS.length)],
    createdAt: new Date(base + rnd(365 * 24 * 3600 * 1000)),
    tags: [TAGS[rnd(TAGS.length)], TAGS[rnd(TAGS.length)]],
  }));
}

let running = false;

async function runIndexCost() {
  if (running) {
    const e = new Error('Một lần đo khác đang chạy, đợi vài giây rồi thử lại');
    e.status = 429;
    throw e;
  }
  running = true;
  const database = getClient().db(DB);
  try {
    await database.dropDatabase(); // dọn rác nếu lần trước bị ngắt giữa chừng
    const docs = makeDocs();
    const best = {};
    for (let round = 1; round <= ROUNDS; round++) {
      for (const cfg of CONFIGS) {
        const col = await database.createCollection(`${cfg.key}_r${round}`);
        if (cfg.indexes.length) await col.createIndexes(cfg.indexes); // tạo index trên collection rỗng
        const t = process.hrtime.bigint();
        for (let i = 0; i < docs.length; i += BATCH) {
          // eslint-disable-next-line no-await-in-loop
          await col.insertMany(docs.slice(i, i + BATCH), { ordered: false });
        }
        const ms = Number(process.hrtime.bigint() - t) / 1e6;
        if (best[cfg.key] === undefined || ms < best[cfg.key]) best[cfg.key] = ms;
        await col.drop();
      }
    }
    const baseMs = best.none;
    return {
      kind: 'indexcost',
      value: {
        docs: DOCS, batch: BATCH, rounds: ROUNDS,
        runs: CONFIGS.map((c) => ({
          key: c.key,
          label: c.label,
          indexes: c.indexes.length,
          ms: Math.round(best[c.key]),
          docsPerSec: Math.round(DOCS / (best[c.key] / 1000)),
          slowdown: Math.round((best[c.key] / baseMs) * 100) / 100,
        })),
      },
    };
  } finally {
    running = false;
    try { await database.dropDatabase(); } catch { /* ignore */ }
  }
}

module.exports = { runIndexCost, DB, DOCS };
