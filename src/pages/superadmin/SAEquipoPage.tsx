import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useSuperAdmin } from '@/contexts/SuperAdminContext';
import { useNavigate } from 'react-router-dom';
import { Users, Eye, Shield, DollarSign, HeartPulse, Megaphone, UserCheck } from 'lucide-react';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  zone: string | null;
  is_active: boolean | null;
  last_access_at: string | null;
  user_id: string | null;
}

const ROLE_CONFIG: Record<string, { label: string; icon: any; color: string; panel: string }> = {
  superadmin: { label: 'Superadmin', icon: Shield, color: 'bg-secondary text-secondary-foreground', panel: '/superadmin' },
  jefe_ventas: { label: 'Jefe de Ventas', icon: Users, color: 'bg-primary text-primary-foreground', panel: '/backoffice' },
  vendedor: { label: 'Vendedor', icon: UserCheck, color: 'bg-primary/20 text-primary', panel: '/vendedor' },
  finanzas: { label: 'Finanzas', icon: DollarSign, color: 'bg-muted text-muted-foreground', panel: '/finanzas' },
  marketing: { label: 'Marketing', icon: Megaphone, color: 'bg-muted text-muted-foreground', panel: '#' },
  customer_success: { label: 'Customer Success', icon: HeartPulse, color: 'bg-muted text-muted-foreground', panel: '#' },
};

export default function SAEquipoPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const { setImpersonating } = useSuperAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    supabase.from('backoffice_members').select('*').order('role').then(({ data }) => {
      setMembers((data || []) as Member[]);
      setLoading(false);
    });
  }, []);

  const impersonate = (member: Member) => {
    const config = ROLE_CONFIG[member.role] || ROLE_CONFIG.vendedor;
    setImpersonating(member.user_id);
    navigate(config.panel);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  // Group by role
  const grouped = Object.keys(ROLE_CONFIG).map(role => ({
    role,
    config: ROLE_CONFIG[role],
    members: members.filter(m => m.role === role),
  })).filter(g => g.members.length > 0 || ['jefe_ventas', 'vendedor', 'finanzas'].includes(g.role));

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Equipo</h1>
        <Badge variant="outline">{members.length} miembros</Badge>
      </div>

      {grouped.map(g => {
        const Icon = g.config.icon;
        return (
          <div key={g.role}>
            <div className="flex items-center gap-2 mb-3">
              <Icon className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">{g.config.label}</h2>
              <Badge variant="outline" className="text-xs">{g.members.length}</Badge>
            </div>
            {g.members.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-center text-sm text-muted-foreground">
                  Sin miembros con este rol
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-2">
                {g.members.map(m => (
                  <Card key={m.id}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${g.config.color}`}>
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{m.name}</p>
                          <p className="text-xs text-muted-foreground">{m.email} {m.zone ? `· ${m.zone}` : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={m.is_active ? 'outline' : 'destructive'} className="text-[10px]">
                          {m.is_active ? 'Activo' : 'Inactivo'}
                        </Badge>
                        {m.user_id && (
                          <Button variant="ghost" size="sm" onClick={() => impersonate(m)} title="Ver como este usuario">
                            <Eye className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
