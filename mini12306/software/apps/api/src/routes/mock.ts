import { Router } from 'express';
import { prisma } from '../db';
import { ApiError, Errors, ok, wrap } from '../lib/http';
import { paymentProvider, identityProvider, smsProvider } from '../providers/mock';
import { combineDateTime } from '../lib/datetime';
import { newRefundNo } from '../lib/ids';

/**
 * Mock 第三方服务对外接口（M8）
 * 与真实服务的字段风格保持同构，便于将来切换为真实实现。
 */
export const mockRouter = Router();

/** POST /mock/identity/verify 实名核验 */
mockRouter.post(
  '/identity/verify',
  wrap(async (req, res) => {
    const { realName, idCardNo } = req.body as { realName?: string; idCardNo?: string };
    if (!realName || !idCardNo) throw new ApiError(1001, '缺少 realName 或 idCardNo', 400);
    const result = await identityProvider.verify(realName, idCardNo);
    return ok(res, result, result.message);
  }),
);

/** POST /mock/identity/card/verify 银行卡四要素核验 */
mockRouter.post(
  '/identity/card/verify',
  wrap(async (req, res) => {
    const body = req.body as { realName?: string; idCardNo?: string; phone?: string; bankCardNo?: string };
    if (!body.realName || !body.idCardNo || !body.phone || !body.bankCardNo) {
      throw new ApiError(1001, '缺少必填项', 400);
    }
    const result = await identityProvider.verifyBankCard({
      realName: body.realName,
      idCardNo: body.idCardNo,
      phone: body.phone,
      bankCardNo: body.bankCardNo,
    });
    return ok(res, result, result.message);
  }),
);

/** POST /mock/sms/send 发送短信 */
mockRouter.post(
  '/sms/send',
  wrap(async (req, res) => {
    const { phone, scene, code } = req.body as { phone?: string; scene?: string; code?: string };
    if (!phone) throw new ApiError(1001, '缺少 phone', 400);
    const result = await smsProvider.send(phone, scene ?? 'GENERAL', code ?? '000000');
    return ok(res, result, result.message);
  }),
);

/** POST /mock/pay/create 创建支付单 */
mockRouter.post(
  '/pay/create',
  wrap(async (req, res) => {
    const { outTradeNo, amountCents, subject } = req.body as { outTradeNo?: string; amountCents?: number; subject?: string };
    if (!outTradeNo || !amountCents) throw new ApiError(1001, '缺少 outTradeNo 或 amountCents', 400);
    const result = await paymentProvider.create({ outTradeNo, amountCents, subject: subject ?? 'Mini-12306 车票' });
    return ok(res, result, result.message);
  }),
);

/** POST /mock/pay/query 查单 */
mockRouter.post(
  '/pay/query',
  wrap(async (req, res) => {
    const { outTradeNo } = req.body as { outTradeNo?: string };
    if (!outTradeNo) throw new ApiError(1001, '缺少 outTradeNo', 400);
    return ok(res, await paymentProvider.query(outTradeNo));
  }),
);

/** POST /mock/pay/refund 退款申请 */
mockRouter.post(
  '/pay/refund',
  wrap(async (req, res) => {
    const { outTradeNo, amountCents, reason } = req.body as { outTradeNo?: string; amountCents?: number; reason?: string };
    if (!outTradeNo || !amountCents) throw new ApiError(1001, '缺少 outTradeNo 或 amountCents', 400);
    const result = await paymentProvider.refund({
      outTradeNo,
      refundNo: newRefundNo(),
      amountCents,
      reason: reason ?? '用户申请退款',
    });
    return ok(res, result, result.message);
  }),
);

