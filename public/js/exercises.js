/* Tab "Bài tập" của Query Explorer + điều khiển tab */

/* ---------- Tabs ---------- */
function setTab(name) {
  if (!$(`[data-panel="${name}"]`)) name = 'exercises';
  $$('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  const u = new URL(location.href);
  u.searchParams.set('tab', name);
  history.replaceState(null, '', u);
}
$$('[data-tab]').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
setTab(new URLSearchParams(location.search).get('tab') || 'exercises');

/* ---------- Database/collection của Bài 3 (đổi được tên) ---------- */
const DB_RE = /^[A-Za-z0-9_-]{1,63}$/;
const COLL_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$/;
let defaults = { db: 'movie_demo', collection: 'watchlist' };
let exTarget = null;

function loadTarget() {
  try {
    const saved = JSON.parse(localStorage.getItem('exTarget') || 'null');
    if (saved && DB_RE.test(saved.db) && COLL_RE.test(saved.collection)) return saved;
  } catch { /* ignore */ }
  return { ...defaults };
}
function validateTarget(t) {
  if (!DB_RE.test(t.db)) return 'Tên database chỉ gồm chữ, số, _ hoặc - (tối đa 63 ký tự)';
  if (/^(admin|local|config)$/i.test(t.db) || /^sample_/i.test(t.db)) return 'Không dùng database hệ thống hoặc dữ liệu mẫu (sample_*)';
  if (!COLL_RE.test(t.collection) || t.collection.startsWith('system.')) return 'Tên collection không hợp lệ';
  return null;
}
const sandboxLink = () => `/sandbox?db=${encodeURIComponent(exTarget.db)}&coll=${encodeURIComponent(exTarget.collection)}`;

// Thay tên mặc định trong lệnh mongosh của tài liệu bằng tên người dùng chọn
function shellFor(q) {
  if (!q.configurable) return q.shell;
  return q.shell
    .replace(/^use movie_demo$/m, `use ${exTarget.db}`)
    .replace(/db\.watchlist\./g, `${collRef(exTarget.collection)}.`);
}
const fill = (s) => s.replaceAll('{db}', exTarget.db).replaceAll('{coll}', exTarget.collection);

/* ---------- State ---------- */
let exState = null;
async function loadExState() {
  const p = new URLSearchParams({ db: exTarget.db, collection: exTarget.collection });
  try {
    exState = (await api('/api/exercises/state?' + p)).data;
  } catch (e) {
    $('#exState').innerHTML = `<span class="chip chip-danger">${esc(e.message)}</span>`;
    return;
  }
  $('#exState').innerHTML = `
    <a class="chip" href="${sandboxLink()}" title="Mở collection của Bài 3 trong Sandbox">${esc(exState.db)}.${esc(exState.collection)}: <b class="tabular">${fmt(exState.count)}</b> docs</a>
    <span class="chip ${exState.runtimeIndex ? 'chip-soft' : ''}" title="Index trên movies.runtime">index runtime: <b>${exState.runtimeIndex ? esc(exState.runtimeIndex) : 'không có'}</b></span>`;
  const tip = $('#ex7tip');
  if (tip) {
    tip.innerHTML = exState.runtimeIndex
      ? `Index <code>${esc(exState.runtimeIndex)}</code> <b>đang tồn tại</b>, nên bước "Without index" vẫn sẽ dùng IXSCAN. Muốn thấy COLLSCAN thì chạy bước <b>Drop index</b> ở cuối bài trước, rồi làm lại từ đầu.`
      : 'Hiện <b>không có</b> index trên <code>runtime</code>: bước "Without index" sẽ là COLLSCAN, đúng thứ tự của bài.';
  }
}

/* ---------- Render ---------- */
let exercises = [];
const queryById = new Map();
let prevExplain = null; // so sánh 2 lần explain của Bài 7

function queryBlock(q) {
  const badge = q.write ? `<span class="chip text-xs ${q.danger ? 'chip-danger' : ''}">${q.danger ? 'xóa dữ liệu' : 'ghi dữ liệu'}</span>` : '';
  return `
  <div class="ex-query" data-q="${esc(q.id)}">
    <div class="flex flex-col sm:flex-row sm:items-start gap-2">
      <pre class="code flex-1 min-w-0 text-xs" data-shell>${esc(shellFor(q))}</pre>
      <div class="flex sm:flex-col items-center sm:items-stretch gap-1.5 shrink-0 sm:w-28">
        <button class="btn btn-sm btn-primary" data-run>▶ Chạy</button>${badge}
      </div>
    </div>
    ${q.note ? `<p class="text-xs muted mt-1.5">${esc(q.note)}</p>` : ''}
    <div data-out></div>
  </div>`;
}

function partBlock(p) {
  return `
  <section class="ex-part" data-part>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="font-semibold">${esc(p.name)}</h3>
      <button class="btn btn-sm" data-reveal aria-expanded="false">Hiện đáp án</button>
    </div>
    <ol class="tasks">${p.tasks.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
    <div class="space-y-4 mt-3" data-answers hidden>${p.queries.map(queryBlock).join('')}</div>
  </section>`;
}

function targetForm() {
  return `
  <form class="ex-target mt-3" data-target-form novalidate>
    <label class="w-44"><span class="label">Database</span><input name="db" class="input font-mono text-sm" value="${esc(exTarget.db)}" spellcheck="false"></label>
    <label class="w-44"><span class="label">Collection</span><input name="collection" class="input font-mono text-sm" value="${esc(exTarget.collection)}" spellcheck="false"></label>
    <button class="btn btn-sm btn-primary" type="submit">Áp dụng</button>
    <button class="btn btn-sm" type="button" data-target-reset>Mặc định</button>
    <a class="btn btn-sm" data-sandbox-link href="${sandboxLink()}">Mở trong Sandbox →</a>
    <p class="w-full text-xs muted">Tài liệu dùng <code>movie_demo.watchlist</code>. Nếu bạn đặt tên khác (vd. <code>movie_club</code>), nhập vào đây; mọi query bên dưới sẽ chạy trên tên mới. Database hệ thống và <code>sample_*</code> bị chặn.</p>
  </form>`;
}

function exerciseCard(ex) {
  const head = `
    <div class="flex flex-wrap items-center gap-3">
      <span class="ex-no" aria-hidden="true">${ex.no}</span>
      <h2 class="text-lg font-semibold flex-1 min-w-0">Exercise ${ex.no}: ${esc(ex.title)}</h2>
      ${ex.setup ? '<span class="chip">làm ngoài ứng dụng</span>' : `<span class="chip chip-soft" ${ex.configurable ? 'data-db-chip' : ''}>db: ${esc(ex.configurable ? exTarget.db : ex.db)}</span>`}
    </div>
    ${ex.intro ? `<p class="text-sm muted mt-2">${esc(ex.intro)}</p>` : ''}`;
  if (ex.setup) {
    return `<article class="card p-5" id="ex-${ex.no}">${head}<ol class="tasks mt-3">${ex.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></article>`;
  }
  return `
  <article class="card p-5" id="ex-${ex.no}">
    ${head}
    ${ex.configurable ? targetForm() : ''}
    ${ex.no === 7 ? '<div id="ex7tip" class="tip mt-3"></div>' : ''}
    ${ex.parts.map(partBlock).join('')}
  </article>`;
}

function explainView(s) {
  const scan = /COLLSCAN/.test(s.plan);
  const cell = (k, v) => `<div class="stat"><div class="text-xs muted">${k}</div><div class="font-semibold tabular">${v}</div></div>`;
  let compare = '';
  if (prevExplain && prevExplain.plan !== s.plan) {
    compare = `<p class="text-sm mt-2">So với lần chạy trước (<code>${esc(prevExplain.plan)}</code>): docs examined <b>${fmt(prevExplain.totalDocsExamined)}</b> → <b>${fmt(s.totalDocsExamined)}</b>.</p>`;
  }
  return `
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      ${cell('stage', `<span style="color:${scan ? 'var(--danger)' : 'var(--accent)'}">${esc(s.plan)}</span>`)}
      ${cell('index', esc(s.index || '—'))}
      ${cell('nReturned', fmt(s.nReturned))}
      ${cell('totalKeysExamined', fmt(s.totalKeysExamined))}
      ${cell('totalDocsExamined', fmt(s.totalDocsExamined))}
      ${cell('executionTimeMillis', fmt(s.executionTimeMillis) + ' ms')}
    </div>
    <p class="text-sm mt-2">${scan
      ? `<b>COLLSCAN</b>: MongoDB phải đọc toàn bộ <b>${fmt(s.totalDocsExamined)}</b> documents để tìm ra <b>${fmt(s.nReturned)}</b> kết quả.`
      : `<b>IXSCAN</b> (index <code>${esc(s.index)}</code>): chỉ đọc <b>${fmt(s.totalKeysExamined)}</b> index keys và <b>${fmt(s.totalDocsExamined)}</b> documents để trả về <b>${fmt(s.nReturned)}</b> kết quả.`}</p>
    ${compare}`;
}

function resultView(r) {
  const meta = (extra = '') => `<div class="text-xs muted mt-3 mb-1.5">Kết quả · ${fmt(r.ms)} ms${extra ? ' · ' + extra : ''}</div>`;
  if (r.kind === 'explain') {
    const html = meta('explain("executionStats")') + explainView(r.value.summary) +
      `<details class="mt-2"><summary class="text-xs muted cursor-pointer">Xem executionStats đầy đủ</summary><pre class="code text-xs mt-2">${esc(prettyResult(r.value.executionStats))}</pre></details>`;
    prevExplain = r.value.summary;
    return html;
  }
  if (r.kind === 'docs') {
    return meta(`${fmt(r.value.length)} document${r.value.length === 1 ? '' : 's'}`) + `<pre class="code text-xs">${esc(prettyResult(r.value))}</pre>`;
  }
  const text = typeof r.value === 'string' ? r.value : typeof r.value === 'number' ? String(r.value) : prettyResult(r.value);
  return meta() + `<pre class="code text-xs">${esc(text)}</pre>`;
}

async function runQuery(id, el) {
  const q = queryById.get(id);
  const shell = shellFor(q);
  if (q.danger && !(await confirmDialog(`${esc(fill(q.danger))}<pre class="code text-xs mt-3">${esc(shell)}</pre>`, { title: 'Chạy lệnh xóa dữ liệu?', okText: 'Chạy' }))) return;
  const btn = $('[data-run]', el);
  const out = $('[data-out]', el);
  btn.disabled = true;
  out.innerHTML = '<div class="skeleton h-16 mt-3"></div>';
  try {
    const body = q.configurable ? { db: exTarget.db, collection: exTarget.collection } : {};
    const r = await api(`/api/exercises/run/${encodeURIComponent(id)}`, { method: 'POST', body });
    out.innerHTML = resultView(r);
    if (q.write) toast(`Đã chạy: ${shell.split('\n').pop()}`, 'success');
  } catch (e) {
    out.innerHTML = `<div class="form-error mt-3 font-mono text-xs">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    if (q.write || id.startsWith('7-')) loadExState();
  }
}

function setReveal(partEl, show) {
  $('[data-answers]', partEl).hidden = !show;
  const b = $('[data-reveal]', partEl);
  b.textContent = show ? 'Ẩn đáp án' : 'Hiện đáp án';
  b.setAttribute('aria-expanded', String(show));
}

function applyTarget(t) {
  exTarget = t;
  try { localStorage.setItem('exTarget', JSON.stringify(t)); } catch { /* ignore */ }
  $$('#exList [data-q]').forEach((el) => {
    const q = queryById.get(el.dataset.q);
    if (q.configurable) { $('[data-shell]', el).textContent = shellFor(q); $('[data-out]', el).innerHTML = ''; }
  });
  $$('[data-db-chip]').forEach((c) => { c.textContent = `db: ${t.db}`; });
  $$('[data-sandbox-link]').forEach((a) => { a.href = sandboxLink(); });
  const f = $('[data-target-form]');
  if (f) { f.db.value = t.db; f.collection.value = t.collection; }
  loadExState();
}

function bindTargetForm() {
  const f = $('[data-target-form]');
  if (!f) return;
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = { db: f.db.value.trim(), collection: f.collection.value.trim() };
    const err = validateTarget(t);
    if (err) { toast(err, 'error'); return; }
    applyTarget(t);
    toast(`Bài 3 giờ chạy trên ${t.db}.${t.collection}`, 'info');
  });
  $('[data-target-reset]', f).onclick = () => applyTarget({ ...defaults });
}

function renderExercises() {
  $('#exToc').innerHTML = exercises.map((ex) => `<button type="button" class="chip" data-goto="${ex.no}">${ex.no}. ${esc(ex.title)}</button>`).join('');
  $$('#exToc [data-goto]').forEach((b) => {
    b.onclick = () => $(`#ex-${b.dataset.goto}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#exList').innerHTML = exercises.map(exerciseCard).join('');
  $$('#exList [data-q]').forEach((el) => { $('[data-run]', el).onclick = () => runQuery(el.dataset.q, el); });
  $$('#exList [data-part]').forEach((p) => {
    $('[data-reveal]', p).onclick = () => setReveal(p, $('[data-answers]', p).hidden);
  });
  bindTargetForm();
  let showAll = false;
  try { showAll = localStorage.getItem('exShowAll') === '1'; } catch { /* ignore */ }
  $('#showAll').checked = showAll;
  $$('#exList [data-part]').forEach((p) => setReveal(p, showAll));
}

$('#showAll').addEventListener('change', (e) => {
  try { localStorage.setItem('exShowAll', e.target.checked ? '1' : '0'); } catch { /* ignore */ }
  $$('#exList [data-part]').forEach((p) => setReveal(p, e.target.checked));
});

$('#exList').innerHTML = skeletonRows(3, 'h-48 rounded-2xl');
api('/api/exercises')
  .then(({ data, defaults: d }) => {
    if (d) defaults = d;
    exTarget = loadTarget();
    exercises = data;
    for (const ex of data) for (const p of ex.parts || []) for (const q of p.queries) queryById.set(q.id, q);
    renderExercises();
    loadExState();
  })
  .catch((e) => { $('#exList').innerHTML = errorBox(e.message); });
