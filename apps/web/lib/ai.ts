// 大模型客户端（DeepSeek，OpenAI 兼容）。使用 curl 子进程绕过 webpack fetch polyfill 问题。
// JSON body 通过 stdin 传递，避免 Windows 命令行编码问题。
// 看图任务走支持图像输入的 deepseek-flash，文本任务可用 DEEPSEEK_MODEL 指定其他模型。

const { spawn } = eval('require')('node:child_process');

import { mergeRuns, parseRecognition, type RawRoom, type RawRun } from './recognition';
import { assignOpeningsToRooms } from '@i-renovation/shared/plan';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export function httpsPost(url: string, body: Record<string, unknown>, headers: Record<string, string>, timeoutMs = 65000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const headerArgs = Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]);
    const args = ['-s', '-w', '\n%{http_code}', '-X', 'POST', ...headerArgs, '--data-binary', '@-', url];

    const child = spawn('curl', args, { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf-8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf-8'); });
    child.on('error', (err: Error) => reject(new Error(`curl spawn failed: ${err.message}`)));
    child.on('close', (code: number | null) => {
      if (code !== 0) { reject(new Error(`curl exit ${code}: ${stderr}`)); return; }
      const lastNewline = stdout.lastIndexOf('\n');
      const bodyStr = lastNewline > 0 ? stdout.slice(0, lastNewline) : stdout;
      const statusStr = lastNewline > 0 ? stdout.slice(lastNewline + 1).trim() : '0';
      resolve({ status: parseInt(statusStr, 10) || 0, body: bodyStr });
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

interface Provider { base: string; key: string; model: string }

// DeepSeek 里支持图像输入的模型；看图调用必须落在其中之一
const VISION_MODELS = ['deepseek-flash'];

function providerFor(withImage: boolean): Provider | null {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  const textModel = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
  // 用户用 DEEPSEEK_MODEL 换成纯文本模型时，看图调用仍固定走支持图像的模型，避免请求被拒
  const model = withImage && !VISION_MODELS.includes(textModel) ? 'deepseek-flash' : textModel;
  return {
    base: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    key,
    model,
  };
}

async function requestChat(p: Provider, messages: ChatMessage[], opts?: { imageBase64?: string; mime?: string; maxTokens?: number; noThinking?: boolean }): Promise<{ text: string; tokensUsed: number }> {
  let content: unknown = messages[messages.length - 1].content;
  if (opts?.imageBase64) {
    content = [
      { type: 'text', text: messages[messages.length - 1].content },
      { type: 'image_url', image_url: { url: `data:${opts.mime ?? 'image/png'};base64,${opts.imageBase64}` } },
    ];
  }

  const body = {
    model: p.model,
    messages: [...messages.slice(0, -1), { role: 'user', content }],
    max_tokens: opts?.maxTokens ?? 2000,
    // 看图识别这类任务不需要长时间思考：关掉思考，约快 4 倍，且不会因思考耗尽回答长度而返回空内容
    // （实测 deepseek-flash 关掉后 reasoning_tokens 为 0）。
    ...(opts?.noThinking ? { thinking: { type: 'disabled' } } : {}),
  };

  // 直连实测有 10 秒以上的波动，65 秒上限会误杀正常回答，统一放宽到 120 秒
  const res = await httpsPost(`${p.base}/chat/completions`, body, {
    'content-type': 'application/json',
    authorization: `Bearer ${p.key}`,
  }, 120_000);
  if (res.status < 200 || res.status >= 300) throw new Error(`AI API ${res.status}: ${res.body.slice(0, 200)}`);

  const data = JSON.parse(res.body) as { choices: { message: { content: string | null } }[]; usage?: { total_tokens?: number } };
  const text = data.choices[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('AI API 返回空内容'); // 空回答按失败处理，交给上层异常分类
  return { text, tokensUsed: data.usage?.total_tokens ?? 0 };
}

export async function callAI(messages: ChatMessage[], opts?: { imageBase64?: string; mime?: string; maxTokens?: number; noThinking?: boolean }): Promise<{ text: string; tokensUsed: number }> {
  const p = providerFor(!!opts?.imageBase64);
  if (!p) throw new Error('DEEPSEEK_API_KEY not configured');
  return requestChat(p, messages, opts);
}

/**
 * 户型图视觉识别（画板「AI 识别房间」和 floor_plan 智能体共用这一份实现）：
 * 图片 → 房间矩形 + 门窗（归一化 0~1 坐标）。同一张图并行识别 runs 次，只保留多数次一致的结果。
 */
export async function recognizeFloorPlan(b64: string, mime: string, runs = 3): Promise<
  { rooms: (RawRoom & { openings: ReturnType<typeof assignOpeningsToRooms>[number] })[]; runs: number; tokensUsed: number }
  | { error: string; raw: string; status: number; tokensUsed: number }> {
    const prompt = [
      '这是一张户型平面图（可能是手绘草图或标准制图）。请识别图中所有房间，以及墙上所有的门和窗。',
      '只返回严格 JSON，不要 markdown 代码块、不要解释：',
      '{"rooms":[{"name":"客厅","x":0.1,"y":0.2,"w":0.35,"d":0.4}],"windows":[{"x":0.2,"y":0.19,"w":0.1,"d":0.02}],"doors":[{"x":0.44,"y":0.5,"w":0.02,"d":0.08}]}',
      '所有坐标都是相对整图的归一化坐标（0~1），x 向右、y 向下，w/d 为宽高。',
      'rooms 是房间矩形，忽略尺寸标注和文字注释，房间名用中文（客厅/主卧/次卧/厨房/卫生间/阳台/书房/餐厅等）。',
      'windows 是每一扇窗在图上的外框（窗通常画成墙上的蓝色双线或细线）。doors 是每一扇门在图上的外框（门画成墙上的一个缺口，常带一段弧线）。',
      '一扇门或窗只写一次，即使它被两个房间共用。只写图上真的画出来的，不要猜。没有就写 []。',
    ].join('\n');

    const settled = await Promise.allSettled(Array.from({ length: runs }, () =>
      callAI([{ role: 'user', content: prompt }], { imageBase64: b64, mime, maxTokens: 4000, noThinking: true })));

    const parsed: RawRun[] = [];
    let tokensUsed = 0;
    let lastRaw = '';
    let lastError = '';
    for (const r of settled) {
      if (r.status === 'rejected') { lastError = (r.reason as Error).message; continue; }
      tokensUsed += r.value.tokensUsed;
      lastRaw = r.value.text;
      const run = parseRecognition(r.value.text);
      if (run) parsed.push(run);
    }
    if (parsed.length === 0) {
      return { error: lastError || '识别结果无法解析', raw: lastRaw.slice(0, 200), status: lastError ? 502 : 422, tokensUsed };
    }

    const merged = mergeRuns(parsed);
    const { rooms, windows, doors } = merged.run;
    if (rooms.length === 0) {
      return { error: '多次识别没有一致的房间，请换一张更清晰的户型图', raw: lastRaw.slice(0, 200), status: 422, tokensUsed };
    }
    const hints = assignOpeningsToRooms(rooms, [
      ...windows.map(({ votes, ...b }) => ({ type: 'window' as const, ...b, conf: votes / merged.runs })),
      ...doors.map(({ votes, ...b }) => ({ type: 'door' as const, ...b, conf: votes / merged.runs })),
    ]);

    return { rooms: rooms.map((r, i) => ({ ...r, openings: hints[i] })), runs: merged.runs, tokensUsed };
}
