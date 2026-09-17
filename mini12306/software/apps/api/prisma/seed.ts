/**
 * 初始化数据（seed）
 * ─ 车站 / 车次 / 未来 14 天运行日与库存 / 演示账号 / 系统参数 / 公告 / 示例订单
 * ─ 运行：npm run db:seed（或 npm run db:reset 重建库）
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();
const KEY = Buffer.from(process.env.ID_CARD_AES_KEY ?? '6d696e6931323330362d6c6f63616c2d6465762d6b65792d3230323630313031', 'hex');

/** 加密证件号（与 src/lib/crypto.ts 保持一致） */
function encryptIdCard(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}
function hashIdCard(plain: string): string {
  return crypto.createHmac('sha256', KEY).update(plain.trim().toUpperCase()).digest('hex');
}

/** 由 17 位前缀计算 GB 11643 校验位，生成合法身份证号 */
const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
function idCard(base17: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += Number(base17[i]) * WEIGHTS[i];
  return base17 + CHECK[sum % 11];
}

/** 东八区日期字符串 */
function cnDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

/** 席别系数 / 票种折扣（与 src/services/pricing.ts 保持一致） */
const SEAT_FACTOR: Record<string, number> = { BUSINESS: 3.0, FIRST: 1.6, SECOND: 1.0, SOFT_SLEEPER: 1.9, HARD_SLEEPER: 1.2, HARD_SEAT: 0.8, STANDING: 1.0 };
const CAPACITY: Record<string, number> = { BUSINESS: 20, FIRST: 60, SECOND: 400, SOFT_SLEEPER: 36, HARD_SLEEPER: 66, HARD_SEAT: 480, STANDING: 120 };
function mileageFactor(km: number): number {
  if (km <= 200) return 0.9;
  if (km <= 500) return 1.0;
  if (km <= 1000) return 1.1;
  return 1.2;
}
function price(baseYuan: number, seatClass: string, km: number): number {
  return Math.round(baseYuan * 100 * (SEAT_FACTOR[seatClass] ?? 1) * mileageFactor(km));
}
function classesFor(type: string): string[] {
  return type === 'G' || type === 'D' ? ['BUSINESS', 'FIRST', 'SECOND', 'STANDING'] : ['SOFT_SLEEPER', 'HARD_SLEEPER', 'HARD_SEAT'];
}

/* ── 基础数据定义 ─────────────────────────────────────────── */

const STATIONS = [
  ['VNP', '北京南', '北京', '北京市', 'beijingnan'],
  ['BXP', '北京西', '北京', '北京市', 'beijingxi'],
  ['AOH', '上海虹桥', '上海', '上海市', 'shanghaihongqiao'],
  ['SHH', '上海', '上海', '上海市', 'shanghai'],
  ['IZQ', '广州南', '广州', '广东省', 'guangzhounan'],
  ['IOQ', '深圳北', '深圳', '广东省', 'shenzhenbei'],
  ['HGH', '杭州东', '杭州', '浙江省', 'hangzhoudong'],
  ['NJH', '南京南', '南京', '江苏省', 'nanjingnan'],
  ['WHN', '武汉', '武汉', '湖北省', 'wuhan'],
  ['EAY', '西安北', '西安', '陕西省', 'xianbei'],
  ['ICW', '成都东', '成都', '四川省', 'chengdudong'],
  ['CUW', '重庆北', '重庆', '重庆市', 'chongqingbei'],
  ['CWQ', '长沙南', '长沙', '湖南省', 'changshanan'],
  ['ZAF', '郑州东', '郑州', '河南省', 'zhengzhoudong'],
  ['TJP', '天津', '天津', '天津市', 'tianjin'],
  ['JGK', '济南西', '济南', '山东省', 'jinanxi'],
];

