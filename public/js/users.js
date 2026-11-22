const state = { q: '', page: 1 };
let reqId = 0;

async function load() {
  const id = ++reqId;
  $('#rows').innerHTML = `<tr><td colspan="4">${skeletonRows(6, 'h-8')}</td></tr>`;
  const p = new URLSearchParams({ page: state.page, limit: 15 });
  if (state.q) p.set('q', state.q);
  try {
    const res = await api('/api/users?' + p);
    if (id !== reqId) return;
    setQuery('list', res.query);
    $('#rows').innerHTML = res.data.length ? res.data.map((u) => `
      <tr data-id="${u._id}">
        <td class="font-medium">${esc(u.name)}</td>
        <td class="muted">${esc(u.email)}</td>
        <td class="hidden md:table-cell text-xs muted font-mono">${esc(u._id)}</td>
        <td class="num whitespace-nowrap admin-only">
          <button class="btn btn-sm admin-only" data-edit>Sửa</button>
          <button class="btn btn-sm btn-danger admin-only" data-del>Xóa</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="4" class="text-center muted py-8">Không tìm thấy user nào.</td></tr>';
    for (const u of res.data) {
      const tr = $(`[data-id="${u._id}"]`);
      $('[data-edit]', tr).onclick = () => openForm(u);
      $('[data-del]', tr).onclick = async () => {
        if (!(await confirmDialog(`Xóa user <b>${esc(u.name)}</b> (${esc(u.email)})?`))) return;
        try {
          const r = await api(`/api/users/${u._id}`, { method: 'DELETE' });
          toast(`Đã xóa ${u.name}`, 'success', r.query);
          load();
        } catch (e) { toast(e.message, 'error'); }
      };
    }
    renderPagination($('#pager'), res, (pg) => { state.page = pg; load(); });
  } catch (e) {
    if (id === reqId) $('#rows').innerHTML = `<tr><td colspan="4">${errorBox(e.message)}</td></tr>`;
  }
}

function openForm(u) {
  const isEdit = !!u;
  openModal({
    title: isEdit ? `Sửa user: ${u.name}` : 'Thêm user mới',
    submitText: isEdit ? 'Lưu thay đổi' : 'Thêm user',
    body: `
      <label class="block"><span class="label">Tên *</span><input name="name" class="input" required maxlength="100" value="${esc(u?.name)}"></label>
      <label class="block"><span class="label">Email *</span><input name="email" type="email" class="input" required maxlength="200" value="${esc(u?.email)}"></label>
      <label class="block"><span class="label">Mật khẩu ${isEdit ? '(để trống nếu không đổi)' : '*'}</span>
        <input name="password" type="password" class="input" minlength="6" maxlength="72" autocomplete="new-password" ${isEdit ? '' : 'required'}></label>
      <p class="text-xs muted">Email phải là duy nhất: server kiểm tra trước khi ghi và trả lỗi 409 nếu bị trùng. Mật khẩu được hash bằng bcrypt.</p>`,
    async onSubmit(f) {
      const body = { name: f.name.value.trim(), email: f.email.value.trim(), password: f.password.value };
      if (!body.name) throw new Error('Tên là bắt buộc');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new Error('Email không hợp lệ');
      if ((!isEdit || body.password) && body.password.length < 6) throw new Error('Mật khẩu phải có ít nhất 6 ký tự');
      if (isEdit && !body.password) delete body.password;
      const res = isEdit
        ? await api(`/api/users/${u._id}`, { method: 'PUT', body })
        : await api('/api/users', { method: 'POST', body });
      toast(isEdit ? `Đã cập nhật ${res.data.name}` : `Đã thêm ${res.data.name}`, 'success', res.query);
      if (!isEdit) { state.q = res.data.email; $('#q').value = state.q; state.page = 1; }
      load();
      return true;
    },
  });
}

$('#addBtn').onclick = () => openForm(null);
$('#q').addEventListener('input', debounce(() => { state.q = $('#q').value.trim(); state.page = 1; load(); }, 350));
load();
