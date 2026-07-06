/**
 * Node.js 测试脚本 — 在终端中测试轻小说打包下载功能
 * 无需浏览器 / Tampermonkey
 *
 * 用法:
 *   node test/node_test.mjs <URL>
 *
 * 示例:
 *   node test/node_test.mjs https://www.linovelib.com/novel/1.html
 *   node test/node_test.mjs https://m.bilinovel.com/novel/1.html --combine
 *   node test/node_test.mjs <URL> --volumes 1,2   # 选择第1,2卷
 *   node test/node_test.mjs <URL> --no-down        # 只查看信息不下载
 */

import { createRequire } from 'module';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DOMParser, parseHTML } from 'linkedom';

// ==================== Polyfill 浏览器/GM API ====================

// DOMParser
globalThis.DOMParser = DOMParser;

// location
globalThis.location = { href: process.argv[2] || '', origin: '' };

// Blob
globalThis.Blob = class Blob {
  constructor(parts, opts = {}) {
    this.parts = parts;
    this.type = opts.type || '';
    this.size = parts.reduce((s, p) => s + (p.byteLength || p.length || 0), 0);
  }
};

// URL (native in Node 24)
// already available

// atob (native in Node)
// already available

// 使用 linkedom 提供完整 DOM 支持
const { document: _linkedDoc } = parseHTML('<!DOCTYPE html><html><body></body></html>');

// 代理 linkedom document，覆写几个浏览器特有方法为安全 no-op
globalThis.document = new Proxy(_linkedDoc, {
  get(target, prop) {
    if (prop === 'getElementById') return () => null;
    if (prop === 'addEventListener') return () => {};
    if (prop === 'readyState') return 'complete';
    const val = target[prop];
    return typeof val === 'function' ? val.bind(target) : val;
  }
});

// GM_* polyfills
globalThis.GM_xmlhttpRequest = (() => {
  return function gmFetch(opts) {
    const { method = 'GET', url, headers = {}, responseType = 'text', onload, onerror, ontimeout, timeout = 30000 } = opts;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const fetchHeaders = new Headers(headers);

    fetch(url, { method, headers: fetchHeaders, signal: controller.signal })
      .then(async (res) => {
        clearTimeout(timer);
        if (!res.ok) {
          onerror?.({ error: `HTTP ${res.status}`, status: res.status });
          return;
        }
        let response;
        if (responseType === 'arraybuffer') {
          response = new Uint8Array(await res.arrayBuffer());
        } else {
          response = await res.text();
        }
        onload?.({ status: res.status, response, responseText: response });
      })
      .catch((err) => {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          ontimeout?.();
        } else {
          onerror?.({ error: err.message });
        }
      });
  };
})();

globalThis.GM_download = function (opts) {
  if (typeof opts === 'string') {
    console.log(`[GM_download] ${opts}`);
    return;
  }
  const { url, name } = opts;
  console.log(`[GM_download] ${name} (${url?.substring(0, 50) || 'blob'})`);
  // 实际写文件在 downloadFile 里处理
  opts.onload?.();
};

globalThis.GM_addStyle = () => {};

// JSZip (加载 npm 版本)
import('jszip').then(mod => {
  globalThis.JSZip = mod.default;
  main();
}).catch(err => {
  console.error('Failed to load jszip:', err);
  process.exit(1);
});

// ==================== 主逻辑 ====================

