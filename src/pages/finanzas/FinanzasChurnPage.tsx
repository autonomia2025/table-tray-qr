import { Card, CardContent } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Loader2 } from 'lucide-react';
import { abandono, mesCorto, useMetricasFinanzas } from '@/lib/finanzas';

/** Abandono y cohortes (fase 8.2): quiénes se van y cuántos siguen pagando, desde los cobros reales. */
export default function FinanzasChurnPage() {
  const m = useMetricasFinanzas(12);
  if (m === undefined) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!m) return <p className="p-6 text-sm text-muted-foreground">No pudimos cargar el abandono. Intenta de nuevo.</p>;
  const meses = m.meses.map((x) => ({ ...x, etiqueta: mesCorto(x.mes), abandono: abandono(x) }));
  const actual = meses[meses.length - 1];
  const perdidos12 = meses.reduce((t, x) => t + x.perdidos, 0);
  const nuevos12 = meses.reduce((t, x) => t + x.nuevos, 0);
  const largo = Math.max(0, ...m.cohortes.map((c) => c.siguen.length));

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Abandono</h1>
        <p className="text-sm text-muted-foreground">Locales que cancelan y cuántos siguen pagando mes a mes.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Abandono este mes</p><p className="text-2xl font-bold text-foreground tabular-nums" data-testid="abandono-mes">{actual?.abandono ?? 0}%</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cancelados (12 meses)</p><p className="text-2xl font-bold text-foreground tabular-nums">{perdidos12}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Nuevos (12 meses)</p><p className="text-2xl font-bold text-primary tabular-nums">{nuevos12}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cancelados en total</p><p className="text-2xl font-bold text-foreground tabular-nums">{m.actual.cancelados}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold text-foreground mb-4">Nuevos y cancelados por mes</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={meses}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, n: string) => [v, n === 'nuevos' ? 'Nuevos' : 'Cancelados']} />
                <Bar dataKey="nuevos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="perdidos" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto p-4">
          <h2 className="text-sm font-semibold text-foreground mb-1">Cohortes</h2>
          <p className="mb-3 text-xs text-muted-foreground">De los locales que pagaron por primera vez cada mes, cuántos siguen pagando en los meses siguientes.</p>
          {m.cohortes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay cobros pagados para armar cohortes.</p>
          ) : (
            <table className="text-sm" data-testid="cohortes">
              <thead><tr className="text-left">
                <th className="py-1 pr-4 font-semibold text-foreground">Primer pago</th>
                <th className="py-1 pr-4 font-semibold text-foreground">Locales</th>
                {Array.from({ length: largo }, (_, k) => <th key={k} className="px-2 py-1 text-center font-semibold text-muted-foreground">Mes {k}</th>)}
              </tr></thead>
              <tbody>
                {m.cohortes.map((c) => (
                  <tr key={c.mes}>
                    <td className="py-1 pr-4 text-foreground">{mesCorto(c.mes)}</td>
                    <td className="py-1 pr-4 tabular-nums text-foreground">{c.tamano}</td>
                    {c.siguen.map((s, k) => (
                      <td key={k} className="px-2 py-1 text-center tabular-nums" style={{ backgroundColor: `hsl(var(--primary) / ${c.tamano ? (s / c.tamano) * 0.35 : 0})` }}>
                        {c.tamano ? Math.round((s / c.tamano) * 100) : 0}%
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
