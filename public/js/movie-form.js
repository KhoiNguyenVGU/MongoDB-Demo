/* Form thêm/sửa phim (dùng ở trang list và trang detail) */

function movieValues(m = {}) {
  return {
    title: m.title || '',
    year: typeof m.year === 'number' ? m.year : null,
    type: m.type || 'movie',
    runtime: typeof m.runtime === 'number' ? m.runtime : null,
    rated: m.rated || '',
    imdbRating: ratingOf(m),
    poster: m.poster || '',
    plot: m.plot || '',
    fullplot: m.fullplot || '',
    genres: m.genres || [],
    directors: m.directors || [],
    writers: m.writers || [],
    cast: m.cast || [],
    languages: m.languages || [],
    countries: m.countries || [],
  };
}

const TAG_FIELDS = [
  ['genres', 'Thể loại', 'Drama, Comedy…', true],
  ['directors', 'Đạo diễn', 'Tên đạo diễn'],
  ['writers', 'Biên kịch', 'Tên biên kịch'],
  ['cast', 'Diễn viên', 'Tên diễn viên', true],
  ['languages', 'Ngôn ngữ', 'English…'],
  ['countries', 'Quốc gia', 'USA…'],
];

function openMovieForm(movie, onSaved) {
  const isEdit = !!movie;
  const orig = movieValues(movie || {});
  const tags = {};
  const body = `
    <div class="grid sm:grid-cols-2 gap-4">
      <label class="sm:col-span-2"><span class="label">Tiêu đề *</span>
        <input name="title" class="input" required maxlength="300" value="${esc(orig.title)}" autofocus></label>
      <label><span class="label">Năm phát hành</span>
        <input name="year" type="number" min="1880" max="2030" step="1" class="input" value="${orig.year ?? ''}" placeholder="vd. 2010"></label>
      <label><span class="label">Loại</span>
        <select name="type" class="input"><option value="movie">movie</option><option value="series">series</option></select></label>
      <label><span class="label">Thời lượng (phút)</span>
        <input name="runtime" type="number" min="1" max="1000" step="1" class="input" value="${orig.runtime ?? ''}"></label>
      <label><span class="label">IMDb rating (0–10)</span>
        <input name="imdbRating" type="number" min="0" max="10" step="0.1" class="input" value="${orig.imdbRating ?? ''}"></label>
      <label><span class="label">Phân loại (rated)</span>
        <input name="rated" class="input" maxlength="20" value="${esc(orig.rated)}" placeholder="PG-13, R…"></label>
      <label><span class="label">Poster URL</span>
        <input name="poster" type="url" class="input" value="${esc(orig.poster)}" placeholder="https://…"></label>
      ${TAG_FIELDS.map(([k, label, ph, wide]) => `
        <div class="${wide ? 'sm:col-span-2' : ''}"><span class="label">${label}</span><div data-tags="${k}" data-ph="${esc(ph)}"></div></div>`).join('')}
      <label class="sm:col-span-2"><span class="label">Tóm tắt (plot)</span>
        <textarea name="plot" class="input" rows="2" maxlength="5000">${esc(orig.plot)}</textarea></label>
      <label class="sm:col-span-2"><span class="label">Nội dung đầy đủ (fullplot)</span>
        <textarea name="fullplot" class="input" rows="4" maxlength="5000">${esc(orig.fullplot)}</textarea></label>
    </div>
    <p class="text-xs muted">Danh sách (thể loại, diễn viên…) lưu dưới dạng mảng trong document. Nhập từng mục rồi nhấn Enter hoặc dấu phẩy.</p>`;

  openModal({
    title: isEdit ? `Sửa phim: ${orig.title}` : 'Thêm phim mới',
    submitText: isEdit ? 'Lưu thay đổi' : 'Thêm phim',
    wide: true,
    body,
    onOpen(form) {
      form.type.value = orig.type;
      $$('[data-tags]', form).forEach((el) => { tags[el.dataset.tags] = tagInput(el, orig[el.dataset.tags], el.dataset.ph); });
    },
    async onSubmit(form) {
      const numOrNull = (v) => (String(v).trim() === '' ? null : Number(v));
      const cur = {
        title: form.title.value.trim(),
        year: numOrNull(form.year.value),
        type: form.type.value,
        runtime: numOrNull(form.runtime.value),
        imdbRating: numOrNull(form.imdbRating.value),
        rated: form.rated.value.trim(),
        poster: form.poster.value.trim(),
        plot: form.plot.value.trim(),
        fullplot: form.fullplot.value.trim(),
      };
      for (const [k] of TAG_FIELDS) cur[k] = tags[k].get();

      // Validate phía client (server cũng validate lại)
      if (!cur.title) throw new Error('Tiêu đề là bắt buộc');
      if (cur.year !== null && (!Number.isInteger(cur.year) || cur.year < 1880 || cur.year > 2030)) throw new Error('Năm phải là số nguyên từ 1880 đến 2030');
      if (cur.runtime !== null && (!Number.isInteger(cur.runtime) || cur.runtime < 1 || cur.runtime > 1000)) throw new Error('Thời lượng phải là số nguyên từ 1 đến 1000 phút');
      if (cur.imdbRating !== null && (Number.isNaN(cur.imdbRating) || cur.imdbRating < 0 || cur.imdbRating > 10)) throw new Error('IMDb rating phải từ 0 đến 10');
      if (cur.poster && !/^https?:\/\//i.test(cur.poster)) throw new Error('Poster phải là URL bắt đầu bằng http:// hoặc https://');

      let payload;
      if (isEdit) {
        // Chỉ gửi các field đã thay đổi -> server $set đúng những field đó
        payload = Object.fromEntries(Object.entries(cur).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(orig[k])));
        if (!Object.keys(payload).length) { toast('Không có thay đổi nào', 'info'); return true; }
      } else {
        payload = Object.fromEntries(Object.entries(cur).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
      }
      const res = isEdit
        ? await api(`/api/movies/${movie._id}`, { method: 'PUT', body: payload })
        : await api('/api/movies', { method: 'POST', body: payload });
      toast(isEdit ? `Đã cập nhật ${Object.keys(payload).length} field` : `Đã thêm phim "${res.data.title}"`, 'success', res.query);
      onSaved?.(res.data, res.query);
      return true;
    },
  });
}
