const movieId = location.pathname.split('/').filter(Boolean).pop();
let movie = null;
let cPage = 1;

if (document.referrer.includes('/movies?')) $('#backLink').href = document.referrer;

function row(label, value) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '';
  const v = Array.isArray(value) ? value.map(esc).join(', ') : esc(value);
  return `<div class="grid grid-cols-[120px_1fr] gap-3 py-2" style="border-bottom:1px solid var(--border)"><dt class="text-sm muted">${label}</dt><dd class="text-sm">${v}</dd></div>`;
}

function renderMovie(m) {
  movie = m;
  document.title = `${m.title} · MFlix MongoDB Demo`;
  const r = ratingOf(m);
  const tv = m.tomatoes?.viewer;
  $('#detail').innerHTML = `
  <div class="grid md:grid-cols-[260px_1fr] gap-6">
    <div class="space-y-3">
      <div class="poster rounded-2xl card">${posterImg(m.poster, m.title)}</div>
      <div class="grid grid-cols-2 gap-2 admin-only">
        <button class="btn" id="editBtn">Sửa</button>
        <button class="btn btn-danger" id="delBtn">Xóa</button>
      </div>
      <button class="btn btn-sm btn-query w-full" data-query="movie">{ }</button>
    </div>
    <div class="space-y-5 min-w-0">
      <div>
        <div class="flex flex-wrap gap-1.5 mb-2">${(m.genres || []).map((g) => `<a class="chip chip-soft" href="/movies?genres=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}</div>
        <h1 class="text-3xl font-bold tracking-tight">${esc(m.title)}</h1>
        <p class="muted mt-1">${[m.year, m.rated, m.runtime ? m.runtime + ' phút' : null, m.type].filter(Boolean).map(esc).join(' · ')}</p>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="card p-3"><div class="text-xs muted">IMDb</div><div class="rating text-xl">${r != null ? '★ ' + r : '—'}</div><div class="text-xs muted">${m.imdb?.votes ? fmt(m.imdb.votes) + ' votes' : ''}</div></div>
        <div class="card p-3"><div class="text-xs muted">Tomatoes (viewer)</div><div class="text-xl font-semibold">${tv?.meter != null ? tv.meter + '%' : '—'}</div><div class="text-xs muted">${tv?.numReviews ? fmt(tv.numReviews) + ' reviews' : ''}</div></div>
        <div class="card p-3"><div class="text-xs muted">Giải thưởng</div><div class="text-xl font-semibold">${m.awards?.wins ?? '—'}</div><div class="text-xs muted">${m.awards?.nominations != null ? m.awards.nominations + ' đề cử' : ''}</div></div>
        <div class="card p-3"><div class="text-xs muted">Comments</div><div class="text-xl font-semibold tabular" id="numComments">${fmt(m.num_mflix_comments ?? 0)}</div><div class="text-xs muted">num_mflix_comments</div></div>
      </div>
      ${m.fullplot || m.plot ? `<p class="leading-relaxed">${esc(m.fullplot || m.plot)}</p>` : '<p class="muted">Chưa có nội dung.</p>'}
      <dl>
        ${row('Đạo diễn', m.directors)}
        ${row('Biên kịch', m.writers)}
        ${row('Diễn viên', m.cast)}
        ${row('Ngôn ngữ', m.languages)}
        ${row('Quốc gia', m.countries)}
        ${row('Phát hành', m.released ? new Date(m.released).toLocaleDateString('vi-VN') : null)}
        ${row('Giải thưởng', m.awards?.text)}
        ${row('Cập nhật', m.lastupdated ? fmtDate(m.lastupdated) : null)}
        ${row('_id', m._id)}
      </dl>
    </div>
  </div>`;

  if (QUERIES.movie) setQuery('movie', QUERIES.movie);
  $('#editBtn').onclick = () => openMovieForm(movie, (updated, query) => { renderMovie(updated); setQuery('movie', query); });
  $('#delBtn').onclick = async () => {
    const n = movie.num_mflix_comments || 0;
    const ok = await confirmDialog(`Xóa phim <b>${esc(movie.title)}</b>? ${n ? `${fmt(n)} comment của phim cũng sẽ bị xóa.` : ''}<br><span class="text-sm muted">deleteOne(movie) và deleteMany(comments) chạy chung 1 transaction.</span>`);
    if (!ok) return;
    try {
      const res = await api(`/api/movies/${movieId}`, { method: 'DELETE' });
      flash(`Đã xóa phim "${movie.title}" và ${res.data.removedComments} comment (transaction)`);
      location.href = '/movies';
    } catch (e) { toast(e.message, 'error'); }
  };
}

function commentItem(c) {
  return `
  <article class="p-4 rounded-xl" style="border:1px solid var(--border)" data-id="${c._id}">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div><span class="font-semibold">${esc(c.name)}</span> <span class="text-xs muted">${esc(c.email)}</span>
        <div class="text-xs muted">${fmtDate(c.date)}</div></div>
      <div class="flex gap-1">
        <button class="btn btn-sm admin-only" data-edit>Sửa</button>
        <button class="btn btn-sm btn-danger admin-only" data-del>Xóa</button>
      </div>
    </div>
    <p class="mt-2 text-sm leading-relaxed whitespace-pre-line" data-text>${esc(c.text)}</p>
  </article>`;
}

async function loadComments() {
  $('#cList').innerHTML = skeletonRows(3, 'h-20');
  try {
    const res = await api(`/api/movies/${movieId}/comments?page=${cPage}&limit=10`);
    setQuery('comments', res.query);
    $('#cCount').textContent = `(${fmt(res.total)})`;
    $('#cList').innerHTML = res.data.length ? res.data.map(commentItem).join('') : `<p class="muted text-sm">Chưa có bình luận nào.${IS_ADMIN ? ' Hãy là người đầu tiên.' : ''}</p>`;
    renderPagination($('#cPager'), res, (p) => { cPage = p; loadComments(); });
    bindComments(res.data);
  } catch (e) { $('#cList').innerHTML = errorBox(e.message); }
}

function bumpCount(delta) {
  movie.num_mflix_comments = (movie.num_mflix_comments || 0) + delta;
  $('#numComments').textContent = fmt(movie.num_mflix_comments);
}

function bindComments(list) {
  for (const c of list) {
    const el = $(`[data-id="${c._id}"]`);
    $('[data-del]', el).onclick = async () => {
      if (!(await confirmDialog('Xóa bình luận này?'))) return;
      try {
        const res = await api(`/api/comments/${c._id}`, { method: 'DELETE' });
        toast('Đã xóa bình luận', 'success', res.query);
        bumpCount(-1);
        loadComments();
      } catch (e) { toast(e.message, 'error'); }
    };
    $('[data-edit]', el).onclick = () => {
      const textEl = $('[data-text]', el);
      if ($('textarea', el)) return;
      textEl.outerHTML = `<div class="mt-2 space-y-2" data-editor>
        <textarea class="input" rows="3" maxlength="2000" aria-label="Sửa nội dung">${esc(c.text)}</textarea>
        <div class="flex gap-2 justify-end"><button class="btn btn-sm" data-cancel>Hủy</button><button class="btn btn-sm btn-primary" data-save>Lưu</button></div></div>`;
      const ta = $('textarea', el); ta.focus();
      $('[data-cancel]', el).onclick = () => loadComments();
      $('[data-save]', el).onclick = async () => {
        const text = ta.value.trim();
        if (!text) { toast('Nội dung không được để trống', 'error'); return; }
        try {
          const res = await api(`/api/comments/${c._id}`, { method: 'PUT', body: { text } });
          toast('Đã cập nhật bình luận', 'success', res.query);
          loadComments();
        } catch (e) { toast(e.message, 'error'); }
      };
    };
  }
}

$('#cForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const body = { name: f.name.value.trim(), email: f.email.value.trim(), text: f.text.value.trim() };
  if (!body.name || !body.email || !body.text) { toast('Vui lòng nhập đủ tên, email và nội dung', 'error'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { toast('Email không hợp lệ', 'error'); return; }
  const btn = $('[type=submit]', f); btn.disabled = true;
  try {
    const res = await api(`/api/movies/${movieId}/comments`, { method: 'POST', body });
    toast('Đã thêm bình luận', 'success', res.query);
    f.text.value = '';
    bumpCount(1);
    cPage = 1;
    loadComments();
  } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
});

(async function init() {
  try {
    const res = await api(`/api/movies/${movieId}`);
    renderMovie(res.data);
    setQuery('movie', res.query);
    $('#commentsSection').hidden = false;
    loadComments();
  } catch (e) {
    $('#detail').innerHTML = errorBox(e.message);
  }
})();
