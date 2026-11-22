/* Sandbox: duyệt database do người dùng tạo + CRUD document dạng JSON */

const DB_RE = /^[A-Za-z0-9_-]{1,63}$/;
const COLL_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$/;
const params = new URLSearchParams(location.search);
const sel = { db: params.get('db') || '', coll: params.get('coll') || '' };
const view = { filter: '', sort: '', page: 1 };
let dbs = [];
let docs = [];

const base = () => `/api/sandbox/databases/${encodeURIComponent(sel.db)}/collections/${encodeURIComponent(sel.coll)}`;
const fmtSize = (b) => (b == null ? '' : b < 1024 * 1024 ? `${fmt(b / 1024, 0)} KB` : `${fmt(b / 1024 / 1024, 1)} MB`);

function validDb(name) {
  if (!DB_RE.test(name)) return 'Tên database chỉ gồm chữ, số, _ hoặc - (tối đa 63 ký tự)';
  if (/^(admin|local|config)$/i.test(name) || /^sample_/i.test(name)) return 'Không dùng tên database hệ thống hoặc sample_*';
  return null;
}
function validColl(name) {
  if (!COLL_RE.test(name) || name.startsWith('system.')) return 'Tên collection chỉ gồm chữ, số, _ - . và không bắt đầu bằng "system."';
  return null;
}

function select(db, coll) {
  sel.db = db; sel.coll = coll;
  Object.assign(view, { filter: '', sort: '', page: 1 });
  const u = new URL(location.href);
  u.search = db && coll ? new URLSearchParams({ db, coll }).toString() : '';
  history.replaceState(null, '', u);
  renderDbs();
  renderMain();
}

/* ---------- Danh sách database ---------- */
async function loadDbs() {
  try {
    const r = await api('/api/sandbox/databases');
    dbs = r.data;
    $('#hiddenDbs').textContent = r.hidden?.length ? `Đang ẩn: ${r.hidden.join(', ')}` : '';
  } catch (e) {
    $('#dbList').innerHTML = errorBox(e.message);
    return;
  }
  const exists = dbs.some((d) => d.name === sel.db && d.collections.some((c) => c.name === sel.coll));
  if (sel.db && !exists) {
    toast(`Không tìm thấy ${sel.db}.${sel.coll || ''}`, 'info');
    sel.db = ''; sel.coll = '';
  }
  if (!sel.db) {
    const first = dbs.find((d) => d.collections.length);
    if (first) { select(first.name, first.collections[0].name); return; }
  }
  renderDbs();
  renderMain();
}

function renderDbs() {
  if (!dbs.length) {
    $('#dbList').innerHTML = IS_ADMIN
      ? '<p class="text-sm muted px-2 py-3">Chưa có database nào. Bấm <b>+ Database mới</b> hoặc chạy Exercise 3 trong Query Explorer.</p>'
      : '<p class="text-sm muted px-2 py-3">Chưa có database nào.</p>';
    return;
  }
  $('#dbList').innerHTML = dbs.map((d) => `
    <div class="db-item" data-db="${esc(d.name)}">
      <div class="flex items-center gap-1 pl-2 py-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="muted shrink-0" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>
        <span class="font-semibold text-sm flex-1 truncate ml-1" title="${esc(d.name)}">${esc(d.name)}</span>
        <span class="text-xs muted tabular">${fmtSize(d.sizeOnDisk)}</span>
        <button class="btn btn-sm btn-ghost admin-only" data-add-coll title="Thêm collection" aria-label="Thêm collection vào ${esc(d.name)}">+</button>
        <button class="btn btn-sm btn-ghost btn-danger admin-only" data-drop-db title="Drop database" aria-label="Drop database ${esc(d.name)}">✕</button>
      </div>
      ${d.collections.map((c) => `
        <button class="coll-btn ${d.name === sel.db && c.name === sel.coll ? 'active' : ''}" data-coll="${esc(c.name)}" ${d.name === sel.db && c.name === sel.coll ? 'aria-current="true"' : ''}>
          <span class="truncate">${esc(c.name)}</span><span class="text-xs muted tabular">${fmt(c.count)}</span>
        </button>`).join('')}
      ${d.collections.length ? '' : '<div class="text-xs muted pl-7 py-1">Chưa có collection</div>'}
    </div>`).join('');

  $$('#dbList [data-db]').forEach((el) => {
    const db = el.dataset.db;
    $$('[data-coll]', el).forEach((b) => { b.onclick = () => select(db, b.dataset.coll); });
    $('[data-add-coll]', el).onclick = () => openNewCollection(db);
    $('[data-drop-db]', el).onclick = () => dropDatabase(db);
  });
}

