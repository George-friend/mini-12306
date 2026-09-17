/**
 * 端到端冒烟测试：把「注册实名 → 查询 → 下单 → 支付 → 退票 → 改签 → 管理端 → 售票窗口」全流程跑一遍。
 * 用法：node scripts/smoke.mjs   （需先启动后端服务）
 */
const BASE = `http://127.0.0.1:${process.env.PORT ?? 4000}/api/v1`;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    failures.push(`${name} ${detail}`);
    console.log(`  ❌ ${name} ${detail}`);
  }
}

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

function idCard(base17) {
  const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const C = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  let s = 0;
  for (let i = 0; i < 17; i += 1) s += Number(base17[i]) * W[i];
  return base17 + C[s % 11];
}

const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
// 下单相关用例统一使用次日车次：当日早班车可能已过"开车前 30 分钟停止售票"的截止时间
const bookDate = new Date(Date.now() + 8 * 3600 * 1000 + 86400 * 1000).toISOString().slice(0, 10);

async function main() {
  console.log('\n=== 1. 健康检查 ===');
  const health = await call('GET', '/health');
  check('服务健康检查返回 code=0', health.code === 0, JSON.stringify(health).slice(0, 160));

  console.log('\n=== 2. 车站与车次查询（免登录） ===');
  const stations = await call('GET', '/stations');
  check('车站列表非空', stations.data?.list?.length > 0, `count=${stations.data?.list?.length}`);
  const search = await call('GET', `/trains/search?from=${encodeURIComponent('北京南')}&to=${encodeURIComponent('上海虹桥')}&date=${today}`);
  check('车次查询有结果', search.data?.list?.length > 0, `total=${search.data?.total}`);
  const firstTrain = search.data?.list?.[0];
  check('车次含余票与票价', !!firstTrain?.seats?.length, JSON.stringify(firstTrain?.seats?.[0] ?? {}));
  check('余票文案符合规则', ['有票', '无票'].includes(firstTrain?.seats?.[0]?.availableText) || /^\d+$/.test(firstTrain?.seats?.[0]?.availableText ?? ''), firstTrain?.seats?.[0]?.availableText);

  console.log('\n=== 3. 注册（实名核验 + 短信验证码） ===');
  const phone = `139${String(Math.floor(Math.random() * 90000000 + 10000000))}`;
  const sms = await call('POST', '/auth/sms-code', { body: { phone, scene: 'REGISTER' } });
  check('发送验证码成功', sms.code === 0, JSON.stringify(sms).slice(0, 160));
  const newUsername = `smoke${Date.now().toString().slice(-6)}`;
  const card = idCard(`110101199${Math.floor(Math.random() * 9) + 1}0${Math.floor(Math.random() * 2) + 1}0${Math.floor(Math.random() * 2) + 1}${Math.floor(Math.random() * 900 + 100)}`);
  const reg = await call('POST', '/auth/register', {
    body: { username: newUsername, password: 'Test@123456', realName: '冒烟测试', idCardNo: card, phone, smsCode: '123456' },
  });
  check('实名注册成功并返回令牌', reg.code === 0 && !!reg.data?.token, JSON.stringify(reg).slice(0, 200));
  check('证件号已脱敏返回', String(reg.data?.user?.idCardMasked ?? '').includes('*'), reg.data?.user?.idCardMasked);

  console.log('\n=== 4. 实名核验风控（Mock 黑名单） ===');
  const risk = await call('POST', '/mock/identity/verify', { body: { realName: '测试用户', idCardNo: '110101199003078881' } });
  check('风控名单被拒绝', risk.data?.success === false && risk.data?.code === 'RISK_REJECTED', JSON.stringify(risk.data).slice(0, 160));

  console.log('\n=== 5. 旅客登录与乘车人 ===');
  const login = await call('POST', '/auth/login', { body: { username: 'passenger01', password: 'Pass@123456' } });
  check('旅客登录成功', login.code === 0 && !!login.data?.token, JSON.stringify(login).slice(0, 160));
  const token = login.data.token;

  const passengers = await call('GET', '/passengers', { token });
  check('乘车人列表非空', passengers.data?.list?.length > 0, `count=${passengers.data?.list?.length}`);
  const adult = passengers.data.list.find((p) => p.passengerType === 'ADULT');

  console.log('\n=== 6. 下单（锁票） ===');
  const bookSearch = await call('GET', `/trains/search?from=${encodeURIComponent('北京南')}&to=${encodeURIComponent('上海虹桥')}&date=${bookDate}`);
  const g101 = bookSearch.data.list.find((t) => t.seats.some((s) => s.seatClass === 'SECOND' && s.available > 1));
  check('次日车次可查询到', !!g101, `bookDate=${bookDate}`);
  const secondSeat = g101.seats.find((s) => s.seatClass === 'SECOND');
  const order = await call('POST', '/orders', {
    token,
    headers: { 'Idempotency-Key': `smoke-${Date.now()}` },
    body: { scheduleId: g101.scheduleId, seatClass: 'SECOND', passengerIds: [adult.id] },
  });
  check('下单成功并锁定余票', order.code === 0 && order.data?.status === 'PENDING_PAYMENT', JSON.stringify(order).slice(0, 220));
  const orderNo = order.data?.orderNo;
  check('订单号格式正确', /^M\d{18}$/.test(orderNo ?? ''), orderNo);
  check('车票已分配座位号', !!order.data?.items?.[0]?.seatNo, order.data?.items?.[0]?.seatNo);
  check('订单金额等于票价', order.data?.totalAmountCents === secondSeat?.priceCents, `${order.data?.totalAmountCents} vs ${secondSeat?.priceCents}`);

  console.log('\n=== 7. 下单幂等性 ===');
  const adults = passengers.data.list.filter((p) => p.passengerType === 'ADULT');
  const idemAdult = adults[1] ?? adults[0];
  const key = `idem-${Date.now()}`;
  const idemBody = { scheduleId: g101.scheduleId, seatClass: 'FIRST', passengerIds: [idemAdult.id] };
  const a1 = await call('POST', '/orders', { token, headers: { 'Idempotency-Key': key }, body: idemBody });
  const a2 = await call('POST', '/orders', { token, headers: { 'Idempotency-Key': key }, body: idemBody });
  check('首次下单成功', a1.code === 0, JSON.stringify(a1).slice(0, 160));
  check('重复提交返回同一订单（幂等）', a1.code === 0 && a1.data?.orderNo === a2.data?.orderNo, `${a1.data?.orderNo} / ${a2.data?.orderNo}`);
  const cancelIdem = await call('POST', `/orders/${a1.data.orderNo}/cancel`, { token });
  check('取消待支付订单并释放余票', cancelIdem.data?.status === 'CANCELLED' && cancelIdem.data?.items?.[0]?.ticketStatus === 'CANCELLED', cancelIdem.data?.status);

  console.log('\n=== 8. 支付（Mock 银行收银台 → 签名回调） ===');
  const pay = await call('POST', `/orders/${orderNo}/pay`, { token });
  check('创建支付单并返回收银台地址', pay.code === 0 && !!pay.data?.payUrl, JSON.stringify(pay.data).slice(0, 200));
  const simulate = await call('POST', `/payments/${orderNo}/simulate`, { token, body: { action: 'SUCCESS' } });
  check('模拟支付成功后订单转已支付', simulate.data?.order?.status === 'PAID', JSON.stringify(simulate.data?.order?.status));
  check('车票状态为已出票', simulate.data?.order?.items?.[0]?.ticketStatus === 'TICKETED', simulate.data?.order?.items?.[0]?.ticketStatus);
  const afterPay = await call('GET', `/trains/search?from=${encodeURIComponent('北京南')}&to=${encodeURIComponent('上海虹桥')}&date=${bookDate}`);
  const afterSeat = afterPay.data.list.find((t) => t.scheduleId === g101.scheduleId)?.seats.find((s) => s.seatClass === 'SECOND');
  check('支付后余票减少 1', afterSeat?.available === secondSeat.available - 1, `${secondSeat.available} → ${afterSeat?.available}`);

  console.log('\n=== 9. 退票费试算与退票 ===');
  const itemId = simulate.data.order.items[0].id;
  const preview = await call('GET', `/refunds/preview?orderItemIds=${itemId}`, { token });
  check('退票费试算返回费率与金额', preview.code === 0 && typeof preview.data?.list?.[0]?.feeCents === 'number', JSON.stringify(preview.data?.list?.[0] ?? {}).slice(0, 200));
  const refund = await call('POST', '/refunds', { token, body: { orderItemIds: [itemId], reason: '冒烟测试退票' } });
  check('退票成功并生成退款流水', refund.code === 0 && refund.data?.refundNos?.length > 0, JSON.stringify(refund).slice(0, 200));
  check('退票后订单状态更新', ['REFUNDED', 'PARTIAL_REFUNDED'].includes(refund.data?.orders?.[0]?.status), refund.data?.orders?.[0]?.status);

  console.log('\n=== 10. 改签（差价试算 + 改签） ===');
  const second = await call('POST', '/orders', { token, headers: { 'Idempotency-Key': `chg-${Date.now()}` }, body: { scheduleId: g101.scheduleId, seatClass: 'SECOND', passengerIds: [idemAdult.id] } });
  check('改签前置下单成功', second.code === 0, JSON.stringify(second).slice(0, 160));
  await call('POST', `/orders/${second.data.orderNo}/pay`, { token });
  await call('POST', `/payments/${second.data.orderNo}/simulate`, { token, body: { action: 'SUCCESS' } });
  const secondOrder = await call('GET', `/orders/${second.data.orderNo}`, { token });
  check('前置订单已支付并出票', secondOrder.data?.items?.[0]?.ticketStatus === 'TICKETED', secondOrder.data?.items?.[0]?.ticketStatus);
  const chgItem = secondOrder.data.items[0].id;
  const targetTrain = bookSearch.data.list.find((t) => t.scheduleId !== g101.scheduleId && t.scheduleStatus === 'NORMAL');
  check('找到可改签的目标车次', !!targetTrain, targetTrain?.trainNo);
  const chgPreview = await call('POST', '/changes/preview', { token, body: { orderItemIds: [chgItem], toScheduleId: targetTrain.scheduleId, toSeatClass: 'FIRST' } });
  check('改签试算返回差价', chgPreview.code === 0 && typeof chgPreview.data?.list?.[0]?.diffCents === 'number', JSON.stringify(chgPreview.data?.list?.[0] ?? {}).slice(0, 220));
  const change = await call('POST', '/changes', { token, body: { orderItemIds: [chgItem], toScheduleId: targetTrain.scheduleId, toSeatClass: 'FIRST' } });
  check('改签成功并生成新订单', change.code === 0 && !!change.data?.newOrderNo, JSON.stringify(change).slice(0, 220));
  check('新票状态为已出票', change.data?.newOrder?.items?.[0]?.ticketStatus === 'TICKETED', change.data?.newOrder?.items?.[0]?.ticketStatus);
  const changeAgain = await call('POST', '/changes', { token, body: { orderItemIds: [change.data.newOrder.items[0].id], toScheduleId: targetTrain.scheduleId, toSeatClass: 'SECOND' } });
  check('已改签过的票不可再次改签', changeAgain.code === 6002, `code=${changeAgain.code} ${changeAgain.message}`);

  console.log('\n=== 11. 管理员端 ===');
  const adminLogin = await call('POST', '/auth/login', { body: { username: 'admin01', password: 'Admin@123456' } });
  const adminToken = adminLogin.data?.token;
  check('管理员登录成功', !!adminToken);
  const overview = await call('GET', '/admin/stats/overview', { token: adminToken });
  check('运营概览返回统计', overview.code === 0 && overview.data?.orderCount > 0, JSON.stringify(overview.data).slice(0, 200));
  const settings = await call('GET', '/admin/settings', { token: adminToken });
  check('系统参数列表非空', settings.data?.list?.length >= 10, `count=${settings.data?.list?.length}`);
  const updSetting = await call('PUT', '/admin/settings/order.pay_timeout_minutes', { token: adminToken, body: { value: '20' } });
  check('修改系统参数成功（立即生效）', updSetting.code === 0, JSON.stringify(updSetting).slice(0, 160));
  await call('PUT', '/admin/settings/order.pay_timeout_minutes', { token: adminToken, body: { value: '15' } });
  const ann = await call('POST', '/admin/announcements', { token: adminToken, body: { title: '冒烟测试公告', content: '这是一条用于验证公告发布链路的测试公告。', type: 'NOTICE' } });
  check('发布公告成功', ann.code === 0, JSON.stringify(ann).slice(0, 160));
  const audits = await call('GET', '/admin/audit-logs', { token: adminToken });
  check('审计日志已记录管理员操作', audits.data?.total > 0, `total=${audits.data?.total}`);
  const forbidden = await call('GET', '/admin/stats/overview', { token });
  check('旅客访问管理端被拒绝（403/1003）', forbidden.code === 1003, `code=${forbidden.code}`);

  console.log('\n=== 12. 并发抢票（零超卖） ===');
  const target = (await call('GET', `/trains/search?from=${encodeURIComponent('上海虹桥')}&to=${encodeURIComponent('杭州东')}&date=${bookDate}`)).data.list[0];
  const invUpd = await call('GET', `/admin/schedules?date=${bookDate}&trainNo=${target.trainNo}`, { token: adminToken });
  const bizInv = invUpd.data.list[0].inventory.find((i) => i.seatClass === 'BUSINESS');
  await call('PUT', `/admin/inventory/${bizInv.id}`, { token: adminToken, body: { totalCount: bizInv.soldCount + 3 } });
  const payer = await call('POST', '/auth/login', { body: { username: 'passenger02', password: 'Pass@123456' } });
  const p2token = payer.data.token;

  // 为该账号准备 8 名不同乘车人，保证并发请求之间不因"重复购票"规则互相干扰，
  // 从而让竞争真实发生在库存扣减环节。
  const racePassengers = [];
  for (let i = 0; i < 8; i += 1) {
    const c = idCard(`1101011993${String(i + 1).padStart(2, '0')}${String(i + 10).padStart(2, '0')}${String(100 + i)}`);
    const r = await call('POST', '/passengers', { token: p2token, body: { name: `并发测试${i + 1}`, idCardNo: c, passengerType: 'ADULT' } });
    if (r.code === 0) racePassengers.push(r.data.id);
  }
  check('并发测试乘车人准备完成', racePassengers.length === 8, `已准备 ${racePassengers.length} 人`);

  const results = await Promise.all(
    racePassengers.map((pid, i) =>
      call('POST', '/orders', {
        token: p2token,
        headers: { 'Idempotency-Key': `race-${Date.now()}-${i}` },
        body: { scheduleId: target.scheduleId, seatClass: 'BUSINESS', passengerIds: [pid] },
      }),
    ),
  );
  const okCount = results.filter((r) => r.code === 0).length;
  const codes = [...new Set(results.filter((r) => r.code !== 0).map((r) => r.code))];
  const invAfter = await call('GET', `/admin/schedules?date=${bookDate}&trainNo=${target.trainNo}`, { token: adminToken });
  const bizAfter = invAfter.data.list[0].inventory.find((i) => i.seatClass === 'BUSINESS');
  check('并发下单成功数不超过剩余库存（3）', okCount <= 3, `成功 ${okCount} 笔`);
  check('库存未超卖（已售 + 锁定 ≤ 定员）', bizAfter.soldCount + bizAfter.lockedCount <= bizAfter.totalCount, `${bizAfter.soldCount} + ${bizAfter.lockedCount} ≤ ${bizAfter.totalCount}`);
  check('恰好卖出剩余的全部 3 张（无无效拒绝）', okCount === 3, `成功 ${okCount} 笔，拒绝码 ${JSON.stringify(codes)}`);

  console.log('\n=== 13. 售票窗口 ===');
  const clerkLogin = await call('POST', '/auth/login', { body: { username: 'clerk01', password: 'Clerk@123456' } });
  const clerkToken = clerkLogin.data?.token;
  check('售票员登录成功', !!clerkToken);
  const cSearch = await call('GET', '/clerk/orders/search?keyword=13800000003', { token: clerkToken });
  check('按手机号检索到旅客', cSearch.data?.users?.length > 0, `users=${cSearch.data?.users?.length}`);
  const cUser = cSearch.data.users[0];
  const cPass = await call('GET', `/clerk/users/${cUser.id}/passengers`, { token: clerkToken });
  const cAdult = cPass.data.list.find((x) => x.passengerType === 'ADULT');
  const ticketTrain = (await call('GET', `/trains/search?from=${encodeURIComponent('北京南')}&to=${encodeURIComponent('南京南')}&date=${bookDate}`)).data.list[0];
  const cOrder = await call('POST', '/clerk/orders', { token: clerkToken, headers: { 'Idempotency-Key': `clerk-${Date.now()}` }, body: { userId: cUser.id, scheduleId: ticketTrain.scheduleId, seatClass: 'SECOND', passengerIds: [cAdult.id] } });
  check('窗口代客下单成功', cOrder.code === 0, JSON.stringify(cOrder).slice(0, 200));
  const cash = await call('POST', `/clerk/orders/${cOrder.data?.orderNo}/pay-cash`, { token: clerkToken });
  check('窗口现金收银出票成功', cash.data?.status === 'PAID' && cash.data?.items?.[0]?.ticketStatus === 'TICKETED', JSON.stringify(cash.data?.status));

  console.log('\n=== 14. 异常与边界 ===');
  const badLogin = await call('POST', '/auth/login', { body: { username: 'passenger01', password: 'wrong-password' } });
  check('密码错误被拒绝', badLogin.code === 2001, `code=${badLogin.code}`);
  const sameStation = await call('GET', `/trains/search?from=${encodeURIComponent('北京南')}&to=${encodeURIComponent('北京南')}&date=${today}`);
  check('同站查询被拒绝', sameStation.code === 1001, `code=${sameStation.code}`);
  const cancelPaid = await call('POST', `/orders/${orderNo}/cancel`, { token });
  check('已支付订单不可取消', cancelPaid.code === 5001, `code=${cancelPaid.code}`);

  console.log('\n=== 15. 管理端 CRUD 全链路 ===');
  const newStation = await call('POST', '/admin/stations', { token: adminToken, body: { code: 'SMK', name: '冒烟测试站', city: '测试市', province: '测试省', pinyin: 'maoyanceshizhan' } });
  check('新增车站成功', newStation.code === 0, JSON.stringify(newStation).slice(0, 160));
  const newTrain = await call('POST', '/admin/trains', {
    token: adminToken,
    body: { trainNo: 'G901', trainType: 'G', fromStationId: newStation.data?.id, toStationId: newStation.data?.id, departTime: '09:00', arriveTime: '10:00', durationMin: 60, mileageKm: 100, basePriceCents: 5000 },
  });
  check('同站车次被拒绝', newTrain.code === 1001, `code=${newTrain.code}`);

  const st = await call('GET', '/stations');
  const fromSt = st.data.list.find((s) => s.name === '北京南');
  const toSt = st.data.list.find((s) => s.name === '天津');
  const train2 = await call('POST', '/admin/trains', {
    token: adminToken,
    body: { trainNo: 'G901', trainType: 'G', fromStationId: fromSt.id, toStationId: toSt.id, departTime: '09:00', arriveTime: '09:35', durationMin: 35, mileageKm: 120, basePriceCents: 5500 },
  });
  check('新增车次成功', train2.code === 0, JSON.stringify(train2).slice(0, 160));
  check('重复车次号被拒绝', (await call('POST', '/admin/trains', { token: adminToken, body: { trainNo: 'G901', trainType: 'G', fromStationId: fromSt.id, toStationId: toSt.id, departTime: '09:00', arriveTime: '09:35', durationMin: 35, mileageKm: 120, basePriceCents: 5500 } })).code === 2002);

  const gen = await call('POST', `/admin/trains/${train2.data?.id}/schedules`, { token: adminToken, body: { startDate: bookDate, endDate: bookDate } });
  check('批量生成运行日成功', gen.code === 0 && gen.data?.created === 1, JSON.stringify(gen.data));
  const genAgain = await call('POST', `/admin/trains/${train2.data?.id}/schedules`, { token: adminToken, body: { startDate: bookDate, endDate: bookDate } });
  check('重复生成运行日幂等（不重复创建）', genAgain.data?.created === 0, `created=${genAgain.data?.created}`);

  const schList = await call('GET', `/admin/schedules?date=${bookDate}&trainNo=G901`, { token: adminToken });
  const sch = schList.data.list[0];
  check('运行日生成后含席别库存', sch?.inventory?.length === 4, `席别数=${sch?.inventory?.length}`);
  const schStatus = await call('PUT', `/admin/schedules/${sch.id}`, { token: adminToken, body: { status: 'DELAYED', delayMinutes: 15, note: '冒烟测试晚点' } });
  check('修改运行日状态成功', schStatus.code === 0 && schStatus.data?.status === 'DELAYED', JSON.stringify(schStatus.data).slice(0, 120));
  const se = sch.inventory.find((i) => i.seatClass === 'SECOND');
  const priceUpd = await call('PUT', `/admin/inventory/${se.id}`, { token: adminToken, body: { priceCents: se.priceCents + 100, totalCount: se.totalCount } });
  check('调整票价成功', priceUpd.code === 0 && priceUpd.data?.priceCents === se.priceCents + 100, `price=${priceUpd.data?.priceCents}`);
  // 用已有售票的席别验证"定员不得低于已售+已锁定"（第 12 项并发下单已在该席别占用 3 张）
  const guardSch = (await call('GET', `/admin/schedules?date=${bookDate}&trainNo=${target.trainNo}`, { token: adminToken })).data.list[0];
  const guardInv = guardSch.inventory.find((i) => i.seatClass === 'BUSINESS');
  const badInv = await call('PUT', `/admin/inventory/${guardInv.id}`, { token: adminToken, body: { totalCount: 0 } });
  check('定员低于已售+已锁定被拒绝', badInv.code === 1001, `code=${badInv.code} ${badInv.message}`);
  const delTrain = await call('DELETE', `/admin/trains/${train2.data?.id}`, { token: adminToken });
  check('删除无订单车次成功', delTrain.code === 0, JSON.stringify(delTrain).slice(0, 120));
  const delStation = await call('DELETE', `/admin/stations/${newStation.data?.id}`, { token: adminToken });
  check('删除未被引用车站成功', delStation.code === 0);
  const delUsedStation = await call('DELETE', `/admin/stations/${fromSt.id}`, { token: adminToken });
  check('删除被车次引用的车站被拒绝', delUsedStation.code === 1001, `code=${delUsedStation.code}`);

  const annList = await call('GET', '/admin/announcements', { token: adminToken });
  const smokeAnn = annList.data.list.find((a) => a.title === '冒烟测试公告');
  const offAnn = await call('PUT', `/admin/announcements/${smokeAnn.id}`, { token: adminToken, body: { status: 'OFFLINE' } });
  check('公告下架成功', offAnn.code === 0 && offAnn.data?.status === 'OFFLINE', offAnn.data?.status);
  check('已下架公告不在前台展示', (await call('GET', '/announcements')).data.list.every((a) => a.title !== '冒烟测试公告'));
  check('删除公告成功', (await call('DELETE', `/admin/announcements/${smokeAnn.id}`, { token: adminToken })).code === 0);

  const p3 = await call('POST', '/auth/login', { body: { username: 'passenger03', password: 'Pass@123456' } });
  const p3id = p3.data?.user?.id;
  check('冻结用户成功', (await call('PATCH', `/admin/users/${p3id}/status`, { token: adminToken, body: { status: 'FROZEN' } })).code === 0);
  const frozenLogin = await call('POST', '/auth/login', { body: { username: 'passenger03', password: 'Pass@123456' } });
  check('冻结后登录被拒绝', frozenLogin.code === 2003, `code=${frozenLogin.code}`);
  check('解冻用户成功', (await call('PATCH', `/admin/users/${p3id}/status`, { token: adminToken, body: { status: 'ACTIVE' } })).code === 0);
  check('解冻后可正常登录', (await call('POST', '/auth/login', { body: { username: 'passenger03', password: 'Pass@123456' } })).code === 0);
  const reset = await call('POST', `/admin/users/${p3id}/reset-password`, { token: adminToken });
  check('重置密码返回新密码', reset.code === 0 && typeof reset.data?.newPassword === 'string', reset.data?.newPassword);
  const job = await call('POST', '/admin/jobs/expire-orders', { token: adminToken });
  check('手动触发超时订单释放', job.code === 0 && typeof job.data?.released === 'number', JSON.stringify(job.data));

  console.log('\n=== 16. Mock 第三方服务接口 ===');
  // 6222020200112233446 通过 Luhn 校验；末位改为 5 则不通过
  const cardOk = await call('POST', '/mock/identity/card/verify', { body: { realName: '张伟', idCardNo: '110101199001011237', phone: '13800000003', bankCardNo: '6222020200112233446' } });
  check('银行卡四要素核验通过', cardOk.data?.success === true, `${cardOk.data?.code} ${cardOk.data?.message}`);
  const cardBad = await call('POST', '/mock/identity/card/verify', { body: { realName: '张伟', idCardNo: '110101199001011237', phone: '13800000003', bankCardNo: '6222020200112233445' } });
  check('非法银行卡号被拒绝', cardBad.data?.success === false && cardBad.data?.code === 'BANK_CARD_INVALID', cardBad.data?.code);
  const payCreate = await call('POST', '/mock/pay/create', { body: { outTradeNo: `OTSMOKE${Date.now()}`, amountCents: 12345, subject: '冒烟测试支付单' } });
  check('Mock 支付创建返回收银台地址', payCreate.data?.success === true && String(payCreate.data?.payUrl).includes('cashier'), payCreate.data?.payUrl);
  const payQuery = await call('POST', '/mock/pay/query', { body: { outTradeNo: payCreate.data?.outTradeNo } });
  check('Mock 支付查单可用', typeof payQuery.data?.status === 'string', payQuery.data?.status);
  const cashier = await fetch(`http://127.0.0.1:${process.env.PORT ?? 4000}/api/v1/mock/pay/cashier?outTradeNo=${payCreate.data?.outTradeNo}`);
  const html = await cashier.text();
  check('Mock 银行收银台页面可打开', cashier.status === 200 && html.includes('MOCK BANK'), `status=${cashier.status}`);
  const badSign = await fetch(`http://127.0.0.1:${process.env.PORT ?? 4000}/api/v1/payments/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outTradeNo: payCreate.data?.outTradeNo, tradeNo: 'TNX', amountCents: 12345, status: 'SUCCESS', sign: 'wrong-sign' }),
  }).then((r) => r.json());
  check('支付回调签名错误被拒绝（7002）', badSign.code === 7002, `code=${badSign.code}`);

  console.log(`\n================ 结果 ================`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  if (failures.length) {
    console.log('  失败明细：');
    failures.forEach((f) => console.log(`    - ${f}`));
  }
  console.log('');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('冒烟测试异常终止：', e);
  process.exit(1);
});
