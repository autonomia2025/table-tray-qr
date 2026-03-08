import { useEffect, useState, useMemo } from "react";
import { useAdmin } from "@/contexts/AdminContext";
import { supabase } from "@/integrations/supabase/client";
import { formatCLP } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, DollarSign, ShoppingBag, Receipt, TrendingUp, ChevronLeft, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const PIE_COLORS = ["hsl(var(--primary))", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4"];

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export default function ReportesPage() {
  const { branchId } = useAdmin();
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(() => startOfDay(new Date()));

  // Raw data
  const [orders, setOrders] = useState<{ total_amount: number; confirmed_at: string; status: string }[]>([]);
  const [orderItems, setOrderItems] = useState<{ menu_item_name: string; quantity: number }[]>([]);
  const [yesterdayTotal, setYesterdayTotal] = useState(0);

  const fetchData = async () => {
    setLoading(true);
    const from = startOfDay(date).toISOString();
    const to = endOfDay(date).toISOString();

    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);

    const [ordersRes, yesterdayRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, total_amount, confirmed_at, status")
        .eq("branch_id", branchId)
        .gte("confirmed_at", from)
        .lte("confirmed_at", to)
        .neq("status", "cancelled"),
      supabase
        .from("orders")
        .select("total_amount")
        .eq("branch_id", branchId)
        .gte("confirmed_at", startOfDay(yesterday).toISOString())
        .lte("confirmed_at", endOfDay(yesterday).toISOString())
        .neq("status", "cancelled"),
    ]);

    const ordersData = ordersRes.data ?? [];
    setOrders(ordersData.map(o => ({ total_amount: o.total_amount, confirmed_at: o.confirmed_at ?? "", status: o.status ?? "" })));
    setYesterdayTotal((yesterdayRes.data ?? []).reduce((s, o) => s + o.total_amount, 0));

    if (ordersData.length > 0) {
      const { data: items } = await supabase
        .from("order_items")
        .select("menu_item_name, quantity")
        .in("order_id", ordersData.map(o => o.id));
      setOrderItems(items ?? []);
    } else {
      setOrderItems([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (!branchId) return;
    fetchData();
  }, [branchId, date]);

  const totalSales = useMemo(() => orders.reduce((s, o) => s + o.total_amount, 0), [orders]);
  const totalOrders = orders.length;
  const avgTicket = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;
  const vsYesterday = yesterdayTotal > 0 ? Math.round(((totalSales - yesterdayTotal) / yesterdayTotal) * 100) : 0;

  // Hourly chart
  const hourlyData = useMemo(() => {
    const hours: Record<number, number> = {};
    for (let h = 8; h <= 23; h++) hours[h] = 0;
    orders.forEach(o => {
      const h = new Date(o.confirmed_at).getHours();
      hours[h] = (hours[h] ?? 0) + o.total_amount;
    });
    return Object.entries(hours).map(([h, v]) => ({ hora: `${h}:00`, ventas: v }));
  }, [orders]);

  // Top 5 items
  const topItems = useMemo(() => {
    const map: Record<string, number> = {};
    orderItems.forEach(i => { map[i.menu_item_name] = (map[i.menu_item_name] ?? 0) + i.quantity; });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, qty]) => ({ name, qty }));
  }, [orderItems]);

  const changeDay = (delta: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    if (d <= new Date()) setDate(startOfDay(d));
  };

  const isToday = startOfDay(new Date()).getTime() === date.getTime();
  const dateLabel = date.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div>
      {/* Date nav */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-foreground">Reportes</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => changeDay(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium capitalize min-w-[160px] text-center">{dateLabel}</span>
          <Button variant="ghost" size="icon" disabled={isToday} onClick={() => changeDay(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Ventas del día</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><p className="text-xl font-bold">{formatCLP(totalSales)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Pedidos</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><p className="text-xl font-bold">{totalOrders}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Ticket promedio</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><p className="text-xl font-bold">{formatCLP(avgTicket)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">vs Ayer</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className={`text-xl font-bold ${vsYesterday >= 0 ? "text-green-600" : "text-red-600"}`}>
              {vsYesterday >= 0 ? "+" : ""}{vsYesterday}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Hourly sales */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Ventas por hora</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hourlyData}>
                <XAxis dataKey="hora" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCLP(v)} labelFormatter={(l) => `${l}`} />
                <Bar dataKey="ventas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top 5 items */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Top 5 platos</CardTitle></CardHeader>
          <CardContent>
            {topItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sin datos</p>
            ) : (
              <div className="space-y-3">
                {topItems.map((item, i) => {
                  const maxQty = topItems[0]?.qty ?? 1;
                  return (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className="text-sm font-bold text-muted-foreground w-5">{i + 1}</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <div className="h-2 bg-muted rounded-full mt-1 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${(item.qty / maxQty) * 100}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                        </div>
                      </div>
                      <span className="text-sm font-semibold">{item.qty}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
