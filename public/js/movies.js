const FIELDS = ['q', 'yearFrom', 'yearTo', 'minRating', 'type', 'sort'];
const state = { q: '', yearFrom: '', yearTo: '', minRating: '', type: '', sort: '', genres: [], page: 1 };

(function readURL() {
  const p = new URLSearchParams(location.search);
  for (const k of FIELDS) state[k] = p.get(k) || '';
  state.genres = (p.get('genres') || '').split(',').filter(Boolean);
  state.page = Math.max(1, Number(p.get('page')) || 1);
  for (const k of FIELDS) $('#' + k).value = state[k];
})();

function params() {
  const p = new URLSearchParams();
  for (const k of FIELDS) if (state[k]) p.set(k, state[k]);
  if (state.genres.length) p.set('genres', state.genres.join(','));
  if (state.page > 1) p.set('page', state.page);
  return p;
}

function card(m) {
  const r = ratingOf(m);
  return `
  <a href="/movies/${m._id}" class="card movie-card overflow-hidden flex flex-col transition-colors">
    <div class="poster">${posterImg(m.poster, m.title)}</div>
    <div class="p-3 flex-1 flex flex-col gap-1">
      <div class="font-semibold text-sm leading-snug line-clamp-2" title="${esc(m.title)}">${esc(m.title)}</div>
      <div class="text-xs muted">${esc(m.year ?? '—')}${m.runtime ? ` · ${m.runtime} phút` : ''}${m.type === 'series' ? ' · series' : ''}</div>
      <div class="mt-auto pt-1 flex items-center justify-between gap-2">
        <span class="text-xs muted truncate">${esc((m.genres || []).slice(0, 2).join(', '))}</span>
        <span class="rating">${r != null ? '★ ' + r : ''}</span>
      </div>
    </div>
  </a>`;
}

let reqId = 0;
async function load() {
  const id = ++reqId;
  const p = params();
  history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
  $('#grid').innerHTML = Array.from({ length: 12 }, () => '<div class="skeleton aspect-[2/3.6] rounded-2xl"></div>').join('');
  try {
    const res = await api(`/api/movies?${p}&limit=24`);
    if (id !== reqId) return; // bỏ kết quả của request cũ
    setQuery('list', res.query);
    $('#grid').innerHTML = res.data.length ? res.data.map(card).join('') : `<div class="col-span-full">${emptyBox('Không có phim nào khớp bộ lọc.')}</div>`;
    const go = (page) => { state.page = page; load(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    renderPagination($('#pager'), res, go);
    renderPagination($('#pagerTop'), res, go);
  } catch (e) {
    if (id === reqId) $('#grid').innerHTML = `<div class="col-span-full">${errorBox(e.message)}</div>`;
  }
}

function renderGenres(all) {
  $('#genres').innerHTML = all.map((g) => `<button type="button" class="chip ${state.genres.includes(g) ? 'on' : ''}" data-g="${esc(g)}" aria-pressed="${state.genres.includes(g)}">${esc(g)}</button>`).join('');
  $$('#genres [data-g]').forEach((b) => {
    b.onclick = () => {
      const g = b.dataset.g;
      state.genres = state.genres.includes(g) ? state.genres.filter((x) => x !== g) : [...state.genres, g];
      b.classList.toggle('on');
      b.setAttribute('aria-pressed', String(state.genres.includes(g)));
      state.page = 1;
      load();
    };
  });
}

const onChange = (k) => () => { state[k] = $('#' + k).value.trim(); state.page = 1; load(); };
$('#q').addEventListener('input', debounce(onChange('q'), 400));
for (const k of ['yearFrom', 'yearTo']) $('#' + k).addEventListener('input', debounce(onChange(k), 500));
for (const k of ['minRating', 'type', 'sort']) $('#' + k).addEventListener('change', onChange(k));
$('#resetBtn').onclick = () => {
  for (const k of FIELDS) { state[k] = ''; $('#' + k).value = ''; }
  state.genres = []; state.page = 1;
  $$('#genres .chip.on').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
  load();
};
$('#addBtn').onclick = () => openMovieForm(null, (m) => {
  flash(`Đã thêm phim "${m.title}" (insertOne)`);
  location.href = `/movies/${m._id}`;
});

api('/api/movies/genres').then(({ data }) => renderGenres(data)).catch((e) => { $('#genres').innerHTML = errorBox(e.message); });
load();
