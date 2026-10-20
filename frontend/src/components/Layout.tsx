import {
  Activity,
  BarChart3,
  Bell,
  BookOpenCheck,
  ClipboardCheck,
  Database,
  FileText,
  FolderKanban,
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
import { useT } from "../i18n";
import LanguageMenu from "./LanguageMenu";
import BrandLogo from "./Brand";
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
      { to: "/student/peers", label: "Give Feedback", icon: <Users className={ic} /> },
      { to: "/student/report", label: "AI Growth Report", icon: <FileText className={ic} /> },
      { to: "/student/feedback", label: "360° Feedback", icon: <MessageCircle className={ic} /> },
      { to: "/student/artifacts", label: "My Projects", icon: <FolderKanban className={ic} /> },
      { to: "/student/team", label: "My Team", icon: <Users className={ic} /> },
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
  const t = useT();
  return <div className="sidebar-brand"><BrandLogo caption={t(portal)} /></div>;
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const navigate = useNavigate();
  const t = useT();
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
      <button onClick={() => setOpen(!open)} className="relative rounded-lg p-2 text-slate-500 hover:bg-brand-50 hover:text-brand-700" aria-label={t("Notifications")}>
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute end-0 z-40 mt-2 w-80 overflow-hidden sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold">{t("Notifications")}</span>
            {unread > 0 && (
              <button className="text-xs text-brand-600 hover:underline" onClick={() => api("/api/notifications/read-all", { method: "POST" }).then(load)}>
                {t("Mark all read")}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-400">{t("No notifications")}</div>}
            {items.map((n) => (
              <button key={n.id} onClick={() => openItem(n)} className={`block w-full border-b border-slate-50 px-4 py-3 text-start hover:bg-slate-50 ${n.is_read ? "" : "bg-brand-50/50"}`}>
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
  const t = useT();
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const drawer = document.getElementById("mobile-navigation");
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
      if (e.key === "Tab" && drawer) {
        const focusable = [...drawer.querySelectorAll<HTMLElement>("a, button")];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawer?.querySelector<HTMLElement>("button")?.focus();
    document.addEventListener("keydown", close);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", close); previous?.focus(); };
  }, [mobileOpen]);
  if (!user) return null;
  const nav = NAV[user.role];

  const sidebar = (
    <div className="flex h-full flex-col">
      <Brand portal={nav.portal} />
      <div className="sidebar-section">{t("Workspace")}</div>
      <nav className="sidebar-nav" aria-label={t("Main navigation")}>
        {nav.items.map((item) => (
          <NavLink
            key={item.to + item.label}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? "is-active" : ""}`
            }
          >
            {item.icon}
            {t(item.label)}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-profile">
        <Link to="/profile" className="flex min-w-0 flex-1 items-center gap-3" title={t("My profile")}>
          <div className="sidebar-avatar">{initials(user.full_name)}</div>
          <div className="min-w-0">
            <div className="profile-name truncate text-xs font-medium">{user.full_name}</div>
            <div className="profile-role mt-1 text-[11px] capitalize">{t(user.role)}</div>
          </div>
        </Link>
        <button onClick={logout} className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-700" title={t("Log out")} aria-label={t("Log out")}>
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-canvas">
      <a className="skip-link" href="#workspace-content">{t("Skip to content")}</a>
      <aside className="workspace-sidebar fixed inset-y-0 start-0 z-40 hidden w-60 lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside id="mobile-navigation" className="workspace-sidebar relative h-full w-72" role="dialog" aria-modal="true" aria-label={t("Main navigation")} onClick={(e) => e.stopPropagation()}>
            <button className="absolute end-2 top-2 rounded-lg p-3 text-white lg:hidden" onClick={() => setMobileOpen(false)} aria-label={t("Close menu")}><X className="h-5 w-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:ps-60">
        <header className="workspace-header sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 px-4 sm:px-9">
          <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("Open menu")} aria-expanded={mobileOpen} aria-controls="mobile-navigation">
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="text-sm font-semibold tracking-tight text-slate-800 lg:hidden" dir="ltr">EduSkills<span className="ms-1 text-[10px] text-slate-500">AI</span></span>
          <div className="workspace-breadcrumb hidden lg:flex"><span>{t(nav.portal)}</span><span aria-hidden="true">/</span><strong>{t(nav.items.find((item) => location.pathname === item.to || (!item.end && location.pathname.startsWith(item.to + "/")))?.label ?? "My profile")}</strong></div>
          <div className="flex items-center gap-1">
            <LanguageMenu />
            <Notifications />
            <Link to="/profile" className="rounded-lg p-2 text-slate-500 hover:bg-brand-50 hover:text-brand-700" aria-label={t("Profile")}>
              <UserIcon className="h-5 w-5" />
            </Link>
          </div>
        </header>
        <main id="workspace-content" className="workspace-main mx-auto w-full max-w-6xl flex-1 px-5 py-7 sm:px-9 sm:py-9" tabIndex={-1}>
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
