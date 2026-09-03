// ==UserScript==
// @name         哔哩轻小说打包下载器
// @namespace    https://github.com/202310011168/bili-novel-downloader
// @version      4.1.8
// @updateURL    https://raw.githubusercontent.com/202310011168/bili-novel-downloader/master/bili-novel-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/202310011168/bili-novel-downloader/master/bili-novel-downloader.user.js
// @description  将哔哩轻小说(linovelib.com/bilinovel.com/bilinovel.net)打包为EPUB电子书。支持分卷选择下载、插图、封面识别、反爬调度、段落还原。苹果风格UI。
// @author       bili_novel_packer
// @match        *://m.bilinovel.com/novel/*
// @match        *://bilinovel.com/novel/*
// @match        *://www.bilinovel.com/novel/*
// @match        *://bilinovel.net/novel/*
// @match        *://www.bilinovel.net/novel/*
// @match        *://m.bilinovel.net/novel/*
// @match        *://linovelib.com/novel/*
// @match        *://www.linovelib.com/novel/*
// @match        *://m.linovelib.com/novel/*
// @require      https://unpkg.com/jszip@3.2.0/dist/jszip.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      m.bilinovel.com
// @connect      bilinovel.com
// @connect      www.bilinovel.com
// @connect      m.bilinovel.net
// @connect      bilinovel.net
// @connect      www.bilinovel.net
// @connect      linovelib.com
// @connect      www.linovelib.com
// @connect      m.linovelib.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

