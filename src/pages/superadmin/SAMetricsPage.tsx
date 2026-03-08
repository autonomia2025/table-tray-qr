import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Building2, ShoppingBag, TrendingUp, DollarSign } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface DayCount { day: string; count: number }
interface TopTenant { name: string; orders_count: number; last_order: string | null }

export default function SAMetricsPage() {
  const [loading, setLoading] = useState(true);
  const [activeTenants, setActiveTenants] = useState(0);
  const [ordersToday, setOrdersToday] = useState(0);
  const [ordersMonth, setOrdersMonth] = useState(0);
  const [chartData, setChartData] = useState<DayCount[]>([]);
  const [topTenants, setTopTenants] = useState<TopTenant[]>([]);

  useEffect(() => {
    const load = async () => {
      const today = new Date().toISOString().split('T')[0];
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

      const [tenantsRes, todayRes, monthRes, weekOrders, allTenants, monthOrders] = await Promise.all([
        supabase.from('tenants').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('orders').select('id', { count: 'exact', head: true }).gte('confirmed_at', today),
        supabase.from('orders').select('id', { count: 'exact', head: true }).gte('confirmed_at', monthStart.toISOString()),
        supabase.from('orders').select('confirmed_at').gte('confirmed_at', weekAgo.toISOString()).order('confirmed_at'),
        supabase.from('tenants').select('id, name'),
        supabase.from('orders').select('tenant_id, confirmed_at').gte('confirmed_at', monthStart.toISOString()),
      ]);

      setActiveTenants(tenantsRes.count ?? 0);
      setOrdersToday(todayRes.count ?? 0);
      setOrdersMonth(monthRes.count ?? 0);

      // Build chart data
      const dayMap: Record<string, number> = {};
      const dayNames = ['dom','lun','mar','mié','jue','vie','sáb'];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        dayMap[key] = 0;
      }
      weekOrders.data?.forEach(o => {
        const key = o.confirmed_at?.split('T')[0];
        if (key && dayMap[key] !== undefined) dayMap[key]++;
      });
      setChartData(Object.entries(dayMap).map(([day, count]) => ({
        day: dayNames[new Date(day + 'T12:00:00').getDay()],
        count,
      })));

      // Top tenants
      const tenantMap: Record<string, { name: string; count: number; last: string }> = {};
      allTenants.data?.forEach(t => { tenantMap[t.id] = { name: t.name, count: 0, last: '' }; });
      monthOrders.data?.forEach(o => {
        if (tenantMap[o.tenant_id]) {
          tenantMap[o.tenant_id].count++;
          if (o.confirmed_at && o.confirmed_at > tenantMap[o.tenant_id].last) {
            tenantMap[o.tenant_id].last = o.confirmed_at;
          }
        }
      });
      setTopTenants(
        Object.values(tenantMap)
          .filter(t => t.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 10)
          .map(t => ({ name: t.name, orders_count: t.count, last_order: t.last || null }))
      );

      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const cards = [
    { label: 'Tenants activos', value: activeTenants, icon: Building2, color: 'text-indigo-600' },
    { label: 'Pedidos hoy', value: ordersToday, icon: ShoppingBag, color: 'text-primary' },
    { label: 'Pedidos este mes', value: ordersMonth, icon: TrendingUp, color: 'text-green-600' },
    { label: 'Revenue estimado', value: 'Próximamente', icon: DollarSign, color: 'text-muted-foreground' },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold text-foreground">Métricas</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center ${c.color}`}>
                  <c.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{c.value}</p>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Pedidos últimos 7 días</h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {topTenants.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Top tenants este mes</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-muted-foreground font-medium">Restaurante</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Pedidos</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Último</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {topTenants.map((t, i) => (
                    <tr key={i}>
                      <td className="py-2 font-medium text-foreground">{t.name}</td>
                      <td className="py-2 text-right font-semibold">{t.orders_count}</td>
                      <td className="py-2 text-right text-muted-foreground text-xs">
                        {t.last_order ? new Date(t.last_order).toLocaleDateString('es-CL') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