/* ---------- Panel chính: documents ---------- */
function renderMain() {
  if (!sel.db || !sel.coll) {
    $('#main').innerHTML = emptyBox(dbs.length ? 'Chọn một collection ở bên trái.' : IS_ADMIN ? 'Tạo database đầu tiên để bắt đầu.' : 'Chưa có dữ liệu để xem.');
    return;
  }
  $('#main').innerHTML = `
    <div class="card p-4 flex flex-wrap items-center gap-3">
      <div class="flex-1 min-w-0">
        <div class="text-xs muted font-mono">${esc(sel.db)}</div>
        <h2 class="text-xl font-bold truncate">${esc(sel.coll)}</h2>
      </div>
      <button class="btn btn-sm btn-query" data-query="docs">{ }</button>
      <button class="btn btn-danger admin-only" id="dropCollBtn">Drop collection</button>
      <button class="btn btn-primary admin-only" id="addDocBtn">+ Thêm document</button>
    </div>
    <form id="filterForm" class="card p-3 grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end" novalidate>
      <label><span class="label">Filter</span><input name="filter" class="input font-mono text-xs" placeholder='{ "watched": false }' value="${esc(view.filter)}" spellcheck="false"></label>
      <label><span class="label">Sort</span><input name="sort" class="input font-mono text-xs" placeholder='{ "year": -1 }' value="${esc(view.sort)}" spellcheck="false"></label>
      <button class="btn btn-primary" type="submit">Lọc</button>
      <button class="btn" type="button" id="clearFilter">Bỏ lọc</button>
    </form>
    <div id="pagerTop" class="flex flex-wrap items-center justify-between gap-3"></div>
    <div id="docList" class="space-y-3"></div>
    <div id="pager" class="flex flex-wrap items-center justify-between gap-3"></div>`;

  $('#addDocBtn').onclick = () => openDocEditor(null);
  $('#dropCollBtn').onclick = dropCollection;
  $('#filterForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    for (const [k, label] of [['filter', 'Filter'], ['sort', 'Sort']]) {
      const v = f[k].value.trim();
      if (v) { try { JSON.parse(v); } catch { toast(`${label} không phải JSON hợp lệ`, 'error'); return; } }
    }
    view.filter = f.filter.value.trim(); view.sort = f.sort.value.trim(); view.page = 1;
    loadDocs();
  });
  $('#clearFilter').onclick = () => { view.filter = ''; view.sort = ''; view.page = 1; renderMain(); };
  loadDocs();
}

