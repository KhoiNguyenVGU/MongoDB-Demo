/* Tab "Mongo Shell": terminal giống mongosh chạy trên trình duyệt */
(function () {
  const out = $('#shellOut');
  const input = $('#shellInput');
  const form = $('#shellForm');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const state = {
    db: store.get('shellDb', 'sample_mflix'),
    history: store.get('shellHistory', []),
    hIndex: null, // vị trí đang xem trong lịch sử
    draft: '',
    lastCursor: null, // { code, db, shown } cho lệnh "it"
    busy: false,
  };

  /* ---------- Định dạng output kiểu mongosh ---------- */
  const ID_RE = /^[A-Za-z_$][\w$]*$/;
  const P = (plain, cls) => ({ plain, html: cls ? `<span class="${cls}">${esc(plain)}</span>` : esc(plain) });
  const strLit = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\t/g, '\\t')}'`;
  const uuidFromB64 = (b64) => {
    const hex = [...atob(b64)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  // Extended JSON -> kiểu BSON hiển thị như mongosh
  function special(v) {
    const keys = Object.keys(v);
    if (keys.length === 1) {
      const k = keys[0]; const x = v[k];
      if (k === '$oid') return P(`ObjectId('${x}')`, 'sh-type');
      if (k === '$date') {
        const iso = typeof x === 'string' ? x : x && x.$numberLong ? new Date(Number(x.$numberLong)).toISOString() : String(x);
        return P(`ISODate('${iso.replace(/Z$/, '.000Z').replace(/\.(\d{3})\.000Z$/, '.$1Z')}')`, 'sh-type');
      }
      if (k === '$numberDecimal') return P(`Decimal128('${x}')`, 'sh-num');
      if (k === '$numberLong') return P(`Long('${x}')`, 'sh-num');
      if (k === '$numberDouble' || k === '$numberInt') return P(String(x), 'sh-num');
      if (k === '$regularExpression') return P(`/${x.pattern}/${x.options || ''}`, 'sh-re');
      if (k === '$timestamp') return P(`Timestamp({ t: ${x.t}, i: ${x.i} })`, 'sh-type');
      if (k === '$minKey') return P('MinKey()', 'sh-type');
      if (k === '$maxKey') return P('MaxKey()', 'sh-type');
      if (k === '$binary') {
        if (x.subType === '04' || x.subType === '4') return P(`UUID('${uuidFromB64(x.base64)}')`, 'sh-type');
        return P(`Binary.createFromBase64('${x.base64}', ${parseInt(x.subType, 16) || 0})`, 'sh-type');
      }
    }
    return null;
  }

  function render(v, ind = 0) {
    if (v === null) return P('null', 'sh-null');
    if (v === undefined) return P('undefined', 'sh-null');
    if (typeof v === 'string') return P(strLit(v), 'sh-str');
    if (typeof v === 'number') return P(Object.is(v, -0) ? '-0' : String(v), 'sh-num');
    if (typeof v === 'boolean') return P(String(v), 'sh-bool');
    const pad = ' '.repeat(ind + 2);
    if (Array.isArray(v)) {
      if (!v.length) return P('[]');
      const items = v.map((x) => render(x, ind + 2));
      const inline = `[ ${items.map((i) => i.plain).join(', ')} ]`;
      if (ind + inline.length <= 78 && !inline.includes('\n')) return { plain: inline, html: `[ ${items.map((i) => i.html).join(', ')} ]` };
      return {
        plain: `[\n${items.map((i) => pad + i.plain).join(',\n')}\n${' '.repeat(ind)}]`,
        html: `[\n${items.map((i) => pad + i.html).join(',\n')}\n${' '.repeat(ind)}]`,
      };
    }
    if (typeof v === 'object') {
      const sp = special(v);
      if (sp) return sp;
      const entries = Object.entries(v);
      if (!entries.length) return P('{}');
      const parts = entries.map(([k, x]) => {
        const key = ID_RE.test(k) ? k : strLit(k);
        const r = render(x, ind + 2);
        return { plain: `${key}: ${r.plain}`, html: `<span class="sh-key">${esc(key)}</span>: ${r.html}` };
      });
      const inline = `{ ${parts.map((p) => p.plain).join(', ')} }`;
      if (ind + inline.length <= 78 && !inline.includes('\n')) return { plain: inline, html: `{ ${parts.map((p) => p.html).join(', ')} }` };
      return {
        plain: `{\n${parts.map((p) => pad + p.plain).join(',\n')}\n${' '.repeat(ind)}}`,
        html: `{\n${parts.map((p) => pad + p.html).join(',\n')}\n${' '.repeat(ind)}}`,
      };
    }
    return P(String(v));
  }

  /* ---------- Ghi ra terminal ---------- */
  const HELP = [
    ['Shell', [
      ['use <db>', 'chuyển database'], ['show dbs', 'liệt kê database'], ['show collections', 'liệt kê collection'],
      ['db', 'database hiện tại'], ['it', 'xem 20 kết quả tiếp theo'], ['cls', 'xóa màn hình'],
    ]],
    ['Đọc', [
      ['db.c.find(filter, projection)', '.sort() .skip() .limit() .project() .hint() .count() .toArray() .explain()'],
      ['db.c.findOne(filter, projection)', ''], ['db.c.countDocuments(filter)', ''], ['db.c.estimatedDocumentCount()', ''],
      ['db.c.distinct(field, filter)', ''], ['db.c.aggregate([ stages ])', '.toArray() .explain()'],
    ]],
    ['Ghi', [
      ['db.c.insertOne(doc) / insertMany([docs])', ''], ['db.c.updateOne / updateMany(filter, update, options)', ''],
      ['db.c.replaceOne(filter, doc)', ''], ['db.c.deleteOne / deleteMany(filter)', ''],
      ['db.c.findOneAndUpdate / findOneAndReplace / findOneAndDelete', ''], ['db.c.bulkWrite([ ops ])', ''],
    ]],
    ['Index & quản trị', [
      ['db.c.createIndex(keys, options) / getIndexes() / dropIndex(name)', ''], ['db.c.explain("executionStats").find(...)', ''],
      ['db.c.drop() · db.c.renameCollection(name) · db.c.stats()', ''], ['db.createCollection(name) · db.dropDatabase()', ''],
      ['db.getCollectionNames() · db.getSiblingDB(name) · db.stats() · db.runCommand({ ping: 1 })', ''],
    ]],
    ['Kiểu dữ liệu', [['ObjectId("…") · ISODate("…") · new Date() · NumberInt(5) · NumberLong("…") · NumberDecimal("…") · UUID() · /regex/i', '']]],
  ];
  function helpHtml() {
    return HELP.map(([title, rows]) => `<div class="sh-help-title">${esc(title)}</div>${rows.map(([c, d]) => `<div class="sh-help-row"><span class="sh-fn">${esc(c)}</span>${d ? ` <span class="sh-dim">${esc(d)}</span>` : ''}</div>`).join('')}`).join('');
  }

  function scrollBottom() { out.scrollTop = out.scrollHeight; }
  function append(html, cls = '') {
    const div = document.createElement('div');
    div.className = `sh-block ${cls}`;
    div.innerHTML = html;
    out.appendChild(div);
    while (out.children.length > 300) out.firstChild.remove();
    scrollBottom();
    return div;
  }
  function echo(code, db) {
    append(`<span class="sh-prompt">${esc(db)}&gt;</span> <span class="sh-cmd">${esc(code)}</span>`, 'sh-echo');
  }
  const meta = (o) => (o.ms != null ? `<span class="sh-ms">${o.ms} ms</span>` : '');

  function showOutput(o, multi) {
    const src = multi ? `<div class="sh-src">› ${esc(o.source.split('\n')[0])}${o.source.includes('\n') ? ' …' : ''}</div>` : '';
    switch (o.kind) {
      case 'error':
        append(`${src}<span class="sh-err">${esc(o.error)}</span>`);
        break;
      case 'text':
        append(`${src}${esc(o.text)}${meta(o)}`);
        break;
      case 'help':
        append(helpHtml(), 'sh-help');
        break;
      case 'clear':
        out.innerHTML = '';
        break;
      case 'cursor': {
        const docs = o.value.map((d) => render(d).html).join('\n');
        const tail = o.more ? '\n<span class="sh-dim">Type "it" for more</span>' : '';
        append(`${src}${o.value.length ? docs : '<span class="sh-dim">(không có document nào)</span>'}${tail}${meta(o)}`);
        state.lastCursor = o.more ? { code: o.source, db: o.db, shown: o.shown } : null;
        break;
      }
      case 'explain': {
        const s = o.summary;
        const bar = s
          ? `<div class="sh-explain"><b class="${/COLLSCAN/.test(s.plan) ? 'sh-err' : 'sh-ok'}">${esc(s.plan)}</b>${s.index ? ` · index <b>${esc(s.index)}</b>` : ''}${s.totalDocsExamined != null ? ` · docs examined <b>${fmt(s.totalDocsExamined)}</b> · keys examined <b>${fmt(s.totalKeysExamined)}</b> · nReturned <b>${fmt(s.nReturned)}</b> · ${fmt(s.executionTimeMillis)} ms` : ''}</div>`
          : '';
        append(`${src}${bar}<details${s ? '' : ' open'}><summary class="sh-dim">Toàn bộ output explain()</summary>${render(o.value).html}</details>${meta(o)}`);
        break;
      }
      default:
        append(`${src}${render(o.value).html}${meta(o)}`);
    }
  }

  /* ---------- Chạy lệnh ---------- */
  function setDb(db) {
    state.db = db;
    store.set('shellDb', db);
    $('#shellPrompt').textContent = `${db}>`;
    $('#shellDbChip').textContent = db;
  }

  function remember(code) {
    if (state.history[state.history.length - 1] !== code) state.history.push(code);
    if (state.history.length > 100) state.history = state.history.slice(-100);
    store.set('shellHistory', state.history);
    state.hIndex = null;
  }

  async function execute(code) {
    const trimmed = code.trim();
    if (!trimmed || state.busy) return;
    remember(trimmed);
    echo(trimmed, state.db);
    if (trimmed === 'cls' || trimmed === 'clear') { out.innerHTML = ''; return; }

    let body = { code: trimmed, db: state.db };
    if (trimmed === 'it') {
      if (!state.lastCursor) { append('<span class="sh-dim">no cursor</span>'); return; }
      body = { code: state.lastCursor.code, db: state.lastCursor.db, itSkip: state.lastCursor.shown };
    }

    state.busy = true;
    form.classList.add('busy');
    const pending = append('<span class="sh-dim">…</span>');
    try {
      const res = await api('/api/shell', { method: 'POST', body });
      pending.remove();
      const multi = res.outputs.length > 1;
      if (trimmed !== 'it') state.lastCursor = null;
      for (const o of res.outputs) showOutput(o, multi);
      if (trimmed !== 'it') setDb(res.db);
    } catch (e) {
      pending.remove();
      append(`<span class="sh-err">${esc(e.message)}</span>`);
    } finally {
      state.busy = false;
      form.classList.remove('busy');
      input.focus();
    }
  }

  /* ---------- Ô nhập ---------- */
  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 260)}px`;
  }
  // Ngoặc chưa đóng -> Enter xuống dòng thay vì chạy (giống mongosh)
  function balanced(s) {
    let depth = 0; let q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
    }
    return depth <= 0 && !q;
  }
  function setInput(v) { input.value = v; autosize(); input.setSelectionRange(v.length, v.length); }

  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      if (balanced(input.value)) {
        e.preventDefault();
        const code = input.value;
        setInput('');
        execute(code);
      }
      return;
    }
    if ((e.key === 'l' || e.key === 'L') && e.ctrlKey) { e.preventDefault(); out.innerHTML = ''; return; }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end');
      return;
    }
    const v = input.value; const pos = input.selectionStart;
    if (e.key === 'ArrowUp' && input.selectionEnd === pos && !v.slice(0, pos).includes('\n') && state.history.length) {
      e.preventDefault();
      if (state.hIndex === null) { state.draft = v; state.hIndex = state.history.length; }
      state.hIndex = Math.max(0, state.hIndex - 1);
      setInput(state.history[state.hIndex]);
    } else if (e.key === 'ArrowDown' && input.selectionEnd === pos && !v.slice(pos).includes('\n') && state.hIndex !== null) {
      e.preventDefault();
      state.hIndex++;
      if (state.hIndex >= state.history.length) { state.hIndex = null; setInput(state.draft); } else setInput(state.history[state.hIndex]);
    }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); const code = input.value; setInput(''); execute(code); });
  $('#shellClear').onclick = () => { out.innerHTML = ''; input.focus(); };
  out.addEventListener('click', (e) => { if (!window.getSelection().toString() && !e.target.closest('summary, details')) input.focus(); });

  /* ---------- Lệnh mẫu ---------- */
  const EXAMPLES = [
    ['Bắt đầu', [
      'show dbs',
      'use sample_mflix',
      'show collections',
    ]],
    ['Đọc dữ liệu', [
      'db.movies.findOne({ title: "The Matrix" })',
      'db.movies.find(\n  { genres: "Sci-Fi", "imdb.rating": { $gte: 8 } },\n  { _id: 0, title: 1, year: 1, "imdb.rating": 1 }\n).sort({ "imdb.rating": -1 }).limit(5)',
      'db.movies.find({ cast: "Tom Hanks" }, { title: 1, year: 1 }).sort({ year: -1 })',
      'db.movies.countDocuments({ year: { $gte: 2000, $lt: 2010 } })',
      'db.movies.distinct("rated")',
      'db.movies.find({ title: /star wars/i }, { title: 1, year: 1, _id: 0 })',
    ]],
    ['Aggregation', [
      'db.movies.aggregate([\n  { $unwind: "$genres" },\n  { $group: { _id: "$genres", count: { $sum: 1 }, avgRating: { $avg: "$imdb.rating" } } },\n  { $sort: { count: -1 } },\n  { $limit: 5 }\n])',
      'db.comments.aggregate([\n  { $group: { _id: "$movie_id", n: { $sum: 1 } } },\n  { $sort: { n: -1 } },\n  { $limit: 3 },\n  { $lookup: { from: "movies", localField: "_id", foreignField: "_id", as: "movie" } },\n  { $project: { n: 1, title: { $first: "$movie.title" } } }\n])',
    ]],
    ['Ghi dữ liệu (database riêng)', [
      'use movie_demo',
      'db.watchlist.insertOne({ title: "Dune", year: 2021, genres: ["Sci-Fi"], watched: false })',
      'db.watchlist.updateOne({ title: "Dune" }, { $set: { watched: true, myRating: 8 } })',
      'db.watchlist.find()',
      'db.watchlist.deleteOne({ title: "Dune" })',
    ]],
    ['Index & explain', [
      'db.movies.getIndexes()',
      'db.movies.find({ runtime: 142 }).explain("executionStats")',
      'db.movies.createIndex({ runtime: 1 })',
    ]],
  ];
  $('#shellExamples').innerHTML = EXAMPLES.map(([title, cmds]) => `
    <div>
      <div class="label" style="margin-bottom:6px">${esc(title)}</div>
      <div class="space-y-1">${cmds.map((c) => `<button type="button" class="sh-example" data-cmd="${esc(c)}" title="${esc(c)}">${esc(c.replace(/\s*\n\s*/g, ' '))}</button>`).join('')}</div>
    </div>`).join('');
  $$('#shellExamples [data-cmd]').forEach((b) => {
    b.onclick = () => { setInput(b.dataset.cmd); input.focus(); };
  });

  /* ---------- Khởi động ---------- */
  setDb(state.db);
  append(`<span class="sh-dim">Kết nối tới MongoDB Atlas qua server demo, không cần cài mongosh.
Gõ </span><span class="sh-fn">help</span><span class="sh-dim"> để xem các lệnh được hỗ trợ.</span>`);
  autosize();
  // Focus ô lệnh khi mở tab Shell
  $$('[data-tab="shell"]').forEach((b) => b.addEventListener('click', () => setTimeout(() => input.focus(), 0)));
  if (!$('[data-panel="shell"]').hidden) input.focus();
})();
