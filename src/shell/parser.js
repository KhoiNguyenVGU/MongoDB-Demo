// Parser cho cú pháp mongosh (một tập con an toàn của JavaScript).
// KHÔNG eval code: chỉ đọc lệnh dạng  db.<collection>.<method>(<literal>...).<method>(...)
// cùng các lệnh shell (use, show, it, help) và literal: object, array, string, number,
// regex, ObjectId(), ISODate(), new Date(), NumberInt(), NumberLong(), NumberDecimal(), UUID()...
const {
  ObjectId, Int32, Long, Decimal128, Double, UUID, Timestamp, Binary, MinKey, MaxKey,
} = require('mongodb');

class ShellSyntaxError extends Error {
  constructor(message) { super(message); this.name = 'SyntaxError'; }
}

const PUNCT = '{}[](),:.;-+';
const VALUE_END = new Set(['id', 'num', 'str', 'regex']);

function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  const err = (msg, at = i) => { throw new ShellSyntaxError(`${msg} (vị trí ${at + 1})`); };
  const prevIsValue = () => {
    const p = toks[toks.length - 1];
    return p && (VALUE_END.has(p.t) || (p.t === 'p' && ')]}'.includes(p.v)));
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    const start = i;
    if (/[A-Za-z_$]/.test(c)) {
      while (i < n && /[\w$]/.test(src[i])) i++;
      toks.push({ t: 'id', v: src.slice(start, i), pos: start, end: i });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(src.slice(i));
      i += m[0].length;
      toks.push({ t: 'num', v: Number(m[0]), raw: m[0], pos: start, end: i });
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i++;
      let s = '';
      while (true) {
        if (i >= n) err('Chuỗi chưa được đóng', start);
        const ch = src[i];
        if (ch === c) { i++; break; }
        if (c === '`' && ch === '$' && src[i + 1] === '{') err('Không hỗ trợ template string ${...}');
        if (ch === '\\') {
          const e = src[i + 1];
          const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
          if (e === 'u') {
            const hex = src.slice(i + 2, i + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) err('Escape \\u không hợp lệ');
            s += String.fromCharCode(parseInt(hex, 16)); i += 6; continue;
          }
          if (e === 'x') {
            const hex = src.slice(i + 2, i + 4);
            if (!/^[0-9a-fA-F]{2}$/.test(hex)) err('Escape \\x không hợp lệ');
            s += String.fromCharCode(parseInt(hex, 16)); i += 4; continue;
          }
          if (e === '\n') { i += 2; continue; }
          s += map[e] ?? e; i += 2; continue;
        }
        if (ch === '\n' && c !== '`') err('Chuỗi chưa được đóng', start);
        s += ch; i++;
      }
      toks.push({ t: 'str', v: s, pos: start, end: i });
      continue;
    }
    if (c === '/' && !prevIsValue()) {
      // Regex literal: /pattern/flags
      i++;
      let body = '';
      let inClass = false;
      while (true) {
        if (i >= n || src[i] === '\n') err('Regex chưa được đóng', start);
        const ch = src[i];
        if (ch === '\\') { body += ch + (src[i + 1] ?? ''); i += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { i++; break; }
        body += ch; i++;
      }
      let flags = '';
      while (i < n && /[a-z]/i.test(src[i])) flags += src[i++];
      try { new RegExp(body, flags); } catch (e) { err(`Regex không hợp lệ: ${e.message}`, start); }
      toks.push({ t: 'regex', v: { pattern: body, flags }, pos: start, end: i });
      continue;
    }
    if (PUNCT.includes(c)) { toks.push({ t: 'p', v: c, pos: start, end: i + 1 }); i++; continue; }
    if (c === '=' || c === '>' || c === '<' || c === '*' || c === '%' || c === '!' || c === '&' || c === '|' || c === '?') {
      err(`Console này chỉ chạy lệnh MongoDB, không hỗ trợ toán tử JavaScript "${c}" (biến, phép gán, phép tính...). Ví dụ đúng: db.movies.findOne()`);
    }
    err(`Ký tự không hợp lệ "${c}"`);
  }
  return toks;
}