let reqId = 0;
async function loadDocs() {
  const id = ++reqId;
  $('#docList').innerHTML = skeletonRows(3, 'h-28');
  const p = new URLSearchParams({ page: view.page, limit: 20 });
  if (view.filter) p.set('filter', view.filter);
  if (view.sort) p.set('sort', view.sort);
  try {
    const r = await api(`${base()}/docs?${p}`);
    if (id !== reqId) return;
    docs = r.data;
    setQuery('docs', r.query);
    $('#docList').innerHTML = docs.length
      ? docs.map((d, i) => `
        <article class="card doc-card p-3" data-i="${i}">
          <div class="flex items-center justify-between gap-2 mb-2">
            <span class="text-xs muted font-mono truncate">_id: ${esc(mongoish(JSON.stringify(d._id)))}</span>
            <div class="flex gap-1 shrink-0">
              <button class="btn btn-sm admin-only" data-edit>Sửa</button>
              <button class="btn btn-sm btn-danger admin-only" data-del>Xóa</button>
            </div>
          </div>
          <pre class="code text-xs">${esc(prettyResult(withoutId(d)))}</pre>
        </article>`).join('')
      : emptyBox(view.filter ? 'Không có document nào khớp filter.' : IS_ADMIN ? 'Collection đang trống. Bấm "+ Thêm document".' : 'Collection đang trống.');
    $$('#docList [data-i]').forEach((el) => {
      const d = docs[Number(el.dataset.i)];
      $('[data-edit]', el).onclick = () => openDocEditor(d);
      $('[data-del]', el).onclick = () => deleteDoc(d);
    });
    const go = (pg) => { view.page = pg; loadDocs(); };
    renderPagination($('#pager'), r, go);
    renderPagination($('#pagerTop'), r, go);
  } catch (e) {
    if (id === reqId) $('#docList').innerHTML = errorBox(e.message);
  }
}

function withoutId(d) { const { _id, ...rest } = d; return rest; }

// Template cho document mới: lấy các field của document đầu tiên, giá trị rỗng theo kiểu
function template() {
  const sample = docs[0];
  if (!sample) return '{\n  "name": "value"\n}';
  const blank = (v) => (Array.isArray(v) ? [] : v === null ? null : typeof v === 'number' ? 0 : typeof v === 'boolean' ? false : typeof v === 'object' ? (v.$date ? { $date: new Date().toISOString() } : v.$oid ? null : {}) : '');
  return JSON.stringify(Object.fromEntries(Object.entries(withoutId(sample)).map(([k, v]) => [k, blank(v)])), null, 2);
}

function openDocEditor(doc) {
  const isEdit = !!doc;
  openModal({
    title: isEdit ? 'Sửa document' : `Thêm document vào ${sel.db}.${sel.coll}`,
    submitText: isEdit ? 'Lưu (replaceOne)' : 'Thêm (insertOne)',
    wide: true,
    body: `
      ${isEdit ? `<div class="text-xs muted font-mono">_id: ${esc(mongoish(JSON.stringify(doc._id)))} (không đổi được)</div>` : ''}
      <label class="block"><span class="label">Document (JSON)</span>
        <textarea name="doc" class="input json-editor" spellcheck="false" autofocus>${esc(isEdit ? JSON.stringify(withoutId(doc), null, 2) : template())}</textarea></label>
      <p class="text-xs muted">Kiểu đặc biệt dùng Extended JSON: <code>{ "$oid": "..." }</code>, <code>{ "$date": "2024-01-01T00:00:00Z" }</code>. ${isEdit ? 'Toàn bộ document sẽ được thay bằng nội dung này.' : '_id sẽ được MongoDB tự tạo.'}</p>`,
    onOpen(form) {
      form.doc.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          const ta = e.target; const s = ta.selectionStart;
          ta.setRangeText('  ', s, ta.selectionEnd, 'end');
        }
      });
    },
    async onSubmit(form) {
      const text = form.doc.value.trim();
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { throw new Error(`JSON không hợp lệ: ${e.message}`); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Document phải là một object { ... }');
      const res = isEdit
        ? await api(`${base()}/docs`, { method: 'PUT', body: { id: doc._id, doc: text } })
        : await api(`${base()}/docs`, { method: 'POST', body: { doc: text } });
      toast(isEdit ? 'Đã cập nhật document' : 'Đã thêm document', 'success', res.query);
      await loadDocs();
      refreshCounts();
      return true;
    },
  });
}

async function deleteDoc(d) {
  if (!(await confirmDialog(`Xóa document <code>${esc(mongoish(JSON.stringify(d._id)))}</code> khỏi <b>${esc(sel.db)}.${esc(sel.coll)}</b>?`))) return;
  try {
    const res = await api(`${base()}/docs`, { method: 'DELETE', body: { id: d._id } });
    toast('Đã xóa document', 'success', res.query);
    loadDocs();
    refreshCounts();
  } catch (e) { toast(e.message, 'error'); }
}

