import { NextResponse } from 'next/server';

// 地理编码代理：高德的 Key 是 Web(JS API) 类型，无法调用其 REST 接口，
// 这里改用 OpenStreetMap Nominatim（免费、无需 Key）实现逆地理编码与地点搜索。
// 浏览器不直连 Nominatim（国内可能不稳定），统一经本站服务器转发。
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const UA = 'fangwu-hackathon/1.0 (geocode proxy)';
const PER_MINUTE = 60;
const hits = new Map<string, { count: number; reset: number }>();

export const runtime = 'nodejs';

type Action = 'reverse' | 'search';

export async function GET(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (action !== 'reverse' && action !== 'search') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // 限流
  const who = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const now = Date.now();
  const seen = hits.get(who);
  if (!seen || seen.reset < now) hits.set(who, { count: 1, reset: now + 60_000 });
  else if (++seen.count > PER_MINUTE) return NextResponse.json({ error: '请求过于频繁' }, { status: 429 });

  const reqUrl = new URL(req.url);
  const target = new URL(NOMINATIM + (action === 'reverse' ? '/reverse' : '/search'));
  target.searchParams.set('format', 'json');
  target.searchParams.set('accept-language', 'zh-CN,zh;q=0.9');
  target.searchParams.set('addressdetails', '1');

  if (action === 'reverse') {
    const lat = reqUrl.searchParams.get('lat');
    const lng = reqUrl.searchParams.get('lng');
    if (!lat || !lng) return NextResponse.json({ error: '缺少 lat/lng' }, { status: 400 });
    target.searchParams.set('lat', lat);
    target.searchParams.set('lon', lng);
    target.searchParams.set('zoom', '18');
  } else {
    const q = reqUrl.searchParams.get('q')?.trim();
    if (!q) return NextResponse.json({ error: '缺少 q' }, { status: 400 });
    target.searchParams.set('q', q);
    target.searchParams.set('limit', '8');
    target.searchParams.set('countrycodes', 'cn');
  }

  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: `地理服务异常（${upstream.status}）` }, { status: 502 });
    }
    const data = await upstream.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: '地理服务无响应' }, { status: 502 });
  }
}
