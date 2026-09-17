import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'mini-12306-local-dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  idCardAesKey: process.env.ID_CARD_AES_KEY ?? '6d696e6931323330362d6c6f63616c2d6465762d6b65792d3230323630313031',
  providerMode: (process.env.PROVIDER_MODE ?? 'mock') as 'mock' | 'real',
  mockSmsCode: process.env.MOCK_SMS_CODE ?? '123456',
};

/** 系统参数默认值（首次启动写入 system_settings，可在管理端修改） */
export const DEFAULT_SETTINGS: Array<{
  key: string;
  value: string;
  valueType: 'INT' | 'STRING' | 'BOOL';
  description: string;
  groupName: string;
}> = [
  { key: 'order.pay_timeout_minutes', value: '15', valueType: 'INT', description: '订单支付时限（分钟），超时自动取消并释放余票', groupName: 'order' },
  { key: 'order.max_tickets_per_order', value: '5', valueType: 'INT', description: '单笔订单最多购票张数', groupName: 'order' },
  { key: 'order.max_pending_orders', value: '3', valueType: 'INT', description: '单账号同时存在的待支付订单上限', groupName: 'order' },
  { key: 'passenger.max_per_user', value: '10', valueType: 'INT', description: '每账号最多可添加的乘车人数', groupName: 'user' },
  { key: 'ticket.sale_stop_minutes', value: '30', valueType: 'INT', description: '开车前多少分钟停止购票', groupName: 'ticket' },
  { key: 'ticket.min_refund_fee_cents', value: '200', valueType: 'INT', description: '最低退票费（分），费率大于 0 时不足此值按此值收取', groupName: 'ticket' },
  { key: 'ticket.standing_enabled', value: 'false', valueType: 'BOOL', description: '是否允许发售无座票', groupName: 'ticket' },
  { key: 'auth.max_login_fail', value: '5', valueType: 'INT', description: '连续登录失败多少次锁定账号', groupName: 'auth' },
  { key: 'auth.lock_minutes', value: '10', valueType: 'INT', description: '账号锁定时长（分钟）', groupName: 'auth' },
  { key: 'auth.require_identity', value: 'true', valueType: 'BOOL', description: '注册是否强制实名核验通过', groupName: 'auth' },
  { key: 'sms.code_expire_seconds', value: '300', valueType: 'INT', description: '短信验证码有效期（秒）', groupName: 'auth' },
  { key: 'sms.resend_interval_seconds', value: '60', valueType: 'INT', description: '同一手机号短信重发间隔（秒）', groupName: 'auth' },
];
