require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const db = require('./src/db');
const { ROLES, getRole, viewerGuard } = require('./src/utils/role');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');

app.set('trust proxy', 1); // chạy sau proxy của Render

// ---------- Basic Auth (tùy chọn) ----------
// Đặt biến môi trường DEMO_PASSWORD để bắt đăng nhập trước khi xem/sửa dữ liệu (khi deploy công khai).
if (process.env.DEMO_PASSWORD) {
  const user = process.env.DEMO_USER || 'demo';
  const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const same = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next(); // để health check của Render hoạt động
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i > -1 && same(decoded.slice(0, i), user) && same(decoded.slice(i + 1), process.env.DEMO_PASSWORD)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="MFlix MongoDB Demo", charset="UTF-8"');
    res.status(401).send('Cần đăng nhập để xem demo');
  });
}

app.use(express.json({ limit: '100kb' }));

// ---------- Vai trò: admin (toàn quyền) / user (chỉ xem) ----------
app.get('/api/role', (req, res) => res.json({ role: getRole(req) }));
app.post('/api/role', (req, res) => {
  const role = req.body && req.body.role;
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Vai trò phải là "admin" hoặc "user"' });
  // Cookie phiên (hết hạn khi đóng trình duyệt) để lần mở sau hỏi lại. Không HttpOnly vì giao diện cần đọc để ẩn nút.
  res.cookie('role', role, { sameSite: 'lax', secure: req.secure, path: '/' });
  res.json({ role });
});
app.use('/api', viewerGuard);

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
app.use('/api/sandbox', require('./src/routes/sandbox'));
app.use('/api/explain', require('./src/routes/explain'));
app.use('/api/exercises', require('./src/routes/exercises'));
app.use('/api/shell', require('./src/routes/shell'));
app.use('/api', (req, res) => res.status(404).json({ error: 'API không tồn tại' }));

// ---------- Frontend ----------
app.use(express.static(PUBLIC, { extensions: ['html'] }));
app.get('/movies/:id', (req, res) => res.sendFile(path.join(PUBLIC, 'movie.html')));
app.get('/watchlist', (req, res) => res.redirect(301, '/sandbox?db=movie_demo&coll=watchlist')); // trang cũ
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

// ---------- Error handler tập trung ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Lỗi server';
  if (err.code === 121) { status = 400; message = 'Document không qua được schema validation của collection'; }
  if (err.code === 11000) { status = 409; message = 'Dữ liệu bị trùng (duplicate key)'; }
  if (err.code === 50) { status = 504; message = 'Query chạy quá thời gian cho phép (maxTimeMS)'; }
  if (err.name === 'MongoServerError' && status === 500) { status = 400; message = `MongoServerError: ${err.message}`; }
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
