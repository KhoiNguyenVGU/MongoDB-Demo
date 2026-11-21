// Mongo Shell trên web: nhận lệnh mongosh dạng text, parse và chạy bằng driver (không eval JavaScript)
const router = require('express').Router();
const { getClient } = require('../db');
const { bad, requireBody } = require('../utils/validate');
const { runShell } = require('../shell/executor');

router.post('/', async (req, res) => {
  requireBody(req.body);
  const code = String(req.body.code ?? '');
  if (!code.trim()) throw bad('Chưa nhập lệnh');
  if (code.length > 20000) throw bad('Lệnh quá dài (tối đa 20.000 ký tự)');
  res.json(await runShell(getClient(), { code, db: req.body.db, itSkip: req.body.itSkip }));
});

module.exports = router;
