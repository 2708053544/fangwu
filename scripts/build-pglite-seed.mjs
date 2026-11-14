// 构建时预生成一个"已初始化、无业务表"的 PGlite 数据目录（apps/web/pglite-seed）。
// 无服务器平台（Netlify/Vercel）冷启动时把这份目录复制到 /tmp 再打开，
// 可跳过 PGlite 首次 initdb 的 5 秒左右开销，避免函数 10 秒超时。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = path.join(root, 'apps', 'web', 'pglite-seed');
const require = createRequire(path.join(root, 'apps', 'web', 'package.json'));
const { PGlite } = require('@electric-sql/pglite');

fs.rmSync(seedDir, { recursive: true, force: true });
fs.mkdirSync(seedDir, { recursive: true });

const started = Date.now();
const db = new PGlite(seedDir);
await db.exec('select 1');
await db.close();

console.log(`[seed] pglite-seed 已生成（${Date.now() - started} ms）`);
