import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { mensajeError } from "@/lib/errores";

interface Reporte { id: string; motivo: string; created_at: string; estado: string; reportado: string | null; reportes_total: number; suspendido: boolean }

/** Moderación de la comunidad (fase 9.2): los reportes de las personas. Revisar o suspender, siempre con nota. */
export default function SAComunidadPage() {
  const { toast } = useToast();
  const [reportes, setReportes] = useState<Reporte[] | null>(null);
  const [notas, setNotas] = useState<Record<string, string>>({});

  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc("reportes_comunidad_abiertos");
    setReportes((data ?? []) as unknown as Reporte[]);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const moderar = async (id: string, suspender: boolean) => {
    const { error } = await supabase.rpc("moderar_reporte", { _reporte_id: id, _suspender: suspender, _nota: notas[id] ?? "" });
    if (error) return toast({ title: "No se pudo", description: mensajeError(error), variant: "destructive" });
    toast({ title: suspender ? "Perfil suspendido" : "Reporte revisado" });
    cargar();
  };

  if (!reportes) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground"><ShieldAlert className="h-5 w-5 text-primary" /> Comunidad</h1>
        <p className="text-sm text-muted-foreground">Reportes de las personas (últimos 30 días y los abiertos). Suspender corta todas sus amistades.</p>
      </div>
      {reportes.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="sin-reportes">No hay reportes.</p>
      ) : reportes.map((r) => (
        <Card key={r.id} data-testid="reporte-comunidad">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">{r.reportado ?? "Perfil borrado"}</span>
              <Badge variant={r.estado === "abierto" ? "destructive" : "secondary"}>{r.estado === "abierto" ? "Abierto" : r.estado === "suspendido" ? "Suspendido" : "Revisado"}</Badge>
              <span className="text-xs text-muted-foreground">{r.reportes_total} {r.reportes_total === 1 ? "reporte" : "reportes"} en total · {new Date(r.created_at).toLocaleString("es-CL")}</span>
            </div>
            <p className="text-sm text-foreground">“{r.motivo}”</p>
            {r.estado === "abierto" && (
              <div className="flex flex-wrap gap-2">
                <Input className="max-w-sm" placeholder="Nota (obligatoria)" value={notas[r.id] ?? ""} onChange={(e) => setNotas((n) => ({ ...n, [r.id]: e.target.value }))} aria-label="Nota de moderación" />
                <Button variant="outline" onClick={() => moderar(r.id, false)}>Marcar revisado</Button>
                <Button variant="destructive" onClick={() => moderar(r.id, true)} disabled={r.suspendido}>Suspender perfil</Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
