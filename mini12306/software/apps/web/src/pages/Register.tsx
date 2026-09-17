/** 实名注册：表单校验、Mock 短信验证码与自动登录 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Input, useToast } from '../components/ui';

/* ── 接口类型 ─────────────────────────────────────────────── */

interface SmsCodeData {
  smsId: string;
  expiresInSeconds: number;
  mockCode: string;
}

interface RegisterData {
  token: string;
  user: {
    id: number;
    username: string;
    realName: string;
    phone: string;
    role: string;
    isVerified: boolean;
    idCardMasked?: string;
  };
}

interface FormState {
  username: string;
  password: string;
  confirmPassword: string;
  realName: string;
  idCardNo: string;
  phone: string;
  smsCode: string;
  bankCardNo: string;
}

type FieldKey = keyof FormState;

const INITIAL: FormState = {
  username: '',
  password: '',
  confirmPassword: '',
  realName: '',
  idCardNo: '',
  phone: '',
  smsCode: '',
  bankCardNo: '',
};

/* ── 与前/后端一致的校验规则 ──────────────────────────────── */

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

/** 身份证号校验（GB 11643-1999 校验位） */
function validateIdCardNo(input: string): string {
  const v = input.trim().toUpperCase();
  if (!v) return '请填写身份证号';
  if (!/^\d{17}[\dX]$/.test(v)) return '身份证号必须为 18 位，末位可为 X';
  const y = Number(v.slice(6, 10));
  const m = Number(v.slice(10, 12));
  const d = Number(v.slice(12, 14));
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '身份证号中的出生日期不合法';
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += Number(v[i]) * WEIGHTS[i];
  if (CHECK_CODES[sum % 11] !== v[17]) return '身份证号校验位不正确，请核对后重新输入';
  return '';
}

