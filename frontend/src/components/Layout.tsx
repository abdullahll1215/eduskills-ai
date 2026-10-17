import {
  Activity,
  BarChart3,
  Bell,
  BookOpenCheck,
  ClipboardCheck,
  Database,
  FileText,
  FolderKanban,
  GitCommitHorizontal,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  ScrollText,
  Settings,
  ShieldAlert,
  User as UserIcon,
  Users,
  X,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Notification } from "../api/types";
import { useAuth } from "../context/AuthContext";
import ErrorBoundary from "./ErrorBoundary";
import { fmtDate, initials } from "./ui";

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean };

const ic = "h-[18px] w-[18px]";
const NAV: Record<string, { portal: string; items: NavItem[] }> = {
  student: {
    portal: "Student Portal",
    items: [
      { to: "/student", label: "Student Dashboard", icon: <LayoutDashboard className={ic} />, end: true },
      { to: "/student/self-assessment", label: "Self-Assessment", icon: <ClipboardCheck className={ic} /> },
      { to: "/student/peers", label: "Evaluate Peers", icon: <Users className={ic} /> },
      { to: "/student/report", label: "AI Growth Report", icon: <FileText className={ic} /> },
      { to: "/student/feedback", label: "Peer Feedback", icon: <MessageCircle className={ic} /> },
      { to: "/student/artifacts", label: "Project Artifacts", icon: <GitCommitHorizontal className={ic} /> },
      { to: "/student/coach", label: "AI Coach", icon: <Activity className={ic} /> },
    ],
  },
  instructor: {
    portal: "Instructor Portal",
    items: [
      { to: "/instructor", label: "Instructor Console", icon: <BarChart3 className={ic} />, end: true },
      { to: "/instructor/reports", label: "Cohort Reports", icon: <FileText className={ic} /> },
      { to: "/instructor/evaluations", label: "Evaluation Records", icon: <BookOpenCheck className={ic} /> },
      { to: "/instructor/projects", label: "Projects & Teams", icon: <FolderKanban className={ic} /> },
    ],
  },
  advisor: {
    portal: "Advisor Portal",
    items: [{ to: "/advisor", label: "Intervention Alerts", icon: <ShieldAlert className={ic} />, end: true }],
  },
  admin: {
    portal: "Admin Console",
    items: [
      { to: "/admin", label: "System Health", icon: <Activity className={ic} />, end: true },
      { to: "/admin/users", label: "Users", icon: <Users className={ic} /> },
      { to: "/instructor/projects", label: "Projects & Teams", icon: <FolderKanban className={ic} /> },
      { to: "/instructor", label: "Analytics Console", icon: <BarChart3 className={ic} />, end: true },
      { to: "/admin/settings", label: "Configuration & AI", icon: <Settings className={ic} /> },
      { to: "/admin/rubric", label: "Rubric & Resources", icon: <BookOpenCheck className={ic} /> },
      { to: "/admin/maintenance", label: "Backup & Retention", icon: <Database className={ic} /> },
      { to: "/admin/audit", label: "Audit Logs", icon: <ScrollText className={ic} /> },
      { to: "/advisor", label: "Interventions", icon: <ShieldAlert className={ic} />, end: true },
    ],
  },
};

function Brand({ portal }: { portal: string }) {
  return (
    <div className="px-5 py-5">
      <div className="flex items-center gap-2 text-xl font-bold text-brand-600">
        <Activity className="h-5 w-5" /> EduSkills AI
      </div>
      <div className="mt-0.5 text-xs text-slate-500">{portal}</div>
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const navigate = useNavigate();
  const load = () => api<Notification[]>("/api/notifications").then(setItems).catch(() => undefined);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  const unread = items.filter((n) => !n.is_read).length;

  const openItem = async (n: Notification) => {
    if (!n.is_read) await api(`/api/notifications/${n.id}/read`, { method: "POST" });
    setOpen(false);
    load();
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-80 overflow-hidden sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button className="text-xs text-brand-600 hover:underline" onClick={() => api("/api/notifications/read-all", { method: "POST" }).then(load)}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-400">No notifications</div>}
            {items.map((n) => (
              <button key={n.id} onClick={() => openItem(n)} className={`block w-full border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 ${n.is_read ? "" : "bg-brand-50/50"}`}>
                <div className="flex items-start gap-2">
                  {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-800">{n.title}</div>
                    {n.body && <div className="line-clamp-2 text-xs text-slate-500">{n.body}</div>}
                    <div className="mt-1 text-[11px] text-slate-400">{fmtDate(n.created_at, true)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);
  if (!user) return null;
  const nav = NAV[user.role];

  const sidebar = (
    <div className="flex h-full flex-col">
      <Brand portal={nav.portal} />
      <nav className="flex-1 space-y-1 overflow-y-auto border-t border-slate-100 px-3 py-4">
        {nav.items.map((item) => (
          <NavLink
            key={item.to + item.label}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-4">
        <Link to="/profile" className="flex min-w-0 flex-1 items-center gap-3" title="My profile">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{initials(user.full_name)}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-800">{user.full_name}</div>
            <div className="text-xs capitalize text-slate-500">{user.role}</div>
          </div>
        </Link>
        <button onClick={logout} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Log out" aria-label="Log out">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-64 bg-white" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur sm:px-8">
          <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="hidden text-sm text-slate-400 lg:block">AI-Driven Soft Skills Assessment & Development System</div>
          <div className="flex items-center gap-1">
            <Notifications />
            <Link to="/profile" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Profile">
              <UserIcon className="h-5 w-5" />
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
