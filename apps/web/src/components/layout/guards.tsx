import { Navigate, useLocation } from "react-router";
import type { UserRole } from "@mountain-live/core";
import { useSessionStore } from "@/store/session";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useSessionStore((s) => s.token);
  const loc = useLocation();
  if (!token) return <Navigate to="/auth/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const user = useSessionStore((s) => s.user);
  const loc = useLocation();
  if (!user) return <Navigate to="/auth/login" replace state={{ from: loc.pathname }} />;
  if (!roles.includes(user.role) && user.role !== "admin") return <Navigate to="/map" replace />;
  return <>{children}</>;
}
