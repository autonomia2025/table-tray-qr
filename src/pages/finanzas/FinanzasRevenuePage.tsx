import { Card, CardContent } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { DollarSign, TrendingUp, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react';
import { formatCLP } from '@/lib/format';
import { mesCorto, useMetricasFinanzas } from '@/lib/finanzas';

/** Ingresos de Tablio (fase 8.2): desde los cobros reales de la mensualidad, calculados en la base. */
export default function FinanzasRevenuePage() {
  const m = useMetricasFinanzas(12);
  if (m === undefined) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!m) return <p className="p-6 text-sm text-muted-foreground">No pudimos cargar los ingresos. Intenta de nuevo.</p>;

  const meses = m.meses.map((x) => ({ ...x, etiqueta: mesCorto(x.mes) }));
  const actual = meses[meses.length - 1];
  const anterior = meses[meses.length - 2];
  const delta = anterior && anterior.facturado > 0 ? ((actual.facturado - anterior.facturado) / anterior.facturado) * 100 : null;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ingresos</h1>
        <p className="text-sm text-muted-foreground">Desde los cobros reales de la mensualidad de cada local.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground font-medium">Ingreso mensual</p><DollarSign className="w-4 h-4 text-primary" /></div>
            <p className="text-2xl font-bold text-foreground mt-1 tabular-nums" data-testid="mrr">{formatCLP(m.actual.mrr)}</p>
            <p className="text-xs text-muted-foreground mt-1">Mensualidades vigentes (sin pruebas)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground font-medium">Proyección anual</p><TrendingUp className="w-4 h-4 text-primary" /></div>
            <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">{formatCLP(m.actual.mrr * 12)}</p>
            <p className="text-xs text-muted-foreground mt-1">Ingreso mensual × 12</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Facturado este mes</p>
            <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">{formatCLP(actual?.facturado ?? 0)}</p>
            {delta !== null && (
              <div className={`flex items-center gap-1 mt-1 text-xs ${delta >= 0 ? 'text-primary' : 'text-destructive'}`}>
                {delta >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {Math.abs(delta).toFixed(1)}% vs el mes anterior
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Por cobrar</p>
            <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">{formatCLP(m.actual.por_cobrar)}</p>
            <p className={`text-xs mt-1 ${m.actual.vencido ? 'text-destructive' : 'text-muted-foreground'}`}>{m.actual.vencido ? `${formatCLP(m.actual.vencido)} vencido` : 'Nada vencido'}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold text-foreground mb-4">Facturado y cobrado por mes (12 meses)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={meses}>
                <defs>
                  <linearGradient id="gradCobrado" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v) => formatCLP(v)} width={80} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, n: string) => [formatCLP(v), n === 'cobrado' ? 'Cobrado' : 'Facturado']} />
                <Legend formatter={(n) => (n === 'cobrado' ? 'Cobrado' : 'Facturado')} />
                <Area type="linear" dataKey="facturado" stroke="hsl(var(--muted-foreground))" fill="transparent" strokeDasharray="4 4" strokeWidth={2} isAnimationActive={false} />
                <Area type="linear" dataKey="cobrado" stroke="hsl(var(--primary))" fill="url(#gradCobrado)" strokeWidth={2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
