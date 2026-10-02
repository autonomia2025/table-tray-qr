import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useAdmin } from "@/contexts/AdminContext";
import { inicioPanel, puedeVer, type SeccionLocal } from "@/lib/roles";

/**
 * Entrada al panel del local: exige sesión con acceso a ESTE local y deja abrir
 * solo las secciones de su rol (src/lib/roles.ts). Mozo y cocina tienen sus propias pantallas.
 */
export default function AdminGuard() {
  const { isLoading, isAuthenticated, role, branchId } = useAdmin();
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated || !role) return <Navigate to="/login" replace />;
  if (role === "waiter") return <Navigate to="/mozo/mesas" replace />;
  if (role === "kitchen") return <Navigate to={branchId ? `/kds?branch=${branchId}` : "/kds"} replace />;

  const seccion = location.pathname.split("/")[3] as SeccionLocal | undefined;
  if (seccion && !puedeVer(role, seccion)) {
    return <Navigate to={`/admin/${slug}/${inicioPanel(role)}`} replace />;
  }

  return <Outlet />;
}
