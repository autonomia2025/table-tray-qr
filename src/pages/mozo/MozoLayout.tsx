import { Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useWaiters } from '@/contexts/WaitersContext';
import { LayoutGrid, Bell, User, LogOut } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

function playNotifSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(1046, ctx.currentTime);
    osc.frequency.setValueAtTime(1318, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* ignore */ }
}

export default function MozoLayout() {
  const { isLoggedIn, staffName, branchId, staffId, logout } = useWaiters();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifCount, setNotifCount] = useState(0);
  const prevNotifCountRef = useRef(0);
  const audioUnlockedRef = useRef(false);

  // Unlock AudioContext on first user interaction
  useEffect(() => {
    const unlock = () => { audioUnlockedRef.current = true; };
    window.addEventListener("click", unlock, { once: true });
    return () => window.removeEventListener("click", unlock);
  }, []);

  // Count pending notifications for MY tables + unassigned tables
  useEffect(() => {
    if (!isLoggedIn) return;

    const fetchCounts = async () => {
      // First get my table IDs (assigned to me or unassigned)
      const { data: tablesData } = await supabase
        .from('tables')
        .select('id, assigned_waiter_id')
        .eq('branch_id', branchId);

      const myTableIds = (tablesData ?? [])
        .filter(t => !t.assigned_waiter_id || t.assigned_waiter_id === staffId)
        .map(t => t.id);

      if (myTableIds.length === 0) { setNotifCount(0); return; }

      const [wc, br, oc] = await Promise.all([
        supabase.from('waiter_calls').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).eq('status', 'pending').in('table_id', myTableIds),
        supabase.from('bill_requests').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).eq('status', 'pending').in('table_id', myTableIds),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).eq('status', 'confirmed').in('table_id', myTableIds),
      ]);
      setNotifCount((wc.count ?? 0) + (br.count ?? 0) + (oc.count ?? 0));
    };

    fetchCounts();

    const channel = supabase
      .channel('mozo-notif-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls', filter: `branch_id=eq.${branchId}` }, () => fetchCounts())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bill_requests', filter: `branch_id=eq.${branchId}` }, () => fetchCounts())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, () => fetchCounts())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables', filter: `branch_id=eq.${branchId}` }, () => fetchCounts())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isLoggedIn, branchId, staffId]);

  // Play sound when notification count increases
  useEffect(() => {
    if (!audioUnlockedRef.current) return;
    if (notifCount > prevNotifCountRef.current) {
      playNotifSound();
    }
    prevNotifCountRef.current = notifCount;
  }, [notifCount]);

  if (!isLoggedIn) return <Navigate to="/mozo/login" replace />;

  const tabs = [
    { path: '/mozo/mesas', icon: LayoutGrid, label: 'Mesas' },
    { path: '/mozo/notificaciones', icon: Bell, label: 'Alertas', badge: notifCount },
    { path: '/mozo/perfil', icon: User, label: 'Perfil' },
  ];

  const handleLogout = () => {
    logout();
    navigate('/mozo/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="h-14 border-b border-border bg-card flex items-center px-4 shrink-0">
        <span className="text-sm font-semibold text-foreground truncate flex-1">MenuQR</span>
        <span className="text-sm text-muted-foreground mr-3 truncate">{staffName}</span>
        <button onClick={handleLogout} className="p-2 text-muted-foreground hover:text-foreground">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      {/* Bottom nav */}
      <nav className="h-16 border-t border-border bg-card flex items-center justify-around shrink-0 safe-area-bottom">
        {tabs.map(tab => {
          const active = location.pathname === tab.path;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`flex flex-col items-center gap-0.5 relative px-4 py-1 ${active ? 'text-primary' : 'text-muted-foreground'}`}
            >
              <div className="relative">
                <tab.icon className="w-6 h-6" />
                {tab.badge ? (
                  <span className="absolute -top-1.5 -right-2 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                ) : null}
              </div>
              <span className="text-[11px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
