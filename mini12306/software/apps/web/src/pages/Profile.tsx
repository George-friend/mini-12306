/** 个人中心：账号信息与手机号 / 银行卡 / 密码修改 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { dateTime, maskPhone } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Field, Input, Spinner, Tag, useToast } from '../components/ui';

/* ── 接口类型 ─────────────────────────────────────────────── */

interface SmsCodeData {
  smsId: string;
  expiresInSeconds: number;
  mockCode: string;
}

/* ── 工具 ─────────────────────────────────────────────────── */

const ROLE_LABEL: Record<string, string> = { PASSENGER: '旅客', CLERK: '售票员', ADMIN: '管理员' };

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

/* ── 页面 ─────────────────────────────────────────────────── */

export default function Profile() {
  const { user, refresh, loading: authLoading } = useAuth();
  const toast = useToast();

  /* 手机号 */
  const [newPhone, setNewPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneCountdown, setPhoneCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [mockCode, setMockCode] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  /* 银行卡 */
  const [bankCardNo, setBankCardNo] = useState('');
  const [savingBank, setSavingBank] = useState(false);

  /* 密码 */
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (phoneCountdown <= 0) return undefined;
    const timer = window.setTimeout(() => setPhoneCountdown(phoneCountdown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [phoneCountdown]);

  const phoneError = useMemo(() => {
    const v = newPhone.trim();
    if (!v) return '';
    if (!/^1[3-9]\d{9}$/.test(v)) return '手机号格式不正确（应为 1 开头的 11 位数字）';
    if (user && maskPhone(v) === user.phone) return '新手机号与当前手机号相同，无需修改';
    return '';
  }, [newPhone, user]);

  const bankError = useMemo(() => validateBankCardNo(bankCardNo), [bankCardNo]);

  const passwordError = useMemo(() => {
    if (!newPassword) return '';
    if (newPassword.length < 6) return '新密码至少 6 位';
    if (newPassword.length > 32) return '新密码最多 32 位';
    if (oldPassword && newPassword === oldPassword) return '新密码不能与原密码相同';
    return '';
  }, [newPassword, oldPassword]);

  const confirmError = confirmPassword && confirmPassword !== newPassword ? '两次输入的新密码不一致' : '';

  const sendCode = async () => {
    const phone = newPhone.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      toast.error('请先填写正确的 11 位新手机号');
      return;
    }
    setSendingCode(true);
    try {
      const d = await api.post<SmsCodeData>('/auth/sms-code', { phone, scene: 'CHANGE' });
      setPhoneCountdown(60);
      setMockCode(d.mockCode ?? '');
      toast.success(`验证码已发送（Mock 短信通道），演示验证码：${d.mockCode}`);
    } catch (e: unknown) {
      toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '验证码发送失败');
    } finally {
      setSendingCode(false);
    }
  };

  const savePhone = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (phoneError) {
      toast.error(phoneError);
      return;
    }
    if (!newPhone.trim()) {
      toast.error('请填写新手机号');
      return;
    }
    if (!/^\d{6}$/.test(phoneCode.trim())) {
      toast.error('请填写 6 位短信验证码');
      return;
    }
    setSavingPhone(true);
    try {
      await api.patch('/auth/me', { phone: newPhone.trim(), smsCode: phoneCode.trim() });
      await refresh();
      setNewPhone('');
      setPhoneCode('');
      setMockCode('');
      toast.success('手机号已更新');
    } catch (err: unknown) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : '手机号修改失败');
    } finally {
      setSavingPhone(false);
    }
  };

  const saveBank = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (bankError) {
      toast.error(bankError);
      return;
    }
    if (!bankCardNo.replace(/\s/g, '')) {
      toast.error('请填写银行卡号，或点击「清除绑定」');
      return;
    }
    setSavingBank(true);
    try {
      await api.patch('/auth/me', { bankCardNo: bankCardNo.replace(/\s/g, '') });
      await refresh();
      setBankCardNo('');
      toast.success('银行卡信息已更新（仅保存后 4 位）');
    } catch (err: unknown) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : '银行卡修改失败');
    } finally {
      setSavingBank(false);
    }
  };

  const clearBank = async () => {
    setSavingBank(true);
    try {
      await api.patch('/auth/me', { bankCardNo: '' });
      await refresh();
      toast.success('已解除银行卡绑定');
    } catch (err: unknown) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : '操作失败');
    } finally {
      setSavingBank(false);
    }
  };

  const savePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!oldPassword) {
      toast.error('请输入原密码');
      return;
    }
    if (passwordError) {
      toast.error(passwordError);
      return;
    }
    if (!newPassword) {
      toast.error('请输入新密码');
      return;
    }
    if (confirmPassword !== newPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setSavingPassword(true);
    try {
      await api.patch('/auth/me', { oldPassword, newPassword });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('密码已修改，请使用新密码登录');
    } catch (err: unknown) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : '密码修改失败');
    } finally {
      setSavingPassword(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="card">
        <Spinner label="正在加载账号信息…" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg">个人中心</h1>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">查看实名信息、维护联系方式与登录密码。</p>
        </div>
        <Link to="/orders" className="btn-sm btn-ghost">
          我的订单
        </Link>
      </div>

      {/* 账号信息 */}
      <section className="card p-5">
        <h2 className="text-base">账号信息</h2>
        <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <InfoItem label="用户名" value={user.username} />
          <InfoItem label="真实姓名" value={user.realName || '--'} />
          <InfoItem label="证件号" value={user.idCardMasked ?? '--'} mono />
          <InfoItem label="手机号" value={user.phone} mono />
          <InfoItem
            label="账号角色"
            value={<Tag className="bg-brand-50 text-brand-700">{ROLE_LABEL[user.role] ?? user.role}</Tag>}
          />
          <InfoItem
            label="实名状态"
            value={
              <Tag className={user.isVerified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                {user.isVerified ? '已实名核验' : '未完成实名核验'}
              </Tag>
            }
          />
          <InfoItem label="银行卡" value={user.bankCardLast4 ? `**** **** **** ${user.bankCardLast4}` : '未绑定'} mono />
          <InfoItem label="注册时间" value={dateTime(user.createdAt)} mono />
          <InfoItem label="最后登录" value={dateTime(user.lastLoginAt)} mono />
        </dl>
        <p className="mt-4 text-xs text-[var(--fg-muted)]">
          实名核验由本地 Mock 服务完成，身份证号采用 AES 加密存储、界面仅展示后 4 位；如证件信息有误请联系管理员。
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {/* 手机号 */}
        <section className="card p-5">
          <h2 className="text-base">修改手机号</h2>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            当前手机号 <span className="tnum">{user.phone}</span>，修改后需使用新手机号接收的验证码确认。
          </p>
          <form className="mt-4 space-y-4" onSubmit={(e) => void savePhone(e)} noValidate>
            <Field label="新手机号" required error={phoneError || undefined}>
              <Input
                id="profile-phone"
                aria-label="新手机号"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="11 位手机号"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
            </Field>

            <Field label="短信验证码" required hint={phoneCountdown > 0 ? `${phoneCountdown} 秒后可重新获取` : '验证码有效期 5 分钟'}>
              <div className="flex gap-2">
                <Input
                  id="profile-phone-code"
                  aria-label="短信验证码"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位验证码"
                  value={phoneCode}
                  onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, ''))}
                />
                <button
                  type="button"
                  className="btn-ghost shrink-0 min-w-[8.5rem]"
                  disabled={sendingCode || phoneCountdown > 0}
                  onClick={() => void sendCode()}
                >
                  {sendingCode ? '发送中…' : phoneCountdown > 0 ? `${phoneCountdown} 秒后重发` : '获取验证码'}
                </button>
              </div>
            </Field>

            {mockCode && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
                <span>演示环境验证码：</span>
                <span className="tnum font-semibold tracking-widest">{mockCode}</span>
                <button type="button" className="btn-sm btn-ghost h-7 ml-auto" onClick={() => setPhoneCode(mockCode)}>
                  填入验证码
                </button>
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={savingPhone}>
              {savingPhone ? '提交中…' : '保存手机号'}
            </button>
          </form>
        </section>

        <div className="space-y-5">
          {/* 银行卡 */}
          <section className="card p-5">
            <h2 className="text-base">修改银行卡</h2>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              当前绑定：<span className="tnum">{user.bankCardLast4 ? `**** ${user.bankCardLast4}` : '未绑定'}</span> ·
              仅保存卡号后 4 位，用于演示退票款原路退回。
            </p>
            <form className="mt-4 space-y-4" onSubmit={(e) => void saveBank(e)} noValidate>
              <Field label="银行卡号" hint="12-19 位数字，系统执行 Luhn 校验" error={bankError || undefined}>
                <Input
                  id="profile-bank"
                  aria-label="银行卡号"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="请输入新的银行卡号"
                  value={bankCardNo}
                  onChange={(e) => setBankCardNo(e.target.value.replace(/[^\d\s]/g, ''))}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn-primary" disabled={savingBank}>
                  {savingBank ? '提交中…' : '保存银行卡'}
                </button>
                {user.bankCardLast4 && (
                  <button type="button" className="btn-ghost" disabled={savingBank} onClick={() => void clearBank()}>
                    解除绑定
                  </button>
                )}
              </div>
            </form>
          </section>

          {/* 密码 */}
          <section className="card p-5">
            <h2 className="text-base">修改密码</h2>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">修改成功后原密码立即失效，请使用新密码重新登录。</p>
            <form className="mt-4 space-y-4" onSubmit={(e) => void savePassword(e)} noValidate>
              <Field label="原密码" required>
                <Input
                  id="profile-old-pwd"
                  aria-label="原密码"
                  type="password"
                  autoComplete="current-password"
                  placeholder="请输入当前密码"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                />
              </Field>
              <Field label="新密码" required hint="6-32 位，建议包含字母、数字与符号" error={passwordError || undefined}>
                <Input
                  id="profile-new-pwd"
                  aria-label="新密码"
                  type="password"
                  autoComplete="new-password"
                  placeholder="请输入新密码"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
              <Field label="确认新密码" required error={confirmError || undefined}>
                <Input
                  id="profile-confirm-pwd"
                  aria-label="确认新密码"
                  type="password"
                  autoComplete="new-password"
                  placeholder="请再次输入新密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>
              <button type="submit" className="btn-primary" disabled={savingPassword}>
                {savingPassword ? '提交中…' : '修改密码'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ── 局部小组件 ───────────────────────────────────────────── */

function InfoItem({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-[var(--fg-muted)]">{label}</dt>
      <dd className={`mt-1 text-sm text-slate-800 ${mono ? 'tnum' : ''}`}>{value}</dd>
    </div>
  );
}
