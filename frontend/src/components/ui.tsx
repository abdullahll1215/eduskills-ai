import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { ReactNode, useCallback, useEffect, useState } from "react";
import type { Level } from "../api/types";

export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Loading({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" /> {label}
    </div>
  );
}

export function Alert({ kind = "info", title, children, onClose }: { kind?: "info" | "error" | "success" | "warning"; title?: string; children?: ReactNode; onClose?: () => void }) {
  const styles = {
    info: "border-blue-200 bg-blue-50 text-blue-800",
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
  }[kind];
  const Icon = { info: Info, error: AlertTriangle, success: CheckCircle2, warning: AlertTriangle }[kind];
  return (
    <div className={`flex gap-3 rounded-xl border p-4 text-sm ${styles}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={title ? "mt-1" : ""}>{children}</div>}
      </div>
      {onClose && (
        <button onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "default", icon }: { label: string; value: ReactNode; hint?: string; tone?: "default" | "danger" | "warning" | "success"; icon?: ReactNode }) {
  const toneCls = {
    default: "bg-white border-slate-200",
    danger: "bg-red-50 border-red-200",
    warning: "bg-amber-50 border-amber-200",
    success: "bg-emerald-50 border-emerald-200",
  }[tone];
  const valueCls = { default: "text-slate-900", danger: "text-red-600", warning: "text-amber-600", success: "text-emerald-600" }[tone];
  return (
    <div className={`rounded-xl border p-5 shadow-sm ${toneCls}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className={`text-sm ${tone === "danger" ? "text-red-600" : "text-slate-500"}`}>{label}</div>
          <div className={`mt-2 text-3xl font-bold ${valueCls}`}>{value}</div>
          {hint && <div className={`mt-1 text-xs ${tone === "danger" ? "text-red-500" : "text-slate-400"}`}>{hint}</div>}
        </div>
        {icon && <div className="rounded-lg bg-slate-50 p-2.5">{icon}</div>}
      </div>
    </div>
  );
}

export const LEVEL_LABEL: Record<Level, string> = { ALIGNED: "Aligned", MODERATE_GAP: "Moderate", CRITICAL_GAP: "Critical" };

export function LevelBadge({ level, label }: { level?: Level | string | null; label?: string }) {
  if (!level) return <span className="badge bg-slate-100 text-slate-500">{label ?? "Pending"}</span>;
  const cls = {
    ALIGNED: "bg-emerald-100 text-emerald-700",
    MODERATE_GAP: "bg-amber-100 text-amber-700",
    CRITICAL_GAP: "bg-red-100 text-red-700",
  }[level as Level] ?? "bg-slate-100 text-slate-600";
  return <span className={`badge ${cls}`}>{label ?? LEVEL_LABEL[level as Level] ?? level}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Aligned: "bg-emerald-100 text-emerald-700",
    Moderate: "bg-amber-100 text-amber-700",
    Critical: "bg-red-100 text-red-700",
    "Awaiting instructor": "bg-brand-100 text-brand-700",
    Processing: "bg-blue-100 text-blue-700",
    Incomplete: "bg-slate-100 text-slate-500",
    open: "bg-red-100 text-red-700",
    acknowledged: "bg-amber-100 text-amber-700",
    resolved: "bg-emerald-100 text-emerald-700",
  };
  return <span className={`badge ${map[status] ?? "bg-slate-100 text-slate-600"}`}>{status}</span>;
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon}
      <div className="text-base font-semibold text-slate-800">{title}</div>
      {children && <div className="max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Modal({ open, title, children, onClose, footer }: { open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function fmt(v: number | null | undefined, digits = 1) {
  return v == null ? "—" : v.toFixed(digits);
}

export function fmtDate(v?: string | null, withTime = false) {
  if (!v) return "—";
  const d = new Date(v.endsWith("Z") || v.includes("+") ? v : v + "Z");
  return withTime ? d.toLocaleString() : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function initials(name: string) {
  return name
    .replace(/^(Dr|Ms|Mr|Mrs)\.?\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

// ---------------------------------------------------------------- in-page dialogs --
// window.confirm/prompt are blocked in sandboxed frames, so confirmations are rendered in the page.

type DialogRequest = { kind: "confirm" | "prompt" | "file"; message: string; value?: string; title?: string; resolve: (v: string | boolean | null) => void };
let pushDialog: ((d: DialogRequest) => void) | null = null;

export function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => (pushDialog ? pushDialog({ kind: "confirm", message, resolve: (v) => resolve(v === true) }) : resolve(true)));
}

export function askText(message: string, value = ""): Promise<string | null> {
  return new Promise((resolve) => (pushDialog ? pushDialog({ kind: "prompt", message, value, resolve: (v) => resolve(typeof v === "string" ? v : null) }) : resolve(value)));
}

/** Shows a generated file (CSV) in a dialog where downloads are not possible. */
export function showFile(title: string, content: string) {
  pushDialog?.({ kind: "file", title, message: "", value: content, resolve: () => undefined });
}

export function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    pushDialog = (d) => {
      setText(d.value ?? "");
      setCopied(false);
      setReq(d);
    };
    return () => {
      pushDialog = null;
    };
  }, []);
  if (!req) return null;
  const close = (v: string | boolean | null) => {
    req.resolve(v);
    setReq(null);
  };
  if (req.kind === "file") {
    const rows = (req.value ?? "").trim().split("\n").map((r) => r.split(","));
    return (
      <Modal open title={req.title ?? "File"} onClose={() => close(null)}
        footer={<>
          <button className="btn-outline" onClick={() => navigator.clipboard?.writeText(req.value ?? "").then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? "Copied" : "Copy CSV"}</button>
          <button className="btn-primary" onClick={() => close(null)}>Close</button>
        </>}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={i === 0 ? "bg-slate-50 font-semibold" : "border-t border-slate-100"}>
                  {r.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1.5">{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open title={req.kind === "confirm" ? "Please confirm" : "Enter a value"} onClose={() => close(req.kind === "confirm" ? false : null)}
      footer={<>
        <button className="btn-ghost" onClick={() => close(req.kind === "confirm" ? false : null)}>Cancel</button>
        <button className="btn-primary" onClick={() => close(req.kind === "confirm" ? true : text)}>{req.kind === "confirm" ? "Confirm" : "OK"}</button>
      </>}>
      <p className="text-sm text-slate-700">{req.message}</p>
      {req.kind === "prompt" && <input className="input mt-3" value={text} onChange={(e) => setText(e.target.value)} autoFocus />}
    </Modal>
  );
}
