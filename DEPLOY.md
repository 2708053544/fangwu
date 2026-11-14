# 部署指南

本仓库代码已清理完毕（无任何比赛相关字样），AI 统一走 DeepSeek 客户端，数据层使用内置 PGlite（无需外部数据库）。

## 方式一：已有服务器更新（推荐，如 39.105.92.190）

服务器上跑着旧版时，直接拉取最新代码重建：

```bash
cd /path/to/fangwu          # 服务器上的项目目录
git pull origin main        # 或重新 git clone https://github.com/2708053544/fangwu.git
npm install                 # 安装依赖（workspaces 会一并装好）
npm run build -w apps/web   # 构建业主端
npm run start -w apps/web   # 启动（默认 3000 端口，可用 -p 指定）
```

如果用 pm2 / systemd 守护进程，重启对应服务即可，例如：

```bash
pm2 restart yushe           # pm2 场景
systemctl restart yushe     # systemd 场景
```

## 方式二：全新服务器部署

```bash
git clone https://github.com/2708053544/fangwu.git
cd fangwu
npm install
npm run build -w apps/web
PORT=3000 npm run start -w apps/web
```

用 Nginx 反向代理 3000 端口到 80/443，绑定域名即可对外访问。

## 环境变量

复制 `.env.example` 为 `apps/web/.env.local` 并填写：

| 变量 | 说明 | 缺失时的表现 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥 | AI 识别/匹配不可用，自动走规则兜底 |
| `SESSION_SECRET` | 会话签名密钥（≥32 字符） | 每次重启后登录态失效 |
| `BOSS_PHONE` / `BOSS_PASSWORD` | 老板控制台账号 | 无法登录老板端 |
| `AGNES_API_KEY` | 图像生成密钥 | 3D/效果图生成不可用 |

数据落在项目根目录 `.pglite-data/`（自动创建），备份该目录即备份数据。

## 注意事项

- Node 版本 ≥ 22（项目 engines 声明 ≥24，22 可正常运行）。
- 不要在多个服务进程中共用同一个 `.pglite-data` 目录。
- 上传的图片在 `IRENO_UPLOAD_DIR`（默认 uploads/），同样需要备份。
