const state = { q: '', state: '', page: 1 };
let mode = 'list'; // 'list' | 'near'
let current = [];
const markerById = new Map();

const map = L.map('map').setView([39.5, -98.35], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);
const markers = L.layerGroup().addTo(map);
let circle = null;

const addr = (t) => t.location?.address || {};
const latlng = (t) => { const c = t.location?.geo?.coordinates || []; return [c[1], c[0]]; };
const fmtKm = (m) => (m < 1000 ? `${Math.round(m)} m` : `${fmt(m / 1000, 1)} km`);

function plot(list, fit = true) {
  markers.clearLayers();
  markerById.clear();
  const color = cssVar('--accent');
  const pts = [];
  for (const t of list) {
    const ll = latlng(t);
    if (ll[0] == null) continue;
    pts.push(ll);
    const a = addr(t);
    const m = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95 })
      .bindPopup(`<b>Theater #${esc(t.theaterId)}</b><br>${esc(a.street1)}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zipcode)}${t.distance != null ? `<br><b>${fmtKm(t.distance)}</b>` : ''}`)
      .addTo(markers);
    markerById.set(t._id, m);
  }
  if (fit && pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
}

function item(t) {
  const a = addr(t);
  return `
  <div class="card p-3 flex items-start justify-between gap-3" data-id="${t._id}">
    <button type="button" class="text-left flex-1 min-w-0" data-focus title="Xem trên bản đồ">
      <div class="font-medium">#${esc(t.theaterId)} · ${esc(a.city)}, ${esc(a.state)}</div>
      <div class="text-sm muted truncate">${esc(a.street1)} · ${esc(a.zipcode)}</div>
      ${t.distance != null ? `<div class="text-xs accent font-semibold mt-0.5">cách ${fmtKm(t.distance)}</div>` : ''}
    </button>
    <div class="flex gap-1 shrink-0">
      <button class="btn btn-sm" data-edit>Sửa</button>
      <button class="btn btn-sm btn-danger" data-del>Xóa</button>
    </div>
  </div>`;
}

function renderList(list) {
  current = list;
  $('#list').innerHTML = list.length ? list.map(item).join('') : emptyBox(mode === 'near' ? 'Không có rạp nào trong bán kính này. Thử tăng bán kính hoặc chọn điểm ở Mỹ.' : 'Không tìm thấy rạp nào.');
  for (const t of list) {
    const el = $(`[data-id="${t._id}"]`);
    $('[data-focus]', el).onclick = () => {
      map.flyTo(latlng(t), 14, { duration: 0.6 });
      markerById.get(t._id)?.openPopup();
    };
    $('[data-edit]', el).onclick = () => openForm(t);
    $('[data-del]', el).onclick = async () => {
      const a = addr(t);
      if (!(await confirmDialog(`Xóa rạp <b>#${esc(t.theaterId)}</b> tại ${esc(a.street1)}, ${esc(a.city)}?`))) return;
      try {
        const res = await api(`/api/theaters/${t._id}`, { method: 'DELETE' });
        toast(`Đã xóa rạp #${t.theaterId}`, 'success', res.query);
        refresh();
      } catch (e) { toast(e.message, 'error'); }
    };
  }
}

let reqId = 0;
async function loadList() {
  mode = 'list';
  const id = ++reqId;
  $('#nearHeader').hidden = true;
  $('#listFilters').hidden = false;
  if (circle) { circle.remove(); circle = null; }
  $('#list').innerHTML = skeletonRows(8, 'h-16');
  const p = new URLSearchParams({ page: state.page, limit: 20 });
  if (state.q) p.set('q', state.q);
  if (state.state) p.set('state', state.state);
  try {
    const res = await api('/api/theaters?' + p);
    if (id !== reqId) return;
    setQuery('list', res.query);
    renderList(res.data);
    plot(res.data);
    renderPagination($('#pager'), res, (pg) => { state.page = pg; loadList(); });
  } catch (e) { if (id === reqId) $('#list').innerHTML = errorBox(e.message); }
}

let lastNear = null;
async function loadNear(lat, lng, km) {
  mode = 'near';
  lastNear = { lat, lng, km };
  const id = ++reqId;
  $('#list').innerHTML = skeletonRows(6, 'h-16');
  $('#pager').innerHTML = '';
  try {
    const res = await api(`/api/theaters/near?lat=${lat}&lng=${lng}&km=${km}`);
    if (id !== reqId) return;
    setQuery('near', res.query);
    $('#listFilters').hidden = true;
    $('#nearHeader').hidden = false;
    $('#nearHeader').innerHTML = `
      <span class="text-sm"><b>${res.data.length}</b> rạp gần nhất trong bán kính <b>${fmt(res.km, 1)} km</b> quanh (${fmt(lat, 4)}, ${fmt(lng, 4)})</span>
      <button class="btn btn-sm" id="backList">← Danh sách</button>`;
    $('#backList').onclick = loadList;
    renderList(res.data);
    plot(res.data, false);
    if (circle) circle.remove();
    circle = L.circle([lat, lng], { radius: res.km * 1000, color: cssVar('--accent'), weight: 1.5, fillOpacity: 0.06 }).addTo(map);
    map.fitBounds(circle.getBounds(), { padding: [20, 20] });
  } catch (e) { if (id === reqId) { $('#list').innerHTML = errorBox(e.message); toast(e.message, 'error'); } }
}

