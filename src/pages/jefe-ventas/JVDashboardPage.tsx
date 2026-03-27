import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { Target, Users, DollarSign, TrendingUp, Loader2 } from 'lucide-react';

const PILOT_THRESHOLD = 5;
const PILOT_PRICE = 199000;
const COMMERCIAL_PRICE = 299000;

export default function JVDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>({});

  useEffect(() => {
    const load = async () => {
      const [tenantsRes, leadsRes, membersRes] = await Promise.all([
        supabase.from('tenants').select('id, name, plan_status, is_active, created_at'),
        supabase.from('leads').select('id, stage, assigned_seller_id, monthly_value, created_at, updated_at'),
        supabase.from('backoffice_members').select('id, name, role').eq('is_active', true),
      ]);

      const tenants = tenantsRes.data || [];
      const leads = leadsRes.data || [];
      const members = membersRes.data || [];

      const paying = tenants.filter(t => t.plan_status === 'active' || t.plan_status === 'paying');
      const pilots = tenants.filter(t => t.plan_status === 'pilot' || t.plan_status === 'trial');
      const totalClients = paying.length + pilots.length;

      const isPhase0 = totalClients < PILOT_THRESHOLD;
      const currentPrice = isPhase0 ? PILOT_PRICE : COMMERCIAL_PRICE;
      const activeRecurring = isPhase0 ? 30000 : 40000;

      const mrr = paying.reduce((s, t) => {
        // First 5 at pilot price, rest at commercial
        return s + (paying.indexOf(t) < PILOT_THRESHOLD ? PILOT_PRICE : COMMERCIAL_PRICE);
      }, 0);

      const sellers = members.filter(m => m.role === 'vendedor');
      const closedLeads = leads.filter(l => l.stage === 'cliente_pagando');
      const pipelineLeads = leads.filter(l => !['cliente_pagando', 'frio'].includes(l.stage));

      // Stale leads (>48h without update)
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const staleLeads = leads.filter(l =>
        !['cliente_pagando', 'frio'].includes(l.stage) &&
        (!l.updated_at || l.updated_at < twoDaysAgo)
      );

      // Weekly closes
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const weeklyCloses = closedLeads.filter(l => l.created_at && l.created_at > weekAgo).length;

      setData({
        totalClients, paying: paying.length, pilots: pilots.length,
        isPhase0, currentPrice, activeRecurring, mrr,
        sellers: sellers.length, closedLeads: closedLeads.length,
        pipelineLeads: pipelineLeads.length, staleLeads,
        weeklyCloses, totalLeads: leads.length,
      });
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const d = data;
  const phaseLabel = d.isPhase0 ? 'Fase Piloto' : 'Fase Comercial';
  const phaseProgress = Math.min((d.totalClients / PILOT_THRESHOLD) * 100, 100);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Resumen de ventas y equipo</p>
        </div>
        <Badge className={`text-sm px-3 py-1 ${d.isPhase0 ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' : 'bg-primary/10 text-primary border-primary/20'}`}>
          {phaseLabel} — ${(d.currentPrice).toLocaleString('es-CL')}/cliente
        </Badge>
      </div>

      {/* Phase progress */}
      <Card className="border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Progreso a Fase Comercial</span>
            </div>
            <span className="text-sm font-bold text-foreground">{d.totalClients} / {PILOT_THRESHOLD}</span>
          </div>
          <Progress value={phaseProgress} className="h-3" />
          <p className="text-xs text-muted-foreground mt-2">
            {d.isPhase0
              ? `Faltan ${PILOT_THRESHOLD - d.totalClients} pilotos para pasar a $${COMMERCIAL_PRICE.toLocaleString('es-CL')}/cliente`
              : '¡Fase comercial activa! Precio: $299.000/cliente'}
          </p>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground font-medium">MRR Proyectado</p>
              <DollarSign className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold text-foreground mt-1">${d.mrr.toLocaleString('es-CL')}</p>
            <p className="text-xs text-muted-foreground">{d.paying} clientes pagando</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Pilotos activos</p>
            <p className="text-2xl font-bold text-foreground mt-1">{d.pilots}</p>
            <p className="text-xs text-muted-foreground">En período de prueba</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">En pipeline</p>
            <p className="text-2xl font-bold text-foreground mt-1">{d.pipelineLeads}</p>
            <p className="text-xs text-muted-foreground">{d.totalLeads} leads totales</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground font-medium">Vendedores</p>
              <Users className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold text-foreground mt-1">{d.sellers}</p>
            <p className="text-xs text-muted-foreground">activos</p>
          </CardContent>
        </Card>
      </div>

      {/* Weekly summary */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Resumen semanal</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-primary">{d.weeklyCloses}</p>
              <p className="text-xs text-muted-foreground">Cierres esta semana</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{d.pipelineLeads}</p>
              <p className="text-xs text-muted-foreground">Leads activos</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stale leads alert */}
      {d.staleLeads.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 text-amber-600">
              ⚠️ Leads sin actualizar +48h ({d.staleLeads.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-40 overflow-auto">
              {d.staleLeads.slice(0, 10).map((l: any) => (
                <div key={l.id} className="flex justify-between text-sm">
                  <span className="text-foreground font-medium">{l.restaurant_name || l.id.slice(0, 8)}</span>
                  <span className="text-xs text-muted-foreground">{l.stage}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
