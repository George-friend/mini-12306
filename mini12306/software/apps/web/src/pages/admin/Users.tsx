/** 用户管理：账号检索、冻结 / 解冻、重置密码 */
import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime } from '../../lib/format';
import { ConfirmModal, Empty, ErrorBox, Input, Modal, SectionTitle, Spinner, Tag, useToast } from '../../components/ui';

interface UserRow {
  id: number;
  username: string;
  realName: string;
  phone: string;
  idCardMasked: string;
  role: string;
  status: string;
  isVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserListData {
  list: UserRow[];
}

interface ResetResult {
  newPassword: string;
}

const ROLE_TONE: Record<string, string> = {
  ADMIN: 'bg-brand-50 text-brand-700',
  CLERK: 'bg-violet-50 text-violet-700',
  PASSENGER: 'bg-slate-100 text-slate-600',
};

const ROLE_TEXT: Record<string, string> = { ADMIN: '管理员', CLERK: '售票员', PASSENGER: '旅客' };

export default function Users() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [keyword, setKeyword] = useState('');
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusTarget, setStatusTarget] = useState<UserRow | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const load = useCallback(async (kw: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<UserListData>(`/admin/users${qs({ keyword: kw.trim() })}`);
      setRows(res.list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(keyword);
  }, [keyword, load]);

  async function confirmStatus() {
    if (!statusTarget) return;
    const next = statusTarget.status === 'FROZEN' ? 'ACTIVE' : 'FROZEN';
    setStatusLoading(true);
    try {
      await api.patch<{ id: number; status: string }>(`/admin/users/${statusTarget.id}/status`, { status: next });
      toast.success(next === 'FROZEN' ? `账号 ${statusTarget.username} 已冻结` : `账号 ${statusTarget.username} 已解冻`);
      setStatusTarget(null);
      await load(keyword);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setStatusLoading(false);
    }
  }

  async function confirmReset() {
    if (!resetTarget) return;
    setResetLoading(true);
    try {
      const res = await api.post<ResetResult>(`/admin/users/${resetTarget.id}/reset-password`);
      setNewPassword(res.newPassword);
      toast.success(`账号 ${resetTarget.username} 密码已重置`);
      setResetTarget(null);
      await load(keyword);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重置失败');
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="用户管理"
        desc="手机号与证件号均按脱敏规则展示；冻结账号后该用户将无法登录与下单"
        extra={
          <Input
            className="w-44 sm:w-56"
            placeholder="用户名 / 真实姓名 / 手机号"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            aria-label="搜索用户"
          />
        }
      />

      {error && <ErrorBox message={error} onRetry={() => void load(keyword)} />}

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner label="正在加载用户…" />
        ) : rows.length === 0 ? (
          <Empty
            title={keyword.trim() ? '没有匹配的用户' : '暂无用户数据'}
            hint={keyword.trim() ? '请核对用户名、真实姓名或手机号后重试' : '旅客注册后此处将显示账号列表'}
            action={
              keyword.trim() ? (
                <button type="button" className="btn-sm btn-ghost" onClick={() => setKeyword('')}>
                  清空关键字
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px]">
              <thead>
                <tr>
                  <th className="th">用户名</th>
                  <th className="th">真实姓名</th>
                  <th className="th">手机号</th>
                  <th className="th">证件号</th>
                  <th className="th">角色</th>
                  <th className="th">状态</th>
                  <th className="th">实名</th>
                  <th className="th">注册时间</th>
                  <th className="th">最后登录</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const isSelf = me?.id === u.id;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="td font-medium text-slate-800">
                        {u.username}
                        {isSelf && <span className="ml-2 text-[11px] text-brand-700">当前登录</span>}
                      </td>
                      <td className="td text-slate-700">{u.realName}</td>
                      <td className="td tnum text-slate-600">{u.phone}</td>
                      <td className="td font-mono text-xs text-slate-500">{u.idCardMasked}</td>
                      <td className="td">
                        <Tag className={ROLE_TONE[u.role] ?? 'bg-slate-100 text-slate-600'}>{ROLE_TEXT[u.role] ?? u.role}</Tag>
                      </td>
                      <td className="td">
                        <Tag className={u.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}>
                          {u.status === 'ACTIVE' ? '正常' : '已冻结'}
                        </Tag>
                      </td>
                      <td className="td">
                        <Tag className={u.isVerified ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-500'}>
                          {u.isVerified ? '已实名' : '未实名'}
                        </Tag>
                      </td>
                      <td className="td text-xs text-slate-500 tnum">{dateTime(u.createdAt)}</td>
                      <td className="td text-xs text-slate-500 tnum">{dateTime(u.lastLoginAt)}</td>
                      <td className="td">
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          <button
                            type="button"
                            className={u.status === 'FROZEN' ? 'btn-sm btn-ghost' : 'btn-sm btn-danger'}
                            disabled={isSelf}
                            title={isSelf ? '不能冻结当前登录的管理员账号' : undefined}
                            onClick={() => setStatusTarget(u)}
                          >
                            {u.status === 'FROZEN' ? '解冻' : '冻结'}
                          </button>
                          <button type="button" className="btn-sm btn-ghost" onClick={() => setResetTarget(u)}>
                            重置密码
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!statusTarget}
        title={statusTarget?.status === 'FROZEN' ? '解冻账号' : '冻结账号'}
        danger={statusTarget?.status !== 'FROZEN'}
        confirmText={statusTarget?.status === 'FROZEN' ? '确认解冻' : '确认冻结'}
        loading={statusLoading}
        onClose={() => setStatusTarget(null)}
        onConfirm={() => void confirmStatus()}
        content={
          statusTarget?.status === 'FROZEN' ? (
            <>
              确定解冻账号 <b>{statusTarget?.username}</b>（{statusTarget?.realName}）吗？解冻后该用户可正常登录与购票。
            </>
          ) : (
            <>
              确定冻结账号 <b>{statusTarget?.username}</b>（{statusTarget?.realName}）吗？
              <br />
              冻结后该用户无法登录、下单与办理退改，已购车票不受影响。操作会记入审计日志。
            </>
          )
        }
      />

      <ConfirmModal
        open={!!resetTarget}
        title="重置密码"
        confirmText="确认重置"
        loading={resetLoading}
        onClose={() => setResetTarget(null)}
        onConfirm={() => void confirmReset()}
        content={
          <>
            确定重置 <b>{resetTarget?.username}</b>（{resetTarget?.realName}）的登录密码吗？
            <br />
            系统将生成一个新的随机密码，旧密码立即失效，请在线下告知用户。
          </>
        }
      />

      <Modal
        open={!!newPassword}
        title="新密码已生成"
        onClose={() => setNewPassword('')}
        footer={
          <button type="button" className="btn-primary" onClick={() => setNewPassword('')}>
            我已记录
          </button>
        }
      >
        <p className="text-sm text-slate-700">请立即线下告知用户，关闭后将无法再次查看：</p>
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-slate-50 px-4 py-3 font-mono text-lg tracking-wider text-slate-900 select-all">
          {newPassword}
        </div>
        <p className="mt-3 text-xs text-slate-500">建议用户登录后立即在「个人中心」修改密码。</p>
      </Modal>
    </div>
  );
}
