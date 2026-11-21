/* Helpers dùng chung cho mọi trang: API, navbar, toast, modal, query viewer, pagination, tag input */

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const QUERIES = {}; // key -> query object trả về từ API (cho nút "Query")

const POSTER_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300">' +
  '<rect width="200" height="300" fill="#8aa39a" fill-opacity=".18"/>' +
  '<g fill="none" stroke="#8aa39a" stroke-width="5"><rect x="70" y="115" width="60" height="44" rx="6"/><path d="M84 115l-8-14M116 115l8-14"/></g>' +
  '<text x="100" y="190" font-family="sans-serif" font-size="14" fill="#8aa39a" text-anchor="middle">No poster</text></svg>'
);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: d }));
const fmtDate = (d) => (d ? new Date(d).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const debounce = (fn, ms = 350) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const ratingOf = (m) => (typeof m?.imdb?.rating === 'number' ? m.imdb.rating : null);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* không phải JSON */ }
  if (!res.ok) throw new Error(json?.error || `Lỗi HTTP ${res.status}`);
  return json;
}

/* ---------- Navbar + theme ---------- */
const NAV = [
  ['/', 'Dashboard'], ['/movies', 'Movies'], ['/theaters', 'Theaters'],
  ['/users', 'Users'], ['/sandbox', 'Sandbox'], ['/explorer', 'Query Explorer'],
];

function renderNav() {
  const el = $('#nav');
  if (!el) return;
  const p = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const active = (h) => (h === '/' ? p === '/' || p === '/index' : p === h || p.startsWith(h + '/'));
  const links = NAV.map(([h, t]) => `<a href="${h}" class="nav-link ${active(h) ? 'active' : ''}" ${active(h) ? 'aria-current="page"' : ''}>${t}</a>`).join('');
  el.innerHTML = `
  <header class="nav">
    <div class="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
      <a href="/" class="flex items-center gap-2 font-bold shrink-0">
        <span class="logo" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c3.5 3.6 6 7.6 6 11.4 0 3.6-2.4 6.3-5.3 6.9V22h-1.4v-1.7C8.4 19.7 6 17 6 13.4 6 9.6 8.5 5.6 12 2z"/></svg></span>
        <span>MFlix <span class="muted font-normal hidden sm:inline">· MongoDB Demo</span></span>
      </a>
      <nav class="hidden lg:flex gap-1 ml-3" aria-label="Chính">${links}</nav>
      <div class="ml-auto flex items-center gap-2">
        <span class="hidden sm:flex items-center gap-2 text-xs muted" id="dbStatus" title="Trạng thái kết nối MongoDB Atlas"><span class="status-dot"></span>Atlas</span>
        <button class="btn btn-sm btn-ghost" id="themeBtn" aria-label="Đổi giao diện sáng/tối"></button>
        <button class="btn btn-sm lg:hidden" id="menuBtn" aria-label="Mở menu" aria-expanded="false">☰</button>
      </div>
    </div>
    <nav id="mobileNav" class="lg:hidden hidden px-4 pb-3 grid gap-1" aria-label="Chính (mobile)">${links}</nav>
  </header>`;

  const themeBtn = $('#themeBtn');
  const paint = () => { themeBtn.textContent = document.documentElement.classList.contains('dark') ? '☀ Sáng' : '☾ Tối'; };
  paint();
  themeBtn.onclick = () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
    paint();
    window.dispatchEvent(new Event('themechange'));
  };
  $('#menuBtn').onclick = (e) => {
    const open = $('#mobileNav').classList.toggle('hidden') === false;
    e.currentTarget.setAttribute('aria-expanded', String(open));
  };

  api('/api/health')
    .then((h) => { $('#dbStatus .status-dot').classList.add('ok'); $('#dbStatus').title = `Đã kết nối · db ${h.db} · ping ${h.pingMs} ms`; })
    .catch(() => { $('#dbStatus .status-dot').classList.add('err'); $('#dbStatus').title = 'Mất kết nối MongoDB'; });
}