// Cập nhật số document ở sidebar mà không vẽ lại panel chính
async function refreshCounts() {
  try { dbs = (await api('/api/sandbox/databases')).data; renderDbs(); } catch { /* ignore */ }
}

/* ---------- Database / collection ---------- */
function openNewDatabase() {
  openModal({
    title: 'Tạo database mới',
    submitText: 'Tạo',
    body: `
      <label class="block"><span class="label">Tên database</span><input name="db" class="input font-mono" placeholder="movie_demo" spellcheck="false" autofocus></label>
      <label class="block"><span class="label">Collection đầu tiên</span><input name="collection" class="input font-mono" placeholder="watchlist" spellcheck="false"></label>
      <p class="text-xs muted">MongoDB chỉ lưu database khi nó có ít nhất một collection, nên cần đặt tên collection đầu tiên.</p>`,
    async onSubmit(f) {
      const db = f.db.value.trim(); const collection = f.collection.value.trim();
      const err = validDb(db) || validColl(collection);
      if (err) throw new Error(err);
      const res = await api('/api/sandbox/databases', { method: 'POST', body: { db, collection } });
      toast(`Đã tạo ${db}.${collection}`, 'success', res.query);
      await refreshCounts();
      select(db, collection);
      return true;
    },
  });
}

function openNewCollection(db) {
  openModal({
    title: `Thêm collection vào ${db}`,
    submitText: 'Tạo',
    body: `<label class="block"><span class="label">Tên collection</span><input name="name" class="input font-mono" spellcheck="false" autofocus></label>`,
    async onSubmit(f) {
      const name = f.name.value.trim();
      const err = validColl(name);
      if (err) throw new Error(err);
      const res = await api(`/api/sandbox/databases/${encodeURIComponent(db)}/collections`, { method: 'POST', body: { name } });
      toast(`Đã tạo ${db}.${name}`, 'success', res.query);
      await refreshCounts();
      select(db, name);
      return true;
    },
  });
}

async function dropCollection() {
  const { db, coll } = sel;
  if (!(await confirmDialog(`Drop collection <b>${esc(db)}.${esc(coll)}</b>? Mọi document trong đó sẽ bị xóa vĩnh viễn.`, { title: 'Drop collection', okText: 'Drop' }))) return;
  try {
    const res = await api(`/api/sandbox/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(coll)}`, { method: 'DELETE' });
    toast(`Đã drop ${db}.${coll}`, 'success', res.query);
    sel.db = ''; sel.coll = '';
    loadDbs();
  } catch (e) { toast(e.message, 'error'); }
}

function dropDatabase(db) {
  openModal({
    title: `Drop database ${db}`,
    submitText: 'Drop database',
    submitClass: 'btn-danger-solid',
    body: `
      <p>Toàn bộ collection và document trong <b>${esc(db)}</b> sẽ bị xóa vĩnh viễn.</p>
      <label class="block"><span class="label">Gõ <code>${esc(db)}</code> để xác nhận</span><input name="confirm" class="input font-mono" autocomplete="off" spellcheck="false" autofocus></label>`,
    async onSubmit(f) {
      if (f.confirm.value.trim() !== db) throw new Error('Tên database không khớp');
      const res = await api(`/api/sandbox/databases/${encodeURIComponent(db)}`, { method: 'DELETE' });
      toast(`Đã drop database ${db}`, 'success', res.query);
      if (sel.db === db) { sel.db = ''; sel.coll = ''; }
      loadDbs();
      return true;
    },
  });
}

$('#newDbBtn').onclick = openNewDatabase;
$('#refreshBtn').onclick = loadDbs;
$('#dbList').innerHTML = skeletonRows(4, 'h-9');
$('#main').innerHTML = skeletonRows(3, 'h-28');
loadDbs();
