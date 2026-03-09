import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Building2, ShoppingBag, TrendingUp, DollarSign, Users, Zap, QrCode, ChefHat } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import ReportKPICard from "@/components/reports/ReportKPICard";
import { fetchAll, startOfMonth, daysAgo, pctChange } from "@/lib/report-utils";

export default function SAMetricsPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>({});

  useEffect(() => {
    const load = async () => {
      const today = new Date().toISOString().split("T")[0];
      const monthStart = startOfMonth(new Date()).toISOString();
      const weekAgo = daysAgo(7).toISOString();
      const prevMonthStart = new Date(); prevMonthStart.setMonth(prevMonthStart.getMonth() - 1); prevMonthStart.setDate(1);
      const prevMonthEnd = startOfMonth(new Date()); prevMonthEnd.setDate(prevMonthEnd.getDate() - 1);

      const [
        allTenants, activeTenantsRes, ordersToday, ordersMonth, ordersPrevMonth,
        weekOrders, staffUsers, tablesData, waiterCallsMonth, billRequestsMonth,
      ] = await Promise.all([
        supabase.from("tenants").select("id, name, created_at, is_active, plan_status, trial_ends_at, slug"),
        supabase.from("tenants").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("orders").select("id", { count: "exact", head: true }).gte("confirmed_at", today),
        fetchAll("orders", "id, tenant_id, confirmed_at, total_amount, status, source", [
          { column: "confirmed_at", op: "gte", value: monthStart },
        ]),
        fetchAll("orders", "id, total_amount", [
          { column: "confirmed_at", op: "gte", value: prevMonthStart.toISOString() },
          { column: "confirmed_at", op: "lte", value: prevMonthEnd.toISOString() },
        ]),
        fetchAll("orders", "confirmed_at, tenant_id", [
          { column: "confirmed_at", op: "gte", value: weekAgo },
        ]),
        supabase.from("staff_users").select("id, tenant_id, role"),
        supabase.from("tables").select("id, tenant_id, qr_token"),
        supabase.from("waiter_calls").select("id").gte("created_at", monthStart),
        supabase.from("bill_requests").select("id").gte("requested_at", monthStart),
      ]);

      const tenants = allTenants.data ?? [];
      const activeTenantCount = activeTenantsRes.count ?? 0;
      const monthOrders = ordersMonth as any[];
      const prevMonth = ordersPrevMonth as any[];

      // -- SaaS metrics --
      const totalOrdersMonth = monthOrders.length;
      const totalRevenueMonth = monthOrders.reduce((s: number, o: any) => s + (o.total_amount ?? 0), 0);
      const prevRevenueMonth = prevMonth.reduce((s: number, o: any) => s + (o.total_amount ?? 0), 0);

      // Tenants with orders this month
      const tenantsWithOrders = new Set(monthOrders.map((o: any) => o.tenant_id));
      const inactiveTenants = tenants.filter(t => t.is_active && !tenantsWithOrders.has(t.id));

      // Trial vs active
      const onTrial = tenants.filter(t => t.plan_status === "trial" && t.is_active);
      const paying = tenants.filter(t => t.plan_status === "active" && t.is_active);

      // New tenants per month (last 6 months)
      const newTenantsChart: { month: string; count: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(); d.setMonth(d.getMonth() - i);
        const m = d.toISOString().slice(0, 7);
        const count = tenants.filter(t => t.created_at?.startsWith(m)).length;
        newTenantsChart.push({ month: m.slice(5), count });
      }

      // Orders per day (last 7)
      const dayNames = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
      const dayMap: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        dayMap[d.toISOString().split("T")[0]] = 0;
      }
      (weekOrders as any[]).forEach((o: any) => {
        const key = o.confirmed_at?.split("T")[0];
        if (key && dayMap[key] !== undefined) dayMap[key]++;
      });
      const chartData = Object.entries(dayMap).map(([day, count]) => ({
        day: dayNames[new Date(day + "T12:00:00").getDay()],
        count,
      }));

      // Top tenants
      const tenantOrders: Record<string, { name: string; count: number; revenue: number }> = {};
      tenants.forEach(t => { tenantOrders[t.id] = { name: t.name, count: 0, revenue: 0 }; });
      monthOrders.forEach((o: any) => {
        if (tenantOrders[o.tenant_id]) {
          tenantOrders[o.tenant_id].count++;
          tenantOrders[o.tenant_id].revenue += o.total_amount ?? 0;
        }
      });
      const topTenants = Object.values(tenantOrders).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
      const neverOrdered = Object.values(tenantOrders).filter(t => t.count === 0);

      // Feature usage
      const staffData = staffUsers.data ?? [];
      const tablesAll = tablesData.data ?? [];
      const tenantsWithStaff = new Set(staffData.filter(s => s.role === "waiter").map(s => s.tenant_id)).size;
      const tenantsWithQR = new Set(tablesAll.map(t => t.tenant_id)).size;
      const kdsUsage = monthOrders.filter((o: any) => o.status === "delivered" || o.status === "ready").length;
      const waiterCallCount = waiterCallsMonth.data?.length ?? 0;
      const billRequestCount = billRequestsMonth.data?.length ?? 0;
      const manualOrders = monthOrders.filter((o: any) => o.source === "manual_waiter").length;

      setData({
        activeTenantCount,
        totalTenants: tenants.length,
        ordersToday: ordersToday.count ?? 0,
        totalOrdersMonth,
        totalRevenueMonth,
        prevRevenueMonth,
        prevMonthOrders: prevMonth.length,
        inactiveTenants,
        onTrial,
        paying,
        newTenantsChart,
        chartData,
        topTenants,
        neverOrdered,
        tenantsWithStaff,
        tenantsWithQR,
        totalStaff: staffData.length,
        totalTables: tablesAll.length,
        kdsUsage,
        waiterCallCount,
        billRequestCount,
        manualOrders,
      });

      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const d = data;
  const fmtCLP = (n: number) => "$" + n.toLocaleString("es-CL");

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold text-foreground">Métricas de Plataforma</h1>

      <Tabs defaultValue="negocio" className="space-y-4">
        <TabsList className="grid grid-cols-4 h-auto">
          <TabsTrigger value="negocio" className="text-xs">Negocio</TabsTrigger>
          <TabsTrigger value="crecimiento" className="text-xs">Crecimiento</TabsTrigger>
          <TabsTrigger value="uso" className="text-xs">Uso</TabsTrigger>
          <TabsTrigger value="producto" className="text-xs">Producto</TabsTrigger>
        </TabsList>

        {/* NEGOCIO / SAAS */}
        <TabsContent value="negocio">
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <ReportKPICard label="Tenants activos" value={d.activeTenantCount} icon={Building2} subtitle={`${d.totalTenants} totales`} />
              <ReportKPICard label="Pedidos hoy" value={d.ordersToday} icon={ShoppingBag} />
              <ReportKPICard label="Revenue este mes" value={fmtCLP(d.totalRevenueMonth)} icon={DollarSign} trend={pctChange(d.totalRevenueMonth, d.prevRevenueMonth)} />
              <ReportKPICard label="Pedidos este mes" value={d.totalOrdersMonth} icon={TrendingUp} trend={pctChange(d.totalOrdersMonth, d.prevMonthOrders)} />
            </div>

            <Card>
              <CardHeader><CardTitle className="text-sm">Pedidos últimos 7 días</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={d.chartData}>
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Top tenants por revenue (mes)</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-border">
                      <th className="text-left py-2 text-muted-foreground font-medium">Restaurante</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Pedidos</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Revenue</th>
                    </tr></thead>
                    <tbody className="divide-y divide-border">
                      {d.topTenants.map((t: any) => (
                        <tr key={t.name}>
                          <td className="py-2 font-medium text-foreground">{t.name}</td>
                          <td className="py-2 text-right">{t.count}</td>
                          <td className="py-2 text-right font-semibold">{fmtCLP(t.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {d.inactiveTenants.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm text-amber-600">Tenants sin pedidos este mes ({d.inactiveTenants.length})</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {d.inactiveTenants.slice(0, 15).map((t: any) => (
                      <p key={t.id} className="text-sm text-muted-foreground">{t.name}</p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* CRECIMIENTO */}
        <TabsContent value="crecimiento">
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <ReportKPICard label="En prueba" value={d.onTrial.length} icon={Building2} subtitle="plan_status = trial" />
              <ReportKPICard label="Pagando" value={d.paying.length} icon={DollarSign} subtitle="plan_status = active" />
              <ReportKPICard label="Tasa activación" value={d.activeTenantCount > 0 ? Math.round(((d.activeTenantCount - d.inactiveTenants.length) / d.activeTenantCount) * 100) + "%" : "0%"} icon={TrendingUp} subtitle="Con pedidos / activos" />
              <ReportKPICard label="Sin pedidos nunca" value={d.neverOrdered.length} icon={Building2} />
            </div>

            <Card>
              <CardHeader><CardTitle className="text-sm">Nuevos tenants por mes</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={d.newTenantsChart}>
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* USO DE LA PLATAFORMA */}
        <TabsContent value="uso">
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <ReportKPICard label="Pedidos plataforma (mes)" value={d.totalOrdersMonth} icon={ShoppingBag} />
              <ReportKPICard label="Pedidos hoy" value={d.ordersToday} icon={ShoppingBag} />
              <ReportKPICard label="Tenants activos (con pedidos)" value={d.activeTenantCount - d.inactiveTenants.length} icon={Building2} />
              <ReportKPICard label="Total mesas registradas" value={d.totalTables} icon={QrCode} />
            </div>

            <Card>
              <CardHeader><CardTitle className="text-sm">Ranking tenants más activos (mes)</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {d.topTenants.slice(0, 10).map((t: any, i: number) => {
                    const max = d.topTenants[0]?.count ?? 1;
                    return (
                      <div key={t.name} className="flex items-center gap-3">
                        <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{t.name}</p>
                          <div className="h-2 bg-muted rounded-full mt-1 overflow-hidden">
                            <div className="h-full rounded-full bg-primary/80" style={{ width: `${(t.count / max) * 100}%` }} />
                          </div>
                        </div>
                        <span className="text-sm font-semibold">{t.count} pedidos</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* PRODUCTO */}
        <TabsContent value="producto">
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <ReportKPICard label="KDS (pedidos procesados)" value={d.kdsUsage} icon={ChefHat} subtitle="Delivered + Ready" />
              <ReportKPICard label="Llamadas al mozo" value={d.waiterCallCount} icon={Users} subtitle="Este mes" />
              <ReportKPICard label="Solicitudes de cuenta" value={d.billRequestCount} icon={DollarSign} subtitle="Este mes" />
              <ReportKPICard label="Pedidos manuales (mozo)" value={d.manualOrders} icon={Zap} subtitle={d.totalOrdersMonth > 0 ? `${Math.round((d.manualOrders / d.totalOrdersMonth) * 100)}% del total` : ""} />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Adopción de features</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[
                      { label: "Tenants con mozos", value: d.tenantsWithStaff, total: d.activeTenantCount },
                      { label: "Tenants con QR/mesas", value: d.tenantsWithQR, total: d.activeTenantCount },
                    ].map(f => (
                      <div key={f.label}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-muted-foreground">{f.label}</span>
                          <span className="font-semibold">{f.value} / {f.total}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-primary/80" style={{ width: `${f.total > 0 ? (f.value / f.total) * 100 : 0}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Resumen del sistema</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total staff registrado</span><span className="font-semibold">{d.totalStaff}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Total mesas</span><span className="font-semibold">{d.totalTables}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tenants totales</span><span className="font-semibold">{d.totalTenants}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Pedidos totales (mes)</span><span className="font-semibold">{d.totalOrdersMonth}</span></div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
