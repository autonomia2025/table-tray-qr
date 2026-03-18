import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { DollarSign, Users, TrendingDown, PieChart, LogIn, LogOut } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useState, useEffect } from 'react';
import ThemeToggle from '@/components/ThemeToggle';
import GlobalSearch from '@/components/GlobalSearch';

const NAV_ITEMS = [
  { path: '/finanzas/revenue', icon: DollarSign, label: 'Revenue' },
  { path: '/finanzas/clientes', icon: Users, label: 'Clientes' },
  { path: '/finanzas/churn', icon: TrendingDown, label: 'Churn' },
  { path: '/finanzas/costos', icon: PieChart, label: 'Costos' },
];

function FinanzasLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Tablio</h1>
          <Badge className="bg-secondary text-secondary-foreground mt-1">Finanzas</Badge>
        </div>
        <Input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <Input placeholder="Contraseña" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" className="w-full gap-2" disabled={loading}>
          <LogIn className="w-4 h-4" />
          {loading ? 'Ingresando...' : 'Ingresar'}
        </Button>
      </form>
    </div>
  );
}

export default function FinanzasLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authorized, setAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setIsLoading(false); return; }
      // Allow platform admins or backoffice members with role 'finanzas' or 'jefe_ventas'
      const [adminRes, memberRes] = await Promise.all([
        supabase.from('platform_admins').select('id').eq('user_id', session.user.id).maybeSingle(),
        supabase.from('backoffice_members').select('id, role').eq('user_id', session.user.id).eq('is_active', true).maybeSingle(),
      ]);
      const isAdmin = !!adminRes.data;
      const member = memberRes.data as any;
      const allowedRoles = ['finanzas', 'jefe_ventas', 'superadmin'];
      setAuthorized(isAdmin || (member && allowedRoles.includes(member.role)));
      setIsLoading(false);
    };
    check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => check());
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/finanzas');
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!authorized) return <FinanzasLogin />;

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-56 border-r border-border bg-card flex flex-col shrink-0">
        <div className="h-14 flex items-center gap-2 px-5 border-b border-border">
          <span className="font-bold text-foreground text-lg tracking-tight">Tablio</span>
          <Badge className="bg-secondary text-secondary-foreground text-[10px]">Finanzas</Badge>
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
        <div className="p-3 border-t border-border space-y-1">
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
