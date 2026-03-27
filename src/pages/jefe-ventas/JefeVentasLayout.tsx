import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, DollarSign, Kanban, Settings, LogOut } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useJefeVentas } from '@/contexts/JefeVentasContext';
import ThemeToggle from '@/components/ThemeToggle';

const NAV_ITEMS = [
  { path: '/jefe-ventas/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/jefe-ventas/equipo', icon: Users, label: 'Equipo' },
  { path: '/jefe-ventas/comisiones', icon: DollarSign, label: 'Comisiones' },
  { path: '/jefe-ventas/pipeline', icon: Kanban, label: 'Pipeline' },
  { path: '/jefe-ventas/perfil', icon: Settings, label: 'Mi perfil' },
];

export default function JefeVentasLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, isLoading, isAuthenticated } = useJefeVentas();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    navigate('/login');
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-56 border-r border-border bg-card flex flex-col shrink-0">
        <div className="h-14 flex items-center gap-2 px-5 border-b border-border">
          <span className="font-bold text-foreground text-lg tracking-tight">tablio</span>
          <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">Jefe Ventas</Badge>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(item => {
            const active = location.pathname.startsWith(item.path);
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border space-y-2">
          <div className="px-3 py-1">
            <p className="text-xs text-muted-foreground truncate">{profile?.name}</p>
            <p className="text-[10px] text-muted-foreground/60 truncate">{profile?.email}</p>
          </div>
          <div className="flex items-center justify-between px-1">
            <ThemeToggle />
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
