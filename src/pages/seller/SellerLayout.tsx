import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { CalendarCheck, ClipboardList, BarChart3, BookOpen, PlusCircle, LogIn, LogOut, DollarSign } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSeller } from '@/contexts/SellerContext';
import { supabase } from '@/integrations/supabase/client';
import { useState } from 'react';
import ThemeToggle from '@/components/ThemeToggle';

const NAV_ITEMS = [
  { path: '/vendedor/mi-dia', icon: CalendarCheck, label: 'Mi día' },
  { path: '/vendedor/registro', icon: PlusCircle, label: 'Visita' },
  { path: '/vendedor/pipeline', icon: ClipboardList, label: 'Pipeline' },
  { path: '/vendedor/numeros', icon: BarChart3, label: 'Números' },
  { path: '/vendedor/recursos', icon: BookOpen, label: 'Recursos' },
];

function SellerLogin() {
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
          <Badge className="bg-primary text-primary-foreground mt-1">Vendedor</Badge>
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

export default function SellerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { seller, isLoading, isAuthenticated } = useSeller();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/vendedor');
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <SellerLogin />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top header - compact */}
      <header className="h-12 flex items-center justify-between px-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-foreground">Tablio</span>
          <Badge variant="outline" className="text-[10px] border-primary text-primary">{seller?.zone || 'Vendedor'}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <span className="text-xs text-muted-foreground truncate max-w-[100px]">{seller?.name}</span>
          <button onClick={handleLogout} className="text-muted-foreground hover:text-foreground transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto pb-20">
        <Outlet />
      </main>

      {/* Bottom nav - mobile-first */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 border-t border-border bg-card flex items-center justify-around z-50">
        {NAV_ITEMS.map(item => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 transition-colors ${
                active ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <item.icon className={`w-5 h-5 ${active ? 'stroke-[2.5]' : ''}`} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
