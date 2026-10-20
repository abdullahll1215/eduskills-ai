import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "../api/client";
import type { User } from "../api/types";

export interface RegisterData {
  full_name: string;
  email: string;
  password: string;
  student_number?: string;
}

/** The sign-in page used; the server refuses a student account on the staff page and vice versa. */
export type Portal = "student" | "staff";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, portal?: Portal) => Promise<User>;
  register: (data: RegisterData) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api<User>("/api/auth/me"));
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (email: string, password: string, portal?: Portal) => {
    const res = await api<{ access_token: string; user: User }>("/api/auth/login", { body: { email, password, portal } });
    setToken(res.access_token);
    setUser(res.user);
    return res.user;
  };

  const register = async (data: RegisterData) => {
    const res = await api<{ access_token: string; user: User }>("/api/auth/register", { body: data });
    setToken(res.access_token);
    setUser(res.user);
    return res.user;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function homeFor(role: string) {
  return { student: "/student", instructor: "/instructor", advisor: "/advisor", admin: "/admin" }[role] ?? "/login";
}