/* ---------- Toast ---------- */
function toast(msg, type = 'success', query) {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.className = 'fixed bottom-4 right-4 left-4 sm:left-auto z-[70] flex flex-col gap-2 sm:w-96';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="flex-1">${esc(msg)}</span>${query ? '<button class="toast-link">Xem query</button>' : ''}<button class="toast-x" aria-label="Đóng">×</button>`;
  if (query) $('.toast-link', el).onclick = () => showQuery(query);
  $('.toast-x', el).onclick = () => el.remove();
  box.appendChild(el);
  setTimeout(() => el.remove(), query ? 8000 : 4000);
}

// Thông báo qua trang (vd: xóa phim xong chuyển về danh sách)
function flash(msg, type = 'success') { try { sessionStorage.setItem('flash', JSON.stringify({ msg, type })); } catch { /* ignore */ } }
function showFlash() {
  try {
    const f = JSON.parse(sessionStorage.getItem('flash') || 'null');
    if (f) { sessionStorage.removeItem('flash'); toast(f.msg, f.type); }
  } catch { /* ignore */ }
}

/* ---------- Modal ---------- */
function openModal({ title, body, submitText = 'Lưu', submitClass = 'btn-primary', wide = false, onSubmit, onOpen, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-[60] flex items-start sm:items-center justify-center bg-black/50 p-4 overflow-y-auto';
  wrap.innerHTML = `
    <form class="card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} my-8" novalidate role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="flex items-center justify-between px-5 py-4" style="border-bottom:1px solid var(--border)">
        <h3 class="font-semibold text-lg">${esc(title)}</h3>
        <button type="button" class="btn btn-sm btn-ghost" data-close aria-label="Đóng">✕</button>
      </div>
      <div class="p-5 space-y-4"><div data-error class="form-error" hidden></div>${body}</div>
      <div class="flex justify-end gap-2 px-5 py-4" style="border-top:1px solid var(--border)">
        <button type="button" class="btn" data-close>${onSubmit ? 'Hủy' : 'Đóng'}</button>
        ${onSubmit ? `<button type="submit" class="btn ${submitClass}">${esc(submitText)}</button>` : ''}
      </div>
    </form>`;
  const form = $('form', wrap);
  const prevFocus = document.activeElement;
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
    onClose?.(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(false); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(false); });
  $$('[data-close]', wrap).forEach((b) => { b.onclick = () => close(false); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    const btn = $('[type=submit]', form);
    const errBox = $('[data-error]', form);
    errBox.hidden = true;
    btn.disabled = true;
    try {
      const r = await onSubmit(form);
      if (r !== false) close(true);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  document.body.appendChild(wrap);
  onOpen?.(form);
  ($('[autofocus]', form) || $('input:not([type=hidden]),textarea,select', form) || $('[type=submit]', form) || $('[data-close]', form))?.focus();
  return { close, form };
}

function confirmDialog(message, { title = 'Xác nhận xóa', okText = 'Xóa' } = {}) {
  return new Promise((resolve) => {
    openModal({
      title, submitText: okText, submitClass: 'btn-danger-solid',
      body: `<p>${message}</p>`,
      onSubmit: () => true,
      onClose: (ok) => resolve(!!ok),
    });
  });
}

/* ---------- Query viewer ---------- */
// db.<coll> chỉ hợp lệ khi tên là identifier; ngược lại phải dùng db.getCollection("...")
const collRef = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? `db.${name}` : `db.getCollection(${JSON.stringify(name)})`);

function toShell(q) {
  const j = (o) => JSON.stringify(o, null, 2);
  let s;
  if (q.database) {
    const inner = { ...q, database: undefined };
    return `use ${q.database}\n` + toShell(inner);
  }
  if (q.op === 'dropDatabase') return 'db.dropDatabase()';
  if (q.op === 'createCollection') return `db.createCollection(${JSON.stringify(q.args?.[0] ?? q.collection)})`;
  if (q.op === 'transaction') {
    s = `const session = client.startSession();\nsession.withTransaction(async () => {\n${q.steps.map((st) => '  ' + toShell(st).replace(/\n/g, '\n  ') + ';').join('\n')}\n});`;
  } else if (q.op === 'find') {
    s = `${collRef(q.collection)}.find(${j(q.filter || {})}${q.projection ? ', ' + j(q.projection) : ''})`;
    if (q.sort) s += `.sort(${j(q.sort)})`;
    if (q.skip) s += `.skip(${q.skip})`;
    if (q.limit) s += `.limit(${q.limit})`;
  } else if (q.op === 'aggregate') {
    s = `${collRef(q.collection)}.aggregate(${j(q.pipeline)})`;
  } else {
    const args = ['filter', 'document', 'update'].filter((k) => q[k] !== undefined).map((k) => j(q[k]));
    s = `${collRef(q.collection)}.${q.op}(${args.join(', ')})`;
  }
  return mongoish(s);
}

// Extended JSON -> cú pháp mongosh: {"$oid": ".."} -> ObjectId(".."), {"$date": ".."} -> ISODate("..")
function mongoish(s) {
  return s
    .replace(/\{\s*"\$oid":\s*"([a-f\d]{24})"\s*\}/gi, 'ObjectId("$1")')
    .replace(/\{\s*"\$date":\s*"([^"]+)"\s*\}/g, 'ISODate("$1")');
}
const prettyResult = (v) => mongoish(JSON.stringify(v, null, 2));

function showQuery(q) {
  if (!q) { toast('Chưa có query nào được chạy', 'info'); return; }
  const shell = toShell(q);
  openModal({
    title: 'Query MongoDB đã chạy',
    wide: true,
    body: `
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <span class="chip chip-soft">${esc(q.op)}</span>
        <span class="chip">${esc(q.collection || '')}</span>
        ${q.ms != null ? `<span class="chip">${q.ms} ms</span>` : ''}
        <button type="button" class="btn btn-sm ml-auto" data-copy>Copy</button>
      </div>
      <pre class="code">${esc(shell)}</pre>
      <p class="text-xs muted">Cú pháp mongosh. Thời gian đo ở server Node.js, đã gồm độ trễ mạng tới Atlas.</p>`,
    onOpen(form) {
      $('[data-copy]', form).onclick = async () => {
        try { await navigator.clipboard.writeText(shell); toast('Đã copy query'); } catch { toast('Không copy được', 'error'); }
      };
    },
  });
}

function setQuery(key, q) {
  QUERIES[key] = q;
  $$(`[data-query="${key}"]`).forEach((b) => { b.textContent = `{ } ${q?.ms != null ? q.ms + ' ms' : 'query'}`; b.title = 'Xem query MongoDB'; });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-query]');
  if (b) showQuery(QUERIES[b.dataset.query]);
});

/* ---------- Pagination ---------- */
function renderPagination(el, { page, pages, total }, onGo) {
  if (!total) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <span class="text-sm muted tabular">${fmt(total)} kết quả${pages > 1 ? ` · trang ${fmt(page)}/${fmt(pages)}` : ''}</span>
    ${pages > 1 ? `<div class="flex gap-1">
      <button class="btn btn-sm" data-p="1" ${page <= 1 ? 'disabled' : ''} aria-label="Trang đầu">«</button>
      <button class="btn btn-sm" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Trước</button>
      <button class="btn btn-sm" data-p="${page + 1}" ${page >= pages ? 'disabled' : ''}>Sau ›</button>
      <button class="btn btn-sm" data-p="${pages}" ${page >= pages ? 'disabled' : ''} aria-label="Trang cuối">»</button>
    </div>` : ''}`;
  $$('[data-p]', el).forEach((b) => { b.onclick = () => onGo(Number(b.dataset.p)); });
}

