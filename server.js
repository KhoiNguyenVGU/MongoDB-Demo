require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./src/db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');

app.use(express.json({ limit: '100kb' }));

// ---------- API ----------
app.get('/api/health', async (req, res) => {
  const t = Date.now();
  await db.getClient().db('admin').command({ ping: 1 });
  res.json({ ok: true, db: process.env.MONGODB_DB || 'sample_mflix', pingMs: Date.now() - t });
});
app.use('/api/stats', require('./src/routes/stats'));
app.use('/api', require('./src/routes/comments')); // /api/movies/:id/comments, /api/comments/:id
app.use('/api/movies', require('./src/routes/movies'));
app.use('/api/theaters', require('./src/routes/theaters'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/watchlist', require('./src/routes/watchlist'));
app.use('/api/explain', require('./src/routes/explain'));
app.use('/api', (req, res) => res.status(404).json({ error: 'API không tồn tại' }));

// ---------- Frontend ----------
app.use(express.static(PUBLIC, { extensions: ['html'] }));
app.get('/movies/:id', (req, res) => res.sendFile(path.join(PUBLIC, 'movie.html')));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

// ---------- Error handler tập trung ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Lỗi server';
  if (err.code === 121) { status = 400; message = 'Document không qua được schema validation của collection'; }
  if (err.code === 11000) { status = 409; message = 'Dữ liệu bị trùng (duplicate key)'; }
  if (err.code === 50) { status = 504; message = 'Query chạy quá thời gian cho phép (maxTimeMS)'; }
  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(status).json({ error: message });
});

db.connect()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✔ Đã kết nối MongoDB Atlas (db: ${process.env.MONGODB_DB || 'sample_mflix'})`);
      console.log(`✔ Web demo chạy tại http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('✘ Không kết nối được MongoDB:', err.message);
    console.error('  Kiểm tra MONGODB_URI trong .env và Network Access (IP whitelist) trên Atlas.');
    process.exit(1);
  });

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await db.close();
    process.exit(0);
  });
}