// 线路表：[去程站, 回程站, 里程km, 历时min, 基准价元, 车次类型, 去程发车时刻列表]
// 覆盖全部 16 个车站，保证任意两个有线路的车站之间都能查到车次（双向自动生成）
const ROUTES: Array<[string, string, number, number, number, string, string[]]> = [
  ['北京南', '上海虹桥', 1318, 268, 553, 'G', ['07:00', '14:00']],
  ['北京南', '杭州东', 1500, 312, 630, 'G', ['08:00', '13:30']],
  ['北京南', '南京南', 1023, 258, 445, 'G', ['07:30', '15:00']],
  ['北京南', '广州南', 2298, 480, 862, 'G', ['09:00']],
  ['北京南', '济南西', 406, 105, 185, 'G', ['08:20', '16:10']],
  ['北京南', '天津', 120, 35, 55, 'G', ['07:10', '10:05', '18:20']],
  ['北京南', '武汉', 1229, 260, 520, 'G', ['08:40', '13:20']],
  ['北京南', '长沙南', 1591, 340, 650, 'G', ['09:10']],
  ['上海虹桥', '广州南', 1800, 420, 700, 'G', ['08:30', '12:00']],
  ['上海虹桥', '杭州东', 169, 45, 73, 'G', ['06:40', '09:15', '17:30']],
  ['上海虹桥', '南京南', 301, 75, 135, 'G', ['07:20', '12:40']],
  ['上海虹桥', '武汉', 807, 240, 400, 'D', ['08:10', '14:40']],
  ['上海虹桥', '长沙南', 1080, 300, 480, 'G', ['09:40']],
  ['广州南', '深圳北', 102, 36, 75, 'G', ['07:05', '11:30', '19:00']],
  ['广州南', '长沙南', 707, 150, 314, 'G', ['08:15', '15:20']],
  ['广州南', '武汉', 1069, 245, 460, 'G', ['10:20']],
  ['成都东', '重庆北', 308, 90, 154, 'G', ['08:00', '13:00', '18:40']],
  ['西安北', '成都东', 658, 200, 263, 'D', ['07:50', '13:10']],
  ['郑州东', '武汉', 536, 130, 245, 'G', ['08:30', '16:40']],
  ['北京西', '郑州东', 690, 200, 309, 'G', ['07:20', '13:45']],
  ['北京西', '西安北', 1200, 270, 515, 'G', ['08:00', '14:30']],
  ['上海', '杭州东', 200, 75, 78, 'D', ['06:30', '10:40', '16:20']],
  ['上海', '南京南', 300, 120, 120, 'D', ['07:40', '15:10']],
  ['北京西', '天津', 137, 45, 55, 'K', ['07:10', '14:20']],
  ['北京西', '济南西', 497, 240, 78, 'K', ['08:10']],
  ['郑州东', '西安北', 505, 190, 92, 'K', ['07:50', '15:30']],
];

/** "HH:mm" 加分钟，返回 "HH:mm" */
function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const SETTINGS: Array<[string, string, string, string, string]> = [
  ['order.pay_timeout_minutes', '15', 'INT', '订单支付时限（分钟），超时自动取消并释放余票', 'order'],
  ['order.max_tickets_per_order', '5', 'INT', '单笔订单最多购票张数', 'order'],
  ['order.max_pending_orders', '3', 'INT', '单账号同时存在的待支付订单上限', 'order'],
  ['passenger.max_per_user', '10', 'INT', '每账号最多可添加的乘车人数', 'user'],
  ['ticket.sale_stop_minutes', '30', 'INT', '开车前多少分钟停止购票', 'ticket'],
  ['ticket.min_refund_fee_cents', '200', 'INT', '最低退票费（分）', 'ticket'],
  ['ticket.standing_enabled', 'true', 'BOOL', '是否允许发售无座票', 'ticket'],
  ['auth.max_login_fail', '5', 'INT', '连续登录失败多少次锁定账号', 'auth'],
  ['auth.lock_minutes', '10', 'INT', '账号锁定时长（分钟）', 'auth'],
  ['auth.require_identity', 'true', 'BOOL', '注册是否强制实名核验通过', 'auth'],
  ['sms.code_expire_seconds', '300', 'INT', '短信验证码有效期（秒）', 'auth'],
  ['sms.resend_interval_seconds', '60', 'INT', '同一手机号短信重发间隔（秒）', 'auth'],
];

/* ── 主流程 ───────────────────────────────────────────────── */

