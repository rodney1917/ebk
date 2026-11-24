#!/usr/bin/env node
/**
 * Builds a single-file, offline DEMO preview of the EBK customer app:
 *   node tools/preview/build-preview.mjs  ->  apps/web/dist-preview/index.html
 *
 * - Uses esbuild + the Tailwind v4 compiler directly (no Vite needed).
 * - Runs against the in-memory DemoTransport (__EBK_DEMO__ = true): no backend, no money.
 * - If react-router-dom / @tanstack/react-query / react-hook-form are not installed,
 *   minimal preview shims from tools/preview/shims are aliased in. The production app
 *   is always built with `npm run build -w @ebk/web` using the real packages.
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const web = path.join(root, 'apps/web');
const shims = path.join(root, 'tools/preview/shims');
const require = createRequire(path.join(web, 'package.json'));
const has = (m) => { try { require.resolve(m); return true; } catch { return false; } };

const alias = {};
if (!has('react-router-dom')) alias['react-router-dom'] = path.join(shims, 'react-router-dom.tsx');
if (!has('@tanstack/react-query')) alias['@tanstack/react-query'] = path.join(shims, 'react-query.tsx');
if (!has('react-hook-form')) alias['react-hook-form'] = path.join(shims, 'react-hook-form.ts');
if (!has('@hookform/resolvers/zod')) alias['@hookform/resolvers/zod'] = path.join(shims, 'react-hook-form.ts');
if (Object.keys(alias).length) console.log('Preview shims in use for:', Object.keys(alias).join(', '));

const nodePaths = (process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean);

const js = await build({
  entryPoints: [path.join(web, 'src/main.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  minify: true,
  jsx: 'automatic',
  alias,
  nodePaths,
  loader: { '.css': 'empty' },
  define: {
    __EBK_DEMO__: 'true',
    'import.meta.env.VITE_API_BASE_URL': '"/api"',
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'warning',
});

// Tailwind: compile src/styles/index.css with candidates scanned from the source.
const twDir = path.dirname(require.resolve('tailwindcss/package.json', { paths: [web, ...nodePaths] }));
const { compile } = await import(pathToFileURL(path.join(twDir, 'dist/lib.mjs')).href);
const cssSrc = fs.readFileSync(path.join(web, 'src/styles/index.css'), 'utf8');
const compiler = await compile(cssSrc, {
  base: twDir,
  loadStylesheet: async (id) => {
    const file = id === 'tailwindcss' ? path.join(twDir, 'index.css') : path.resolve(web, 'src/styles', id);
    return { path: file, base: path.dirname(file), content: fs.readFileSync(file, 'utf8') };
  },
});
const candidates = new Set();
const walk = (d) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(tsx?|html)$/.test(f.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/[^\s"'`{}()<>,;]+/g)) candidates.add(m[0]);
  }
};
walk(path.join(web, 'src'));
walk(shims);
const css = compiler.build([...candidates]);

const favicon = fs.readFileSync(path.join(web, 'public/favicon.svg'), 'utf8');
const html = fs
  .readFileSync(path.join(web, 'index.html'), 'utf8')
  .replace('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />', () => `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(favicon)}" />`)
  .replace('<title>', '<title>[DEMO] ')
  .replace('</head>', () => `<style>${css}</style></head>`)
  .replace('<script type="module" src="/src/main.tsx"></script>', () => `<script>${js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);

const outDir = path.join(web, 'dist-preview');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`Preview written: ${path.relative(root, path.join(outDir, 'index.html'))} (${(html.length / 1024).toFixed(0)} KB)`);
