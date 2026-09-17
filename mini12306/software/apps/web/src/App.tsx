import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { SiteLayout, AdminLayout, NotFound } from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';

import Home from './pages/Home';
import TrainList from './pages/TrainList';
import OrderConfirm from './pages/OrderConfirm';
import Pay from './pages/Pay';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import ChangeTicket from './pages/ChangeTicket';
import Login from './pages/Login';
import Register from './pages/Register';
import Passengers from './pages/Passengers';
import Profile from './pages/Profile';
import Announcements from './pages/Announcements';

import Counter from './pages/clerk/Counter';

import Dashboard from './pages/admin/Dashboard';
import Stations from './pages/admin/Stations';
import Trains from './pages/admin/Trains';
import Schedules from './pages/admin/Schedules';
import AdminOrders from './pages/admin/Orders';
import Users from './pages/admin/Users';
import AdminAnnouncements from './pages/admin/Announcements';
import Settings from './pages/admin/Settings';
import AuditLogs from './pages/admin/AuditLogs';

/** 需要登录 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** 需要指定角色 */
function RequireRole({ roles, children }: { roles: Array<'PASSENGER' | 'CLERK' | 'ADMIN'>; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) {
    return (
      <div className="p-10 text-center">
        <div className="text-4xl font-bold text-slate-200">403</div>
        <p className="mt-3 text-sm text-slate-500">当前角色（{user.role}）无权访问该页面</p>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* 旅客端 / Web 端 */}
      <Route element={<SiteLayout />}>
        <Route index element={<Home />} />
        <Route path="trains" element={<TrainList />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route
          path="order/confirm"
          element={
            <RequireAuth>
              <OrderConfirm />
            </RequireAuth>
          }
        />
        <Route
          path="order/pay/:orderNo"
          element={
            <RequireAuth>
              <Pay />
            </RequireAuth>
          }
        />
        <Route
          path="orders"
          element={
            <RequireAuth>
              <Orders />
            </RequireAuth>
          }
        />
        <Route
          path="orders/:orderNo"
          element={
            <RequireAuth>
              <OrderDetail />
            </RequireAuth>
          }
        />
        <Route
          path="change/:orderNo"
          element={
            <RequireAuth>
              <ChangeTicket />
            </RequireAuth>
          }
        />
        <Route
          path="passengers"
          element={
            <RequireAuth>
              <Passengers />
            </RequireAuth>
          }
        />
        <Route
          path="profile"
          element={
            <RequireAuth>
              <Profile />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>

      {/* 售票窗口（售票员 / 管理员） */}
      <Route
        path="/clerk"
        element={
          <RequireRole roles={['CLERK', 'ADMIN']}>
            <AdminLayout />
          </RequireRole>
        }
      >
        <Route index element={<Counter />} />
      </Route>

      {/* 管理后台（仅管理员） */}
      <Route
        path="/admin"
        element={
          <RequireRole roles={['ADMIN']}>
            <AdminLayout />
          </RequireRole>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="stations" element={<Stations />} />
        <Route path="trains" element={<Trains />} />
        <Route path="schedules" element={<Schedules />} />
        <Route path="orders" element={<AdminOrders />} />
        <Route path="users" element={<Users />} />
        <Route path="announcements" element={<AdminAnnouncements />} />
        <Route path="settings" element={<Settings />} />
        <Route path="audit-logs" element={<AuditLogs />} />
      </Route>
    </Routes>
  );
}