/** 银行卡号校验（Luhn） */
function validateBankCardNo(input: string): string {
  const v = input.replace(/\s/g, '');
  if (!v) return '';
  if (!/^\d{12,19}$/.test(v)) return '银行卡号应为 12-19 位数字';
  let sum = 0;
  let alt = false;
  for (let i = v.length - 1; i >= 0; i -= 1) {
    let n = Number(v[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0 ? '' : '银行卡号校验失败，请核对卡号';
}

function buildErrors(f: FormState): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  const username = f.username.trim();
  if (!username) e.username = '请填写用户名';
  else if (username.length < 4 || username.length > 20) e.username = '用户名需为 4-20 位';
  else if (!/^[A-Za-z0-9_]+$/.test(username)) e.username = '用户名只能包含字母、数字与下划线';

  if (!f.password) e.password = '请填写密码';
  else if (f.password.length < 6) e.password = '密码至少 6 位';
  else if (f.password.length > 32) e.password = '密码最多 32 位';

  if (!f.confirmPassword) e.confirmPassword = '请再次输入密码';
  else if (f.confirmPassword !== f.password) e.confirmPassword = '两次输入的密码不一致';

  const realName = f.realName.trim();
  if (!realName) e.realName = '请填写真实姓名';
  else if (realName.length < 2 || realName.length > 20) e.realName = '姓名长度需为 2-20 个字符';

  const idErr = validateIdCardNo(f.idCardNo);
  if (idErr) e.idCardNo = idErr;

  const phone = f.phone.trim();
  if (!phone) e.phone = '请填写手机号';
  else if (!/^1[3-9]\d{9}$/.test(phone)) e.phone = '手机号格式不正确（应为 1 开头的 11 位数字）';

  if (!f.smsCode.trim()) e.smsCode = '请填写短信验证码';
  else if (!/^\d{6}$/.test(f.smsCode.trim())) e.smsCode = '验证码为 6 位数字';

  const bankErr = validateBankCardNo(f.bankCardNo);
  if (bankErr) e.bankCardNo = bankErr;

  return e;
}

/* ── 页面 ─────────────────────────────────────────────────── */

export default function Register() {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useAuth();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [mockCode, setMockCode] = useState('');

  const errors = useMemo(() => buildErrors(form), [form]);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const setField = (key: FieldKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const showError = (key: FieldKey): string | undefined => (touched[key] || submitted ? errors[key] : undefined);
  const blur = (key: FieldKey) => setTouched((prev) => ({ ...prev, [key]: true }));

  const sendSmsCode = async () => {
    const phone = form.phone.trim();
    setTouched((prev) => ({ ...prev, phone: true }));
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      toast.error('请先填写正确的 11 位手机号');
      return;
    }
    setSending(true);
    try {
      const d = await api.post<SmsCodeData>('/auth/sms-code', { phone, scene: 'REGISTER' });
      setCountdown(60);
      setMockCode(d.mockCode ?? '');
      toast.success(`验证码已发送（Mock 短信通道），演示验证码：${d.mockCode}`);
    } catch (e: unknown) {
      toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '验证码发送失败');
    } finally {
      setSending(false);
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
    const firstError = Object.keys(errors)[0];
    if (firstError) {
      toast.error('表单填写有误，请检查标红项');
      return;
    }
    setSubmitting(true);
    try {
      const d = await api.post<RegisterData>('/auth/register', {
        username: form.username.trim(),
        password: form.password,
        realName: form.realName.trim(),
        idCardNo: form.idCardNo.trim().toUpperCase(),
        phone: form.phone.trim(),
        smsCode: form.smsCode.trim(),
        bankCardNo: form.bankCardNo.replace(/\s/g, ''),
      });
      tokenStore.set(d.token);
      await refresh();
      toast.success('注册成功，已自动登录');
      navigate('/', { replace: true });
    } catch (err: unknown) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : '注册失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[64rem] py-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <section className="card p-6 sm:p-8">
          <h1 className="text-xl">实名注册</h1>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            注册后可直接使用在线购票、退票与改签服务；带 <span className="text-red-500">*</span> 为必填项。
          </p>

          <form className="mt-6 space-y-4" onSubmit={(e) => void onSubmit(e)} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="用户名" required hint="4-20 位字母、数字或下划线" error={showError('username')}>
                <Input
                  id="reg-username"
                  name="username"
                  aria-label="用户名"
                  autoComplete="username"
                  placeholder="如 zhangsan"
                  value={form.username}
                  onChange={(e) => setField('username', e.target.value)}
                  onBlur={() => blur('username')}
                />
              </Field>

              <Field label="真实姓名" required hint="与身份证一致的姓名" error={showError('realName')}>
                <Input
                  id="reg-realname"
                  name="realName"
                  aria-label="真实姓名"
                  autoComplete="name"
                  placeholder="如 张三"
                  value={form.realName}
                  onChange={(e) => setField('realName', e.target.value)}
                  onBlur={() => blur('realName')}
                />
              </Field>

              <Field label="密码" required hint="6-32 位，建议包含字母、数字与符号" error={showError('password')}>
                <Input
                  id="reg-password"
                  name="password"
                  aria-label="密码"
                  type="password"
                  autoComplete="new-password"
                  placeholder="请输入密码"
                  value={form.password}
                  onChange={(e) => setField('password', e.target.value)}
                  onBlur={() => blur('password')}
                />
              </Field>

              <Field label="确认密码" required error={showError('confirmPassword')}>
                <Input
                  id="reg-confirm"
                  name="confirmPassword"
                  aria-label="确认密码"
                  type="password"
                  autoComplete="new-password"
                  placeholder="请再次输入密码"
                  value={form.confirmPassword}
                  onChange={(e) => setField('confirmPassword', e.target.value)}
                  onBlur={() => blur('confirmPassword')}
                />
              </Field>

              <Field label="身份证号" required hint="18 位，系统将校验出生日期与校验位" error={showError('idCardNo')}>
                <Input
                  id="reg-idcard"
                  name="idCardNo"
                  aria-label="身份证号"
                  inputMode="text"
                  autoComplete="off"
                  placeholder="18 位身份证号"
                  value={form.idCardNo}
                  onChange={(e) => setField('idCardNo', e.target.value)}
                  onBlur={() => blur('idCardNo')}
                />
              </Field>

              <Field label="手机号" required hint="用于接收短信验证码" error={showError('phone')}>
                <Input
                  id="reg-phone"
                  name="phone"
                  aria-label="手机号"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="11 位手机号"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                  onBlur={() => blur('phone')}
                />
              </Field>
            </div>

            <Field
              label="短信验证码"
              required
              hint={countdown > 0 ? `验证码已发送，${countdown} 秒后可重新获取` : '点击右侧按钮获取 6 位验证码'}
              error={showError('smsCode')}
            >
              <div className="flex gap-2">
                <Input
                  id="reg-smscode"
                  name="smsCode"
                  aria-label="短信验证码"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="6 位验证码"
                  value={form.smsCode}
                  onChange={(e) => setField('smsCode', e.target.value.replace(/\D/g, ''))}
                  onBlur={() => blur('smsCode')}
                />
                <button
                  type="button"
                  className="btn-ghost shrink-0 min-w-[8.5rem]"
                  disabled={sending || countdown > 0}
                  onClick={() => void sendSmsCode()}
                >
                  {sending ? '发送中…' : countdown > 0 ? `${countdown} 秒后重发` : '获取验证码'}
                </button>
              </div>
            </Field>

            {mockCode && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
                <span>演示环境验证码：</span>
                <span className="tnum font-semibold tracking-widest">{mockCode}</span>
                <button
                  type="button"
                  className="btn-sm btn-ghost h-7 ml-auto"
                  onClick={() => {
                    setField('smsCode', mockCode);
                    setTouched((prev) => ({ ...prev, smsCode: true }));
                  }}
                >
                  填入验证码
                </button>
              </div>
            )}

            <Field label="银行卡号" hint="选填，仅保存后 4 位，用于演示退票款原路退回" error={showError('bankCardNo')}>
              <Input
                id="reg-bankcard"
                name="bankCardNo"
                aria-label="银行卡号"
                inputMode="numeric"
                autoComplete="off"
                placeholder="选填，12-19 位卡号"
                value={form.bankCardNo}
                onChange={(e) => setField('bankCardNo', e.target.value.replace(/[^\d\s]/g, ''))}
                onBlur={() => blur('bankCardNo')}
              />
            </Field>

            <button type="submit" className="btn-primary w-full sm:w-auto sm:px-10" disabled={submitting}>
              {submitting ? '注册中…' : '提交注册'}
            </button>
          </form>

          <p className="mt-6 text-xs text-[var(--fg-muted)] leading-relaxed">
            实名核验由本地 Mock 服务完成，身份证号将加密存储、界面脱敏展示；短信与银行支付同样为 Mock 实现，
            请勿填写真实个人信息。已有账号？
            <Link to="/login" className="text-brand-700 hover:underline ml-1">
              前往登录
            </Link>
          </p>
        </section>

        <aside className="card p-5">
          <h2 className="text-base">注册须知</h2>
          <ul className="mt-3 space-y-2.5 text-xs text-slate-600 leading-relaxed">
            <li>
              <span className="badge bg-brand-50 text-brand-700 mr-1.5">实名</span>
              身份证号需通过 GB 11643 校验位验证，姓名至少 2 个字符；核验未通过的证件将被拒绝注册。
            </li>
            <li>
              <span className="badge bg-brand-50 text-brand-700 mr-1.5">短信</span>
              同一手机号 60 秒内仅可发送一次验证码，验证码有效期 5 分钟。
            </li>
            <li>
              <span className="badge bg-brand-50 text-brand-700 mr-1.5">唯一性</span>
              用户名、手机号与证件号均需唯一，重复注册会给出明确提示。
            </li>
            <li>
              <span className="badge bg-brand-50 text-brand-700 mr-1.5">乘车人</span>
              注册成功后可在「乘车人」页面添加最多 10 名同行乘车人。
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