async function main() {
  console.log('清空旧数据…');
  await prisma.$transaction([
    prisma.change.deleteMany(),
    prisma.refund.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.order.deleteMany(),
    prisma.seatInventory.deleteMany(),
    prisma.trainSchedule.deleteMany(),
    prisma.train.deleteMany(),
    prisma.station.deleteMany(),
    prisma.passenger.deleteMany(),
    prisma.identityVerification.deleteMany(),
    prisma.verificationCode.deleteMany(),
    prisma.announcement.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.systemSetting.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  console.log('写入系统参数…');
  for (const [key, value, valueType, description, groupName] of SETTINGS) {
    await prisma.systemSetting.create({ data: { key, value, valueType, description, groupName } });
  }

  console.log('写入车站…');
  const stationMap = new Map<string, number>();
  for (const [code, name, city, province, pinyin] of STATIONS) {
    const s = await prisma.station.create({ data: { code, name, city, province, pinyin } });
    stationMap.set(name, s.id);
  }

  console.log('写入车次与未来 14 天运行日…');
  const today = cnDate(0);
  const RUN_DAYS = 14;
  const trainIdMap = new Map<string, number>();
  /** "出发站→到达站" → 该方向的全部车次号 */
  const routeTrainNos = new Map<string, string[]>();

  /** 生成车次：每条线路自动生成双向，车次号按类型 + 全局序号，保证唯一 */
  const generated: Array<{ trainNo: string; type: string; from: string; to: string; depart: string; arrive: string; km: number; min: number; yuan: number }> = [];
  let seq = 100;
  for (const [from, to, km, min, yuan, type, departs] of ROUTES) {
    for (const dir of [0, 1]) {
      const a = dir === 0 ? from : to;
      const b = dir === 0 ? to : from;
      const nos: string[] = [];
      for (const dp of departs) {
        seq += 1;
        const trainNo = `${type}${seq}`;
        generated.push({ trainNo, type, from: a, to: b, depart: dp, arrive: addMinutes(dp, min), km, min, yuan });
        nos.push(trainNo);
      }
      routeTrainNos.set(`${a}→${b}`, nos);
    }
  }

  /** 让初始化库存有真实的"紧张感"：多数有票、少数紧张、个别无票，便于演示各种余票状态 */
  const seedSold = (seatClass: string, i: number): number => {
    switch (seatClass) {
      case 'BUSINESS':
        return i % 3 === 0 ? 18 : 4;
      case 'FIRST':
        return i % 4 === 0 ? 41 : 12;
      case 'SECOND':
        return i % 7 === 0 ? 400 : i % 5 === 0 ? 372 : 90;
      case 'SOFT_SLEEPER':
        return 8;
      case 'HARD_SLEEPER':
        return i % 3 === 0 ? 60 : 20;
      case 'HARD_SEAT':
        return i % 6 === 0 ? 470 : 120;
      default:
        return 0;
    }
  };

  let trainIdx = 0;
  for (const g of generated) {
    trainIdx += 1;
    const t = await prisma.train.create({
      data: {
        trainNo: g.trainNo,
        trainType: g.type,
        fromStationId: stationMap.get(g.from)!,
        toStationId: stationMap.get(g.to)!,
        departTime: g.depart,
        arriveTime: g.arrive,
        durationMin: g.min,
        mileageKm: g.km,
        basePriceCents: g.yuan * 100,
      },
    });
    trainIdMap.set(g.trainNo, t.id);

    for (let d = 0; d < RUN_DAYS; d += 1) {
      await prisma.trainSchedule.create({
        data: {
          trainId: t.id,
          runDate: cnDate(d),
          inventory: {
            create: classesFor(g.type).map((sc) => ({
              seatClass: sc,
              priceCents: sc === 'STANDING' ? price(g.yuan, 'SECOND', g.km) : price(g.yuan, sc, g.km),
              totalCount: CAPACITY[sc],
              soldCount: seedSold(sc, trainIdx),
            })),
          },
        },
      });
    }
  }

  /** 取某条线路某方向的第 index 个车次号 */
  const trainNoOf = (from: string, to: string, index = 0): string => {
    const list = routeTrainNos.get(`${from}→${to}`);
    if (!list || !list[index]) throw new Error(`seed 线路缺失：${from}→${to}`);
    return list[index];
  };

  console.log('写入演示账号…');
  const pwd = async (p: string) => bcrypt.hash(p, 10);
  const mkUser = async (username: string, password: string, realName: string, base17: string, phone: string, role: string, bankLast4?: string) => {
    const card = idCard(base17);
    return prisma.user.create({
      data: {
        username,
        passwordHash: await pwd(password),
        realName,
        idCardCipher: encryptIdCard(card),
        idCardHash: hashIdCard(card),
        idCardSuffix: card.slice(-4),
        phone,
        bankCardLast4: bankLast4 ?? null,
        role,
        status: 'ACTIVE',
        isVerified: true,
      },
    });
  };

  const admin = await mkUser('admin01', 'Admin@123456', '系统管理员', '11010119800101999', '13800000001', 'ADMIN');
  await mkUser('clerk01', 'Clerk@123456', '售票员王芳', '11010119880202678', '13800000002', 'CLERK');
  const passenger1 = await mkUser('passenger01', 'Pass@123456', '张伟', '11010119900101123', '13800000003', 'PASSENGER', '6222');
  const passenger2 = await mkUser('passenger02', 'Pass@123456', '李娜', '11010119950505432', '13800000004', 'PASSENGER', '8888');
  const passenger3 = await mkUser('passenger03', 'Pass@123456', '陈晓明', '31010119920303456', '13900000005', 'PASSENGER', '1234');

  console.log('写入乘车人…');
  const mkPassenger = async (userId: number, name: string, base17: string, type: string, isDefault = false, phone?: string) => {
    const card = idCard(base17);
    return prisma.passenger.create({
      data: {
        userId,
        name,
        idCardCipher: encryptIdCard(card),
        idCardHash: hashIdCard(card),
        idCardSuffix: card.slice(-4),
        phone: phone ?? null,
        passengerType: type,
        isDefault,
      },
    });
  };

  const pz1 = await mkPassenger(passenger1.id, '张伟', '11010119900101123', 'ADULT', true, '13800000003');
  await mkPassenger(passenger1.id, '张小雨', '11010120150505438', 'CHILD', false);
  await mkPassenger(passenger1.id, '张建国', '11010119620303551', 'ADULT', false);
  const pz2 = await mkPassenger(passenger2.id, '李娜', '11010119950505432', 'ADULT', true, '13800000004');
  await mkPassenger(passenger2.id, '刘思远', '11010120010303876', 'STUDENT', false);
  const pz3 = await mkPassenger(passenger3.id, '陈晓明', '31010119920303456', 'ADULT', true, '13900000005');

  console.log('写入公告…');
  const delayTrainNo = trainNoOf('北京南', '上海虹桥', 0);
  await prisma.announcement.createMany({
    data: [
      {
        title: 'Mini-12306 系统上线公告',
        content: '本系统为软件工程基础实验课程项目，模拟 12306 在线购票全流程。第三方实名认证、短信与银行支付均为 Mock 实现，请勿填写真实个人信息。',
        type: 'SYSTEM',
        status: 'PUBLISHED',
        publisherId: admin.id,
        publishedAt: new Date(),
      },
      {
        title: '购票提示：请提前 30 分钟完成购票',
        content: '为保障行程顺利，请在列车开车前 30 分钟完成购票；开车后不办理退票，改签仅限当日其他车次。',
        type: 'NOTICE',
        status: 'PUBLISHED',
        publisherId: admin.id,
        publishedAt: new Date(Date.now() - 3600_000),
      },
      {
        title: `${delayTrainNo} 因设备检修预计晚点 20 分钟`,
        content: `${delayTrainNo} 次列车（北京南 → 上海虹桥）${cnDate(1)} 因设备检修预计晚点 20 分钟，已购票旅客可免费改签。`,
        type: 'DELAY',
        trainNo: delayTrainNo,
        runDate: cnDate(1),
        status: 'PUBLISHED',
        publisherId: admin.id,
        publishedAt: new Date(Date.now() - 1800_000),
      },
    ],
  });
  // 同步运行日状态，让"晚点"在查询结果里可见
  await prisma.trainSchedule.updateMany({
    where: { trainId: trainIdMap.get(delayTrainNo)!, runDate: cnDate(1) },
    data: { status: 'DELAYED', delayMinutes: 20, note: '设备检修，预计晚点 20 分钟' },
  });

  console.log('写入示例订单…');
  /** 直接落一张"已支付"的历史订单，同时把库存已售数加上去，保证数据自洽 */
  const seedPaidOrder = async (opts: { userId: number; passengerId: number; passengerName: string; idCardSuffix: string; trainNo: string; runDate: string; seatClass: string; ticketType: string; orderNo: string }) => {
    const train = await prisma.train.findUnique({ where: { trainNo: opts.trainNo } });
    if (!train) return;
    const schedule = await prisma.trainSchedule.findFirst({ where: { trainId: train.id, runDate: opts.runDate }, include: { inventory: true } });
    if (!schedule) return;
    const inv = schedule.inventory.find((i) => i.seatClass === opts.seatClass);
    if (!inv) return;
    const discount = opts.ticketType === 'CHILD' ? 0.5 : opts.ticketType === 'STUDENT' ? 0.75 : 1;
    const itemPrice = Math.round(inv.priceCents * discount);
    const depart = new Date(`${opts.runDate}T${train.departTime}:00+08:00`);

    await prisma.order.create({
      data: {
        orderNo: opts.orderNo,
        userId: opts.userId,
        scheduleId: schedule.id,
        channel: 'WEB',
        passengerCount: 1,
        totalAmountCents: itemPrice,
        paidAmountCents: itemPrice,
        status: 'PAID',
        expireAt: new Date(Date.now() - 86400_000),
        paidAt: new Date(Date.now() - 86400_000),
        items: {
          create: [
            {
              passengerId: opts.passengerId,
              passengerName: opts.passengerName,
              idCardSuffix: opts.idCardSuffix,
              seatClass: opts.seatClass,
              ticketType: opts.ticketType,
              priceCents: itemPrice,
              seatNo: '05车12A',
              ticketStatus: 'TICKETED',
            },
          ],
        },
        payments: {
          create: [
            {
              paymentNo: `P${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`,
              type: 'PAY',
              amountCents: itemPrice,
              method: 'MOCK_BANK',
              status: 'SUCCESS',
              outTradeNo: `OT${Date.now()}${Math.floor(Math.random() * 900000 + 100000)}`,
              tradeNo: `TN${Date.now()}`,
              paidAt: new Date(Date.now() - 86400_000),
            },
          ],
        },
      },
    });
    await prisma.seatInventory.update({ where: { id: inv.id }, data: { soldCount: { increment: 1 } } });
    void depart;
  };

  await seedPaidOrder({
    userId: passenger1.id,
    passengerId: pz1.id,
    passengerName: '张伟',
    idCardSuffix: pz1.idCardSuffix,
    trainNo: trainNoOf('北京南', '上海虹桥', 0),
    runDate: cnDate(2),
    seatClass: 'SECOND',
    ticketType: 'ADULT',
    orderNo: 'M20260101000001',
  });
  await seedPaidOrder({
    userId: passenger2.id,
    passengerId: pz2.id,
    passengerName: '李娜',
    idCardSuffix: pz2.idCardSuffix,
    trainNo: trainNoOf('上海虹桥', '杭州东', 0),
    runDate: cnDate(1),
    seatClass: 'FIRST',
    ticketType: 'ADULT',
    orderNo: 'M20260101000002',
  });
  await seedPaidOrder({
    userId: passenger3.id,
    passengerId: pz3.id,
    passengerName: '陈晓明',
    idCardSuffix: pz3.idCardSuffix,
    trainNo: trainNoOf('北京南', '上海虹桥', 1),
    runDate: cnDate(3),
    seatClass: 'SECOND',
    ticketType: 'ADULT',
    orderNo: 'M20260101000003',
  });

  const totalSchedules = generated.length * RUN_DAYS;
  console.log('');
  console.log('  初始化完成 ✅');
  console.log(`  车站 ${STATIONS.length} 个 / 线路 ${ROUTES.length} 条 / 车次 ${generated.length} 个 / 运行日 ${totalSchedules} 个`);
  console.log('  演示账号（密码见括号）：');
  console.log('    旅客   passenger01 / Pass@123456    张伟（已实名，含 3 名乘车人）');
  console.log('    旅客   passenger02 / Pass@123456    李娜');
  console.log('    售票员 clerk01     / Clerk@123456   王芳');
  console.log('    管理员 admin01     / Admin@123456   系统管理员');
  console.log(`  Mock 短信验证码固定为 123456，日期范围 ${today} ~ ${cnDate(13)}`);
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
