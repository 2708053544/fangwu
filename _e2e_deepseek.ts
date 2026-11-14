// 端到端验证大模型客户端（真实调用 apps/web/lib/ai.ts 的 callAI）：文本回答 + 看图回答。
// 跑法：npx tsx _e2e_deepseek.ts   （在 i-renovation 目录下）
//   1. 文本调用走 DEEPSEEK_MODEL（默认 deepseek-flash）
//   2. 看图调用固定走支持图像输入的 deepseek-flash
import { callAI } from './apps/web/lib/ai';
import { readFileSync } from 'node:fs';

process.loadEnvFile('apps/web/.env.local');

const IMG_PATH = 'C:/Users/kakssjs/Desktop/d444516177abdfd096e3380f2ec202a8.png';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (cond) pass++; else fail++;
}

async function main() {
  try {
    const r = await callAI([{ role: 'user', content: '只回复两个字：正常' }], { maxTokens: 100, noThinking: true });
    ok('文本调用', /正常/.test(r.text), `回答：${r.text.slice(0, 40)}`);
  } catch (e) {
    ok('文本调用', false, `抛错：${(e as Error).message.slice(0, 160)}`);
  }

  try {
    const b64 = readFileSync(IMG_PATH).toString('base64');
    const r = await callAI(
      [{ role: 'user', content: '这张图是什么内容？用不超过15个字概括。' }],
      { imageBase64: b64, mime: 'image/png', maxTokens: 300, noThinking: true },
    );
    ok('看图调用', r.text.trim().length > 0, `回答：${r.text.trim().slice(0, 60)}`);
  } catch (e) {
    ok('看图调用', false, `抛错：${(e as Error).message.slice(0, 200)}`);
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

void main();
