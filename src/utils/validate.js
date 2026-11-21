const { ObjectId, BSON } = require('mongodb');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg = 'Không tìm thấy') => new HttpError(404, msg);

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

function toObjectId(id) {
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw bad('ID không hợp lệ');
  return new ObjectId(id);
}

function toInt(v, def, min = -Infinity, max = Infinity) {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function toNum(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// "a,b" | ["a","b"] -> ["a","b"] (trim, bỏ rỗng, bỏ trùng)
function toList(v) {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pageParams(q, defLimit = 20) {
  const limit = toInt(q.limit, defLimit, 1, 50);
  const page = toInt(q.page, 1, 1, 1e6);
  return { page, limit, skip: (page - 1) * limit };
}

// Mô tả query đã chạy để UI hiển thị ("Xem query"). EJSON giữ được ObjectId/Date/RegExp.
function describe(collection, op, spec, startedAt) {
  return {
    collection,
    op,
    ...BSON.EJSON.serialize(spec, { relaxed: true }),
    ms: startedAt ? Date.now() - startedAt : undefined,
  };
}

function str(body, k, { required = false, max = 5000, label = k } = {}) {
  const v = String(body[k] ?? '').trim();
  if (required && !v) throw bad(`${label} là bắt buộc`);
  if (v.length > max) throw bad(`${label} quá dài (tối đa ${max} ký tự)`);
  return v;
}

// Số: '' hoặc null -> null (nghĩa là bỏ field), sai kiểu/ngoài khoảng -> 400
function num(body, k, { label = k, int = false, min = -Infinity, max = Infinity } = {}) {
  const v = body[k];
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || (int && !Number.isInteger(n)) || n < min || n > max) {
    throw bad(`${label} phải là ${int ? 'số nguyên' : 'số'} từ ${min} đến ${max}`);
  }
  return n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function email(body, k = 'email') {
  const v = str(body, k, { required: true, max: 200, label: 'Email' }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw bad('Email không hợp lệ');
  return v;
}

function requireBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Body phải là JSON object');
  return body;
}

module.exports = {
  HttpError, bad, notFound, has, toObjectId, toInt, toNum, toList, escapeRegex,
  pageParams, describe, str, num, email, requireBody,
};
