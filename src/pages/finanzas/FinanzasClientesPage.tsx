import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCLP } from '@/lib/format';
import { exportToCSV } from '@/lib/export-utils';
import { useMetricasFinanzas } from '@/lib/finanzas';
import { TEXTO_ESTADO, estadoMalo, type EstadoMensualidad } from '@/lib/mensualidad';

const fecha = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });

/** Clientes de Tablio (fase 8.2): cada local con suscripción, lo que ha pagado y su estado (desde la base). */
export default function FinanzasClientesPage() {
  const m = useMetricasFinanzas(12);
  if (m === undefined) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!m) return <p className="p-6 text-sm text-muted-foreground">No pudimos cargar los clientes. Intenta de nuevo.</p>;
  const ticket = m.actual.clientes_activos > 0 ? Math.round(m.actual.mrr / m.actual.clientes_activos) : 0;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Clientes</h1>
          <p className="text-sm text-muted-foreground">Los locales con suscripción, desde sus cobros reales.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportToCSV(m.locales.map((l) => ({
          Local: l.local, Plan: l.plan ?? '', Mensualidad: l.precio_mensual, Desde: l.desde, Estado: TEXTO_ESTADO[l.estado as EstadoMensualidad] ?? l.estado,
          'Meses pagados': l.meses_pagados, 'Pagado en total': l.pagado_total,
        })), 'clientes-tablio')}><Download className="w-4 h-4 mr-1" />Exportar</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pagando</p><p className="text-2xl font-bold text-foreground tabular-nums" data-testid="clientes-activos">{m.actual.clientes_activos}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">En prueba</p><p className="text-2xl font-bold text-foreground tabular-nums">{m.actual.en_prueba}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Mensualidad promedio</p><p className="text-2xl font-bold text-foreground tabular-nums">{formatCLP(ticket)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Atrasados</p><p className={`text-2xl font-bold tabular-nums ${m.actual.locales_atrasados ? 'text-destructive' : 'text-foreground'}`}>{m.actual.locales_atrasados}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="tabla-clientes">
            <thead><tr className="border-b border-border text-left">
              <th className="px-4 py-2 font-semibold text-foreground">Local</th>
              <th className="px-3 py-2 font-semibold text-foreground">Plan</th>
              <th className="px-3 py-2 text-right font-semibold text-foreground">Mensualidad</th>
              <th className="px-3 py-2 font-semibold text-foreground">Desde</th>
              <th className="px-3 py-2 text-right font-semibold text-foreground">Pagado</th>
              <th className="px-3 py-2 font-semibold text-foreground">Estado</th>
            </tr></thead>
            <tbody>
              {m.locales.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Todavía no hay locales con suscripción. Se crean en Mensualidades.</td></tr>}
              {m.locales.map((l) => (
                <tr key={l.tenant_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">{l.local}</td>
                  <td className="px-3 py-3 text-muted-foreground">{l.plan ?? '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-foreground">{formatCLP(l.precio_mensual)}</td>
                  <td className="px-3 py-3 text-muted-foreground">{fecha(l.desde)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-foreground">{formatCLP(l.pagado_total)} <span className="text-xs text-muted-foreground">({l.meses_pagados} {l.meses_pagados === 1 ? 'mes' : 'meses'})</span></td>
                  <td className="px-3 py-3"><Badge variant={estadoMalo(l.estado as EstadoMensualidad) ? 'destructive' : 'secondary'}>{TEXTO_ESTADO[l.estado as EstadoMensualidad] ?? l.estado}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