// ---------- Constructor (ObjectId, ISODate, ...) ----------
function toDate(args, name) {
  if (!args.length) return new Date();
  const d = new Date(args[0]);
  if (Number.isNaN(d.getTime())) throw new ShellSyntaxError(`${name}(): ngày không hợp lệ "${args[0]}"`);
  return d;
}
const CONSTRUCTORS = {
  ObjectId: (a) => {
    if (!a.length) return new ObjectId();
    if (typeof a[0] !== 'string' || !/^[0-9a-fA-F]{24}$/.test(a[0])) throw new ShellSyntaxError('ObjectId() cần chuỗi hex 24 ký tự');
    return new ObjectId(a[0]);
  },
  ISODate: (a) => toDate(a, 'ISODate'),
  Date: (a) => toDate(a, 'Date'),
  NumberInt: (a) => new Int32(Number(a[0] ?? 0)),
  Int32: (a) => new Int32(Number(a[0] ?? 0)),
  NumberLong: (a) => Long.fromString(String(a[0] ?? 0)),
  Long: (a) => Long.fromString(String(a[0] ?? 0)),
  NumberDecimal: (a) => Decimal128.fromString(String(a[0] ?? 0)),
  Decimal128: (a) => Decimal128.fromString(String(a[0] ?? 0)),
  Double: (a) => new Double(Number(a[0] ?? 0)),
  UUID: (a) => (a.length ? new UUID(String(a[0])) : new UUID()),
  Timestamp: (a) => (typeof a[0] === 'object' && a[0] !== null ? new Timestamp(a[0]) : new Timestamp({ t: Number(a[0] ?? 0), i: Number(a[1] ?? 0) })),
  BinData: (a) => new Binary(Buffer.from(String(a[1] ?? ''), 'base64'), Number(a[0] ?? 0)),
  RegExp: (a) => new RegExp(String(a[0] ?? ''), String(a[1] ?? '')),
  MinKey: () => new MinKey(),
  MaxKey: () => new MaxKey(),
};

const UNSUPPORTED_KEYWORDS = new Set(['const', 'let', 'var', 'function', 'for', 'while', 'do', 'if', 'else', 'return', 'class', 'async', 'await', 'try', 'throw', 'switch', 'import', 'require', 'console', 'this', 'process', 'globalThis', 'window', 'eval']);

class Parser {
  constructor(src) {
    this.src = src;
    this.toks = tokenize(src);
    this.i = 0;
  }
  peek(o = 0) { return this.toks[this.i + o]; }
  next() { return this.toks[this.i++]; }
  eof() { return this.i >= this.toks.length; }
  isP(v, o = 0) { const t = this.peek(o); return t && t.t === 'p' && t.v === v; }
  expectP(v) {
    const t = this.next();
    if (!t || t.t !== 'p' || t.v !== v) {
      throw new ShellSyntaxError(t ? `Thiếu "${v}" trước "${this.src.slice(t.pos, t.end)}" (vị trí ${t.pos + 1})` : `Thiếu "${v}" ở cuối lệnh`);
    }
    return t;
  }
  lineBreakBefore(tok) {
    const prev = this.toks[this.toks.indexOf(tok) - 1];
    return !!prev && this.src.slice(prev.end, tok.pos).includes('\n');
  }
  endsStatement(o) {
    const t = this.peek(o);
    return !t || (t.t === 'p' && t.v === ';') || this.lineBreakBefore(t);
  }

  parseProgram() {
    const stmts = [];
    while (!this.eof()) {
      if (this.isP(';')) { this.next(); continue; }
      stmts.push(this.parseStatement());
    }
    return stmts;
  }

