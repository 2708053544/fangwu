import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 允许并行实例使用独立构建目录，避免 .next 互踩（默认不变）
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@i-renovation/shared'],
  serverExternalPackages: ['@electric-sql/pglite'],
  // 无服务器平台打包函数时，把 PGlite 的 wasm/数据文件一起带上，否则运行时初始化失败
  outputFileTracingIncludes: {
    '/api/**': ['pglite-seed/**', '../../node_modules/@electric-sql/pglite/dist/**'],
  },
};

export default nextConfig;
