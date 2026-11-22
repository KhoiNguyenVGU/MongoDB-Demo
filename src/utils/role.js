// Vai trò người dùng: "admin" (toàn quyền) hoặc "user" (chỉ xem). Lưu trong cookie `role` (cookie phiên).
// Không có cookie = chưa chọn = coi như "user" (chỉ xem) để an toàn.
// Lưu ý: demo không có đăng nhập nên ai cũng có thể chọn admin; đây là phân quyền giao diện/API, không phải bảo mật.
const ROLES = ['admin', 'user'];

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function getRole(req) {
  const r = readCookie(req, 'role');
  return ROLES.includes(r) ? r : null;
}
const isAdmin = (req) => getRole(req) === 'admin';

class ForbiddenError extends Error {
  constructor(message = 'Vai trò User chỉ được xem, không được thêm/sửa/xóa hoặc chạy code') {
    super(message);
    this.status = 403;
  }
}
function requireAdmin(req) {
  if (!isAdmin(req)) throw new ForbiddenError();
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Chặn mọi thao tác ghi của người không phải admin. Ngoại lệ duy nhất: POST /api/role (chọn vai trò).
function viewerGuard(req, res, next) {
  if (isAdmin(req) || !WRITE_METHODS.has(req.method)) return next();
  if (req.path === '/role') return next();
  return res.status(403).json({ error: new ForbiddenError().message });
}

module.exports = { ROLES, getRole, isAdmin, requireAdmin, ForbiddenError, viewerGuard };
