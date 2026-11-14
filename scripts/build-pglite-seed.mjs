// 构建时预生成一个"已初始化、无业务表"的 PGlite 数据目录，并导出为单个 gzip 包
// apps/web/pglite-seed.tar.gz。无服务器平台（Netlify/Vercel）冷启动时用它直接加载，
// 跳过 PGlite 首次 initdb 的 5 秒左右开销，避免函数 10 秒超时。
// 用单文件而不是目录，是因为打包工具按目录 glob 收集时容易漏文件。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDir = path.join(root, 'apps', 'web', 'pglite-seed');
const outFile = path.join(root, 'apps', 'web', 'pglite-seed.tar.gz');
const require = createRequire(path.join(root, 'apps', 'web', 'package.json'));
const { PGlite } = require('@electric-sql/pglite');

fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });

const started = Date.now();
const db = new PGlite(workDir);
await db.exec('select 1');
const blob = await db.dumpDataDir('gzip');
await db.close();

fs.writeFileSync(outFile, Buffer.from(await blob.arrayBuffer()));
fs.rmSync(workDir, { recursive: true, force: true });

const size = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
console.log(`[seed] pglite-seed.tar.gz 已生成 ${size} MB（${Date.now() - started} ms）`);