  parseStatement() {
    const tok = this.peek();
    if (tok.t === 'id' && (tok.v === 'use' || tok.v === 'show') && !this.isP('.', 1) && !this.isP('(', 1)) {
      // Lấy nguyên phần còn lại của dòng làm tham số (cho phép tên có dấu "-")
      let end = this.src.indexOf('\n', tok.end);
      if (end < 0) end = this.src.length;
      const semi = this.src.indexOf(';', tok.end);
      if (semi >= 0 && semi < end) end = semi;
      while (!this.eof() && this.peek().pos < end) this.next();
      return { type: tok.v, arg: this.src.slice(tok.end, end).trim(), source: this.src.slice(tok.pos, end).trim() };
    }
    if (tok.t === 'id' && ['it', 'help', 'cls'].includes(tok.v) && this.endsStatement(1)) {
      this.next();
      return { type: tok.v, source: tok.v };
    }
    if (tok.t === 'id' && UNSUPPORTED_KEYWORDS.has(tok.v)) {
      throw new ShellSyntaxError(`"${tok.v}": console này chỉ chạy lệnh MongoDB, không hỗ trợ biến, hàm hay vòng lặp JavaScript`);
    }
    const start = tok.pos;
    const expr = this.parseExpression();
    const last = this.toks[this.i - 1];
    if (!this.eof() && !this.isP(';') && !this.lineBreakBefore(this.peek())) {
      const t = this.peek();
      throw new ShellSyntaxError(`Không hiểu "${this.src.slice(t.pos, t.end)}" (vị trí ${t.pos + 1}). Mỗi lệnh nên nằm trên một dòng hoặc cách nhau bằng ";"`);
    }
    return { type: 'expr', expr, source: this.src.slice(start, last.end) };
  }

  parseExpression() {
    let node = this.parsePrimary();
    // Chuỗi .member / (args) / ["member"]
    while (!this.eof()) {
      if (this.isP('.')) {
        this.next();
        const t = this.next();
        if (!t || t.t !== 'id') throw new ShellSyntaxError('Sau "." phải là tên method hoặc collection');
        node = { type: 'member', object: node, name: t.v };
      } else if (this.isP('(')) {
        this.next();
        const args = this.parseList(')');
        node = { type: 'call', callee: node, args };
      } else if (this.isP('[') && node.type !== 'lit') {
        this.next();
        const t = this.next();
        if (!t || t.t !== 'str') throw new ShellSyntaxError('Trong [...] phải là chuỗi, vd. db["my-coll"]');
        this.expectP(']');
        node = { type: 'member', object: node, name: t.v };
      } else break;
    }
    return node;
  }

  parseList(close) {
    const items = [];
    while (!this.isP(close)) {
      if (this.eof()) throw new ShellSyntaxError(`Thiếu "${close}" ở cuối lệnh`);
      items.push(this.parseExpression());
      if (this.isP(',')) this.next();
      else if (!this.isP(close)) {
        const t = this.peek();
        throw new ShellSyntaxError(t ? `Thiếu "," hoặc "${close}" trước "${this.src.slice(t.pos, t.end)}" (vị trí ${t.pos + 1})` : `Thiếu "${close}"`);
      }
    }
    this.next();
    return items;
  }

  literalArgs(close) {
    return this.parseList(close).map((n) => literalValue(n));
  }

