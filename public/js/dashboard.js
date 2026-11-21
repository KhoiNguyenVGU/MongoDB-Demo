const charts = {};
const renders = {}; // key -> hàm vẽ lại (dùng khi đổi theme)

function makeChart(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}

function theme() {
  return { accent: cssVar('--accent'), second: cssVar('--chart-2'), grid: cssVar('--grid'), text: cssVar('--muted'), panel: cssVar('--panel') };
}
function baseOptions(t, extra = {}) {
  Chart.defaults.color = t.text;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350 },
    plugins: { legend: { display: false }, tooltip: { padding: 10, cornerRadius: 8 } },
    ...extra,
  };
}
function axes(t, { horizontal = false, max } = {}) {
  const value = { beginAtZero: true, max, grid: { color: t.grid }, border: { display: false }, ticks: { color: t.text } };
  const cat = { grid: { display: false }, border: { color: t.grid }, ticks: { color: t.text, autoSkip: false } };
  return horizontal ? { x: value, y: cat } : { x: cat, y: value };
}

function filterQS() {
  const p = new URLSearchParams();
  const g = $('#fGenre').value; const yf = $('#fFrom').value; const yt = $('#fTo').value;
  if (g) p.set('genres', g);
  if (yf) p.set('yearFrom', yf);
  if (yt) p.set('yearTo', yt);
  return p.toString();
}

async function load(key, url, render) {
  const status = $(`[data-status="${key}"]`);
  if (status) { status.hidden = false; status.textContent = 'Đang tải…'; }
  try {
    const res = await api(url);
    setQuery(key, res.query);
    renders[key] = () => render(res);
    const empty = Array.isArray(res.data) && res.data.length === 0;
    if (status) { status.hidden = !empty; status.textContent = 'Không có dữ liệu khớp bộ lọc'; }
    render(res);
  } catch (e) {
    if (status) { status.hidden = false; status.textContent = 'Lỗi: ' + e.message; }
    if (key === 'overview') $('#kpis').innerHTML = `<div class="col-span-full">${errorBox(e.message)}</div>`;
  }
}

function kpi(label, value, sub = '') {
  return `<div class="card p-4"><div class="text-sm muted">${label}</div><div class="text-2xl font-bold mt-1 tabular">${value}</div>${sub ? `<div class="text-xs muted mt-1">${sub}</div>` : ''}</div>`;
}

