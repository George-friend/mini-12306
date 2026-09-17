import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import { config, DEFAULT_SETTINGS } from './config';
import { prisma } from './db';
import { errorHandler, ok, requestId } from './lib/http';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/trains';
import { orderRouter, expireOutdatedOrders } from './routes/orders';
import { paymentRouter } from './routes/payments';
import { ticketRouter } from './routes/tickets';
import { clerkRouter } from './routes/clerk';
import { adminRouter } from './routes/admin';
import { mockRouter } from './routes/mock';
import { passengerRouter } from './routes/passengers';

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestId);

/** 健康检查 */
app.get('/api/v1/health', (_req, res) =>
  ok(res, {
    service: 'mini-12306-api',
    version: '1.0.0',
    providerMode: config.providerMode,
    time: new Date().toISOString(),
  }),
);

/** 业务路由（统一前缀 /api/v1） */
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/passengers', passengerRouter);
app.use('/api/v1', publicRouter);
app.use('/api/v1', orderRouter);
app.use('/api/v1', paymentRouter);
app.use('/api/v1', ticketRouter);
/** 售票窗口与管理端：各自挂载独立前缀，避免路由级守卫误拦其它请求 */
app.use('/api/v1/clerk', clerkRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/mock', mockRouter);

/** 未匹配的 API 路径 */
app.use('/api', (_req, res) => {
  res.status(404).json({ code: 1004, message: '接口不存在', data: null, requestId: null });
});

/** 若前端已构建，则由后端一并托管（单端口演示） */
const webDist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  // eslint-disable-next-line no-console
  console.log(`[web] 已托管前端构建产物：${webDist}`);
}

app.use(errorHandler);

/** 首次启动补齐系统参数默认值 */
async function ensureSettings() {
  for (const s of DEFAULT_SETTINGS) {
    const exist = await prisma.systemSetting.findUnique({ where: { key: s.key } });
    if (!exist) await prisma.systemSetting.create({ data: s });
  }
}

/** 定时任务：每 60 秒扫描并释放超时未支付订单（BR-01） */
function startJobs() {
  setInterval(async () => {
    try {
      const n = await expireOutdatedOrders();
      if (n > 0) console.log(`[job] 释放超时订单 ${n} 笔`);
    } catch (e) {
      console.error('[job] 超时订单扫描失败', e);
    }
  }, 60_000);
}

async function main() {
  await ensureSettings();
  startJobs();
  app.listen(config.port, () => {
    console.log('');
    console.log('  Mini-12306 后端服务已启动');
    console.log(`  API       : http://127.0.0.1:${config.port}/api/v1`);
    console.log(`  健康检查  : http://127.0.0.1:${config.port}/api/v1/health`);
    console.log(`  第三方模式: ${config.providerMode}（Mock 实名认证 / 短信 / 银行支付）`);
    console.log('');
  });
}

main().catch((e) => {
  console.error('服务启动失败：', e);
  process.exit(1);
});
