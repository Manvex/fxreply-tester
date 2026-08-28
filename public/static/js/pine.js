// ===========================================================================
// Pine Script v5 SUBSET interpreter.
// Supported: //@version, strategy() decl (parsed for title only), var/=/:=,
// if/else if/else (indent blocks), ternary, and/or/not, arithmetic/comparison,
// series history x[n], input.int/float/bool/string/source, na/nz,
// ta.sma/ema/rma/wma/rsi/atr/tr/stdev/highest/lowest/change/crossover/crossunder,
// math.*, strategy.entry/exit/close/close_all, strategy.position_size,
// builtins: open/high/low/close/volume/hl2/hlc3/ohlc4/bar_index/time, plot (no-op)
// ===========================================================================
const Pine = (() => {

  // ------------------------- tokenizer -------------------------
  function tokenize(line) {
    const toks = [];
    let i = 0;
    const push = (type, value) => toks.push({ type, value });
    while (i < line.length) {
      const ch = line[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (ch === '/' && line[i + 1] === '/') break; // comment
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(line[i + 1]))) {
        let j = i; while (j < line.length && /[0-9._]/.test(line[j])) j++;
        push('num', parseFloat(line.slice(i, j).replace(/_/g, ''))); i = j; continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1, s = '';
        while (j < line.length && line[j] !== ch) { s += line[j]; j++; }
        push('str', s); i = j + 1; continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i; while (j < line.length && /[A-Za-z0-9_.]/.test(line[j])) j++;
        const word = line.slice(i, j);
        if (word === 'and' || word === 'or' || word === 'not' || word === 'if' || word === 'else' || word === 'var' || word === 'varip') push('kw', word);
        else push('id', word);
        i = j; continue;
      }
      const three = line.slice(i, i + 2);
      if ([':=', '==', '!=', '<=', '>=', '=>'].includes(three)) { push('op', three); i += 2; continue; }
      if ('+-*/%<>=?:,()[]'.includes(ch)) { push('op', ch); i++; continue; }
      i++; // skip unknown
    }
    return toks;
  }

  // ------------------------- line splitting & block builder -------------------------
  function buildBlocks(src) {
    const rawLines = src.split('\n');
    const lines = [];
    for (const raw of rawLines) {
      const noComment = raw.replace(/\/\/.*$/, '');
      if (!noComment.trim()) continue;
      const indent = raw.match(/^\s*/)[0].replace(/\t/g, '    ').length;
      lines.push({ indent, text: noComment.trim(), toks: tokenize(noComment.trim()) });
    }
    let pos = 0;
    function parseBlock(minIndent) {
      const stmts = [];
      while (pos < lines.length) {
        const ln = lines[pos];
        if (ln.indent < minIndent) break;
        if (ln.toks.length === 0) { pos++; continue; }
        const first = ln.toks[0];
        if (first.type === 'kw' && first.value === 'if') {
          pos++;
          const cond = parseExpr(ln.toks.slice(1));
          const then = parseBlock(ln.indent + 1);
          const node = { type: 'if', branches: [{ cond, body: then }], elseBody: null };
          // else / else if chains at same indent
          while (pos < lines.length && lines[pos].indent === ln.indent &&
                 lines[pos].toks[0]?.type === 'kw' && lines[pos].toks[0].value === 'else') {
            const eToks = lines[pos].toks;
            if (eToks[1]?.type === 'kw' && eToks[1].value === 'if') {
              const c2 = parseExpr(eToks.slice(2));
              pos++;
              node.branches.push({ cond: c2, body: parseBlock(ln.indent + 1) });
            } else {
              pos++;
              node.elseBody = parseBlock(ln.indent + 1);
              break;
            }
          }
          stmts.push(node);
          continue;
        }
        if (first.type === 'kw' && first.value === 'else') { break; } // handled by parent
        pos++;
        stmts.push(parseSimple(ln.toks));
      }
      return stmts;
    }
    const program = parseBlock(0);
    return program;
  }

  function parseSimple(toks) {
    // var x = expr | x = expr | x := expr | exprStatement
    let once = false, k = 0;
    if (toks[0]?.type === 'kw' && (toks[0].value === 'var' || toks[0].value === 'varip')) { once = true; k = 1; }
    if (toks[k]?.type === 'id' && toks[k + 1]?.type === 'op' && (toks[k + 1].value === '=' || toks[k + 1].value === ':=')) {
      const name = toks[k].value;
      const expr = parseExpr(toks.slice(k + 2));
      return { type: toks[k + 1].value === ':=' ? 'reassign' : 'assign', name, expr, once };
    }
    return { type: 'expr', expr: parseExpr(toks) };
  }

  // ------------------------- expression parser (precedence climbing) -------------------------
  let CALLSITE = 0;
  function parseExpr(toks) {
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const expect = (v) => { const t = next(); if (!t || t.value !== v) throw new Error(`Pine: expected '${v}'`); };

    function parseTernary() {
      let cond = parseOr();
      if (peek()?.value === '?') {
        next();
        const a = parseTernary();
        expect(':');
        const b = parseTernary();
        return { k: 'tern', cond, a, b };
      }
      return cond;
    }
    function parseOr() {
      let l = parseAnd();
      while (peek()?.type === 'kw' && peek().value === 'or') { next(); l = { k: 'bin', op: 'or', l, r: parseAnd() }; }
      return l;
    }
    function parseAnd() {
      let l = parseCmp();
      while (peek()?.type === 'kw' && peek().value === 'and') { next(); l = { k: 'bin', op: 'and', l, r: parseCmp() }; }
      return l;
    }
    function parseCmp() {
      let l = parseAdd();
      while (peek()?.type === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(peek().value)) {
        const op = next().value; l = { k: 'bin', op, l, r: parseAdd() };
      }
      return l;
    }
    function parseAdd() {
      let l = parseMul();
      while (peek()?.type === 'op' && (peek().value === '+' || peek().value === '-')) {
        const op = next().value; l = { k: 'bin', op, l, r: parseMul() };
      }
      return l;
    }
    function parseMul() {
      let l = parseUnary();
      while (peek()?.type === 'op' && ['*', '/', '%'].includes(peek().value)) {
        const op = next().value; l = { k: 'bin', op, l, r: parseUnary() };
      }
      return l;
    }
    function parseUnary() {
      if (peek()?.type === 'kw' && peek().value === 'not') { next(); return { k: 'un', op: 'not', e: parseUnary() }; }
      if (peek()?.type === 'op' && peek().value === '-') { next(); return { k: 'un', op: 'neg', e: parseUnary() }; }
      if (peek()?.type === 'op' && peek().value === '+') { next(); return parseUnary(); }
      return parsePostfix();
    }
    function parsePostfix() {
      let e = parseAtom();
      while (peek()) {
        if (peek().value === '(' && e.k === 'name') {
          next();
          const args = [], named = {};
          while (peek() && peek().value !== ')') {
            // named arg?
            if (peek().type === 'id' && toks[p + 1]?.value === '=' && toks[p + 1]?.type === 'op') {
              const nm = next().value; next();
              named[nm] = parseTernary();
            } else {
              args.push(parseTernary());
            }
            if (peek()?.value === ',') next();
          }
          expect(')');
          e = { k: 'call', name: e.name, args, named, cs: CALLSITE++ };
        } else if (peek().value === '[') {
          next();
          const off = parseTernary();
          expect(']');
          e = { k: 'hist', base: e, off, cs: CALLSITE++ };
        } else break;
      }
      return e;
    }
    function parseAtom() {
      const t = next();
      if (!t) throw new Error('Pine: unexpected end of expression');
      if (t.type === 'num') return { k: 'num', v: t.value };
      if (t.type === 'str') return { k: 'str', v: t.value };
      if (t.type === 'id') return { k: 'name', name: t.value };
      if (t.value === '(') { const e = parseTernary(); expect(')'); return e; }
      throw new Error('Pine: unexpected token ' + t.value);
    }

    const e = parseTernary();
    return e;
  }

  // ------------------------- runtime -------------------------
  function createRuntime(candles, actions) {
    const state = new Map();   // callsite -> state
    const vars = new Map();    // name -> {hist: Float64Array-like []}
    const histBuf = new Map(); // callsite -> [] history of expression values
    let I = 0;                 // current bar index

    const B = {
      open: (i) => candles[i]?.open ?? NaN,
      high: (i) => candles[i]?.high ?? NaN,
      low: (i) => candles[i]?.low ?? NaN,
      close: (i) => candles[i]?.close ?? NaN,
      volume: (i) => candles[i]?.volume ?? NaN,
    };

    function getVar(name) {
      const v = vars.get(name);
      if (!v) return undefined;
      return v.hist[I];
    }
    function getVarHist(name, off) {
      const v = vars.get(name);
      if (!v) return NaN;
      const idx = I - off;
      return idx >= 0 ? v.hist[idx] : NaN;
    }
    function setVar(name, val) {
      let v = vars.get(name);
      if (!v) { v = { hist: new Array(candles.length).fill(NaN) }; vars.set(name, v); }
      v.hist[I] = val;
    }
    function carryVars() {
      for (const v of vars.values()) v.hist[I] = I > 0 ? v.hist[I - 1] : NaN;
    }

    function st(cs, init) {
      if (!state.has(cs)) state.set(cs, init());
      return state.get(cs);
    }

    // stateful TA implementations (per callsite)
    const taFns = {
      'ta.sma': (cs, [src, len]) => {
        const s = st(cs, () => ({ buf: [], sum: 0 }));
        s.buf.push(src); s.sum += src;
        if (s.buf.length > len) s.sum -= s.buf.shift();
        return s.buf.length >= len ? s.sum / len : NaN;
      },
      'ta.ema': (cs, [src, len]) => {
        const s = st(cs, () => ({ prev: NaN, seed: [], k: 2 / (len + 1) }));
        if (isNaN(s.prev)) {
          if (!isNaN(src)) s.seed.push(src);
          if (s.seed.length >= len) { s.prev = s.seed.reduce((a, b) => a + b, 0) / len; return s.prev; }
          return NaN;
        }
        s.prev = src * s.k + s.prev * (1 - s.k);
        return s.prev;
      },
      'ta.rma': (cs, [src, len]) => {
        const s = st(cs, () => ({ prev: NaN, seed: [] }));
        if (isNaN(s.prev)) {
          if (!isNaN(src)) s.seed.push(src);
          if (s.seed.length >= len) { s.prev = s.seed.reduce((a, b) => a + b, 0) / len; return s.prev; }
          return NaN;
        }
        s.prev = (src + (len - 1) * s.prev) / len;
        return s.prev;
      },
      'ta.wma': (cs, [src, len]) => {
        const s = st(cs, () => ({ buf: [] }));
        s.buf.push(src); if (s.buf.length > len) s.buf.shift();
        if (s.buf.length < len) return NaN;
        let num = 0, den = 0;
        for (let j = 0; j < len; j++) { num += s.buf[j] * (j + 1); den += j + 1; }
        return num / den;
      },
      'ta.rsi': (cs, [src, len]) => {
        const s = st(cs, () => ({ prev: NaN, ag: NaN, al: NaN, seedG: [], seedL: [] }));
        if (isNaN(s.prev)) { s.prev = src; return NaN; }
        const ch = src - s.prev; s.prev = src;
        const g = Math.max(ch, 0), l = Math.max(-ch, 0);
        if (isNaN(s.ag)) {
          s.seedG.push(g); s.seedL.push(l);
          if (s.seedG.length >= len) {
            s.ag = s.seedG.reduce((a, b) => a + b, 0) / len;
            s.al = s.seedL.reduce((a, b) => a + b, 0) / len;
          } else return NaN;
        } else {
          s.ag = (g + (len - 1) * s.ag) / len;
          s.al = (l + (len - 1) * s.al) / len;
        }
        return s.al === 0 ? 100 : 100 - 100 / (1 + s.ag / s.al);
      },
      'ta.atr': (cs, [len]) => {
        const s = st(cs, () => ({ prev: NaN, seed: [] }));
        const c = candles[I], pc = I > 0 ? candles[I - 1].close : NaN;
        const tr = isNaN(pc) ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
        if (isNaN(s.prev)) {
          s.seed.push(tr);
          if (s.seed.length >= len) { s.prev = s.seed.reduce((a, b) => a + b, 0) / len; return s.prev; }
          return NaN;
        }
        s.prev = (tr + (len - 1) * s.prev) / len;
        return s.prev;
      },
      'ta.tr': () => {
        const c = candles[I], pc = I > 0 ? candles[I - 1].close : NaN;
        return isNaN(pc) ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
      },
      'ta.stdev': (cs, [src, len]) => {
        const s = st(cs, () => ({ buf: [] }));
        s.buf.push(src); if (s.buf.length > len) s.buf.shift();
        if (s.buf.length < len) return NaN;
        const m = s.buf.reduce((a, b) => a + b, 0) / len;
        return Math.sqrt(s.buf.reduce((a, b) => a + (b - m) ** 2, 0) / len);
      },
      'ta.highest': (cs, [src, len]) => {
        const s = st(cs, () => ({ buf: [] }));
        s.buf.push(src); if (s.buf.length > len) s.buf.shift();
        return s.buf.length >= len ? Math.max(...s.buf) : NaN;
      },
      'ta.lowest': (cs, [src, len]) => {
        const s = st(cs, () => ({ buf: [] }));
        s.buf.push(src); if (s.buf.length > len) s.buf.shift();
        return s.buf.length >= len ? Math.min(...s.buf) : NaN;
      },
      'ta.change': (cs, [src]) => {
        const s = st(cs, () => ({ prev: NaN }));
        const r = src - s.prev; s.prev = src;
        return r;
      },
      'ta.crossover': (cs, [a, b]) => {
        const s = st(cs, () => ({ pa: NaN, pb: NaN }));
        const r = !isNaN(s.pa) && !isNaN(s.pb) && s.pa <= s.pb && a > b;
        s.pa = a; s.pb = b;
        return r;
      },
      'ta.crossunder': (cs, [a, b]) => {
        const s = st(cs, () => ({ pa: NaN, pb: NaN }));
        const r = !isNaN(s.pa) && !isNaN(s.pb) && s.pa >= s.pb && a < b;
        s.pa = a; s.pb = b;
        return r;
      },
      'ta.cross': (cs, [a, b]) => {
        const s = st(cs, () => ({ pa: NaN, pb: NaN }));
        const r = !isNaN(s.pa) && !isNaN(s.pb) && ((s.pa <= s.pb && a > b) || (s.pa >= s.pb && a < b));
        s.pa = a; s.pb = b;
        return r;
      },
    };

    function evalNode(n) {
      switch (n.k) {
        case 'num': return n.v;
        case 'str': return n.v;
        case 'name': return evalName(n.name);
        case 'un': {
          const v = evalNode(n.e);
          return n.op === 'not' ? !truthy(v) : -v;
        }
        case 'bin': {
          if (n.op === 'and') return truthy(evalNode(n.l)) && truthy(evalNode(n.r));
          if (n.op === 'or') return truthy(evalNode(n.l)) || truthy(evalNode(n.r));
          const a = evalNode(n.l), b = evalNode(n.r);
          switch (n.op) {
            case '+': return a + b; case '-': return a - b; case '*': return a * b;
            case '/': return a / b; case '%': return a % b;
            case '==': return a === b; case '!=': return a !== b;
            case '<': return a < b; case '>': return a > b;
            case '<=': return a <= b; case '>=': return a >= b;
          }
          return NaN;
        }
        case 'tern': return truthy(evalNode(n.cond)) ? evalNode(n.a) : evalNode(n.b);
        case 'hist': {
          const off = Math.round(evalNode(n.off));
          // builtin series history
          if (n.base.k === 'name') {
            const nm = n.base.name;
            const bi = I - off;
            if (nm === 'open') return bi >= 0 ? B.open(bi) : NaN;
            if (nm === 'high') return bi >= 0 ? B.high(bi) : NaN;
            if (nm === 'low') return bi >= 0 ? B.low(bi) : NaN;
            if (nm === 'close') return bi >= 0 ? B.close(bi) : NaN;
            if (nm === 'volume') return bi >= 0 ? B.volume(bi) : NaN;
            if (vars.has(nm)) return getVarHist(nm, off);
          }
          // generic expression history via callsite buffer
          const buf = histBuf.get(n.cs) || [];
          const cur = evalNode(n.base);
          buf[I] = cur;
          histBuf.set(n.cs, buf);
          const idx = I - off;
          return idx >= 0 && buf[idx] !== undefined ? buf[idx] : NaN;
        }
        case 'call': return evalCall(n);
      }
      return NaN;
    }

    function truthy(v) { return v === true || (typeof v === 'number' && !isNaN(v) && v !== 0); }

    function evalName(name) {
      switch (name) {
        case 'open': return B.open(I);
        case 'high': return B.high(I);
        case 'low': return B.low(I);
        case 'close': return B.close(I);
        case 'volume': return B.volume(I);
        case 'hl2': return (B.high(I) + B.low(I)) / 2;
        case 'hlc3': return (B.high(I) + B.low(I) + B.close(I)) / 3;
        case 'ohlc4': return (B.open(I) + B.high(I) + B.low(I) + B.close(I)) / 4;
        case 'bar_index': return I;
        case 'time': return candles[I].time * 1000;
        case 'na': return NaN;
        case 'true': return true;
        case 'false': return false;
        case 'strategy.position_size': return actions.positionSize();
        case 'strategy.long': return 'long';
        case 'strategy.short': return 'short';
        case 'strategy.opentrades': return actions.openCount();
        case 'strategy.equity': return actions.equity();
        case 'math.pi': return Math.PI;
      }
      const v = getVar(name);
      if (v !== undefined) return v;
      throw new Error(`Pine: undefined variable '${name}'`);
    }

    function evalCall(n) {
      const args = n.args.map(evalNode);
      const named = {};
      for (const k in n.named) named[k] = evalNode(n.named[k]);
      const nm = n.name;

      if (taFns[nm]) return taFns[nm](n.cs, args);

      if (nm.startsWith('input')) {
        return named.defval !== undefined ? named.defval : (args[0] !== undefined ? args[0] : NaN);
      }
      if (nm === 'na') return args.every(a => typeof a === 'number' ? isNaN(a) : a == null);
      if (nm === 'nz') return (typeof args[0] === 'number' && !isNaN(args[0])) ? args[0] : (args[1] ?? 0);
      if (nm.startsWith('math.')) {
        const f = nm.slice(5);
        const fns = { abs: Math.abs, min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp, log: Math.log, sign: Math.sign, avg: (...a) => a.reduce((x, y) => x + y, 0) / a.length };
        if (fns[f]) return fns[f](...args);
        return NaN;
      }
      if (nm === 'strategy') return NaN; // strategy() declaration — ignore
      if (nm === 'strategy.entry') {
        const id = args[0] ?? 'L';
        const dir = args[1] === 'short' ? -1 : 1;
        const qty = named.qty ?? args[2] ?? 1;
        actions.entry(id, dir, qty, named.comment);
        return NaN;
      }
      if (nm === 'strategy.exit') {
        const id = args[0] ?? 'X';
        const from = named.from_entry ?? args[1] ?? null;
        actions.exit(id, from, named.stop ?? NaN, named.limit ?? NaN, named.loss ?? NaN, named.profit ?? NaN);
        return NaN;
      }
      if (nm === 'strategy.close') { actions.closeId(args[0] ?? null); return NaN; }
      if (nm === 'strategy.close_all') { actions.closeAll(); return NaN; }
      if (nm === 'plot' || nm === 'plotshape' || nm === 'plotchar' || nm === 'hline' ||
          nm === 'alertcondition' || nm === 'bgcolor' || nm === 'barcolor' ||
          nm === 'label.new' || nm === 'line.new' || nm.startsWith('color')) return NaN;
      throw new Error(`Pine: unsupported function '${nm}'`);
    }

    function execBlock(stmts) {
      for (const s of stmts) execStmt(s);
    }
    function execStmt(s) {
      switch (s.type) {
        case 'assign':
          if (s.once) {
            // var x = expr → init once, then carry
            if (I === 0 || !vars.has(s.name) || isNaN(getVarHist(s.name, 1)) && !vars.get(s.name).inited) {
              if (!vars.get(s.name)?.inited) {
                setVar(s.name, evalNode(s.expr));
                vars.get(s.name).inited = true;
              }
            }
          } else {
            setVar(s.name, evalNode(s.expr));
          }
          break;
        case 'reassign':
          setVar(s.name, evalNode(s.expr));
          break;
        case 'expr':
          evalNode(s.expr);
          break;
        case 'if': {
          let done = false;
          for (const br of s.branches) {
            if (truthy(evalNode(br.cond))) { execBlock(br.body); done = true; break; }
          }
          if (!done && s.elseBody) execBlock(s.elseBody);
          break;
        }
      }
    }

    return {
      runBar(i, program) {
        I = i;
        carryVars();
        execBlock(program);
      }
    };
  }

  function compile(src) {
    CALLSITE = 0;
    const program = buildBlocks(src);
    return program;
  }

  return { compile, createRuntime };
})();

window.Pine = Pine;
