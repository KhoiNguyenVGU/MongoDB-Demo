let items = [];
let tab = 'all';

function stat(label, value) {
  return `<div class="card p-4"><div class="text-sm muted">${label}</div><div class="text-2xl font-bold mt-1 tabular">${value}</div></div>`;
}

function renderSummary(s) {
  $('#summary').innerHTML =
    stat('Tổng số', fmt(s.total)) +
    stat('Đã xem', fmt(s.watched)) +
    stat('Chưa xem', fmt(s.total - s.watched)) +
    stat('Điểm TB của tôi', s.avgRating != null ? `<span class="rating text-2xl">★ ${fmt(s.avgRating, 1)}</span>` : '—');
}

function render() {
  const list = items.filter((w) => (tab === 'all' ? true : tab === 'done' ? w.watched : !w.watched));
  $('#list').innerHTML = list.length ? list.map((w) => `
    <div class="card p-4 flex flex-wrap items-center gap-4" data-id="${w._id}">
      <label class="switch" title="Đánh dấu đã xem"><input type="checkbox" data-watched ${w.watched ? 'checked' : ''} aria-label="Đã xem ${esc(w.title)}"><span></span></label>
      <div class="flex-1 min-w-[160px]">
        <div class="font-semibold ${w.watched ? 'line-through muted' : ''}">${esc(w.title)} <span class="font-normal muted">${w.year ? '(' + esc(w.year) + ')' : ''}</span></div>
        <div class="flex flex-wrap gap-1 mt-1">${(w.genres || []).map((g) => `<span class="chip chip-soft">${esc(g)}</span>`).join('')}</div>
      </div>
      <label class="flex items-center gap-2 text-sm"><span class="muted">Điểm</span>
        <select class="input w-20" data-rating aria-label="Điểm của tôi">
          <option value="">—</option>${Array.from({ length: 10 }, (_, i) => `<option ${w.myRating === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}
        </select></label>
      <div class="flex gap-1">
        <button class="btn btn-sm" data-edit>Sửa</button>
        <button class="btn btn-sm btn-danger" data-del>Xóa</button>
      </div>
    </div>`).join('') : emptyBox(tab === 'all' ? 'Watchlist đang trống.' : 'Không có mục nào.');

  for (const w of list) {
    const el = $(`[data-id="${w._id}"]`);
    $('[data-watched]', el).onchange = (e) => patch(w, { watched: e.target.checked }, e.target.checked ? `Đã xem "${w.title}"` : `Bỏ đánh dấu "${w.title}"`);
    $('[data-rating]', el).onchange = (e) => patch(w, { myRating: e.target.value === '' ? null : Number(e.target.value) }, e.target.value ? `Chấm ${e.target.value}/10 cho "${w.title}"` : 'Đã xóa điểm');
    $('[data-edit]', el).onclick = () => openForm(w);
    $('[data-del]', el).onclick = async () => {
      if (!(await confirmDialog(`Xóa <b>${esc(w.title)}</b> khỏi watchlist?`))) return;
      try {
        const res = await api(`/api/watchlist/${w._id}`, { method: 'DELETE' });
        toast('Đã xóa khỏi watchlist', 'success', res.query);
        load();
      } catch (e) { toast(e.message, 'error'); }
    };
  }
}

async function patch(w, body, msg) {
  try {
    const res = await api(`/api/watchlist/${w._id}`, { method: 'PUT', body });
    toast(msg, 'success', res.query);
    load();
  } catch (e) { toast(e.message, 'error'); load(); }
}

async function load() {
  try {
    const res = await api('/api/watchlist');
    setQuery('list', res.query);
    items = res.data;
    renderSummary(res.summary);
    render();
  } catch (e) { $('#list').innerHTML = errorBox(e.message); }
}

function openForm(w) {
  const isEdit = !!w;
  let genres;
  openModal({
    title: isEdit ? `Sửa: ${w.title}` : 'Thêm vào watchlist',
    submitText: isEdit ? 'Lưu' : 'Thêm',
    body: `
      <label class="block"><span class="label">Tiêu đề *</span><input name="title" class="input" required maxlength="300" value="${esc(w?.title)}"></label>
      <div class="grid grid-cols-2 gap-4">
        <label><span class="label">Năm</span><input name="year" type="number" min="1880" max="2030" class="input" value="${esc(w?.year ?? '')}"></label>
        <label class="flex items-center gap-3 mt-6"><span class="switch"><input type="checkbox" name="watched" ${w?.watched ? 'checked' : ''}><span></span></span> Đã xem</label>
      </div>
      <div><span class="label">Thể loại</span><div id="wGenres"></div></div>`,
    onOpen() { genres = tagInput($('#wGenres'), w?.genres || [], 'Sci-Fi, Drama…'); },
    async onSubmit(f) {
      const body = {
        title: f.title.value.trim(),
        year: f.year.value === '' ? null : Number(f.year.value),
        watched: f.watched.checked,
        genres: genres.get(),
      };
      if (!body.title) throw new Error('Tiêu đề là bắt buộc');
      if (body.year !== null && (!Number.isInteger(body.year) || body.year < 1880 || body.year > 2030)) throw new Error('Năm phải từ 1880 đến 2030');
      if (!isEdit && body.year === null) delete body.year;
      const res = isEdit
        ? await api(`/api/watchlist/${w._id}`, { method: 'PUT', body })
        : await api('/api/watchlist', { method: 'POST', body });
      toast(isEdit ? 'Đã cập nhật' : `Đã thêm "${res.data.title}"`, 'success', res.query);
      load();
      return true;
    },
  });
}

$$('[data-tab]').forEach((b) => {
  b.onclick = () => {
    tab = b.dataset.tab;
    $$('[data-tab]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    render();
  };
});
$('#addBtn').onclick = () => openForm(null);
$('#summary').innerHTML = skeletonRows(4, 'h-[86px] rounded-2xl');
$('#list').innerHTML = skeletonRows(3, 'h-20');
load();