const BNP = (function () {
  'use strict';

  // 网站已迁移：linovelib.com -> m.bilinovel.com -> www.bilinovel.net
  // 使用当前主域名，避免请求被重定向导致失败
  const DOMAIN = 'https://www.bilinovel.net';
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
  const _imageScheduler = new RequestScheduler(10, 60000); // 与项目 RateLimitInterceptor(10, 1分钟) 对齐

  const logs = [];
  const LOG_KEY = 'bnp_log_store';
  const MAX_LOG = 3000;
  const MAX_DOM_LOG = 300; // DOM中最多保留300条，其余的只有内存+localStorage
  let _logEl = null, _badgeEl = null, _logDirty = false, _logFlushing = false;
  const _logQueue = [];

  function _ensureLogRefs() {
    if (!_logEl) _logEl = document.getElementById('bnp-log');
    if (!_badgeEl) _badgeEl = document.getElementById('bnp-log-cnt');
  }

  function _isLogVisible() {
    _ensureLogRefs();
    return _logEl && _logEl.style.display !== 'none' && getComputedStyle(_logEl).display !== 'none';
  }

  function _flushLogQueue() {
    _logFlushing = false;
    if (!_logQueue.length) return;
    _ensureLogRefs();
    if (!_logEl) return;
    // 日志面板隐藏时暂不追加DOM，等打开时再渲染
    if (!_isLogVisible()) return;
    const frag = document.createDocumentFragment();
    let batch;
    while ((batch = _logQueue.splice(0, 50)).length) {
      for (const e of batch) {
        const div = document.createElement('div');
        div.className = 'bnp-l';
        if (e.l === 'ERROR') div.classList.add('e');
        else if (e.l === 'WARN') div.classList.add('w');
        else if (e.l === 'SESSION') div.classList.add('s');
        div.innerHTML = e.l === 'SESSION'
          ? `<span>${escH(e.m)}</span>`
          : `<s>${e.t}</s><b>${e.l}</b><span>${escH(e.m)}</span>`;
        frag.appendChild(div);
      }
    }
    _logEl.appendChild(frag);
    // 裁剪DOM节点，防止过多
    while (_logEl.children.length > MAX_DOM_LOG) {
      _logEl.children[0].remove();
    }
    _logEl.scrollTop = _logEl.scrollHeight;
  }

  function _flushLogQueueImmediate() {
    if (_logQueue.length) {
      _logFlushing = true;
      _flushLogQueue();
    }
  }

  function _scheduleLogFlush() {
    if (_logFlushing) return;
    _logFlushing = true;
    requestAnimationFrame(_flushLogQueue);
  }

  function addLog(level, msg) {
    const now = new Date();
    const entry = { t: now.toLocaleTimeString(), ts: now.getTime(), l: level, m: msg };
    logs.push(entry);
    _logQueue.push(entry);
    _scheduleLogFlush();

    _ensureLogRefs();
    if (_badgeEl) _badgeEl.textContent = logs.length;

    if (!_logDirty) {
      _logDirty = true;
      setTimeout(() => {
        try { localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(-MAX_LOG))); } catch {}
        _logDirty = false;
      }, 2000);
    }

    // 控制台输出: ERROR/WARN始终显示, INFO节流显示
    if (level !== 'SESSION' && (level !== 'INFO' || logs.length <= 30)) {
      console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](`[${entry.t}] [${level}] ${msg}`);
    }
  }

  function loadLogs() {
    if (window._bnpLogLoaded) return;
    window._bnpLogLoaded = true;
    _ensureLogRefs();
    if (!_logEl) return;
    try {
      const raw = localStorage.getItem(LOG_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw);
      for (const e of stored.slice(-MAX_LOG)) {
        logs.push(e);
        _logQueue.push(e);
      }
      _scheduleLogFlush();
      if (_badgeEl) _badgeEl.textContent = logs.length;
    } catch (e) { /* 忽略 */ }
  }

  function clearLog() {
    logs.length = 0;
    _logQueue.length = 0;
    try { localStorage.removeItem(LOG_KEY); } catch (e) { /* ignore */ }
    if (document.getElementById('bnp-log')) document.getElementById('bnp-log').innerHTML = '';
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
  function _crossFadeText(el, text) {
    if (el.textContent === text) return;
    el.classList.add('switch');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.textContent = text;
        el.classList.remove('switch');
      });
    });
  }
  function esc(s) { return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''; }
  function escH(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function sanitize(n) { return n.replace(/[:*?"\\\/<>|\0　]/g, ' ').replace(/^\.+|\.+$/g, '').replace(/\s{2,}/g, ' ').trim(); }
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
    secretMap = {};
    try {
      const js = await gmFetch(`${DOMAIN}/themes/zhmb/js/readtools.js`);
      // 新版readtools.js已不包含字符替换映射，此功能不再需要
      // 但仍保留请求用于兼容，结果不会被使用
    } catch (e) {
      addLog('WARN', `readtools.js获取失败: ${e.message}`);
    }
    return secretMap;
  }

  const FALLBACK = { fixedLength: 20, seedMultiplier: 135, seedOffset: 234, a: 9302, c: 49397, mod: 233280 };
  const tplCache = {};
  // 与项目 BiliNovelSource._allowedImageAttributes 对齐
  const ALLOWED_IMAGE_ATTRS = new Set(['alt', 'class', 'dir', 'height', 'id', 'ismap', 'lang', 'longdesc', 'style', 'title', 'usemap', 'width', 'src', 'xml:lang']);
  // 与项目 HTMLUtil._unescapeTable 对齐
  const HTML_UNESCAPE_TABLE = {
    '&quot;': '"', '＆quot;': '"', '&amp;': '&', '＆amp;': '&',
    '&lt;': '<', '＆lt;': '<', '&gt;': '>', '＆gt;': '>',
    '&nbsp;': ' ', '＆nbsp;': ' ', '&middot;': '·', '＆middot;': '·',
    '&raquo;': '?', '＆raquo;': '?', '&frac14;': '?', '＆frac14;': '?',
    '&frac12;': '?', '＆frac12;': '?', '&frac34;': '?', '＆frac34;': '?',
    '&iquest;': '?', '＆iquest;': '?'
  };
  function _unescapeContent(el) {
    function walk(node) {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          let text = child.textContent;
          for (const [k, v] of Object.entries(HTML_UNESCAPE_TABLE)) {
            if (text.includes(k)) text = text.split(k).join(v);
          }
          child.textContent = text;
        } else if (child.nodeType === 1) {
          walk(child);
        }
      }
    }
    walk(el);
  }
  // 与项目 BiliNovelSource._fixImgSrc / _normalizeImg 对齐
  function _fixImgSrc(img) {
    let src = img.getAttribute('data-src') || img.getAttribute('src');
    if (src == null) return;
    if (src.startsWith('data:image')) return;
    if (src.includes('<')) { img.remove(); return; }
    if (src.startsWith('//')) src = 'https:' + src;
    if (!/^https?:/i.test(src)) {
      try { src = new URL(src, DOMAIN).href; } catch { src = DOMAIN + '/' + src.replace(/^\/+/, ''); }
    }
    src = src.replace('https://https://', 'https://').replace(/𝘣/g, 'b');
    img.setAttribute('src', src);
  }
  function _normalizeImg(root) {
    for (const img of root.querySelectorAll('img')) {
      _fixImgSrc(img);
      for (const attr of Array.from(img.attributes)) {
        if (!ALLOWED_IMAGE_ATTRS.has(attr.name)) img.removeAttribute(attr.name);
      }
      img.setAttribute('alt', img.getAttribute('alt') || '');
    }
  }

  async function getShuffleParams(doc) {
    const scripts = doc.querySelectorAll('script[src*="chapterlog.js?v"]');
    if (!scripts.length) return null;
    const idMatch = doc.documentElement.outerHTML.match(/chapterid:'(\d+)'/);
    if (!idMatch) return null;
    const chId = parseInt(idMatch[1]);
    const src = new URL(scripts[0].src, DOMAIN).toString();
    let tpl = tplCache[src];
    if (tpl === undefined) {
      try { tpl = parseChapterLog(await gmFetch(src)) || null; } catch (e) { addLog('WARN', `chapterlog.js请求失败: ${e.message}`); tpl = null; }
      if (!tpl) addLog('WARN', '未解析到段落还原参数，已跳过还原（新版网站正文顺序正确，属正常情况）。若下载内容段落顺序错乱请反馈');
      tplCache[src] = tpl;
    }
    if (!tpl) return null;
    return { fixedLength: tpl.fixedLength, seed: chId * tpl.seedMultiplier + tpl.seedOffset, a: tpl.a, c: tpl.c, mod: tpl.mod };
  }

  function parseChapterLog(js) {
    // 新版chapterlog.js(v1006c1.7+)已不引用chapterId，且服务端直接返回顺序正确的段落，
    // 无需段落还原。若仍套用旧版解析结果，会把正确的段落顺序打乱，因此这里直接跳过。
    if (!js.includes('chapterId')) return null;
    // 新版chapterlog.js已高度混淆，先用自定义base64解码尝试提取字符串
    // 混淆格式: var _0xXXXX=['str1','str2',...]; 其中str是自定义base64编码
    // 自定义字母表: abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=
    try {
      if (js.includes("['\\x61\\x70\\x70\\x6c\\x79']")) {
        // 旧版readtools.js中的secretMap格式（兼容保留）
      }
      // 尝试查找常量数字字面量（即使混淆也能匹配）
      const nums = js.match(/(?:0x[0-9a-f]+|\d{3,6})/g) || [];
      const candidates = nums.map(n => n.startsWith('0x') ? parseInt(n, 16) : parseInt(n)).filter(n => n > 1000 && n < 500000);
      // 典型的LCG参数: mod通常在10万左右, a和c在几千到几万
      let foundMod = null, foundA = null, foundC = null;
      for (const n of candidates) {
        if (n > 20000 && n < 500000) foundMod = n;
      }
      // 若实在找不到则返回null (跳过还原)
    } catch {}
    // 尝试标准模式匹配(旧版未混淆或部分混淆)
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

  // 与 bili_novel_packer BiliNovelRestore 对齐：
  // 只收集正文内容里的直接 <p> 节点，记录它们在完整 childNodes 中的槽位，
  // 还原后只替换这些槽位，非 <p> 分隔物保持原位置。
  function unshuffle(content, params) {
    const childNodes = Array.from(content.childNodes);
    const slots = [];
    const ps = [];
    for (let i = 0; i < childNodes.length; i++) {
      const node = childNodes[i];
      if (node.nodeType === 1 && node.localName === 'p' && node.innerHTML.replace(/\s+/g, '') !== '') {
        slots.push(i);
        ps.push(node);
      }
    }
    if (!ps.length) return;

    const fixed = [], shuffled = [];
    for (let i = 0; i < ps.length; i++) (i < params.fixedLength ? fixed : shuffled).push(i);
    if (ps.length > params.fixedLength) {
      let seed = params.seed;
      for (let i = shuffled.length - 1; i > 0; i--) {
        seed = (seed * params.a + params.c) % params.mod;
        const j = Math.floor(seed / params.mod * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
    }
    const idx = [...fixed, ...shuffled];
    const restored = new Array(ps.length);
    for (let i = 0; i < ps.length; i++) restored[idx[i]] = ps[i];

    for (let i = 0; i < slots.length; i++) {
      childNodes[slots[i]] = restored[i];
    }
    content.innerHTML = '';
    for (const node of childNodes) content.appendChild(node);
  }

  // 清除网站添加的内容加载失败/截断提示
  function _cleanContentError(el) {
    // 递归遍历所有文本节点
    function walkTextNodes(node) {
      const toRemove = [];
      for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i];
        if (child.nodeType === 3) { // TEXT_NODE
          if (child.textContent.includes('內容加載失敗') || child.textContent.includes('内容加载失败')) {
            toRemove.push(child);
          }
        } else if (child.nodeType === 1) { // ELEMENT_NODE
          walkTextNodes(child);
        }
      }
      for (const n of toRemove) node.removeChild(n);
    }
    walkTextNodes(el);
    // 移除内容为空或仅含失败提示的p标签
    for (const p of el.querySelectorAll('p')) {
      const txt = p.textContent.trim();
      if (txt.includes('內容加載失敗') || txt.includes('内容加载失败')) {
        const hasRealContent = Array.from(p.childNodes).some(n => n.nodeType === 3 && !n.textContent.includes('內容加載失敗') && !n.textContent.includes('内容加载失败') && n.textContent.trim().length > 0);
        if (!hasRealContent) p.remove();
      }
    }
  }

  function getId(url) { const m = url.match(/(?:linovelib|bilinovel)\.(?:com|net)\/(?:novel|download)\/(\d+)/); if (!m) throw new Error('不支持的URL'); return m[1]; }

  // 与项目 VolumeUtil 对齐：从卷名中识别丛书编号
  const CHINESE_NUMBER_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15, '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20, '二十一': 21, '二十二': 22, '二十三': 23, '二十四': 24, '二十五': 25, '二十六': 26, '二十七': 27, '二十八': 28, '二十九': 29, '三十': 30 };
  function getSeriesIndex(volumeName) {
    return getSeriesIndexByLastNum(volumeName) ?? getSeriesIndexByVolumeName(volumeName);
  }
  function getSeriesIndexByLastNum(volumeName) {
    const m = volumeName.match(/.*\s(\d+(?:\.\d)?)$/);
    return m ? parseFloat(m[1]) : null;
  }
  function getSeriesIndexByVolumeName(volumeName) {
    const m = volumeName.match(/第([一二三四五六七八九十]+)[卷话章]$/);
    return m ? (CHINESE_NUMBER_MAP[m[1]] ?? null) : null;
  }

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
    // 与项目 v0.2.48 对齐：解析目录前先修复目录中的图片 src
    doc.body.querySelectorAll('img').forEach(img => _fixImgSrc(img));
    const allLis = doc.querySelectorAll('.volume-chapters>li');
    addLog('INFO', `目录li元素: ${allLis.length}个`);
    if (allLis.length === 0) {
      addLog('WARN', `目录为空, html前500=${html.substring(0, 500)}`);
    }
    const volumes = []; let cur = doc.querySelector('.chapter-bar') ? null : { name: '', chapters: [], cover: null };
    for (const li of allLis) {
      if (li.classList.contains('chapter-bar')) { if (cur) volumes.push(cur); cur = { name: li.textContent.trim(), chapters: [], cover: null }; }
      else if (li.classList.contains('volume-cover')) { if (cur) { const img = li.querySelector('a img'); cur.cover = (img && (img.getAttribute('data-src') || img.getAttribute('src'))) || null; } }
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
    // 清除网站添加的内容加载失败提示
    _cleanContentError(el);
    // 与项目 v0.2.48 HTMLUtil.unescape 对齐
    _unescapeContent(el);
    const um = raw.match(/url_previous:'(.*?)',url_next:'(.*?)'/);
    // 与 bili_novel_packer v0.2.46 同步：改用 .prevlink/.nextlink 类名精确定位，
    // 不再依赖“第一个/最后一个链接”，避免 #footlink 中插入其他链接导致漏页
    const prev = doc.querySelector('#footlink a.prevlink');
    const next = doc.querySelector('#footlink a.nextlink');
    let nextUrl = null, prevChapterUrl = null, nextChapterUrl = null;
    // 与项目 v0.2.48 对齐：忽略“返回目录”链接，避免误判为上一章/下一章
    const isCatalog = link => link && (link.textContent || '').trim() === '返回目录';
    if (prev && um?.[1] && !isCatalog(prev)) {
      const prevText = prev.textContent || '';
      if (prevText.includes('上一页') || prevText.includes('上一頁')) {
        // 上一页链接（本章内分页翻页），脚本只向前翻页，无需记录 prevPage
      } else if (um[1]) {
        prevChapterUrl = DOMAIN + um[1];
      }
    }
    if (next && um?.[2] && !isCatalog(next)) {
      const nextText = next.textContent || '';
      if (nextText.includes('下一页') || nextText.includes('下一頁')) {
        nextUrl = DOMAIN + um[2];
      } else if (um[2]) {
        nextChapterUrl = DOMAIN + um[2];
      }
    }
    // 与项目 v0.2.48 对齐：修复图片 src 并清理属性
    _normalizeImg(el);
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
    // 与项目 v0.2.49 LightNovelCoverDetector.addFirst 对齐
    addFirst(name, data) {
      const dims = getImageDimensions(data);
      if (!dims) return;
      const next = {};
      next[name] = dims;
      for (const [k, v] of Object.entries(this._images)) next[k] = v;
      this._images = next;
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
    const { title, author, desc, cover, chapters, images, publisher, subjects, source, series, seriesIndex } = opts;
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
    const sourceXml = source ? `<dc:source>${esc(source)}</dc:source>` : '';
    const publisherXml = publisher ? `<dc:publisher>${esc(publisher)}</dc:publisher>` : '';
    const subjectsXml = subjects && subjects.length ? subjects.map(s => `<dc:subject>${esc(s)}</dc:subject>`).join('') : '';
    const seriesXml = series ? `<meta name="calibre:series" content="${esc(series)}"/>` : '';
    const seriesIndexXml = (seriesIndex !== undefined && seriesIndex !== null) ? `<meta name="calibre:series_index" content="${seriesIndex}"/>` : '';
    zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="bookId" version="3.0"><metadata><dc:identifier id="bookId">${uid}</dc:identifier><dc:language>zh-CN</dc:language><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator>${sourceXml}${desc ? `<dc:description>${esc(desc)}</dc:description>` : ''}${publisherXml}${subjectsXml}<meta property="dcterms:modified">${now}</meta>${seriesXml}${seriesIndexXml}</metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="styles/style.css" media-type="text/css"/>${coverXml}${imgM.join('')}${chM.join('')}</manifest><spine toc="ncx">${chS.join('')}</spine></package>`);

    zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/"><head><meta content="${uid}" name="dtb:uid"/><meta content="1" name="dtb:depth"/></head><docTitle><text>${esc(title)}</text></docTitle><navMap>${nav.map((n, i) => `<navPoint id="np${i + 1}"><navLabel><text>${esc(n.title)}</text></navLabel><content src="${n.src}"/></navPoint>`).join('')}</navMap></ncx>`);

    zip.file('OEBPS/toc.xhtml', `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh"><head><meta charset="UTF-8"/><title>目录</title></head><body><nav id="toc" role="doc-toc" epub:type="toc"><h1>目录</h1><ol>${nav.map(n => `<li><a href="${n.src}">${esc(n.title)}</a></li>`).join('')}</ol></nav></body></html>`);

    return zip;
  }

  function downloadFile(blob, filename) {
    addLog('INFO', `开始下载: ${filename} (${(blob.size / 1024 / 1024).toFixed(1)}MB)`);
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

  // ---------- 保存到指定目录(File System Access API) ----------
  // 参考项目 novel_packer：在当前目录下按书名建文件夹，EPUB 命名规则与 _getEpubName 一致
  const _DIR_DB = 'bnp_save_dir_db';
  const _DIR_STORE = 'dirs';
  const _DIR_KEY = 'save_dir';
  let _saveDirHandle = null;
  let _saveDirSkipped = false; // 用户取消过一次选择后，本次会话不再重复弹窗

  function _idbOpen() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
      let req;
      try { req = indexedDB.open(_DIR_DB, 1); } catch (e) { return reject(e); }
      req.onupgradeneeded = () => { try { req.result.createObjectStore(_DIR_STORE); } catch {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function _idbGet() {
    try {
      const db = await _idbOpen();
      return await new Promise((resolve, reject) => {
        let req;
        try { req = db.transaction(_DIR_STORE).objectStore(_DIR_STORE).get(_DIR_KEY); } catch (e) { return reject(e); }
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch { return null; }
  }
  async function _idbSet(handle) {
    try {
      const db = await _idbOpen();
      await new Promise((resolve, reject) => {
        let req;
        try { req = db.transaction(_DIR_STORE, 'readwrite').objectStore(_DIR_STORE).put(handle, _DIR_KEY); } catch (e) { return reject(e); }
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) { addLog('WARN', `保存目录记忆失败: ${e.message}`); }
  }

  function updateDirUI() {
    const el = document.getElementById('bnp-dir');
    if (!el) return;
    if (typeof window.showDirectoryPicker !== 'function') {
      el.textContent = '📁 保存到浏览器默认下载';
      el.title = '当前浏览器不支持选择目录，将保存到浏览器默认下载目录';
      return;
    }
    el.textContent = _saveDirHandle ? '📁 已选保存目录' : '📁 点击选择保存目录';
    el.title = _saveDirHandle ? '点击可更换保存目录' : '下载前点击此处选择保存目录';
  }

  async function pickSaveDir() {
    if (typeof window.showDirectoryPicker !== 'function') {
      addLog('INFO', '当前浏览器不支持选择目录，将保存到浏览器默认下载目录');
      return;
    }
    try {
      const h = await window.showDirectoryPicker({ mode: 'readwrite' });
      _saveDirHandle = h;
      await _idbSet(h);
      updateDirUI();
      addLog('INFO', '已选择保存目录');
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 用户取消
      addLog('WARN', `选择目录失败: ${e.message}`);
    }
  }

  // 获取保存目录句柄(会话内缓存 + IndexedDB记忆)，不支持或未选择时返回 null
  async function getSaveDirHandle() {
    if (typeof window.showDirectoryPicker !== 'function') return null;
    if (_saveDirHandle) return _saveDirHandle;
    if (_saveDirSkipped) return null;
    const saved = await _idbGet();
    if (saved) {
      try {
        const perm = await saved.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          _saveDirHandle = saved;
          updateDirUI();
          return saved;
        }
      } catch {}
    }
    try {
      const h = await window.showDirectoryPicker({ mode: 'readwrite' });
      _saveDirHandle = h;
      await _idbSet(h);
      updateDirUI();
      return h;
    } catch (e) {
      if (e && e.name === 'AbortError') { _saveDirSkipped = true; return null; } // 用户取消
      throw e;
    }
  }

  // 文件名命名规则与项目 novel_packer._getEpubName 一致
  function buildEpubFileName(title, volumeName) {
    const t = sanitize(title);
    const v = sanitize(volumeName);
    if (!v) return `${t}.epub`;
    if (v.startsWith(t)) return `${v}.epub`;
    return `${t} ${v}.epub`;
  }

  // 保存 EPUB：优先写入指定目录并自动建“编号+书名”文件夹（文件夹名前缀书籍编号，如“1恶魔高校DxD”），否则退回浏览器默认下载
  async function saveEpub(data, bookId, title, volumeName) {
    const fileName = buildEpubFileName(title, volumeName);
    addLog('INFO', `开始保存: ${fileName} (${(data.length / 1024 / 1024).toFixed(1)}MB)`);
    if (typeof window.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await getSaveDirHandle();
        if (dirHandle) {
          const folderName = sanitize(String(bookId) + title);
          const folder = await dirHandle.getDirectoryHandle(folderName, { create: true });
          const file = await folder.getFileHandle(fileName, { create: true });
          const writable = await file.createWritable();
          await writable.write(data);
          await writable.close();
          addLog('INFO', `已保存到 ${folderName}/${fileName}`);
          return;
        }
        addLog('INFO', '未选择保存目录，改用浏览器默认下载');
      } catch (e) {
        addLog('WARN', `写入指定目录失败(${e.message})，改用浏览器默认下载`);
      }
    }
    downloadFile(new Blob([data], { type: 'application/epub+zip' }), fileName);
  }

  GM_addStyle(`
    :root {
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
      --bnp-btn-bg: rgba(255,255,255,0.72);
      --bnp-btn-border: rgba(0,0,0,0.06);
      --bnp-btn-color: #1d1d1f;
      --bnp-btn-shadow: 0 4px 20px rgba(0,0,0,0.1);
      --bnp-btn-glow: rgba(0,0,0,0.04);
    }
    @media (prefers-color-scheme: dark) {
      :root {
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
        --bnp-btn-bg: rgba(40,40,44,0.72);
        --bnp-btn-border: rgba(255,255,255,0.08);
        --bnp-btn-color: #f5f5f7;
        --bnp-btn-shadow: 0 4px 20px rgba(0,0,0,0.35);
        --bnp-btn-glow: rgba(255,255,255,0.04);
      }
    }
    * { box-sizing: border-box; }

    /* ---- 主按钮 ---- */
    #bnp-btn {
      position: fixed; bottom: 80px; right: 20px; z-index: 99999;
      height: 48px; padding: 0 20px;
      border-radius: 24px;
      background: var(--bnp-btn-bg);
      border: 0.5px solid var(--bnp-btn-border);
      box-shadow: var(--bnp-btn-shadow);
      display: flex; align-items: center; justify-content: center;
      gap: 5px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;
      color: var(--bnp-btn-color); cursor: pointer;
      touch-action: none; user-select: none;
      backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%);
      transition: background 0.45s ease, color 0.45s ease, box-shadow 0.45s ease, border-color 0.45s ease, transform 0.25s cubic-bezier(.34,1.56,.64,1), box-shadow 0.25s;
      animation: bnp-btn-float 4s ease-in-out infinite;
      will-change: transform, background, color;
    }
    #bnp-btn svg { transition: color 0.45s ease; color: var(--bnp-btn-color); }
    #bnp-btn:hover { transform: translateY(-2px) scale(1.03); box-shadow: 0 8px 32px rgba(0,0,0,0.15); animation: none; }
    #bnp-btn:active { transform: scale(0.93); box-shadow: 0 2px 8px rgba(0,0,0,0.1); animation: none; }
    @keyframes bnp-btn-float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }

    /* ---- 遮罩 ---- */
    #bnp-overlay {
      position: fixed; inset: 0; z-index: 100000;
      background: var(--bnp-overlay);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      display: none; opacity: 0;
      transition: opacity 0.35s ease;
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
    .bnp-body { flex: 1; overflow-y: auto; padding: 18px 22px; -webkit-overflow-scrolling: touch;
      scrollbar-width: thin; scrollbar-color: var(--bnp-border) transparent; }
    .bnp-body::-webkit-scrollbar { width: 4px; }
    .bnp-body::-webkit-scrollbar-thumb { background: var(--bnp-border); border-radius: 2px; }
    .bnp-body::-webkit-scrollbar-track { background: transparent; }

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
    .bnp-vol-expand {
      font-size: 12px; color: var(--bnp-accent); cursor: pointer; font-weight: 500;
      user-select: none; margin-bottom: 8px; display: inline-block; transition: opacity 0.15s;
    }
    .bnp-vol-tbar {
      display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
    }
    .bnp-vol-cnt {
      font-size: 11px; color: var(--bnp-text3); background: var(--bnp-border);
      padding: 2px 10px; border-radius: 6px; font-weight: 500;
    }
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

    /* ---- 进度 ---- */
    .bnp-progress { margin-top: 14px; display: none; }
    .bnp-bar {
      width: 100%; height: 6px; background: var(--bnp-border); border-radius: 3px; overflow: hidden;
      position: relative;
    }
    .bnp-bar-fill {
      height: 100%; border-radius: 3px; width: 0;
      background: linear-gradient(90deg, var(--bnp-accent), var(--bnp-accent2), #5AC8FA, #34C759, var(--bnp-accent));
      background-size: 300% 100%;
      animation: bnp-shimmer 2.5s linear infinite;
      transition: width 0.45s cubic-bezier(.4,0,.2,1);
    }
    .bnp-bar-fill.done { background: linear-gradient(90deg, #34C759, #30D158); background-size: 100% 100%; animation: none; }
    @keyframes bnp-shimmer { 0% { background-position: 300% 0; } 100% { background-position: -300% 0; } }
    .bnp-ptext {
      font-size: 12px; color: var(--bnp-text3); margin-top: 10px; text-align: center;
      line-height: 1.4; transition: opacity 0.25s ease, transform 0.25s ease;
    }
    .bnp-ptext.switch { opacity: 0; transform: translateY(4px); }
    .bnp-peta {
      font-size: 11px; color: var(--bnp-text3); text-align: center; margin-top: 4px;
      opacity: 0.7; transition: opacity 0.2s ease;
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
      scrollbar-width: thin; scrollbar-color: var(--bnp-border) transparent;
    }
    .bnp-log::-webkit-scrollbar { width: 4px; }
    .bnp-log::-webkit-scrollbar-thumb { background: var(--bnp-border); border-radius: 2px; }
    .bnp-log::-webkit-scrollbar-track { background: transparent; }
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
    .bnp-dir { font-size: 12px; color: var(--bnp-text3); cursor: pointer; user-select: none; padding: 6px 10px; border-radius: 8px; transition: background .15s, color .15s; align-self: center; }
    .bnp-dir:hover { background: var(--bnp-border); color: var(--bnp-text2); }

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

    /* ---- 入场动画 ---- */
    @keyframes bnp-fade-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes bnp-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes bnp-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
    @keyframes bnp-slide-left { from { opacity: 0; transform: translateX(-16px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes bnp-done-bounce { 0% { transform: scale(1); } 30% { transform: scale(1.15); } 50% { transform: scale(0.95); } 70% { transform: scale(1.05); } 100% { transform: scale(1); } }
    @keyframes bnp-shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-4px); } 40% { transform: translateX(4px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(3px); } }
    @keyframes bnp-glow-pulse { 0%,100% { box-shadow: 0 4px 20px var(--bnp-btn-shadow); } 50% { box-shadow: 0 4px 32px var(--bnp-btn-shadow), 0 0 60px rgba(0,122,255,0.15); } }
    .bnp-vol { animation: bnp-fade-up 0.35s cubic-bezier(.4,0,.2,1) both; will-change: transform, opacity; }
    .bnp-vol-in { animation: bnp-fade-up 0.35s cubic-bezier(.4,0,.2,1) both; will-change: transform, opacity; }
    .bnp-info { animation: bnp-fade-up 0.4s cubic-bezier(.4,0,.2,1); will-change: transform, opacity; }
    .bnp-ptext { will-change: opacity, transform; }
    .bnp-ptext.done { animation: bnp-done-bounce 0.5s cubic-bezier(.4,0,.2,1); }
    .bnp-bar-fill { will-change: width; }
    #bnp-mini.done .bnp-mini-ring .fg { stroke: #34C759; stroke-dashoffset: 0 !important; transition: stroke-dashoffset 0.5s, stroke 0.3s; }
    /* 低端设备/省电模式: 关闭动画 */
    @media (prefers-reduced-motion: reduce) {
      .bnp-vol, .bnp-vol-in, .bnp-info { animation: none !important; }
      #bnp-btn { animation: none !important; transition: none !important; }
      .bnp-bar-fill { animation: none !important; }
      .bnp-ptext.done { animation: none !important; }
      .bnp-ptext.switch { opacity: 1 !important; transform: none !important; transition: none !important; }
    }
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

    const btn = document.createElement('button'); btn.id = 'bnp-btn'; btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/></svg><span>EPUB</span>'; document.body.appendChild(btn);
    const btnMoved = makeDraggable(btn);
    btn.addEventListener('click', () => { if (btnMoved()) return; showPanel(); });

    const overlay = document.createElement('div'); overlay.id = 'bnp-overlay'; document.body.appendChild(overlay);
    overlay.addEventListener('click', () => { if (isDownloading) minimizePanel(); else hidePanel(); });

    const panel = document.createElement('div'); panel.id = 'bnp-panel';
    panel.innerHTML = `<div class="bnp-hdr"><h3>轻小说打包下载</h3><button id="bnp-close">&times;</button></div><div class="bnp-body"><div id="bnp-info-area"><div class="bnp-skeleton"><div class="spinner"></div><div>正在加载小说信息...</div></div></div><div id="bnp-vol-area" style="display:none"></div><div class="bnp-progress" id="bnp-progress"><div class="bnp-bar"><div class="bnp-bar-fill" id="bnp-fill"></div></div><div class="bnp-ptext" id="bnp-ptext"></div><div class="bnp-peta" id="bnp-peta"></div></div><div class="bnp-log-wrap"><div class="bnp-log-tbar"><span class="bnp-log-toggle" id="bnp-log-toggle">查看日志</span><span class="bnp-log-cnt" id="bnp-log-cnt">0</span><div class="bnp-log-tools"><button class="bnp-log-tool" id="bnp-log-cpy" title="复制日志">📋</button><button class="bnp-log-tool" id="bnp-log-clr" title="清除日志">🗑</button></div></div><div class="bnp-log" id="bnp-log"></div></div></div><div class="bnp-ftr"><span class="bnp-dir" id="bnp-dir" title="点击选择保存目录">📁 保存位置</span><span style="flex:1"></span><button class="bnp-btn-cancel" id="bnp-cancel">取消</button><button class="bnp-btn-go" id="bnp-go">开始下载</button></div>`;
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
      if (log.style.display === 'none' || !log.style.display) { log.style.display = 'block'; tog.textContent = '收起日志'; loadLogs(); _flushLogQueueImmediate(); } else { log.style.display = 'none'; tog.textContent = '查看日志'; }
    };
    document.getElementById('bnp-log-cpy').onclick = copyLog;
    document.getElementById('bnp-log-clr').onclick = clearLog;
    const dirEl = document.getElementById('bnp-dir');
    if (dirEl) dirEl.onclick = () => pickSaveDir();
    updateDirUI();
  }


  function showPanel() {
    const o = document.getElementById('bnp-overlay'), p = document.getElementById('bnp-panel'), b = document.getElementById('bnp-btn'), m = document.getElementById('bnp-mini');
    o.style.display = 'block'; p.style.display = 'flex'; b.style.display = 'none'; m.style.display = 'none';
    requestAnimationFrame(() => { o.classList.add('show'); p.classList.add('show'); });
    if (!window._bnpLoaded) { window._bnpLoaded = true; loadNovel(); }
    updateDirUI();
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
        const delay = i * 50;
        const hidden = currentVol && v !== currentVol && !_catalogExpanded;
        return `<div class="bnp-vol" data-vol="${i}" style="${hidden ? 'display:none' : `animation-delay:${delay}ms`}"><label class="bnp-vol-hdr"><input type="radio" name="bnp-vol" class="bnp-vc" data-i="${i}"><span class="vn">${label}</span></label></div>`;
      }).join('');

      let extraHtml = '';
      if (currentVol) {
        const others = vols.length - 1;
        if (!_catalogExpanded) {
          extraHtml = `<span class="bnp-vol-expand" id="bnp-vol-expand">📂 展开全部 ${vols.length} 卷</span>`;
        }
      }

      document.getElementById('bnp-vol-area').innerHTML = `<div class="bnp-vol-tbar"><span class="bnp-vol-cnt" id="bnp-vol-cnt">${vols.length} 卷 · 请选择一卷</span></div>${extraHtml}` + volHtml;
      document.getElementById('bnp-vol-area').style.display = 'block';

      const expandBtn = document.getElementById('bnp-vol-expand');
      if (expandBtn) {
        expandBtn.addEventListener('click', () => {
          _catalogExpanded = true;
          const hidden = document.querySelectorAll('.bnp-vol[data-vol][style*="display:none"]');
          hidden.forEach((el, i) => {
            el.style.display = '';
            el.style.animationDelay = (i * 60) + 'ms';
            el.style.animation = 'bnp-fade-up 0.35s cubic-bezier(.4,0,.2,1) both';
          });
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
      const checked = [...document.querySelectorAll('.bnp-vc:checked')].map(c => vols[+c.dataset.i]);
      if (!checked.length) { alert('请至少选择一卷'); btn.disabled = false; isDownloading = false; return; }
            // 新下载会话: 清空上次日志
            clearLog();

      addLog('SESSION', `─── 📥 ${novel.title} ───`);
      addLog('INFO', `下载${checked.length}卷`);
      minimizePanel();
      // 提前请求保存目录(此时用户点击手势仍有效)，避免下载中途弹窗
      if (typeof window.showDirectoryPicker === 'function') {
        try { await getSaveDirHandle(); } catch (e) { addLog('WARN', `选择保存目录失败: ${e.message}`); }
      }
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
          _crossFadeText(ptext, `${done}/${total} ${ch.name}`);
          _crossFadeText(peta, `进度 ${pct}% · 预计剩余 ${eta}`);
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
            let imgOk = 0, imgFail = 0;
            for (const img of imgs) {
              let src = img.src;
              if (!src) continue;
              try {
                const data = await _imageScheduler.run(() => fetchImageWithRetry(src));
                if (data?.length > 0) { const ext = detectExt(data); const fn = `images/${String(++imgIdx).padStart(6, '0')}${ext}`; allImages[fn] = data; img.src = fn; imgOk++; }
              } catch (e) { imgFail++; addLog('WARN', `图片失败(${src.substring(0,60)}): ${e.message}`); }
            }
            if (imgOk > 0) addLog('INFO', `  章节${done}: ${imgOk}张图片已下载${imgFail > 0 ? `, ${imgFail}张失败` : ''}`);
            volChapters.push({ title: title || ch.name, content: container.innerHTML });
          } catch (e) { addLog('ERROR', `章节失败: ${ch.name} - ${e.message}`); volChapters.push({ title: ch.name, content: `<p style="color:#FF3B30">获取失败：${esc(e.message)}${ch.url ? `（${esc(ch.url)}）` : ''}</p>` }); }
        }

          fill.style.width = '90%'; ptext.textContent = `📦 打包: ${volName}`; peta.textContent = '正在生成 EPUB...'; document.getElementById('bnp-mini-text').textContent = `打包中`; document.getElementById('bnp-mini-sub').textContent = volName; if (ringFg) ringFg.style.strokeDashoffset = '7.5';
          const coverUrl = (vol.cover && !vol.cover.includes('no.svg') && !vol.cover.includes('book-cover-no')) ? vol.cover : null;
          const detector = new CoverDetector();
          let volumeCoverData = new Uint8Array(0);
          if (coverUrl) {
            try {
              volumeCoverData = await fetchImage(coverUrl);
              addLog('INFO', `卷封面下载: ${(volumeCoverData.length/1024).toFixed(0)}KB`);
            } catch(e) { addLog('WARN', `卷封面下载失败: ${e.message}`); }
          } else {
            addLog('INFO', '无卷封面（占位图），将由 CoverDetector 从章节插图中选择...');
          }
          // 与项目 v0.2.49 对齐：卷封面作为首选候选，但仍需通过比例检测
          if (volumeCoverData.length > 0) detector.addFirst('__volume_cover__', volumeCoverData);
          for (const [fn, data] of Object.entries(allImages)) {
            if (data.length >= 1000) detector.add(fn, data);
          }
          const coverName = detector.detectCover();
          let cover = new Uint8Array(0);
          if (coverName === '__volume_cover__') {
            cover = volumeCoverData;
            const dims = getImageDimensions(cover);
            addLog('INFO', `封面采用卷封面${dims ? ` (${dims.width}x${dims.height})` : ''}`);
          } else if (coverName) {
            cover = allImages[coverName];
            const dims = getImageDimensions(cover);
            addLog('INFO', `封面自动选择: ${coverName}${dims ? ` (${dims.width}x${dims.height})` : ''}`);
          }
          addLog('INFO', `打包: ${volChapters.length}章, 图片${Object.keys(allImages).length}张, 封面${cover.length > 0 ? '有' : '无'}`);
          // 与项目 _packVolume 对齐：卷名以书名开头时，EPUB 标题直接用卷名
          const docTitle = volName.startsWith(novel.title) ? volName : `${novel.title} ${volName}`;
          // 与项目 VolumeUtil.getSeriesIndex 对齐：识别到丛书编号时写入 Calibre 元数据
          const seriesIndex = getSeriesIndex(volName);
          const zip = buildEpub({ title: docTitle, author: novel.author, desc: novel.description, publisher: novel.publisher, subjects: novel.tags, source: novel.url, series: seriesIndex !== null ? novel.title : null, seriesIndex, cover: cover?.length > 0 ? cover : null, chapters: volChapters, images: allImages });
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
            // 文件夹名=书籍编号+书名（如“1恶魔高校DxD”），文件夹内 EPUB 文件名仍带标题
            await saveEpub(data, novel.id, novel.title, volName);
          } catch(e) { addLog('ERROR', `generate失败: ${e.message} ${e.stack}`); }
      }

      fill.classList.add("done"); fill.style.width = "100%";
      document.getElementById("bnp-mini").classList.add("done");
      _crossFadeText(ptext, "✅ 全部完成!");
      ptext.classList.add("done");
      document.getElementById("bnp-mini-text").innerHTML = "✅ 完成";
      peta.textContent = "";
      if (ringFg) { ringFg.style.strokeDashoffset = "0"; ringFg.style.stroke = "#34C759"; }
      addLog('INFO', '全部完成');
      // delay for completion animation
      setTimeout(() => { prog.style.display = 'none'; document.getElementById('bnp-mini').style.display = 'none'; document.getElementById('bnp-btn').style.display = 'flex'; showPanel(); }, 2500);
    } catch (e) {
      addLog('ERROR', `失败: ${e.message}`);
      ptext.textContent = `❌ 失败: ${e.message}`; peta.textContent = ""; document.getElementById("bnp-mini-text").textContent = "❌ 失败"; document.getElementById("bnp-mini-sub").textContent = e.message;
      ptext.style.animation = "bnp-shake 0.4s cubic-bezier(.4,0,.2,1)";
      if (ringFg) { ringFg.style.stroke = "#FF3B30"; ringFg.style.strokeDashoffset = "0"; }
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
