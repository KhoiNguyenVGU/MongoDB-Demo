let samples = [];

function planBadge(s) {
  const scan = /COLLSCAN/.test(s.plan);
  return `<span class="chip ${scan ? '' : 'chip-soft'}" style="${scan ? 'color:var(--danger);border-color:var(--danger)' : ''}">${esc(s.plan)}</span>`;
}

function statsTable(a, b) {
  const rows = [
    ['Plan', planBadge(a), planBadge(b)],
    ['Index dùng', esc(a.index || '—'), esc(b.index || '—')],
    ['nReturned', fmt(a.nReturned), fmt(b.nReturned)],
    ['totalKeysExamined', fmt(a.totalKeysExamined), fmt(b.totalKeysExamined)],
    ['totalDocsExamined', `<b>${fmt(a.totalDocsExamined)}</b>`, `<b>${fmt(b.totalDocsExamined)}</b>`],
    ['executionTimeMillis', `${fmt(a.executionTimeMillis)} ms`, `${fmt(b.executionTimeMillis)} ms`],
  ];
  const ratio = a.totalDocsExamined > 0 ? b.totalDocsExamined / a.totalDocsExamined : null;
  return `
    <div class="overflow-x-auto"><table class="table">
      <thead><tr><th></th><th>Planner tự chọn</th><th>Ép COLLSCAN ($natural)</th></tr></thead>
      <tbody>${rows.map(([k, x, y]) => `<tr><td class="muted font-mono text-xs">${k}</td><td class="tabular">${x}</td><td class="tabular">${y}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="text-sm mt-2">${
      a.index
        ? `Có index: đọc <b>${fmt(a.totalDocsExamined)}</b> docs thay vì <b>${fmt(b.totalDocsExamined)}</b>${ratio ? ` (ít hơn <b>${fmt(ratio, ratio < 10 ? 1 : 0)}×</b>)` : ''}.`
        : 'Không có index phù hợp nên planner cũng phải quét toàn bộ collection. Đây là lúc nên tạo index.'
    }</p>`;
}

function renderSamples() {
  $('#samples').innerHTML = samples.map((s) => `
    <article class="card p-4" data-key="${s.key}">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="font-semibold">${esc(s.title)}</h3>
          <p class="text-sm muted">${esc(s.note)}</p>
        </div>
        <button class="btn btn-sm btn-primary" data-run>Chạy explain</button>
      </div>
      <pre class="code mt-3 text-xs">${esc(toShell({ op: 'find', collection: s.collection, filter: s.filter, sort: s.sort }))}</pre>
      <div data-out class="mt-3"></div>
    </article>`).join('');
  $$('#samples [data-run]').forEach((b) => { b.onclick = () => run(b.closest('[data-key]').dataset.key); });
}

async function run(key) {
  const el = $(`[data-key="${key}"]`);
  const out = $('[data-out]', el);
  const btn = $('[data-run]', el);
  btn.disabled = true;
  out.innerHTML = skeletonRows(1, 'h-40');
  try {
    const res = await api(`/api/explain/run/${key}`);
    out.innerHTML = statsTable(res.data.indexed, res.data.collscan);
  } catch (e) { out.innerHTML = errorBox(e.message); } finally { btn.disabled = false; }
}

$('#runAll').onclick = async () => {
  $('#runAll').disabled = true;
  for (const s of samples) await run(s.key);
  $('#runAll').disabled = false;
};

$('#custom').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const btn = $('[type=submit]', f);
  btn.disabled = true;
  $('#customOut').innerHTML = skeletonRows(1, 'h-40');
  try {
    const res = await api('/api/explain/custom', {
      method: 'POST',
      body: { collection: f.collection.value, filter: f.filter.value, sort: f.sort.value, limit: f.limit.value },
    });
    QUERIES.custom = res.query;
    const x = res.explain;
    $('#customOut').innerHTML = `
      <div class="card p-4 space-y-3">
        <div class="flex flex-wrap gap-2 items-center text-sm">
          ${planBadge(x)}
          <span class="chip">index: ${esc(x.index || 'không')}</span>
          <span class="chip">trả về ${fmt(res.data.length)} docs</span>
          <span class="chip">keys examined ${fmt(x.totalKeysExamined)}</span>
          <span class="chip">docs examined ${fmt(x.totalDocsExamined)}</span>
          <span class="chip">${fmt(res.query.ms)} ms</span>
          <button class="btn btn-sm btn-query ml-auto" data-query="custom">{ } query</button>
        </div>
        <pre class="code text-xs" style="max-height:480px">${esc(JSON.stringify(res.data, null, 2))}</pre>
      </div>`;
  } catch (err) {
    $('#customOut').innerHTML = errorBox(err.message);
  } finally { btn.disabled = false; }
});

$$('[data-ex]').forEach((b) => {
  b.onclick = () => {
    const ex = JSON.parse(b.dataset.ex);
    const f = $('#custom');
    f.collection.value = ex.c; f.filter.value = ex.f; f.sort.value = ex.s;
    f.requestSubmit();
  };
});

$('#samples').innerHTML = skeletonRows(3, 'h-32');
api('/api/explain/samples').then(({ data }) => { samples = data; renderSamples(); }).catch((e) => { $('#samples').innerHTML = errorBox(e.message); });
