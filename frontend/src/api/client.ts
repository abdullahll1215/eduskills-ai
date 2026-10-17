const TOKEN_KEY = "eduskills.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((d) => d.msg ?? String(d)).join("; ");
  }
  return fallback;
}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown; params?: Record<string, string | undefined | null> } = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  Object.entries(options.params ?? {}).forEach(([k, v]) => v != null && v !== "" && url.searchParams.set(k, v));
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url.pathname + url.search, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401 && token) {
    setToken(null);
    window.location.href = "/login";
  }
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, `Request failed (${res.status})`));
  return data as T;
}

/** Downloads a protected file (PDF/CSV) using the bearer token. */
export async function download(path: string, filename: string, params?: Record<string, string | undefined>) {
  const url = new URL(path, window.location.origin);
  Object.entries(params ?? {}).forEach(([k, v]) => v && url.searchParams.set(k, v));
  const res = await fetch(url.pathname + url.search, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errorMessage(data, "Download failed"));
  }
  const blob = await res.blob();
  const type = res.headers.get("content-type") ?? "";
  const name = type.includes("csv") && filename.endsWith(".pdf") ? filename.replace(/\.pdf$/, ".csv") : filename;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}
