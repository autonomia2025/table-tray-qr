import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Building2, BarChart2, ToggleLeft, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useIsMobile } from '@/hooks/use-mobile';

const NAV_ITEMS = [
  { path: '/superadmin/tenants', icon: Building2, label: 'Tenants' },
  { path: '/superadmin/metricas', icon: BarChart2, label: 'Métricas' },
  { path: '/superadmin/flags', icon: ToggleLeft, label: 'Flags' },
  { path: '/superadmin/config', icon: Settings, label: 'Config' },
];

export default function SuperAdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop sidebar */}
      {!isMobile && (
        <aside className="w-56 border-r border-border bg-card flex flex-col shrink-0">
          <div className="h-14 flex items-center gap-2 px-4 border-b border-border">
            <span className="font-bold text-foreground text-sm">MenuQR</span>
            <Badge className="bg-indigo-600 text-white text-[10px] hover:bg-indigo-700">Founder</Badge>
          </div>
          <nav className="flex-1 p-2 space-y-1">
            {NAV_ITEMS.map(item => {
              const active = location.pathname.startsWith(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        {isMobile && (
          <header className="h-12 flex items-center gap-2 px-4 border-b border-border bg-card">
            <span className="font-bold text-foreground text-sm">MenuQR SuperAdmin</span>
            <Badge className="bg-indigo-600 text-white text-[10px] hover:bg-indigo-700">Founder</Badge>
          </header>
        )}

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>

        {/* Mobile bottom nav */}
        {isMobile && (
          <nav className="h-16 border-t border-border bg-card flex items-center justify-around shrink-0">
            {NAV_ITEMS.map(item => {
              const active = location.pathname.startsWith(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`flex flex-col items-center gap-0.5 px-3 py-1 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
