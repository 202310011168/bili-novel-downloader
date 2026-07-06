// ==UserScript==
// @name         哔哩轻小说打包下载器
// @namespace    https://github.com/202310011168/bili-novel-downloader
// @version      4.1.0
// @updateURL    https://raw.githubusercontent.com/202310011168/bili-novel-downloader/master/bili-novel-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/202310011168/bili-novel-downloader/master/bili-novel-downloader.user.js
// @description  将哔哩轻小说(linovelib.com/bilinovel.com)打包为EPUB电子书。支持分卷选择下载、插图、封面识别、反爬调度、段落还原。苹果风格UI。
// @author       bili_novel_packer
// @match        *://m.bilinovel.com/novel/*
// @match        *://bilinovel.com/novel/*
// @match        *://www.bilinovel.com/novel/*
// @match        *://linovelib.com/novel/*
// @match        *://www.linovelib.com/novel/*
// @match        *://m.linovelib.com/novel/*
// @require      https://unpkg.com/jszip@3.2.0/dist/jszip.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      m.bilinovel.com
// @connect      bilinovel.com
// @connect      www.bilinovel.com
// @connect      linovelib.com
// @connect      www.linovelib.com
// @connect      m.linovelib.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

const BNP = (function () {
  'use strict';

  const DOMAIN = 'https://m.bilinovel.com';
  const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

  class RequestScheduler {
    constructor(n, perMs) {
      this.gap = n > 0 && perMs > 0 ? Math.ceil(perMs / n) : 0;
      this._queue = [];
      this._running = false;
      this._paused = false;
    }
    async run(task) {
      return new Promise((resolve, reject) => {
        this._queue.push({ task, resolve, reject });
        this._process();
      });
    }
    pause() { this._paused = true; }
    resume() { this._paused = false; }
    async _process() {
      if (this._running) return;
      this._running = true;
      while (this._queue.length > 0) {
        while (this._paused) { await sleep(100); }
        const { task, resolve, reject } = this._queue.shift();
        try { resolve(await task()); } catch (e) { reject(e); }
        if (this.gap > 0) await sleep(this.gap);
      }
      this._running = false;
    }
  }
  const _pageScheduler = new RequestScheduler(15, 60000);
  const _imageScheduler = new RequestScheduler(10, 1000);

  const logs = [];
  const LOG_KEY = 'bnp_log_store';
  const MAX_LOG = 3000;
  let _logTimer = 0;

  function addLog(level, msg) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    const entry = { t: timeStr, ts: now.getTime(), l: level, m: msg };
    logs.push(entry);

    const logEl = document.getElementById('bnp-log');
    if (logEl) {
      const div = document.createElement('div');
      div.className = 'bnp-l';
      if (level === 'ERROR') div.classList.add('e');
      else if (level === 'WARN') div.classList.add('w');
      else if (level === 'SESSION') div.classList.add('s');
      div.innerHTML = level === 'SESSION'
        ? `<span>${escH(msg)}</span>`
        : `<s>${timeStr}</s><b>${level}</b><span>${escH(msg)}</span>`;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }

    const badge = document.getElementById('bnp-log-cnt');
    if (badge) badge.textContent = logs.length;

    clearTimeout(_logTimer);
    _logTimer = setTimeout(_persistLogs, 800);

    if (level !== 'SESSION') {
      console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](`[${timeStr}] [${level}] ${msg}`);
    }
  }

  function _persistLogs() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(-MAX_LOG))); } catch (e) { /* localStorage满 */ }
  }

  function loadLogs() {
    if (window._bnpLogLoaded) return;
    window._bnpLogLoaded = true;
    const logEl = document.getElementById('bnp-log');
    if (!logEl) return;
    try {
      const raw = localStorage.getItem(LOG_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw);
      logs.push(...stored.slice(-MAX_LOG));
      logEl.innerHTML = '';
      for (const e of logs) {
        const div = document.createElement('div');
        div.className = 'bnp-l';
        if (e.l === 'ERROR') div.classList.add('e');
        else if (e.l === 'WARN') div.classList.add('w');
        else if (e.l === 'SESSION') div.classList.add('s');
        div.innerHTML = e.l === 'SESSION'
          ? `<span>${escH(e.m)}</span>`
          : `<s>${e.t}</s><b>${e.l}</b><span>${escH(e.m)}</span>`;
        logEl.appendChild(div);
      }
      logEl.scrollTop = logEl.scrollHeight;
      const badge = document.getElementById('bnp-log-cnt');
      if (badge) badge.textContent = logs.length;
    } catch (e) { /* 忽略 */ }
  }

  function clearLog() {
    logs.length = 0;
    try { localStorage.removeItem(LOG_KEY); } catch (e) { /* ignore */ }
    const logEl = document.getElementById('bnp-log');
    if (logEl) logEl.innerHTML = '';
    const badge = document.getElementById('bnp-log-cnt');
    if (badge) badge.textContent = '0';
  }

  function copyLog() {
    const text = logs
      .map(e => e.l === 'SESSION' ? e.m : `[${e.t}] [${e.l}] ${e.m}`)
      .join('\n');
    const btn = document.getElementById('bnp-log-cpy');
    if (!btn) return;
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '✅';
      setTimeout(() => { btn.textContent = '📋'; }, 2000);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
      btn.textContent = '✅';
      setTimeout(() => { btn.textContent = '📋'; }, 2000);
    });
  }

  function gmFetch(url, type = 'text', timeout = 30000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error(`请求超时(${timeout/1000}s): ${url.substring(0, 80)}`)); } }, timeout);
      try {
        GM_xmlhttpRequest({
          method: 'GET', url,
          headers: { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Cookie': 'night=0' },
          responseType: type,
          onload: r => { if (settled) return; settled = true; clearTimeout(timer); r.status >= 200 && r.status < 300 ? resolve(type === 'arraybuffer' ? new Uint8Array(r.response) : r.responseText) : reject(new Error(`HTTP ${r.status}`)); },
          onerror: e => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error(`网络错误: ${e.error || ''}`)); },
          ontimeout: () => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error('GM超时')); },
        });
      } catch (e) { if (!settled) { settled = true; clearTimeout(timer); reject(e); } }
    });
  }

  async function fetchPage(url) {
    return _pageScheduler.run(async () => {
      for (let i = 0; i < 3; i++) {
        try {
          const html = await gmFetch(url, 'text', 30000);
          if (html.includes('Cloudflare to restrict access') || html.includes('503 Service')) {
            addLog('WARN', '触发反爬，暂停调度10秒...');
            _pageScheduler.pause();
            await sleep(10000);
            _pageScheduler.resume();
            continue;
          }
          return html;
        } catch (e) { if (i === 2) throw e; await sleep(2000); }
      }
    });
  }

  function gmFetchImg(url) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('图片超时')); } }, 20000);
      GM_xmlhttpRequest({
        method: 'GET', url,
        headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': DOMAIN + '/', 'Cookie': 'night=0' },
        responseType: 'arraybuffer',
        onload: r => { if (settled) return; settled = true; clearTimeout(timer); r.status >= 200 && r.status < 300 ? resolve(new Uint8Array(r.response)) : reject(new Error(`HTTP ${r.status}`)); },
        onerror: e => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error('网络错误')); },
        ontimeout: () => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error('超时')); },
      });
    });
  }

  async function fetchImage(src) {
    if (src.startsWith('data:image')) return b64ToU8(src.split(',')[1]);
    if (!src.startsWith('http')) src = `${DOMAIN}/${src}`;
    src = src.replace('https://https://', 'https://').replace(/𝘣/g, 'b');
    return gmFetchImg(src);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function formatTime(sec) {
    if (sec < 60) return `${Math.round(sec)}秒`;
    if (sec < 3600) return `${Math.floor(sec / 60)}分${Math.round(sec % 60)}秒`;
    return `${Math.floor(sec / 3600)}时${Math.floor((sec % 3600) / 60)}分`;
  }
  async function fetchImageWithRetry(src, retries = 2) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try { return await fetchImage(src); }
      catch (e) { lastErr = e; if (i < retries) await sleep(1000 * (i + 1)); }
    }
    throw lastErr;
  }
  function b64ToU8(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
  function esc(s) { return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''; }
  function escH(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function sanitize(n) { return n.replace(/[:*?"\\\/<>|\0　]/g, ' ').replace(/^\.+|\.+$/g, '').replace(/\s+/g, ' ').trim(); }
  function detectExt(u) { if (u[0] === 0xFF && u[1] === 0xD8) return '.jpg'; if (u[0] === 0x89 && u[1] === 0x50) return '.png'; if (u[0] === 0x47 && u[1] === 0x49) return '.gif'; if (u[0] === 0x52 && u[1] === 0x49) return '.webp'; return '.jpg'; }
  function getImageDimensions(data) {
    try {
      if (data[0] === 0xFF && data[1] === 0xD8) {
        let i = 2;
        while (i < data.length - 1) {
          if (data[i] !== 0xFF) { i++; continue; }
          const marker = data[i + 1];
          if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
            const h = (data[i + 5] << 8) | data[i + 6];
            const w = (data[i + 7] << 8) | data[i + 8];
            return { width: w, height: h };
          }
          const len = (data[i + 2] << 8) | data[i + 3];
          i += 2 + len;
        }
      }
      if (data[0] === 0x89 && data[1] === 0x50) {
        const w = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
        const h = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
        return { width: w, height: h };
      }
      if (data[0] === 0x47 && data[1] === 0x49) {
        const w = data[6] | (data[7] << 8);
        const h = data[8] | (data[9] << 8);
        return { width: w, height: h };
      }
      if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46) {
        const w = (data[26] | (data[27] << 8)) + 1;
        const h = (data[28] | (data[29] << 8)) + 1;
        return { width: w, height: h };
      }
    } catch {}
    return null;
  }
  function mediaType(ext) { return ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'; }

  let secretMap = null;
  async function getSecretMap() {
    if (secretMap) return secretMap;
    try {
      const js = await gmFetch(`${DOMAIN}/themes/zhmb/js/readtools.js`);
      const before = "['\\x61\\x70\\x70\\x6c\\x79'](null,\"";
      const after = "\"['\\x73\\x70\\x6c\\x69\\x74']";
      const s = js.indexOf(before);
      const e = js.lastIndexOf(after);
      if (s === -1 || e === -1) { addLog('WARN', `readtools.js格式不匹配 (s=${s}, e=${e})`); secretMap = {}; return secretMap; }
      const data = js.substring(s + before.length, e);
      addLog('INFO', `readtools.js数据长度: ${data.length}`);
      // 字符替换混淆的解密映射
      let result = '', code = '';
      for (let i = 0; i < data.length; i++) {
        const c = data.charCodeAt(i);
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
          result += String.fromCharCode(parseInt(code));
          code = '';
        } else {
          code += data[i];
        }
      }
      // 解析 .replace 映射
      secretMap = {};
      result = result.replace(/\\'/g, '"').replace(/'/g, '"');
      const parts = result.split('.replace');
      for (const part of parts) {
        const ps = part.indexOf('RegExp("');
        if (ps === -1) continue;
        const key = part.substring(ps + 8, ps + 9);
        let vs = part.indexOf('), "');
        if (vs === -1) vs = part.indexOf('),"');
        if (vs === -1) continue;
        const vl = part[vs + 2] === '"' ? 3 : 4;
        secretMap[key] = part.substring(vs + vl, vs + vl + 1);
      }
      addLog('INFO', `解密密钥: ${Object.keys(secretMap).length}条`);
      return secretMap;
    } catch (e) {
      addLog('WARN', `readtools.js获取失败: ${e.message}`);
      secretMap = {}; return secretMap;
    }
  }

  const FALLBACK = { fixedLength: 20, seedMultiplier: 135, seedOffset: 234, a: 9302, c: 49397, mod: 233280 };
  const tplCache = {};

  async function getShuffleParams(doc) {
    const scripts = doc.querySelectorAll('script[src*="chapterlog.js?v"]');
    if (!scripts.length) return null;
    const idMatch = doc.documentElement.outerHTML.match(/chapterid:'(\d+)'/);
    if (!idMatch) return null;
    const chId = parseInt(idMatch[1]);
    const src = new URL(scripts[0].src, DOMAIN).toString();
    let tpl = tplCache[src];
    if (tpl === undefined) {
      try { tpl = parseChapterLog(await gmFetch(src)) || null; } catch { tpl = null; }
      tplCache[src] = tpl;
    }
    tpl = tpl || FALLBACK;
    return { fixedLength: tpl.fixedLength, seed: chId * tpl.seedMultiplier + tpl.seedOffset, a: tpl.a, c: tpl.c, mod: tpl.mod };
  }

  function parseChapterLog(js) {
    let m = js.match(/if\s*\(\s*[_$a-zA-Z0-9]+\s*>\s*(.+?)\)/);
    let sm = js.match(/=\s*(.+?Number\s*\(\s*chapterId\s*\).+?)\s*;/);
    let lm = js.match(/=\s*(\(\s*[_$a-zA-Z0-9]+\s*\*.+?\)\s*%\s*.+?)\s*;/);
    if (m && sm && lm) {
      const fl = evInt(stripP(m[1])), sp = parseSeed(sm[1]), lp = parseLcg(lm[1]);
      if (fl !== null && sp && lp) return { fixedLength: fl, seedMultiplier: sp[0], seedOffset: sp[1], a: lp[0], c: lp[1], mod: lp[2] };
    }
    const os = /var\s+[_$a-zA-Z0-9]+\s*=\s*[^;]*?Number\s*\(\s*[_$a-zA-Z0-9]+\s*\)\s*,\s*([^,)]+?)\s*\)\s*,\s*([^,)]+?)\s*\)\s*,/g;
    const ol = /([_$a-zA-Z0-9]+)\s*=\s*[^;]*?\(\s*\1\s*,\s*([^,)]+?)\s*\)\s*,\s*([^,)]+?)\s*\)\s*,\s*([^;)]+?)\s*\)\s*;/g;
    let sp = null, lp = null, t;
    while ((t = os.exec(js))) { const mul = evInt(t[1]), off = evInt(t[2]); if (mul > 0 && off >= 0) { sp = [mul, off]; break; } }
    while ((t = ol.exec(js))) { const a = evInt(t[2]), c = evInt(t[3]), mod = evInt(t[4]); if (a > 0 && c >= 0 && mod > a && mod > c) { lp = [a, c, mod]; break; } }
    if (sp && lp) return { fixedLength: 20, seedMultiplier: sp[0], seedOffset: sp[1], a: lp[0], c: lp[1], mod: lp[2] };
    return null;
  }

  function parseSeed(expr) { const o = evVar(expr, { chapterId: 0 }), v = evVar(expr, { chapterId: 1 }); return o !== null && v !== null ? [v - o, o] : null; }
  function parseLcg(expr) {
    const parts = splitTop(expr, '%'); if (parts.length !== 2) return null;
    const mod = evInt(parts[1]); if (mod === null) return null;
    const left = stripP(parts[0]); const vn = (left.match(/[_$a-zA-Z][_$a-zA-Z0-9]*/) || [])[0]; if (!vn) return null;
    const c = evVar(left, { [vn]: 0 }), v = evVar(left, { [vn]: 1 }); return c !== null && v !== null ? [v - c, c, mod] : null;
  }
  function evVar(expr, vars) { let n = expr; for (const [k, v] of Object.entries(vars)) n = n.replace(new RegExp(`Number\\s*\\(\\s*${k}\\s*\\)`, 'g'), v).replace(new RegExp(`\\b${k}\\b`, 'g'), v); return evInt(n); }
  function splitTop(expr, op) { const r = []; let s = 0, d = 0; for (let i = 0; i < expr.length; i++) { if (expr[i] === '(') { d++; continue; } if (expr[i] === ')') { d--; continue; } if (d === 0 && expr.startsWith(op, i)) { r.push(expr.substring(s, i).trim()); s = i + op.length; i += op.length - 1; } } r.push(expr.substring(s).trim()); return r; }
  function stripP(e) { let v = e.trim(); while (v.startsWith('(') && v.endsWith(')')) { let d = 0, w = true; for (let i = 0; i < v.length; i++) { if (v[i] === '(') d++; if (v[i] === ')') { d--; if (d === 0 && i !== v.length - 1) { w = false; break; } } } if (!w) return v; v = v.substring(1, v.length - 1).trim(); } return v; }
  function evInt(expr) { if (!expr) return null; try { const tk = tokenize(expr.trim()); let p = 0; function pe() { let v = pt(); while (tk[p] === '+' || tk[p] === '-') { const o = tk[p++]; const r = pt(); v = o === '+' ? v + r : v - r; } return v; } function pt() { let v = pu(); while (tk[p] === '*' || tk[p] === '/' || tk[p] === '%') { const o = tk[p++]; const r = pu(); v = o === '*' ? v * r : o === '/' ? Math.trunc(v / r) : v % r; } return v; } function pu() { if (tk[p] === '-') { p++; return -pu(); } if (tk[p] === '+') { p++; return pu(); } if (tk[p] === '~') { p++; return ~pu(); } return pp(); } function pp() { if (tk[p] === '(') { p++; const v = pe(); if (tk[p] === ')') p++; return v; } const t = tk[p++]; return t.startsWith('0x') ? parseInt(t, 16) : parseInt(t); } const r = pe(); return isNaN(r) ? null : r; } catch { return null; } }
  function tokenize(e) { const t = []; let i = 0; while (i < e.length) { if (e[i] === ' ' || e[i] === '\t') { i++; continue; } if (e[i] === '0' && (e[i + 1] === 'x' || e[i + 1] === 'X')) { let j = i + 2; while (j < e.length && /[0-9a-fA-F]/.test(e[j])) j++; t.push(e.substring(i, j)); i = j; continue; } if (/[0-9]/.test(e[i])) { let j = i; while (j < e.length && /[0-9]/.test(e[j])) j++; t.push(e.substring(i, j)); i = j; continue; } if (e.startsWith('>>>', i)) { t.push('>>>'); i += 3; continue; } if (e.startsWith('>>', i)) { t.push('>>'); i += 2; continue; } if (e.startsWith('<<', i)) { t.push('<<'); i += 2; continue; } t.push(e[i]); i++; } return t; }

  function unshuffle(content, params) {
    const ps = Array.from(content.querySelectorAll('p')).filter(p => p.textContent.trim());
    if (!ps.length) return;
    const fixed = [], shuffled = [];
    for (let i = 0; i < ps.length; i++) (i < params.fixedLength ? fixed : shuffled).push(i);
    if (ps.length > params.fixedLength) { let seed = params.seed; for (let i = shuffled.length - 1; i > 0; i--) { seed = (seed * params.a + params.c) % params.mod; const j = Math.floor(seed / params.mod * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; } }
    const idx = [...fixed, ...shuffled]; const mapped = new Array(ps.length);
    for (let i = 0; i < ps.length; i++) mapped[idx[i]] = ps[i];
    let ri = 0;
    for (const ch of Array.from(content.children)) { if (ch.tagName === 'P' && ch.textContent.trim()) content.replaceChild(mapped[ri++].cloneNode(true), ch); }
  }

  function getId(url) { const m = url.match(/(?:linovelib|bilinovel)\.com\/(?:novel|download)\/(\d+)/); if (!m) throw new Error('不支持的URL'); return m[1]; }

  async function getNovel(url) {
    const id = getId(url); addLog('INFO', `获取小说: ${id}`);
    const html = await fetchPage(`${DOMAIN}/novel/${id}.html`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const novel = { id, url, title: doc.querySelector('.book-title')?.textContent || '', alias: doc.querySelector('.backupname .bkname-body.gray')?.textContent?.trim() || '', coverUrl: doc.querySelector('.book-layout img')?.getAttribute('src') || '', tags: [...doc.querySelectorAll('.book-cell .book-meta span em')].map(e => e.textContent), publisher: doc.querySelector('.tag-small.orange')?.textContent || '', author: doc.querySelector('.book-rand-a span')?.textContent || '', description: doc.querySelector('#bookSummary content')?.textContent || '', status: '' };
    const se = doc.querySelector('.book-cell .book-meta+.book-meta');
    if (se) { const n = se.childNodes; for (let i = n.length - 1; i >= 0; i--) if (n[i].textContent.trim()) { novel.status = n[i].textContent.trim(); break; } }
    addLog('INFO', `小说: ${novel.title}`);
    return novel;
  }

  async function getCatalog(id) {
    addLog('INFO', '获取目录...');
    const html = await fetchPage(`${DOMAIN}/novel/${id}/catalog`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const allLis = doc.querySelectorAll('.volume-chapters>li');
    addLog('INFO', `目录li元素: ${allLis.length}个`);
    if (allLis.length === 0) {
      addLog('WARN', `目录为空, html前500=${html.substring(0, 500)}`);
    }
    const volumes = []; let cur = null;
    for (const li of allLis) {
      if (li.classList.contains('chapter-bar')) { if (cur) volumes.push(cur); cur = { name: li.textContent.trim(), chapters: [], cover: null }; }
      else if (li.classList.contains('volume-cover')) { if (cur) { const img = li.querySelector('a img'); cur.cover = img?.getAttribute('src') || null; } }
      else if (li.classList.contains('jsChapter')) { const a = li.querySelector('a'); if (!a || !cur) continue; let href = a.getAttribute('href'); if (!href || href.includes('javascript')) { href = null; } else { href = DOMAIN + href; } cur.chapters.push({ name: a.textContent, url: href }); }
    }
    if (cur) volumes.push(cur);
    addLog('INFO', `目录: ${volumes.length}卷, ${volumes.reduce((s, v) => s + v.chapters.length, 0)}章`);
    for (const v of volumes) {
      for (let i = 0; i < Math.min(2, v.chapters.length); i++) {
        addLog('INFO', `  章节URL样本: ${v.chapters[i].name} => ${v.chapters[i].url || 'null'}`);
      }
    }
    return volumes;
  }

  async function getChapter(url) {
    if (!url) return { title: '', content: '' };
    let title = '', html = '', next = url;
    do {
      const page = await getPage(next);
      if (page.title && !page.title.includes('〇')) title = page.title;
      html += page.content;
      next = page.nextUrl;
    } while (next);
    return { title, content: html };
  }

  async function getPage(url) {
    addLog('INFO', `getPage: ${url}`);
    const raw = await fetchPage(url);
    addLog('INFO', `getPage响应: ${raw.length}字符`);
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const title = !url.includes('_') ? (doc.querySelector('#atitle')?.textContent || null) : null;
    const el = doc.querySelector('#acontent') || doc.querySelector('.bcontent');
    if (!el) { addLog('ERROR', `内容为空, URL=${url}, html前200=${raw.substring(0, 200)}`); throw new Error('内容为空'); }
    for (const sel of ['div', 'ins', 'figure', 'fig', 'br', 'script', '.tp', '.bd']) el.querySelectorAll(sel).forEach(e => e.remove());
    el.querySelectorAll('[class]').forEach(e => { if (/^[a-z]\d{4}$/.test(e.className)) e.remove(); });
    const sp = await getShuffleParams(doc);
    if (sp) unshuffle(el, sp);
    const um = raw.match(/url_previous:'(.*?)',url_next:'(.*?)'/);
    const fl = doc.querySelectorAll('#footlink a');
    let nextUrl = null, prevChapterUrl = null, nextChapterUrl = null;
    if (fl.length && um?.[1]) {
      const prevText = fl[0]?.textContent || '';
      if (prevText.includes('上一页') || prevText.includes('上一頁')) {
      } else if (um[1]) {
        prevChapterUrl = DOMAIN + um[1];
      }
    }
    if (fl.length && um?.[2]) {
      const nextText = fl[fl.length - 1].textContent || '';
      if (nextText.includes('下一页') || nextText.includes('下一頁')) {
        nextUrl = DOMAIN + um[2];
      } else if (um[2]) {
        nextChapterUrl = DOMAIN + um[2];
      }
    }
    el.querySelectorAll('img').forEach(img => {
      let src = img.dataset?.src || img.src;
      if (!src) return;
      if (src.includes('<')) { img.remove(); return; }
      if (src.startsWith('//')) src = 'https:' + src;
      img.src = src;
    });
    return { title, content: el.innerHTML, nextUrl, prevChapterUrl, nextChapterUrl };
  }

  function _getAllChapters(volumes) {
    const all = [];
    for (const v of volumes) {
      for (const ch of v.chapters) {
        all.push(ch);
      }
    }
    return all;
  }

  async function resolveChapterUrl(chapter, volumes) {
    if (chapter.url) return chapter.url;
    const all = _getAllChapters(volumes);
    const idx = all.indexOf(chapter);
    if (idx === -1) return null;

    // 1. 尝试从下一章的"上一章"链接获取
    if (idx < all.length - 1) {
      const next = all[idx + 1];
      if (next.url) {
        try {
          const page = await getPage(next.url);
          if (page.prevChapterUrl) return page.prevChapterUrl;
        } catch (e) { addLog('WARN', `推导URL失败(下一章): ${e.message}`); }
      }
    }

    // 2. 尝试从上一章翻页直到"下一章"链接
    if (idx > 0) {
      const prev = all[idx - 1];
      if (prev.url) {
        try {
          let url = prev.url;
          for (let i = 0; i < 20; i++) {
            const page = await getPage(url);
            if (!page.nextUrl) {
              if (page.nextChapterUrl) return page.nextChapterUrl;
              break;
            }
            url = page.nextUrl;
          }
        } catch (e) { addLog('WARN', `推导URL失败(上一章): ${e.message}`); }
      }
    }
    return null;
  }

  class CoverDetector {
    constructor() { this._images = {}; }
    add(name, data) {
      const dims = getImageDimensions(data);
      if (dims) this._images[name] = dims;
    }
    detectCover() {
      const entries = Object.entries(this._images);
      if (!entries.length) return null;
      for (const [name, dims] of entries) {
        if (dims.height > dims.width) return name;
      }
      return entries[0][0];
    }
  }

  function buildEpub(opts) {
    const { title, author, desc, cover, chapters, images, publisher, subjects } = opts;
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');

    const imgM = [];
    for (const [fn, data] of Object.entries(images)) {
      zip.file(`OEBPS/${fn}`, data);
      imgM.push(`<item id="${fn.replace(/[\./]/g, '_')}" href="${fn}" media-type="${mediaType('.' + fn.split('.').pop().toLowerCase())}"/>`);
    }

    let coverXml = '';
    if (cover && cover.length > 0) { zip.file('OEBPS/images/cover.jpg', cover); coverXml = '<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>'; }

    zip.file('OEBPS/styles/style.css', 'body{margin:1em;font-family:serif;line-height:1.8}.chapter-title{font-size:1.4em;font-weight:bold;margin:1em 0;text-align:center}img{max-width:100%;height:auto}p{text-indent:2em;margin:.4em 0}');

    const chM = [], chS = [], nav = [];
    chapters.forEach((ch, i) => {
      const fn = `ch${String(i + 1).padStart(4, '0')}.xhtml`;
      let c = ch.content.replace(/<(img|br|hr|input|meta|link)([^>]*)>/gi, (match, tag, attrs) => {
        if (attrs.trim().endsWith('/')) return match;
        return `<${tag}${attrs}/>`;
      });
      zip.file(`OEBPS/${fn}`, `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh"><head><meta charset="UTF-8"/><title>${esc(ch.title)}</title><link rel="stylesheet" href="styles/style.css"/></head><body><h1 class="chapter-title">${esc(ch.title)}</h1>${c}</body></html>`);
      chM.push(`<item id="ch${i + 1}" href="${fn}" media-type="application/xhtml+xml"/>`);
      chS.push(`<itemref idref="ch${i + 1}"/>`);
      nav.push({ title: ch.title, src: fn });
    });

    const uid = uuid(), now = new Date().toISOString().replace(/\.\d+Z/, 'Z');
    const publisherXml = publisher ? `<dc:publisher>${esc(publisher)}</dc:publisher>` : '';
    const subjectsXml = subjects && subjects.length ? subjects.map(s => `<dc:subject>${esc(s)}</dc:subject>`).join('') : '';
    zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="bookId" version="3.0"><metadata><dc:identifier id="bookId">${uid}</dc:identifier><dc:language>zh-CN</dc:language><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator>${desc ? `<dc:description>${esc(desc)}</dc:description>` : ''}${publisherXml}${subjectsXml}<meta property="dcterms:modified">${now}</meta></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="styles/style.css" media-type="text/css"/>${coverXml}${imgM.join('')}${chM.join('')}</manifest><spine toc="ncx">${chS.join('')}</spine></package>`);

    zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/"><head><meta content="${uid}" name="dtb:uid"/><meta content="1" name="dtb:depth"/></head><docTitle><text>${esc(title)}</text></docTitle><navMap>${nav.map((n, i) => `<navPoint id="np${i + 1}"><navLabel><text>${esc(n.title)}</text></navLabel><content src="${n.src}"/></navPoint>`).join('')}</navMap></ncx>`);

    zip.file('OEBPS/toc.xhtml', `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh"><head><meta charset="UTF-8"/><title>目录</title></head><body><nav id="toc" role="doc-toc" epub:type="toc"><h1>目录</h1><ol>${nav.map(n => `<li><a href="${n.src}">${esc(n.title)}</a></li>`).join('')}</ol></nav></body></html>`);

    return zip;
  }

  function downloadFile(blob, filename, outputDir) {
    let fullName = filename;
    if (outputDir) {
      const dir = outputDir.replace(/[\/\\]+$/, '');
      fullName = `${dir}/${filename}`;
    }
    addLog('INFO', `开始下载: ${fullName} (${(blob.size / 1024 / 1024).toFixed(1)}MB)`);
    fallbackDL(blob, filename);
  }

  function fallbackDL(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  GM_addStyle(`
    :root, .bnp-theme-light {
      --bnp-accent: #007AFF;
      --bnp-accent2: #5856D6;
      --bnp-bg: rgba(255,255,255,0.92);
      --bnp-surface: #fff;
      --bnp-text: #1d1d1f;
      --bnp-text2: #3c3c43;
      --bnp-text3: #8e8e93;
      --bnp-border: rgba(0,0,0,0.06);
      --bnp-overlay: rgba(0,0,0,0.35);
      --bnp-shadow: rgba(0,0,0,0.2);
      --bnp-log-bg: #1c1c1e;
      --bnp-log-text: #e5e5ea;
      --bnp-btn-shadow: rgba(0,122,255,0.3);
    }
    .bnp-theme-dark {
      --bnp-accent: #0A84FF;
      --bnp-accent2: #5E5CE6;
      --bnp-bg: rgba(40,40,44,0.94);
      --bnp-surface: rgba(50,50,54,0.85);
      --bnp-text: #f5f5f7;
      --bnp-text2: #d1d1d6;
      --bnp-text3: #98989d;
      --bnp-border: rgba(255,255,255,0.08);
      --bnp-overlay: rgba(0,0,0,0.65);
      --bnp-shadow: rgba(0,0,0,0.45);
      --bnp-log-bg: #0a0a0c;
      --bnp-log-text: #c7c7cc;
      --bnp-btn-shadow: rgba(10,132,255,0.35);
    }
    @media (prefers-color-scheme: dark) {
      :root:not(.bnp-theme-light):not(.bnp-theme-dark) {
        --bnp-accent: #0A84FF;
        --bnp-accent2: #5E5CE6;
        --bnp-bg: rgba(40,40,44,0.94);
        --bnp-surface: rgba(50,50,54,0.85);
        --bnp-text: #f5f5f7;
        --bnp-text2: #d1d1d6;
        --bnp-text3: #98989d;
        --bnp-border: rgba(255,255,255,0.08);
        --bnp-overlay: rgba(0,0,0,0.65);
        --bnp-shadow: rgba(0,0,0,0.45);
        --bnp-log-bg: #0a0a0c;
        --bnp-log-text: #c7c7cc;
        --bnp-btn-shadow: rgba(10,132,255,0.35);
      }
    }
    * { box-sizing: border-box; }

    /* ---- 主按钮 ---- */
    #bnp-btn {
      position: fixed; bottom: 80px; right: 20px; z-index: 99999;
      width: 56px; height: 56px; border-radius: 18px;
      background: linear-gradient(135deg, var(--bnp-accent), var(--bnp-accent2));
      border: none;
      box-shadow: 0 4px 16px var(--bnp-btn-shadow), 0 0 0 0.5px rgba(255,255,255,0.1);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700; letter-spacing: 0.5px;
      color: #fff; cursor: pointer;
      touch-action: none; user-select: none;
      transition: transform 0.2s cubic-bezier(.4,0,.2,1), box-shadow 0.2s;
      animation: bnp-btn-breath 3s ease-in-out infinite;
    }
    #bnp-btn::after {
      content: ''; position: absolute; inset: -4px; border-radius: 22px;
      background: linear-gradient(135deg, var(--bnp-accent), var(--bnp-accent2));
      opacity: 0.2; filter: blur(8px); z-index: -1;
      animation: bnp-btn-glow 3s ease-in-out infinite;
    }
    @keyframes bnp-btn-breath { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }
    @keyframes bnp-btn-glow { 0%,100% { opacity: 0.15; } 50% { opacity: 0.35; } }
    #bnp-btn:hover { transform: scale(1.08); box-shadow: 0 6px 24px var(--bnp-btn-shadow); animation: none; }
    #bnp-btn:active { transform: scale(0.92); box-shadow: 0 2px 8px var(--bnp-btn-shadow); animation: none; }

    /* ---- 遮罩 ---- */
    #bnp-overlay {
      position: fixed; inset: 0; z-index: 100000;
      background: var(--bnp-overlay);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      display: none; opacity: 0; transition: opacity 0.3s ease;
    }
    #bnp-overlay.show { opacity: 1; }

    /* ---- 主面板 ---- */
    #bnp-panel {
      position: fixed; z-index: 100001;
      top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.92);
      width: min(500px, 90vw); max-height: min(85vh, 680px);
      background: var(--bnp-bg);
      backdrop-filter: blur(50px) saturate(180%); -webkit-backdrop-filter: blur(50px) saturate(180%);
      border-radius: 24px; border: 0.5px solid var(--bnp-border);
      box-shadow: 0 32px 80px var(--bnp-shadow), 0 0 0 0.5px rgba(0,0,0,0.05);
      display: none; flex-direction: column; overflow: hidden;
      font-family: -apple-system, "SF Pro Display", "SF Pro Text", BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      opacity: 0; transition: opacity 0.3s cubic-bezier(.4,0,.2,1), transform 0.35s cubic-bezier(.34,1.56,.64,1);
    }
    #bnp-panel.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }

    /* ---- 头部 ---- */
    .bnp-hdr {
      padding: 18px 22px 14px; display: flex; justify-content: space-between; align-items: center;
      border-bottom: 0.5px solid var(--bnp-border); flex-shrink: 0;
      background: linear-gradient(135deg, rgba(0,122,255,0.03), rgba(88,86,214,0.03));
    }
    .bnp-hdr h3 {
      margin: 0; font-size: 17px; font-weight: 600; color: var(--bnp-text); letter-spacing: -0.3px;
      display: flex; align-items: center; gap: 8px;
    }
    .bnp-hdr h3::before {
      content: '📖'; font-size: 16px;
    }
    .bnp-hdr button {
      background: var(--bnp-border); border: none; color: var(--bnp-text3);
      width: 30px; height: 30px; border-radius: 15px; font-size: 18px; font-weight: 300;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: background 0.2s, transform 0.15s; line-height: 1;
    }
    .bnp-hdr button:hover { background: rgba(0,0,0,0.1); transform: rotate(90deg); }

    /* ---- 内容区 ---- */
    .bnp-body { flex: 1; overflow-y: auto; padding: 18px 22px; -webkit-overflow-scrolling: touch; }

    /* ---- 小说信息 ---- */
    .bnp-info { display: flex; gap: 16px; margin-bottom: 16px; }
    .bnp-cover {
      width: 84px; height: 118px; object-fit: cover; border-radius: 12px; flex-shrink: 0;
      background: var(--bnp-border); box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      transition: transform 0.2s;
    }
    .bnp-cover:hover { transform: scale(1.03); }
    .bnp-meta h4 { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: var(--bnp-text); line-height: 1.3; }
    .bnp-meta p { margin: 3px 0; font-size: 12px; color: var(--bnp-text3); line-height: 1.4; }
    .bnp-tag {
      display: inline-block;
      background: linear-gradient(135deg, rgba(0,122,255,0.08), rgba(88,86,214,0.08));
      color: var(--bnp-accent); padding: 3px 10px; border-radius: 8px;
      font-size: 11px; font-weight: 500; margin: 2px 4px 0 0;
      transition: background 0.2s, transform 0.15s;
    }
    .bnp-tag:hover { transform: translateY(-1px); }

    /* ---- 分卷列表 ---- */
    .bnp-vol-expand, .bnp-vol-select-all {
      font-size: 12px; color: var(--bnp-accent); cursor: pointer; font-weight: 500;
      user-select: none; margin-bottom: 8px; display: inline-block; transition: opacity 0.15s;
    }
    .bnp-vol-select-all:hover { opacity: 0.7; }
    .bnp-vol {
      border: 0.5px solid var(--bnp-border); border-radius: 14px; margin-bottom: 8px;
      overflow: hidden; background: var(--bnp-surface);
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .bnp-vol:hover { border-color: rgba(0,122,255,0.15); box-shadow: 0 2px 8px rgba(0,122,255,0.06); }
    .bnp-vol-hdr {
      display: flex; align-items: center; padding: 13px 16px;
      cursor: pointer; touch-action: manipulation; transition: background 0.15s;
    }
    .bnp-vol-hdr:active { background: rgba(0,122,255,0.04); }
    .bnp-vol-hdr input {
      margin-right: 12px; width: 20px; height: 20px; accent-color: var(--bnp-accent);
      cursor: pointer; flex-shrink: 0;
    }
    .bnp-vol-hdr .vn { flex: 1; font-size: 14px; font-weight: 500; color: var(--bnp-text); }
    .bnp-vol-hdr .vc {
      font-size: 12px; color: var(--bnp-text3); background: var(--bnp-border);
      padding: 2px 10px; border-radius: 10px; font-weight: 500; flex-shrink: 0;
    }

    /* ---- 选项区 ---- */
    .bnp-opt {
      padding: 14px 0; border-top: 0.5px solid var(--bnp-border); margin-top: 12px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .bnp-opt-row { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--bnp-text2); }
    .bnp-opt-row input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--bnp-accent); cursor: pointer; }
    .bnp-opt-row input[type=text] {
      flex: 1; border: 0.5px solid var(--bnp-border); border-radius: 12px;
      padding: 9px 14px; font-size: 13px; background: var(--bnp-surface);
      outline: none; transition: border-color 0.2s, box-shadow 0.2s; color: var(--bnp-text);
    }
    .bnp-opt-row input[type=text]:focus { border-color: var(--bnp-accent); box-shadow: 0 0 0 3px rgba(0,122,255,0.12); }
    .bnp-opt-row .bnp-path-hint { font-size: 11px; color: var(--bnp-text3); }

    /* ---- 主题切换 ---- */
    .bnp-theme-row { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--bnp-text2); padding-top: 2px; }
    .bnp-theme-row .bnp-theme-label { white-space: nowrap; }
    .bnp-theme-choices { display: flex; background: var(--bnp-surface); border: 0.5px solid var(--bnp-border); border-radius: 10px; overflow: hidden; }
    .bnp-theme-choices .bnp-theme-opt {
      padding: 6px 14px; font-size: 12px; cursor: pointer; border: none; background: transparent;
      color: var(--bnp-text3); font-weight: 500; transition: all 0.2s; position: relative;
    }
    .bnp-theme-choices .bnp-theme-opt.active { background: var(--bnp-accent); color: #fff; }

    /* ---- 进度 ---- */
    .bnp-progress { margin-top: 14px; display: none; }
    .bnp-bar {
      width: 100%; height: 6px; background: var(--bnp-border); border-radius: 3px; overflow: hidden;
      position: relative;
    }
    .bnp-bar-fill {
      height: 100%; border-radius: 3px; width: 0;
      background: linear-gradient(90deg, var(--bnp-accent), var(--bnp-accent2), #5AC8FA, var(--bnp-accent));
      background-size: 200% 100%;
      animation: bnp-shimmer 2s linear infinite;
      transition: width 0.4s cubic-bezier(.4,0,.2,1);
    }
    @keyframes bnp-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .bnp-ptext {
      font-size: 12px; color: var(--bnp-text3); margin-top: 10px; text-align: center;
      line-height: 1.4;
    }
    .bnp-peta {
      font-size: 11px; color: var(--bnp-text3); text-align: center; margin-top: 4px;
      opacity: 0.7;
    }

    /* ---- 日志 ---- */
    .bnp-log-wrap { margin-top: 14px; }
    .bnp-log-tbar {
      display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
    }
    .bnp-log-toggle {
      font-size: 12px; color: var(--bnp-accent); cursor: pointer; font-weight: 500;
      user-select: none; transition: opacity 0.15s;
    }
    .bnp-log-toggle:hover { opacity: 0.7; }
    .bnp-log-cnt {
      font-size: 10px; color: var(--bnp-text3); background: var(--bnp-border);
      padding: 1px 7px; border-radius: 10px; line-height: 1.6;
    }
    .bnp-log-tools { margin-left: auto; display: flex; gap: 4px; }
    .bnp-log-tool {
      background: none; border: 0.5px solid var(--bnp-border); border-radius: 6px;
      padding: 2px 8px; font-size: 11px; color: var(--bnp-text3); cursor: pointer;
      transition: background 0.15s; line-height: 1.5;
    }
    .bnp-log-tool:hover { background: var(--bnp-border); }
    .bnp-log {
      background: var(--bnp-log-bg); color: var(--bnp-log-text);
      font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 11px;
      padding: 10px 12px; border-radius: 12px; max-height: 300px;
      overflow-y: auto; line-height: 1.6;
      margin-top: 6px; display: none;
    }
    .bnp-log:empty { display: none; }
    .bnp-l { padding: 1px 0; display: flex; align-items: flex-start; gap: 6px; }
    .bnp-l s { color: #8e8e93; flex-shrink: 0; min-width: 64px; text-decoration: none; }
    .bnp-l b {
      flex-shrink: 0; min-width: 40px; font-weight: 600; text-align: center;
      padding: 0 4px; border-radius: 3px;
    }
    .bnp-l span { word-break: break-all; }
    .bnp-l.e b { color: #FF3B30; }
    .bnp-l.e s { color: #FF3B30; opacity: 0.6; }
    .bnp-l.w b { color: #FF9500; }
    .bnp-l.w s { color: #FF9500; opacity: 0.6; }
    .bnp-l.i b { color: #0A84FF; }
    .bnp-l.s { justify-content: center; opacity: 0.4; font-style: italic; }

    /* ---- 底部操作栏 ---- */
    .bnp-ftr {
      padding: 14px 22px 18px; border-top: 0.5px solid var(--bnp-border);
      display: flex; justify-content: flex-end; gap: 10px; flex-shrink: 0;
    }
    .bnp-ftr button {
      border: none; border-radius: 14px; padding: 11px 24px;
      font-size: 15px; font-weight: 500; cursor: pointer;
      transition: background 0.2s, transform 0.12s, box-shadow 0.2s;
    }
    .bnp-ftr button:active { transform: scale(0.96); }
    .bnp-btn-cancel {
      background: var(--bnp-border); color: var(--bnp-text2);
    }
    .bnp-btn-cancel:hover { background: rgba(0,0,0,0.08); }
    .bnp-btn-go {
      background: linear-gradient(135deg, var(--bnp-accent), var(--bnp-accent2));
      color: #fff; box-shadow: 0 4px 16px var(--bnp-btn-shadow);
    }
    .bnp-btn-go:hover { box-shadow: 0 6px 20px var(--bnp-btn-shadow); }
    .bnp-btn-go:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }

    /* ---- 迷你进度指示器 ---- */
    #bnp-mini {
      position: fixed; bottom: 80px; right: 20px; z-index: 100001;
      background: var(--bnp-bg);
      backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%);
      border: 0.5px solid var(--bnp-border); border-radius: 22px;
      padding: 12px 18px; display: none; align-items: center; gap: 12px;
      box-shadow: 0 8px 32px var(--bnp-shadow); cursor: pointer;
      touch-action: none; user-select: none; max-width: 280px;
      animation: bnp-mini-in 0.3s cubic-bezier(.34,1.56,.64,1);
    }
    @keyframes bnp-mini-in { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    .bnp-mini-ring {
      width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
      position: relative;
    }
    .bnp-mini-ring svg { transform: rotate(-90deg); }
    .bnp-mini-ring .bg { fill: none; stroke: var(--bnp-border); stroke-width: 3; }
    .bnp-mini-ring .fg {
      fill: none; stroke: url(#bnp-grad); stroke-width: 3; stroke-linecap: round;
      stroke-dasharray: 75.4; stroke-dashoffset: 75.4; transition: stroke-dashoffset 0.5s;
    }
    .bnp-mini-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--bnp-accent); flex-shrink: 0;
      animation: bnp-pulse 1.2s ease-in-out infinite;
      display: none;
    }
    @keyframes bnp-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.7); } }
    .bnp-mini-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .bnp-mini-text {
      font-size: 13px; color: var(--bnp-text); font-weight: 500;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .bnp-mini-sub {
      font-size: 11px; color: var(--bnp-text3);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    /* ---- 加载骨架 ---- */
    .bnp-skeleton {
      padding: 20px; text-align: center; color: var(--bnp-text3); font-size: 13px;
    }
    .bnp-skeleton .spinner {
      display: inline-block; width: 20px; height: 20px; border: 2.5px solid var(--bnp-border);
      border-top-color: var(--bnp-accent); border-radius: 50%; margin-bottom: 10px;
      animation: bnp-spin 0.7s linear infinite;
    }
    @keyframes bnp-spin { to { transform: rotate(360deg); } }
  `);

  function makeDraggable(el) {
    let dragging = false, moved = false, sx, sy, ox, oy;
    function onStart(e) { dragging = true; moved = false; const t = e.touches ? e.touches[0] : e; sx = t.clientX; sy = t.clientY; const r = el.getBoundingClientRect(); ox = r.left; oy = r.top; }
    function onMove(e) { if (!dragging) return; const t = e.touches ? e.touches[0] : e; const dx = t.clientX - sx, dy = t.clientY - sy; if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true; el.style.left = (ox + dx) + 'px'; el.style.top = (oy + dy) + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; e.preventDefault(); }
    function onEnd() { dragging = false; }
    el.addEventListener('mousedown', onStart); el.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('mousemove', onMove); document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onEnd); document.addEventListener('touchend', onEnd);
    return () => moved;
  }

  function injectUI() {
    const svgDefs = document.createElementNS ? null : null;
    if (!document.getElementById('bnp-svg-defs')) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'bnp-svg-defs'; svg.style.cssText = 'position:fixed;width:0;height:0';
      svg.innerHTML = '<defs><linearGradient id="bnp-grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#007AFF"/><stop offset="100%" stop-color="#5856D6"/></linearGradient></defs>';
      document.body.appendChild(svg);
    }

    const btn = document.createElement('button'); btn.id = 'bnp-btn'; btn.textContent = 'EPUB'; document.body.appendChild(btn);
    const btnMoved = makeDraggable(btn);
    btn.addEventListener('click', () => { if (btnMoved()) return; showPanel(); });

    const overlay = document.createElement('div'); overlay.id = 'bnp-overlay'; document.body.appendChild(overlay);
    overlay.addEventListener('click', () => { if (isDownloading) minimizePanel(); else hidePanel(); });

    const panel = document.createElement('div'); panel.id = 'bnp-panel';
    panel.innerHTML = `<div class="bnp-hdr"><h3>轻小说打包下载</h3><button id="bnp-close">&times;</button></div><div class="bnp-body"><div id="bnp-info-area"><div class="bnp-skeleton"><div class="spinner"></div><div>正在加载小说信息...</div></div></div><div id="bnp-vol-area" style="display:none"></div><div class="bnp-opt"><div class="bnp-opt-row"><span style="white-space:nowrap">输出目录:</span><input type="text" id="bnp-outdir" placeholder="留空使用默认下载目录"><span class="bnp-path-hint">留空则保存到浏览器默认目录</span></div><div class="bnp-theme-row"><span class="bnp-theme-label">🎨 主题</span><span class="bnp-theme-choices"><button class="bnp-theme-opt" data-theme="light">☀️ 浅色</button><button class="bnp-theme-opt active" data-theme="auto">📱 跟随</button><button class="bnp-theme-opt" data-theme="dark">🌙 深色</button></span></div></div><div class="bnp-progress" id="bnp-progress"><div class="bnp-bar"><div class="bnp-bar-fill" id="bnp-fill"></div></div><div class="bnp-ptext" id="bnp-ptext"></div><div class="bnp-peta" id="bnp-peta"></div></div><div class="bnp-log-wrap"><div class="bnp-log-tbar"><span class="bnp-log-toggle" id="bnp-log-toggle">查看日志</span><span class="bnp-log-cnt" id="bnp-log-cnt">0</span><div class="bnp-log-tools"><button class="bnp-log-tool" id="bnp-log-cpy" title="复制日志">📋</button><button class="bnp-log-tool" id="bnp-log-clr" title="清除日志">🗑</button></div></div><div class="bnp-log" id="bnp-log"></div></div></div><div class="bnp-ftr"><button class="bnp-btn-cancel" id="bnp-cancel">取消</button><button class="bnp-btn-go" id="bnp-go">开始下载</button></div>`;
    document.body.appendChild(panel);

    const mini = document.createElement('div'); mini.id = 'bnp-mini';
    mini.innerHTML = '<div class="bnp-mini-ring"><svg width="28" height="28" viewBox="0 0 28 28"><circle class="bg" cx="14" cy="14" r="12"/><circle class="fg" id="bnp-mini-ring-fg" cx="14" cy="14" r="12"/></svg></div><div class="bnp-mini-body"><div class="bnp-mini-text" id="bnp-mini-text">下载中...</div><div class="bnp-mini-sub" id="bnp-mini-sub"></div></div>';
    document.body.appendChild(mini);
    const miniMoved = makeDraggable(mini);
    mini.addEventListener('click', () => { if (miniMoved()) return; showPanel(); });

    document.getElementById('bnp-close').onclick = () => isDownloading ? minimizePanel() : hidePanel();
    document.getElementById('bnp-cancel').onclick = () => isDownloading ? minimizePanel() : hidePanel();
    document.getElementById('bnp-go').onclick = startDownload;
    document.getElementById('bnp-log-toggle').onclick = () => {
      const log = document.getElementById('bnp-log'), tog = document.getElementById('bnp-log-toggle');
      if (log.style.display === 'none' || !log.style.display) { log.style.display = 'block'; tog.textContent = '收起日志'; loadLogs(); } else { log.style.display = 'none'; tog.textContent = '查看日志'; }
    };
    document.getElementById('bnp-log-cpy').onclick = copyLog;
    document.getElementById('bnp-log-clr').onclick = clearLog;

    const savedTheme = localStorage.getItem('bnp_theme') || 'auto';
    applyTheme(savedTheme);
    const themeOpts = document.querySelectorAll('.bnp-theme-opt');
    themeOpts.forEach(opt => opt.classList.toggle('active', opt.dataset.theme === savedTheme));
    themeOpts.forEach(opt => {
      opt.addEventListener('click', () => {
        const theme = opt.dataset.theme;
        themeOpts.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        localStorage.setItem('bnp_theme', theme);
        applyTheme(theme);
      });
    });
  }

  function applyTheme(theme) {
    const html = document.documentElement;
    html.classList.remove('bnp-theme-light', 'bnp-theme-dark');
    if (theme === 'light') html.classList.add('bnp-theme-light');
    else if (theme === 'dark') html.classList.add('bnp-theme-dark');
  }

  function showPanel() {
    const o = document.getElementById('bnp-overlay'), p = document.getElementById('bnp-panel'), b = document.getElementById('bnp-btn'), m = document.getElementById('bnp-mini');
    o.style.display = 'block'; p.style.display = 'flex'; b.style.display = 'none'; m.style.display = 'none';
    requestAnimationFrame(() => { o.classList.add('show'); p.classList.add('show'); });
    if (!window._bnpLoaded) { window._bnpLoaded = true; loadNovel(); }
    loadLogs();
  }

  function hidePanel() {
    const o = document.getElementById('bnp-overlay'), p = document.getElementById('bnp-panel');
    o.classList.remove('show'); p.classList.remove('show');
    setTimeout(() => { o.style.display = 'none'; p.style.display = 'none'; }, 250);
    if (!isDownloading) document.getElementById('bnp-btn').style.display = 'flex';
  }

  function minimizePanel() {
    const o = document.getElementById('bnp-overlay'), p = document.getElementById('bnp-panel');
    o.classList.remove('show'); p.classList.remove('show');
    setTimeout(() => { o.style.display = 'none'; p.style.display = 'none'; }, 250);
    document.getElementById('bnp-btn').style.display = 'none';
    document.getElementById('bnp-mini').style.display = 'flex';
  }

  let isDownloading = false;
  let _catalogExpanded = false;

  function isChapterPage() {
    // 章节页: /novel/{id}/{ch}.html 或 /novel/{id}/{ch}_{page}.html
    return /\/novel\/\d+\/\d+/.test(location.pathname);
  }

  function findCurrentVolume(vols) {
    const path = location.pathname;
    for (const vol of vols) {
      for (const ch of vol.chapters) {
        if (ch.url && path === new URL(ch.url).pathname) return vol;
      }
    }
    return null;
  }

  async function getCachedCatalog(id) {
    const key = 'bnp_cat_' + id;
    try {
      const cached = sessionStorage.getItem(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.length > 0) {
          addLog('INFO', `目录缓存命中: ${parsed.length}卷`);
          return parsed;
        }
      }
    } catch {}
    const vols = await getCatalog(id);
    try { sessionStorage.setItem(key, JSON.stringify(vols)); } catch {}
    return vols;
  }

  async function loadNovel() {
    const area = document.getElementById('bnp-info-area');
    try {
      const novel = await getNovel(location.href);
      window._bnpNovel = novel;
      area.innerHTML = `<div class="bnp-info"><img class="bnp-cover" src="${novel.coverUrl}" onerror="this.style.display='none'"><div class="bnp-meta"><h4>${escH(novel.title)}</h4>${novel.alias ? `<p>${escH(novel.alias)}</p>` : ''}<p>${escH(novel.author)} · ${escH(novel.status)}</p>${novel.tags?.length ? `<div>${novel.tags.map(t => `<span class="bnp-tag">${escH(t)}</span>`).join('')}</div>` : ''}</div></div>`;
      const vols = await getCachedCatalog(novel.id);
      window._bnpVols = vols;
      const totalCh = vols.reduce((s, v) => s + v.chapters.length, 0);

      // 判断是否在章节页，尝试定位当前卷
      const chPage = isChapterPage();
      const currentVol = chPage ? findCurrentVolume(vols) : null;
      const volHtml = vols.map((v, i) => {
        const label = escH(v.name || novel.title);
        const checked = currentVol ? (v === currentVol ? 'checked' : '') : 'checked';
        const hidden = currentVol && v !== currentVol && !_catalogExpanded ? ' style="display:none"' : '';
        return `<div class="bnp-vol" data-vol="${i}"${hidden}><label class="bnp-vol-hdr"><input type="checkbox" class="bnp-vc" data-i="${i}" ${checked}><span class="vn">${label}</span></label></div>`;
      }).join('');

      let extraHtml = '';
      if (currentVol) {
        const others = vols.length - 1;
        if (!_catalogExpanded) {
          extraHtml = `<span class="bnp-vol-expand" id="bnp-vol-expand">📂 展开全部 ${vols.length} 卷</span>`;
        }
      }

      document.getElementById('bnp-vol-area').innerHTML = `<span class="bnp-vol-select-all" id="bnp-select-all">☑ 全选/取消</span>${extraHtml}` + volHtml;
      document.getElementById('bnp-vol-area').style.display = 'block';

      document.getElementById('bnp-select-all')?.addEventListener('click', () => {
        const cbs = document.querySelectorAll('.bnp-vc');
        const allChecked = [...cbs].every(cb => cb.checked);
        cbs.forEach(cb => cb.checked = !allChecked);
      });

      const expandBtn = document.getElementById('bnp-vol-expand');
      if (expandBtn) {
        expandBtn.addEventListener('click', () => {
          _catalogExpanded = true;
          document.querySelectorAll('.bnp-vol[data-vol]').forEach(el => el.style.display = '');
          expandBtn.style.display = 'none';
        });
      }
    } catch (e) { area.innerHTML = `<div style="color:#FF3B30;font-size:14px;padding:20px;text-align:center;">❌ 加载失败: ${escH(e.message)}</div>`; addLog('ERROR', `加载失败: ${e.message}`); }
  }

  async function startDownload() {
    const btn = document.getElementById('bnp-go');
    btn.disabled = true; isDownloading = true;
    const prog = document.getElementById('bnp-progress'), fill = document.getElementById('bnp-fill'), ptext = document.getElementById('bnp-ptext'), peta = document.getElementById('bnp-peta');
    const ringFg = document.getElementById('bnp-mini-ring-fg');
    prog.style.display = 'block';
    document.getElementById('bnp-log').style.display = 'block';
    document.getElementById('bnp-log-toggle').textContent = '收起日志';

    try {
      const novel = window._bnpNovel, vols = window._bnpVols;
      const outputDir = document.getElementById('bnp-outdir').value.trim();
      const checked = [...document.querySelectorAll('.bnp-vc:checked')].map(c => vols[+c.dataset.i]);
      if (!checked.length) { alert('请至少选择一卷'); btn.disabled = false; isDownloading = false; return; }

      addLog('SESSION', `─── 📥 ${novel.title} ───`);
      addLog('INFO', `下载${checked.length}卷, 目录=${outputDir || '默认'}`);
      minimizePanel();
      ptext.textContent = '获取解密密钥...';
      document.getElementById('bnp-mini-text').textContent = '获取密钥...';
      await getSecretMap();

      const total = checked.reduce((s, v) => s + v.chapters.length, 0);
      let done = 0, startTime = Date.now(), imgIdx = 0;

      for (const vol of checked) {
        const volName = vol.name || novel.title;
        addLog('INFO', `卷: ${volName} (${vol.chapters.length}章)`);
        const volChapters = [], allImages = {};

        for (const ch of vol.chapters) {
          done++;
          const pct = (done / total * 100).toFixed(1);
          fill.style.width = (done / total * 80).toFixed(1) + '%';
          if (ringFg) {
            const circumference = 75.4; // 2 * PI * 12
            ringFg.style.strokeDashoffset = (circumference * (1 - done / total)).toString();
          }
          const elapsed = (Date.now() - startTime) / 1000;
          const eta = done > 1 ? formatTime((elapsed / done) * (total - done)) : '估算中...';
          ptext.textContent = `${done}/${total} ${ch.name}`;
          peta.textContent = `进度 ${pct}% · 预计剩余 ${eta}`;
          document.getElementById('bnp-mini-text').textContent = `${done}/${total}`;
          document.getElementById('bnp-mini-sub').textContent = ch.name;
          addLog('INFO', `获取章节 ${done}/${total}: ${ch.name} URL=${ch.url || 'null'}`);

          if (!ch.url) {
            ch.url = await resolveChapterUrl(ch, vols);
            if (ch.url) addLog('INFO', `  URL已推导: ${ch.url}`);
          }

          if (!ch.url) { addLog('WARN', `跳过: ${ch.name} (无URL)`); volChapters.push({ title: ch.name, content: '<p>（无链接）</p>' }); continue; }

          try {
            // 带120秒超时的章节获取
            const { title, content } = await Promise.race([
              getChapter(ch.url),
              new Promise((_, rej) => setTimeout(() => rej(new Error('章节获取超时(120s)')), 120000))
            ]);
            const container = document.createElement('div');
            container.innerHTML = content;
            const imgs = container.querySelectorAll('img');
            if (imgs.length > 0) addLog('INFO', `  章节${done}有${imgs.length}张图片，开始下载...`);
            for (const img of imgs) {
              let src = img.src;
              if (!src) continue;
              try {
                addLog('INFO', `  图片URL: ${src.substring(0, 100)}`);
                const data = await _imageScheduler.run(() => fetchImageWithRetry(src));
                if (data?.length > 0) { const ext = detectExt(data); const fn = `images/${String(++imgIdx).padStart(6, '0')}${ext}`; allImages[fn] = data; img.src = fn; addLog('INFO', `  图片${imgIdx}: ${(data.length/1024).toFixed(0)}KB`); }
              } catch (e) { addLog('WARN', `图片失败(${src.substring(0,60)}): ${e.message}`); }
            }
            volChapters.push({ title: title || ch.name, content: container.innerHTML });
          } catch (e) { addLog('ERROR', `章节失败: ${ch.name} - ${e.message}`); volChapters.push({ title: ch.name, content: `<p style="color:#FF3B30">获取失败</p>` }); }
        }

          fill.style.width = '90%'; ptext.textContent = `📦 打包: ${volName}`; peta.textContent = '正在生成 EPUB...'; document.getElementById('bnp-mini-text').textContent = `打包中`; document.getElementById('bnp-mini-sub').textContent = volName; if (ringFg) ringFg.style.strokeDashoffset = '7.5';
          const coverUrl = (vol.cover && !vol.cover.includes('no.svg')) ? vol.cover : null;
          let cover = new Uint8Array(0);
          if (coverUrl) {
            try { cover = await fetchImage(coverUrl); addLog('INFO', `封面下载: ${(cover.length/1024).toFixed(0)}KB`); } catch(e) { addLog('WARN', `封面下载失败: ${e.message}`); }
          } else {
            addLog('INFO', '卷封面是占位符，用 CoverDetector 自动选封面...');
            const detector = new CoverDetector();
            for (const [fn, data] of Object.entries(allImages)) {
              if (data.length >= 1000) detector.add(fn, data);
            }
            const coverName = detector.detectCover();
            if (coverName) {
              cover = allImages[coverName];
              const dims = getImageDimensions(cover);
              addLog('INFO', `封面自动选择: ${coverName}${dims ? ` (${dims.width}x${dims.height})` : ''}`);
            }
          }
          addLog('INFO', `打包: ${volChapters.length}章, 图片${Object.keys(allImages).length}张, 封面${cover.length > 0 ? '有' : '无'}`);
          const zip = buildEpub({ title: `${novel.title} ${volName}`, author: novel.author, desc: novel.description, publisher: novel.publisher, subjects: novel.tags, cover: cover?.length > 0 ? cover : null, chapters: volChapters, images: allImages });
          addLog('INFO', `JSZip文件数: ${Object.keys(zip.files).length}，打包中...`);
          try {
            const data = await zip.generateAsync({
              type: 'uint8array',
              streamFiles: false,
              compression: 'DEFLATE',
            }, (meta) => {
              if (meta.percent && meta.percent % 25 === 0) {
                addLog('INFO', `JSZip进度: ${meta.percent.toFixed(0)}%`);
              }
            });
            addLog('INFO', `打包完成: ${(data.length/1024/1024).toFixed(1)}MB`);
            const epubName = volName.includes(novel.title) ? sanitize(volName) : sanitize(`${novel.title} ${volName}`);
            downloadFile(new Blob([data], { type: 'application/epub+zip' }), epubName + '.epub', outputDir || '');
            addLog('INFO', '下载已触发');
          } catch(e) { addLog('ERROR', `generate失败: ${e.message} ${e.stack}`); }
        }
      }

      fill.style.width = '100%'; ptext.textContent = '✅ 全部完成!'; peta.textContent = ''; document.getElementById('bnp-mini-text').textContent = '✅ 完成'; document.getElementById('bnp-mini-sub').textContent = ''; if (ringFg) ringFg.style.strokeDashoffset = '0';
      addLog('INFO', '全部完成');
      setTimeout(() => { prog.style.display = 'none'; document.getElementById('bnp-mini').style.display = 'none'; document.getElementById('bnp-btn').style.display = 'flex'; showPanel(); }, 2000);
    } catch (e) {
      addLog('ERROR', `失败: ${e.message}`);
      ptext.textContent = `❌ 失败: ${e.message}`; peta.textContent = ''; document.getElementById('bnp-mini-text').textContent = '❌ 失败'; document.getElementById('bnp-mini-sub').textContent = e.message;
      document.getElementById('bnp-mini').style.display = 'none'; document.getElementById('bnp-btn').style.display = 'flex'; showPanel();
    } finally { btn.disabled = false; isDownloading = false; }
  }

  const API = { getNovel, getCatalog, getChapter, getSecretMap, buildEpub, fetchPage, fetchImage, DOMAIN, resolveChapterUrl, CoverDetector, RequestScheduler };

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (document.readyState === 'complete') injectUI();
    else window.addEventListener('load', injectUI);
  }
  return API;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BNP;
}
