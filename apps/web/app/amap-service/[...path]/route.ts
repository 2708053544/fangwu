import { NextResponse } from 'next/server';

// 高德地图 Web 服务 Key（演示用，可通过环境变量 AMAP_KEY 覆盖）
const DEFAULT_AMAP_KEY = '027289b64a48464729061b854487d2cf';

// 高德安全密钥代理（高德推荐的 serviceHost 方式）：浏览器的搜索/逆地理请求经这里转发，
// 服务器附加 jscode。只转发 restapi.amap.com 的只读 /v3、/v4 接口，且必须带本站 Key，不是开放代理。
const UPSTREAM = 'https://restapi.amap.com';
// 未配置安全密钥时，转发到已配置好安全密钥的上游服务器，复用其 jscode
const FALLBACK_UPSTREAM = process.env.AMAP_FALLBACK_HOST ?? 'https://39.105.92.190';
const PER_MINUTE = 240;
const hits = new Map<string, { count: number; reset: number }>();

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const key = process.env.AMAP_KEY ?? DEFAULT_AMAP_KEY;
  const code = process.env.AMAP_SECURITY_CODE;
  if (!key) return NextResponse.json({ message: '地图搜索未配置' }, { status: 503 });

  const { path } = await ctx.params;
  const reqUrl = new URL(req.url);
  if (reqUrl.searchParams.get('key') !== key) {
    return NextResponse.json({ message: 'Not allowed' }, { status: 403 });
  }

  // 限流
  const who = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const now = Date.now();
  const seen = hits.get(who);
  if (!seen || seen.reset < now) hits.set(who, { count: 1, reset: now + 60_000 });
  else if (++seen.count > PER_MINUTE) return NextResponse.json({ message: '地图请求过于频繁' }, { status: 429 });

  // 有安全密钥 → 直接请求高德并附加 jscode
  if (code) {
    const target = new URL('/' + path.map(encodeURIComponent).join('/'), UPSTREAM);
    target.search = reqUrl.search;
    if (!/^\/v[34]\//.test(target.pathname)) {
      return NextResponse.json({ message: 'Not allowed' }, { status: 403 });
    }
    target.searchParams.set('jscode', code);
    try {
      const upstream = await fetch(target, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
      return new Response(await upstream.arrayBuffer(), {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
      });
    } catch {
      return NextResponse.json({ message: '地图服务无响应' }, { status: 502 });
    }
  }

  // 没有安全密钥 → 转发到已配好的上游，由它附加 jscode
  const target = new URL('/amap-service/' + path.map(encodeURIComponent).join('/'), FALLBACK_UPSTREAM);
  target.search = reqUrl.search;
  try {
    const upstream = await fetch(target, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json({ message: '地图服务无响应' }, { status: 502 });
  }
}