/* ---------- Tag input ---------- */
function tagInput(container, initial = [], placeholder = 'Nhập rồi nhấn Enter') {
  const tags = [...(initial || [])];
  container.classList.add('input', 'tag-input');
  const field = () => $('.tag-field', container);
  const add = (v, refocus = true) => {
    String(v).split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => { if (!tags.includes(s)) tags.push(s); });
    render();
    if (refocus) field().focus();
  };
  function render() {
    container.innerHTML = tags.map((t, i) => `<span class="tag">${esc(t)}<button type="button" data-i="${i}" aria-label="Bỏ ${esc(t)}">×</button></span>`).join('')
      + `<input class="tag-field" placeholder="${tags.length ? '' : esc(placeholder)}" aria-label="${esc(placeholder)}">`;
    $$('[data-i]', container).forEach((b) => { b.onclick = () => { tags.splice(Number(b.dataset.i), 1); render(); field().focus(); }; });
    const f = field();
    f.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (f.value.trim()) add(f.value); }
      else if (e.key === 'Backspace' && !f.value && tags.length) { tags.pop(); render(); field().focus(); }
    };
    f.onblur = () => { if (f.value.trim()) add(f.value, false); };
  }
  container.addEventListener('mousedown', (e) => { if (e.target === container) { e.preventDefault(); field().focus(); } });
  render();
  return { get: () => { const f = field(); if (f.value.trim()) add(f.value, false); return [...tags]; } };
}

/* ---------- Misc UI ---------- */
const skeletonRows = (n, h = 'h-12') => Array.from({ length: n }, () => `<div class="skeleton ${h}"></div>`).join('');
const errorBox = (msg) => `<div class="form-error">Không tải được dữ liệu: ${esc(msg)}</div>`;
const emptyBox = (msg) => `<div class="card p-10 text-center muted">${esc(msg)}</div>`;
const posterImg = (src, alt) => `<img src="${esc(src || POSTER_FALLBACK)}" alt="${esc(alt)}" loading="lazy" onerror="this.onerror=null;this.src=POSTER_FALLBACK">`;

renderNav();
showFlash();