function loadAll() {
  const qs = filterQS();
  const sep = qs ? '?' + qs : '';
  $('#kpis').innerHTML = skeletonRows(5, 'h-[94px] rounded-2xl');

  load('overview', '/api/stats/overview' + sep, ({ data: d }) => {
    $('#kpis').innerHTML =
      kpi('Movies', fmt(d.movies), d.filtered ? 'khớp bộ lọc' : 'tổng số document') +
      kpi('Comments', fmt(d.comments), 'tổng số') +
      kpi('Users', fmt(d.users), 'tổng số') +
      kpi('Theaters', fmt(d.theaters), 'GeoJSON + 2dsphere') +
      kpi('IMDb trung bình', d.avgRating == null ? '—' : `<span class="rating text-2xl">★ ${fmt(d.avgRating, 2)}</span>`, d.filtered ? 'khớp bộ lọc' : '$avg imdb.rating');
  });

  load('genres', '/api/stats/genres' + sep, ({ data }) => {
    const t = theme();
    makeChart('chGenres', {
      type: 'bar',
      data: { labels: data.map((x) => x._id), datasets: [{ label: 'Số phim', data: data.map((x) => x.count), backgroundColor: t.accent, borderRadius: 4, maxBarThickness: 40 }] },
      options: { ...baseOptions(t), scales: axes(t) },
    });
  });

  load('types', '/api/stats/types' + sep, ({ data }) => {
    const t = theme();
    makeChart('chTypes', {
      type: 'doughnut',
      data: { labels: data.map((x) => x._id), datasets: [{ data: data.map((x) => x.count), backgroundColor: [t.accent, t.second], borderColor: t.panel, borderWidth: 2 }] },
      options: {
        ...baseOptions(t),
        cutout: '62%',
        plugins: {
          legend: { display: true, position: 'bottom', labels: { color: t.text, usePointStyle: true, boxWidth: 8 } },
          tooltip: {
            callbacks: {
              label: (c) => {
                const total = c.dataset.data.reduce((a, b) => a + b, 0);
                return ` ${c.label}: ${fmt(c.raw)} (${fmt((c.raw / total) * 100, 1)}%)`;
              },
            },
          },
        },
      },
    });
  });

  load('decades', '/api/stats/decades' + sep, ({ data }) => {
    const t = theme();
    makeChart('chDecades', {
      type: 'line',
      data: {
        labels: data.map((x) => `${x._id}s`),
        datasets: [{
          label: 'Số phim', data: data.map((x) => x.count), borderColor: t.accent, borderWidth: 2,
          backgroundColor: t.accent + '22', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: t.accent,
        }],
      },
      options: { ...baseOptions(t), scales: axes(t), interaction: { mode: 'index', intersect: false } },
    });
  });

  load('rating', '/api/stats/rating-by-genre' + sep, ({ data, minCount }) => {
    const t = theme();
    $('#ratingSub').textContent = `$avg imdb.rating · thể loại có ≥ ${minCount} phim`;
    makeChart('chRating', {
      type: 'bar',
      data: { labels: data.map((x) => x._id), datasets: [{ label: 'IMDb TB', data: data.map((x) => x.avgRating), backgroundColor: t.accent, borderRadius: 4, maxBarThickness: 18 }] },
      options: {
        ...baseOptions(t),
        indexAxis: 'y',
        scales: axes(t, { horizontal: true, max: 10 }),
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ★ ${c.raw} · ${fmt(data[c.dataIndex].count)} phim` } } },
      },
    });
  });

  load('top', '/api/stats/top-commented' + sep, ({ data }) => {
    $('#topBody').innerHTML = data.map((m, i) => `
      <tr class="cursor-pointer" onclick="location.href='/movies/${esc(m.movieId)}'">
        <td class="muted tabular">${i + 1}</td>
        <td><a class="font-medium hover:underline" href="/movies/${esc(m.movieId)}">${esc(m.title)}</a><div class="text-xs muted">${esc((m.genres || []).join(', '))}</div></td>
        <td class="num">${esc(m.year)}</td>
        <td class="num"><span class="rating">${typeof m.rating === 'number' ? '★ ' + m.rating : '—'}</span></td>
        <td class="num font-semibold">${fmt(m.comments)}</td>
      </tr>`).join('');
  });

  load('states', '/api/stats/theaters-by-state', ({ data }) => {
    const t = theme();
    makeChart('chStates', {
      type: 'bar',
      data: { labels: data.map((x) => x._id), datasets: [{ label: 'Số rạp', data: data.map((x) => x.count), backgroundColor: t.accent, borderRadius: 4, maxBarThickness: 18 }] },
      options: { ...baseOptions(t), indexAxis: 'y', scales: axes(t, { horizontal: true }) },
    });
  });
}

window.addEventListener('themechange', () => Object.values(renders).forEach((r) => r()));

$('#filters').addEventListener('submit', (e) => {
  e.preventDefault();
  const yf = Number($('#fFrom').value); const yt = Number($('#fTo').value);
  if (yf && yt && yf > yt) { toast('"Từ năm" phải nhỏ hơn hoặc bằng "Đến năm"', 'error'); return; }
  loadAll();
});
$('#fReset').onclick = () => { $('#fGenre').value = ''; $('#fFrom').value = ''; $('#fTo').value = ''; loadAll(); };

api('/api/movies/genres').then(({ data }) => {
  $('#fGenre').insertAdjacentHTML('beforeend', data.map((g) => `<option>${esc(g)}</option>`).join(''));
}).catch(() => {});

loadAll();
