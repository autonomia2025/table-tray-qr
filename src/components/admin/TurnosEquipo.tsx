import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Timer } from "lucide-react";
import { formatCLP } from "@/lib/format";
import { cerrarTurno, duracion, turnosSucursal, type ResumenTurno } from "@/lib/turnos";

// Turnos del equipo (fase 3.1): quién trabajó, cuánto, y sus propinas (la propina es del mozo que
// tomó la mesa). El encargado puede cerrar un turno olvidado, con motivo.

const hoyChile = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const haceDias = (dias: number) =>
  new Date(Date.now() - dias * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const hora = (iso: string) =>
  new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago", weekday: "short", hour: "2-digit", minute: "2-digit" });

export default function TurnosEquipo({ branchId }: { branchId: string }) {
  const { toast } = useToast();
  const [desde, setDesde] = useState(haceDias(6));
  const [hasta, setHasta] = useState(hoyChile());
  const [turnos, setTurnos] = useState<ResumenTurno[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aCerrar, setACerrar] = useState<ResumenTurno | null>(null);
  const [nota, setNota] = useState("");
  const [cerrando, setCerrando] = useState(false);

  const cargar = useCallback(async () => {
    if (!branchId) return;
    setCargando(true);
    const r = await turnosSucursal(branchId, desde, hasta);
    setCargando(false);
    if (r.ok === false) { toast({ title: "No se pudieron cargar los turnos", description: r.error, variant: "destructive" }); return; }
    setTurnos(r.dato);
  }, [branchId, desde, hasta, toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const confirmarCierre = async () => {
    if (!aCerrar) return;
    setCerrando(true);
    const r = await cerrarTurno(aCerrar.turno_id, nota);
    setCerrando(false);
    if (r.ok === false) { toast({ title: "No se pudo cerrar el turno", description: r.error, variant: "destructive" }); return; }
    toast({ title: "Turno cerrado" });
    setACerrar(null);
    setNota("");
    cargar();
  };

  const total = turnos.reduce((s, t) => s + t.propinas, 0);

  return (
    <section className="mt-10" aria-labelledby="turnos-titulo">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-muted-foreground" />
            <h2 id="turnos-titulo" className="text-lg font-bold text-foreground">Turnos</h2>
          </div>
          <p className="text-sm text-muted-foreground">La propina es del mozo que tomó la mesa, aunque cobre la caja.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="turnos-desde" className="text-xs">Desde</Label>
            <Input id="turnos-desde" type="date" value={desde} onChange={(e) => e.target.value && setDesde(e.target.value)} className="h-9 w-40" />
          </div>
          <div>
            <Label htmlFor="turnos-hasta" className="text-xs">Hasta</Label>
            <Input id="turnos-hasta" type="date" value={hasta} onChange={(e) => e.target.value && setHasta(e.target.value)} className="h-9 w-40" />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mozo</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Inicio</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fin</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Duración</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Mesas</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Ventas</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Propinas</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {cargando ? (
              <tr><td colSpan={8} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
            ) : turnos.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Sin turnos en estos días</td></tr>
            ) : turnos.map((t) => (
              <tr key={t.turno_id} className="hover:bg-muted/30">
                <td className="px-4 py-3 font-medium text-foreground">{t.nombre}</td>
                <td className="px-4 py-3 text-muted-foreground">{hora(t.inicio)}{t.abierto_por === "automatico" && <span className="ml-1 text-[10px]">(al tomar mesa)</span>}</td>
                <td className="px-4 py-3">
                  {t.fin ? (
                    <span className="text-muted-foreground">{hora(t.fin)}{t.cerrado_por === "encargado" && <span className="ml-1 text-[10px]">(encargado)</span>}</span>
                  ) : (
                    <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-white" />En turno</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{duracion(t.minutos)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{t.mesas}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCLP(t.ventas)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatCLP(t.propinas)}</td>
                <td className="px-4 py-3 text-right">
                  {!t.fin && (
                    <Button variant="ghost" size="sm" onClick={() => { setACerrar(t); setNota(""); }}>Cerrar</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {turnos.length > 0 && (
            <tfoot className="bg-muted/50">
              <tr>
                <td colSpan={6} className="px-4 py-3 font-bold text-foreground">Total de propinas</td>
                <td className="px-4 py-3 text-right font-extrabold tabular-nums text-foreground">{formatCLP(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Dialog open={!!aCerrar} onOpenChange={(o) => !o && setACerrar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar el turno de {aCerrar?.nombre}</DialogTitle>
            <DialogDescription>Úsalo si se le olvidó cerrarlo. Queda registrado quién lo cerró y por qué.</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="turno-nota">Motivo</Label>
            <Textarea id="turno-nota" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} rows={2} placeholder="Ej: se fue a las 2 y olvidó cerrar el turno" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setACerrar(null)}>Volver</Button>
            <Button onClick={confirmarCierre} disabled={cerrando || nota.trim().length < 5}>
              {cerrando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Cerrar turno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
