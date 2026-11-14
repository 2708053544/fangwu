import { NextResponse } from 'next/server';

// 高德地图 Web 服务 Key（演示用，可通过环境变量 AMAP_KEY 覆盖）
const DEFAULT_AMAP_KEY = '027289b64a48464729061b854487d2cf';

// 高德地图配置：只返回公开的 Web(JS API) Key；安全密钥 AMAP_SECURITY_CODE 只留在服务器，由 /amap-service 代理附加
export function GET() {
  const key = process.env.AMAP_KEY ?? DEFAULT_AMAP_KEY;
  if (!key) return NextResponse.json({ amap: null });
  // 即使没有安全密钥也返回配置：搜索会通过 /amap-service 转发到上游
  return NextResponse.json({ amap: { key, searchReady: true, serviceHost: '/amap-service' } });
}
