'use client';
// 高德地图在浏览器端的加载：Key 来自 /api/map-config，仅用于地图瓦片渲染。
// 由于当前高德 Key 是 Web(JS API) 类型、无法调用其 REST 接口，
// 地点搜索与逆地理编码改走本站 /api/geocode（代理 OpenStreetMap Nominatim）。
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AmapConfig { key: string; searchReady: boolean; serviceHost: string }

let configPromise: Promise<AmapConfig | null> | undefined;
let amapPromise: Promise<any> | undefined;

export function getMapConfig(): Promise<AmapConfig | null> {
  configPromise ??= fetch('/api/map-config').then((r) => r.json()).then((d) => d.amap ?? null).catch(() => null);
  return configPromise;
}

export function loadAmap(cfg: AmapConfig): Promise<any> {
  amapPromise ??= new Promise((resolve, reject) => {
    const w = window as any;
    if (w.AMap) return resolve(w.AMap);
    // 高德 JS API 2.0 要求配置安全密钥；这里用 serviceHost 走本站代理（代理本身仍可响应），
    // 仅用于通过 SDK 的安全校验，地图瓦片不依赖它。搜索/逆地理已改走 /api/geocode。
    w._AMapSecurityConfig = { serviceHost: `${location.origin}${cfg.serviceHost}` };
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(cfg.key)}`;
    script.onload = () => (w.AMap ? resolve(w.AMap) : reject(new Error('AMap did not load')));
    script.onerror = () => { amapPromise = undefined; reject(new Error('AMap could not be reached')); };
    document.head.append(script);
  });
  return amapPromise;
}

export interface PlaceInfo { province: string; city: string; district: string; community: string; address: string; lng: string; lat: string }

// ===== 坐标系转换：WGS-84（GPS / Nominatim） ↔ GCJ-02（高德地图） =====
const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}
function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

export function gcj02ToWgs84(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng - dLng, lat - dLat];
}

// ===== 逆地理编码（GCJ-02 坐标 → 省/市/区/地址）=====
/** 传入 GCJ-02 坐标（高德地图点击坐标），内部转 WGS-84 后请求 Nominatim */
export async function addressAt(lng: number, lat: number): Promise<Partial<PlaceInfo>> {
  const [wLng, wLat] = gcj02ToWgs84(lng, lat);
  try {
    const r = await fetch(`/api/geocode/reverse?lat=${wLat.toFixed(7)}&lng=${wLng.toFixed(7)}`, { cache: 'no-store' });
    if (!r.ok) return {};
    const d = await r.json();
    const a = d?.address ?? {};
    const province = a.state || a.province || '';
    const city = a.city || a.town || a.county || a.municipality || province || '';
    const district = a.city_district || a.county || a.district || a.suburb || a.borough || '';
    const community = a.neighbourhood || a.residential || a.quarter || a.hamlet || a.suburb || '';
    const road = a.road || a.pedestrian || a.footway || '';
    const house = a.house_number ? `${a.house_number}号` : '';
    return {
      province,
      city: city === province ? province : city,
      district: district === city ? '' : district,
      community,
      address: [road, house].filter(Boolean).join('') || d.display_name || '',
    };
  } catch {
    return {};
  }
}

// ===== 地点搜索（关键词 → POI 列表，坐标为 GCJ-02）=====
export interface PoiResult { name: string; address: string; lng: number; lat: number; pname?: string; cityname?: string; adname?: string }

export async function searchPlaces(keyword: string): Promise<PoiResult[]> {
  try {
    const r = await fetch(`/api/geocode/search?q=${encodeURIComponent(keyword)}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const list: any[] = await r.json();
    if (!Array.isArray(list)) return [];
    return list.map((p) => {
      const wLng = parseFloat(p.lon);
      const wLat = parseFloat(p.lat);
      const [gLng, gLat] = wgs84ToGcj02(wLng, wLat);
      const a = p.address ?? {};
      const address = p.display_name || '';
      return {
        name: p.name || address.split(',')[0] || keyword,
        address,
        lng: gLng,
        lat: gLat,
        pname: a.state || '',
        cityname: a.city || a.county || '',
        adname: a.city_district || a.suburb || '',
      };
    });
  } catch {
    return [];
  }
}