/** GET /mock/pay/cashier Mock 银行收银台（HTML 页面，供浏览器打开） */
mockRouter.get('/pay/cashier', (req, res) => {
  const outTradeNo = String(req.query.outTradeNo ?? '');
  void (async () => {
    const payment = await prisma.payment.findUnique({ where: { outTradeNo } });
    const order = payment ? await prisma.order.findUnique({ where: { id: payment.orderId }, include: { schedule: { include: { train: true } } } }) : null;
    const amount = payment ? (payment.amountCents / 100).toFixed(2) : '--';
    const subject = order ? `${order.schedule.train.trainNo} ${order.schedule.runDate} ${order.schedule.train.departTime} 发车` : '未知订单';
    const departAt = order ? combineDateTime(order.schedule.runDate, order.schedule.train.departTime).getTime() : 0;
    void departAt;

    res.type('html').send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Mock 银行收银台 · Mini-12306</title>
<style>
  :root{--brand:#1f6feb;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;background:#f1f5f9;color:var(--ink)}
  .card{width:420px;max-width:92vw;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(15,23,42,.12);padding:28px}
  .bank{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px;letter-spacing:.08em}
  .logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#1f6feb,#38bdf8)}
  h1{font-size:18px;margin:18px 0 6px}
  .amount{font-size:36px;font-weight:700;letter-spacing:-.02em;margin:8px 0 4px}
  .subject{color:var(--muted);font-size:13px;margin-bottom:18px}
  dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px;border-top:1px solid var(--line);padding-top:14px;margin:0 0 20px}
  dt{color:var(--muted)}
  dd{margin:0;text-align:right;font-family:ui-monospace,Consolas,monospace;word-break:break-all}
  button{width:100%;padding:12px;border-radius:10px;border:1px solid transparent;font-size:15px;cursor:pointer;margin-bottom:10px;font-family:inherit}
  .ok{background:var(--brand);color:#fff}
  .ok:hover{background:#1a5fd0}
  .no{background:#fff;color:#b91c1c;border-color:#fecaca}
  .no:hover{background:#fef2f2}
  .cancel{background:#fff;color:var(--muted);border-color:var(--line)}
  #msg{font-size:13px;color:var(--muted);text-align:center;min-height:18px}
  .hint{font-size:12px;color:#94a3b8;text-align:center;margin-top:14px;line-height:1.6}
</style></head>
<body>
  <div class="card">
    <div class="bank"><span class="logo"></span> MOCK BANK · 在线收银台</div>
    <h1>确认支付</h1>
    <div class="amount">￥${amount}</div>
    <div class="subject">${subject}</div>
    <dl>
      <dt>商户单号</dt><dd>${outTradeNo || '--'}</dd>
      <dt>支付方式</dt><dd>Mock 银行卡</dd>
    </dl>
    <button class="ok" onclick="act('SUCCESS')">支付成功</button>
    <button class="no" onclick="act('FAILED')">支付失败</button>
    <button class="cancel" onclick="act('CLOSE')">取消支付</button>
    <div id="msg"></div>
    <div class="hint">这是 Mini-12306 项目内置的 Mock 银行，用于模拟真实支付通道。<br/>点击后将向商户服务端发送带 HMAC-SHA256 签名的异步回调。</div>
  </div>
<script>
async function act(action){
  document.getElementById('msg').textContent = '正在向商户发送回调…';
  const r = await fetch('/api/v1/mock/pay/notify', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ outTradeNo: '${outTradeNo}', action })
  });
  const j = await r.json();
  document.getElementById('msg').textContent = j.message || '处理完成';
  setTimeout(()=>window.close(), 900);
}
</script>
</body></html>`);
  })().catch((e) => res.status(500).type('html').send(`<pre>收银台渲染失败：${String(e)}</pre>`));
});

/**
 * POST /mock/pay/notify
 * 收银台按钮：由 Mock 银行侧构造签名并回调商户服务端的统一回调地址。
 */
mockRouter.post(
  '/pay/notify',
  wrap(async (req, res) => {
    const { outTradeNo, action } = req.body as { outTradeNo?: string; action?: string };
    if (!outTradeNo) throw new ApiError(1001, '缺少 outTradeNo', 400);
    const payment = await prisma.payment.findUnique({ where: { outTradeNo } });
    if (!payment) throw Errors.notFound('支付单不存在');

    const payload = {
      outTradeNo,
      tradeNo: payment.tradeNo ?? `TN${Date.now()}`,
      amountCents: payment.amountCents,
      status: action === 'SUCCESS' ? 'SUCCESS' : action === 'FAILED' ? 'FAILED' : 'CLOSED',
    };
    const sign = paymentProvider.sign(payload);

    const result = await fetch(`http://127.0.0.1:${process.env.PORT ?? 4000}/api/v1/payments/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, sign }),
    }).then((r) => r.json() as Promise<{ message: string }>);

    return ok(res, result, result.message);
  }),
);