async function main() {
  const url = process.argv[2];
  if (!url || url.startsWith('-')) {
    console.log(`
用法: node test/node_test.mjs <URL> [选项]

选项:
  --combine        合并所有分卷为一个EPUB
  --volumes N,N    选择指定卷号（从1开始，如 1,2 或 1-3）
  --no-down        只查看小说信息，不下载
  --output DIR     输出目录（默认 ./output）

示例:
  node test/node_test.mjs https://www.linovelib.com/novel/1.html
  node test/node_test.mjs https://m.bilinovel.com/novel/1.html --combine
`);
    process.exit(0);
  }

  const args = process.argv.slice(3);
  const combine = args.includes('--combine');
  const noDown = args.includes('--no-down');
  const volArg = args.indexOf('--volumes') >= 0 ? args[args.indexOf('--volumes') + 1] : '';
  const outDirArg = args.indexOf('--output') >= 0 ? args[args.indexOf('--output') + 1] : './output';

  // 加载用户脚本（通过 require 加载 commonjs 格式）
  const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bili-novel-downloader.user.js');
  const BNP = createRequire(import.meta.url)(scriptPath);

  console.log('\n========================================');
  console.log('  轻小说打包下载器 — Node.js 测试模式');
  console.log(`  URL: ${url}`);
  console.log('========================================\n');

  let novel, vols;

  try {
    // 1. 获取小说信息
    console.log('📖 获取小说信息...');
    novel = await BNP.getNovel(url);
    console.log(`  书名: ${novel.title}`);
    console.log(`  作者: ${novel.author}`);
    console.log(`  状态: ${novel.status}`);
    if (novel.alias) console.log(`  别名: ${novel.alias}`);
    if (novel.tags?.length) console.log(`  标签: ${novel.tags.join(', ')}`);
    if (novel.description) console.log(`  简介: ${novel.description.substring(0, 100)}...`);

    // 2. 获取目录
    console.log('\n📑 获取目录...');
    vols = await BNP.getCatalog(novel.id);
    console.log(`  共 ${vols.length} 卷`);
    vols.forEach((v, i) => {
      const hasCover = v.cover && !v.cover.includes('no.svg') ? '🖼' : '  ';
      console.log(`  [${i + 1}] ${hasCover} ${v.name} (${v.chapters.length}章)`);
    });

    if (noDown) {
      console.log('\n⏹  --no-down 模式，不下载。\n');
      process.exit(0);
    }

    // 3. 选择分卷
    let selectedVols = [];
    if (volArg) {
      const parts = volArg.split(',');
      for (const p of parts) {
        if (p.includes('-')) {
          const [s, e] = p.split('-').map(Number);
          for (let i = s; i <= e; i++) selectedVols.push(vols[i - 1]);
        } else {
          selectedVols.push(vols[Number(p) - 1]);
        }
      }
    } else {
      // 默认选择全部
      selectedVols = [...vols];
    }

    console.log(`\n📦 选择 ${selectedVols.length} 卷，${combine ? '合并为一本' : '逐卷打包'}`);

    // 4. 获取解密密钥
    console.log('\n🔑 获取解密密钥...');
    await BNP.getSecretMap();
    console.log('  ✅ 密钥已获取');

    // 5. 开始下载
    const outDir = join(process.cwd(), outDirArg);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const total = selectedVols.reduce((s, v) => s + v.chapters.length, 0);
    let done = 0;
    let imgIdx = 0;
    const allChapters = [];
    const allImages = {};

    console.log(`\n⬇️  开始下载 ${total} 章...\n`);

    for (const vol of selectedVols) {
      const volName = vol.name || novel.title;
      console.log(`  📁 卷: ${volName} (${vol.chapters.length}章)`);
      const volChapters = [];

      for (const ch of vol.chapters) {
        done++;
        process.stdout.write(`\r    [${done}/${total}] ${ch.name}`);

        // 推导URL
        if (!ch.url) {
          ch.url = await BNP.resolveChapterUrl(ch, vols);
          if (ch.url) process.stdout.write(` → URL已推导`);
        }
        if (!ch.url) {
          console.log(`\n    ⚠️  跳过: ${ch.name} (无URL)`);
          volChapters.push({ title: ch.name, content: '<p>（无链接）</p>' });
          continue;
        }

        try {
          const { title, content } = await BNP.getChapter(ch.url);
          // 用正则提取所有图片URL，逐个下载并替换
          let processedContent = content;
          const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
          const imgUrls = new Map();
          let m;
          while ((m = imgRegex.exec(content)) !== null) {
            const src = m[1];
            if (!src || imgUrls.has(src)) continue;
            try {
              process.stdout.write(`\n    ⬇️  图片: ${src.substring(0, 50)}...`);
              const data = await BNP.fetchImage(src);
              if (data?.byteLength > 0 || data?.length > 0) {
                const ext = detectExt(data);
                const fn = `images/${String(++imgIdx).padStart(6, '0')}${ext}`;
                allImages[fn] = data;
                imgUrls.set(src, fn);
                process.stdout.write(` → ${fn}`);
              }
            } catch (e) {
              process.stdout.write(` ❌ ${e.message.substring(0, 30)}`);
            }
          }
          // 统一替换所有图片引用
          for (const [origUrl, localFn] of imgUrls) {
            processedContent = processedContent.replace(
              new RegExp(escapeRegex(origUrl), 'g'), localFn
            );
          }
          volChapters.push({ title: title || ch.name, content: processedContent });
        } catch (e) {
          console.log(`\n    ❌ 章节失败: ${ch.name} - ${e.message}`);
          volChapters.push({ title: ch.name, content: '<p>获取失败</p>' });
        }
      }
      console.log('');

      if (combine) {
        allChapters.push(...volChapters);
      } else {
        // 处理封面
        let cover = null;
        if (vol.cover && !vol.cover.includes('no.svg')) {
          try { cover = await BNP.fetchImage(vol.cover); } catch {}
        }
        if (!cover) {
          const detector = new BNP.CoverDetector();
          for (const [fn, data] of Object.entries(allImages)) {
            if (data.length >= 1000) detector.add(fn, data);
          }
          const cn = detector.detectCover();
          if (cn) cover = allImages[cn];
        }

        console.log(`  📦 打包: ${volChapters.length}章, ${Object.keys(allImages).length}图`);
        const zip = BNP.buildEpub({
          title: `${novel.title} ${volName}`,
          author: novel.author,
          desc: novel.description,
          cover,
          chapters: volChapters,
          images: allImages,
        });
        const data = await zip.generateAsync({ type: 'uint8array' });
        const epubName = volName.replace(/[:*?"\\\/<>|\0]/g, ' ').trim();
        const outPath = join(outDir, `${epubName}.epub`);
        writeFileSync(outPath, Buffer.from(data));
        console.log(`  ✅ 已保存: ${outPath}`);
      }
    }

    if (combine) {
      let cover = null;
      if (novel.coverUrl) try { cover = await BNP.fetchImage(novel.coverUrl); } catch {}
      console.log(`\n  📦 打包合并: ${allChapters.length}章, ${Object.keys(allImages).length}图`);
      const zip = BNP.buildEpub({
        title: novel.title,
        author: novel.author,
        desc: novel.description,
        cover,
        chapters: allChapters,
        images: allImages,
      });
      const data = await zip.generateAsync({ type: 'uint8array' });
      const outPath = join(outDir, `${novel.title.replace(/[:*?"\\\/<>|\0]/g, ' ').trim()}.epub`);
      writeFileSync(outPath, Buffer.from(data));
      console.log(`  ✅ 已保存: ${outPath}`);
    }

    console.log('\n🎉 全部完成!\n');
  } catch (e) {
    console.error(`\n❌ 错误: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function detectExt(u) {
  if (u[0] === 0xFF && u[1] === 0xD8) return '.jpg';
  if (u[0] === 0x89 && u[1] === 0x50) return '.png';
  if (u[0] === 0x47 && u[1] === 0x49) return '.gif';
  if (u[0] === 0x52 && u[1] === 0x49) return '.webp';
  return '.jpg';
}