function refresh() {
  if (mode === 'near' && lastNear) loadNear(lastNear.lat, lastNear.lng, lastNear.km);
  else loadList();
}

function readNear() {
  const f = $('#nearForm');
  const lat = Number(f.lat.value); const lng = Number(f.lng.value); const km = Number(f.km.value) || 10;
  if (f.lat.value === '' || f.lng.value === '' || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Tọa độ không hợp lệ (lat -90..90, lng -180..180)');
  return { lat, lng, km };
}

$('#nearForm').addEventListener('submit', (e) => {
  e.preventDefault();
  try { const { lat, lng, km } = readNear(); loadNear(lat, lng, km); } catch (err) { toast(err.message, 'error'); }
});
map.on('click', (e) => {
  const f = $('#nearForm');
  f.lat.value = e.latlng.lat.toFixed(5);
  f.lng.value = e.latlng.lng.toFixed(5);
  loadNear(e.latlng.lat, e.latlng.lng, Number(f.km.value) || 10);
});
$('#geoBtn').onclick = () => {
  if (!navigator.geolocation) { toast('Trình duyệt không hỗ trợ định vị', 'error'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const f = $('#nearForm');
      f.lat.value = pos.coords.latitude.toFixed(5);
      f.lng.value = pos.coords.longitude.toFixed(5);
      loadNear(pos.coords.latitude, pos.coords.longitude, Number(f.km.value) || 10);
    },
    (err) => toast('Không lấy được vị trí: ' + err.message, 'error'),
    { timeout: 10000 },
  );
};

function openForm(t) {
  const isEdit = !!t;
  const a = t ? addr(t) : {};
  const [lat, lng] = t ? latlng(t) : [map.getCenter().lat.toFixed(5), map.getCenter().lng.toFixed(5)];
  openModal({
    title: isEdit ? `Sửa rạp #${t.theaterId}` : 'Thêm rạp mới',
    submitText: isEdit ? 'Lưu thay đổi' : 'Thêm rạp',
    body: `
      <div class="grid grid-cols-2 gap-4">
        <label class="col-span-2"><span class="label">Địa chỉ (street1) *</span><input name="street1" class="input" required maxlength="200" value="${esc(a.street1)}"></label>
        <label><span class="label">Thành phố *</span><input name="city" class="input" required maxlength="100" value="${esc(a.city)}"></label>
        <label><span class="label">Bang (2 chữ) *</span><input name="state" class="input uppercase" required maxlength="2" value="${esc(a.state)}" placeholder="CA"></label>
        <label><span class="label">Zipcode *</span><input name="zipcode" class="input" required maxlength="10" value="${esc(a.zipcode)}"></label>
        <label><span class="label">Theater ID</span><input name="theaterId" type="number" min="1" class="input" value="${esc(t?.theaterId ?? '')}" placeholder="tự động"></label>
        <label><span class="label">Vĩ độ (lat) *</span><input name="lat" type="number" step="any" class="input" required value="${esc(lat)}"></label>
        <label><span class="label">Kinh độ (lng) *</span><input name="lng" type="number" step="any" class="input" required value="${esc(lng)}"></label>
      </div>
      <p class="text-xs muted">Lưu thành <code>location.geo: { type: "Point", coordinates: [lng, lat] }</code>. GeoJSON ghi kinh độ trước.</p>`,
    async onSubmit(f) {
      const body = {
        street1: f.street1.value.trim(), city: f.city.value.trim(), state: f.state.value.trim().toUpperCase(),
        zipcode: f.zipcode.value.trim(), lat: f.lat.value, lng: f.lng.value,
      };
      if (f.theaterId.value.trim()) body.theaterId = f.theaterId.value.trim();
      if (!body.street1 || !body.city || !body.zipcode) throw new Error('Vui lòng nhập đủ địa chỉ, thành phố và zipcode');
      if (!/^[A-Z]{2}$/.test(body.state)) throw new Error('Bang phải gồm đúng 2 chữ cái');
      if (body.lat === '' || body.lng === '' || Math.abs(+body.lat) > 90 || Math.abs(+body.lng) > 180) throw new Error('Tọa độ không hợp lệ');
      const res = isEdit
        ? await api(`/api/theaters/${t._id}`, { method: 'PUT', body })
        : await api('/api/theaters', { method: 'POST', body });
      toast(isEdit ? `Đã cập nhật rạp #${res.data.theaterId}` : `Đã thêm rạp #${res.data.theaterId}`, 'success', res.query);
      if (!isEdit) {
        state.q = String(res.data.theaterId); $('#q').value = state.q; state.page = 1;
        loadList();
      } else refresh();
      return true;
    },
  });
}

$('#addBtn').onclick = () => openForm(null);
$('#q').addEventListener('input', debounce(() => { state.q = $('#q').value.trim(); state.page = 1; loadList(); }, 400));
$('#state').addEventListener('change', () => { state.state = $('#state').value; state.page = 1; loadList(); });
window.addEventListener('themechange', () => plot(current, false));

api('/api/theaters/states').then(({ data }) => {
  $('#state').insertAdjacentHTML('beforeend', data.map((s) => `<option>${esc(s)}</option>`).join(''));
}).catch(() => {});
loadList();