  parsePrimary() {
    const t = this.next();
    if (!t) throw new ShellSyntaxError('Lệnh chưa hoàn chỉnh');
    if (t.t === 'num') return { type: 'lit', value: t.v };
    if (t.t === 'str') return { type: 'lit', value: t.v };
    if (t.t === 'regex') return { type: 'lit', value: new RegExp(t.v.pattern, t.v.flags) };
    if (t.t === 'p') {
      if (t.v === '-' || t.v === '+') {
        const n = this.next();
        if (!n || n.t !== 'num') throw new ShellSyntaxError(`Sau "${t.v}" phải là số`);
        return { type: 'lit', value: t.v === '-' ? -n.v : n.v };
      }
      if (t.v === '{') return { type: 'lit', value: this.parseObject() };
      if (t.v === '[') return { type: 'lit', value: this.literalArgs(']') };
      if (t.v === '(') { const e = this.parseExpression(); this.expectP(')'); return e; }
      throw new ShellSyntaxError(`Không mong đợi "${t.v}" (vị trí ${t.pos + 1})`);
    }
    // identifier
    const v = t.v;
    if (v === 'true') return { type: 'lit', value: true };
    if (v === 'false') return { type: 'lit', value: false };
    if (v === 'null') return { type: 'lit', value: null };
    if (v === 'undefined') return { type: 'lit', value: undefined };
    if (v === 'Infinity') return { type: 'lit', value: Infinity };
    if (v === 'NaN') return { type: 'lit', value: NaN };
    if (v === 'db') return { type: 'db' };
    if (v === 'print' || v === 'printjson') {
      if (!this.isP('(')) {
        throw new ShellSyntaxError(`Không truyền được hàm "${v}" làm tham số (forEach/map không được hỗ trợ). Bỏ .forEach(...) đi, kết quả sẽ tự được in ra`);
      }
      this.expectP('(');
      return { type: 'print', json: v === 'printjson', args: this.parseList(')') };
    }
    if (v === 'new') {
      const c = this.next();
      if (!c || c.t !== 'id' || !CONSTRUCTORS[c.v]) throw new ShellSyntaxError(`Không hỗ trợ "new ${c ? c.v : ''}"`);
      const args = this.isP('(') ? (this.next(), this.literalArgs(')')) : [];
      return { type: 'lit', value: CONSTRUCTORS[c.v](args) };
    }
    if (v === 'Date' && this.isP('.') && this.peek(1)?.v === 'now') {
      this.next(); this.next(); this.expectP('('); this.expectP(')');
      return { type: 'lit', value: Date.now() };
    }
    if (CONSTRUCTORS[v] && this.isP('(')) {
      this.next();
      const args = this.literalArgs(')');
      // Date() không có "new" trả về chuỗi trong JS
      return { type: 'lit', value: v === 'Date' ? new Date().toString() : CONSTRUCTORS[v](args) };
    }
    if (UNSUPPORTED_KEYWORDS.has(v)) throw new ShellSyntaxError(`"${v}": console này không hỗ trợ cú pháp JavaScript tổng quát`);
    throw new ShellSyntaxError(`"${v}" không xác định. Lệnh phải bắt đầu bằng db, use, show, it hoặc help (biến JavaScript không được hỗ trợ)`);
  }

  parseObject() {
    const obj = {};
    while (!this.isP('}')) {
      const k = this.next();
      if (!k) throw new ShellSyntaxError('Thiếu "}" ở cuối object');
      let key;
      if (k.t === 'id' || k.t === 'str') key = k.v;
      else if (k.t === 'num') key = k.raw;
      else throw new ShellSyntaxError(`Tên field không hợp lệ "${this.src.slice(k.pos, k.end)}" (vị trí ${k.pos + 1})`);
      if (!this.isP(':')) {
        throw new ShellSyntaxError(`Thiếu ":" sau field "${key}" (vị trí ${k.end + 1}). Field có dấu chấm phải đặt trong ngoặc kép, vd. "imdb.rating"`);
      }
      this.next();
      obj[key] = literalValue(this.parseExpression());
      if (this.isP(',')) this.next();
      else if (!this.isP('}')) {
        const t = this.peek();
        throw new ShellSyntaxError(t ? `Thiếu "," hoặc "}" trước "${this.src.slice(t.pos, t.end)}" (vị trí ${t.pos + 1})` : 'Thiếu "}" ở cuối object');
      }
    }
    this.next();
    return obj;
  }
}

function literalValue(node) {
  if (node.type === 'lit') return node.value;
  throw new ShellSyntaxError('Tham số phải là giá trị cố định (object, array, chuỗi, số...), không được chứa lệnh db');
}

function parse(src) {
  return new Parser(src).parseProgram();
}

module.exports = { parse, ShellSyntaxError };
