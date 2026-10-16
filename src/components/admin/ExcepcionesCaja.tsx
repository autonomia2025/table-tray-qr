import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/format";
import {
  reintentarReembolso, resolverExcepcion, revisarPagosAhora, TITULO_EXCEPCION, type Excepcion,
} from "@/lib/excepciones";

/**
 * Excepciones de la caja (fase 4.6; brief 5.4): pago sin pedido, monto que no calza, boleta sin marcar,
 * reembolso rechazado y pago sin confirmar. Cada una con su forma de resolverla; lo que se resuelve a mano
 * pide explicar qué pasó y queda en la auditoría.
 */

type Accion = "a_mano" | "descartar" | "revisada" | "no_entregada";

const PEDIR_NOTA: Record<Accion, { titulo: string; ayuda: string; boton: string }> = {
  a_mano: {
    titulo: "Lo devolví de otra forma",
    ayuda: "Cuenta cómo se le devolvió al cliente (por ejemplo, en efectivo o por transferencia) y quién lo hizo.",
    boton: "Guardar",
  },
  descartar: {
    titulo: "Descartar el reembolso",
    ayuda: "Explica por qué ya no se hace (por ejemplo, el cliente prefirió otro producto).",
    boton: "Descartar",
  },
  revisada: {
    titulo: "Marcar como revisada",
    ayuda: "Explica qué encontraste en el portal de Transbank y por qué no calzaba.",
    boton: "Marcar revisada",
  },
  no_entregada: {
    titulo: "La boleta no se pudo entregar",
    ayuda: "Explica qué pasó (por ejemplo, el cliente se fue antes) y si se emitió igual en el sistema del local.",
    boton: "Guardar",
  },
};

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago", weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function ExcepcionesCaja({ branchId, lista, recargar }: { branchId: string; lista: Excepcion[] | null; recargar: () => void }) {
  const { toast } = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [folios, setFolios] = useState<Record<string, string>>({});
  const [nota, setNota] = useState<{ excepcion: Excepcion; accion: Accion; texto: string } | null>(null);

  const correr = async (clave: string, accion: () => Promise<{ ok: boolean; error?: string }>, exito: string) => {
    setOcupado(clave);
    const r = await accion();
    setOcupado(null);
    if (!r.ok) {
      toast({ title: "No se pudo", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: exito });
    recargar();
  };

  const revisar = (e: Excepcion) => correr(`${e.id}-revisar`, async () => {
    const r = await revisarPagosAhora(branchId);
    return r.ok === false ? r : { ok: true };
  }, "Revisado con la pasarela");

  const guardarNota = async () => {
    if (!nota) return;
    const { excepcion, accion, texto } = nota;
    await correr(`${excepcion.id}-${accion}`, () => resolverExcepcion(excepcion.tipo, excepcion.id, accion, texto), "Listo, quedó anotado");
    setNota(null);
  };

  if (lista === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3" data-testid="excepciones-caja">
      <p className="text-sm text-muted-foreground">
        Lo que la app no pudo resolver sola y necesita a alguien de la caja. Lo que resuelvas a mano pide una explicación y queda registrado.
      </p>
      {lista.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border bg-card p-4 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> Todo en orden: no hay excepciones.
        </div>
      ) : (
        lista.map((e) => (
          <div key={`${e.tipo}-${e.id}`} className="rounded-2xl border bg-card p-4" data-testid={`excepcion-${e.tipo}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-semibold text-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" /> {TITULO_EXCEPCION[e.tipo]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {e.mesa !== null ? `Mesa ${e.mesa} · ` : ""}{fechaCorta(e.fecha)}
                  {e.referencia ? ` · ${e.referencia}` : ""}
                  {e.cobrado_por ? ` · cobró ${e.cobrado_por}` : ""}
                  {e.autorizado_por ? ` · pidió ${e.autorizado_por}` : ""}
                </p>
              </div>
              <p className="text-lg font-bold tabular-nums text-foreground">{formatCLP(e.monto)}</p>
            </div>
            <p className="mt-2 text-sm text-foreground">{e.detalle}</p>
            {e.tipo === "devolucion_fallida" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Al cliente se le cobró y no tiene pedido. La app intentó devolverlo{e.intentos ? ` ${e.intentos} ${e.intentos === 1 ? "vez" : "veces"}` : ""} y la pasarela no respondió.
              </p>
            )}
            {e.tipo === "pago_sin_confirmar" && (
              <p className="mt-1 text-xs text-muted-foreground">La app lo revisa sola cada 5 minutos. Si el cliente pagó, se confirma; si no, se cierra sin cobro.</p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(e.tipo === "devolucion_fallida" || e.tipo === "pago_sin_confirmar") && (
                <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => revisar(e)}>
                  {ocupado === `${e.id}-revisar` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                  Revisar con la pasarela
                </Button>
              )}
              {e.tipo === "devolucion_fallida" && (
                <Button size="sm" variant="ghost" disabled={!!ocupado} onClick={() => setNota({ excepcion: e, accion: "a_mano", texto: "" })}>
                  Lo devolví de otra forma
                </Button>
              )}
              {e.tipo === "reembolso_fallido" && e.pago_id && (
                <>
                  <Button size="sm" variant="outline" disabled={!!ocupado}
                    onClick={() => correr(`${e.id}-reintentar`, () => reintentarReembolso(e.pago_id!, e.monto, e.detalle), "Reembolso hecho")}>
                    {ocupado === `${e.id}-reintentar` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                    Reintentar reembolso
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!!ocupado} onClick={() => setNota({ excepcion: e, accion: "descartar", texto: "" })}>
                    Descartar
                  </Button>
                </>
              )}
              {e.tipo === "parte_por_devolver" && e.pago_id && (
                <Button size="sm" variant="outline" disabled={!!ocupado}
                  onClick={() => correr(`${e.id}-devolver`, () => reintentarReembolso(e.pago_id!, e.monto, "Plato dividido anulado: se devuelve la parte pagada"), "Parte devuelta")}>
                  {ocupado === `${e.id}-devolver` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                  Devolver
                </Button>
              )}
              {e.tipo === "diferencia_pasarela" && (
                <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => setNota({ excepcion: e, accion: "revisada", texto: "" })}>
                  Marcar revisada
                </Button>
              )}
              {e.tipo === "boleta_atrasada" && (
                <>
                  <Input aria-label={`Número de boleta de la mesa ${e.mesa ?? ""}`} placeholder="N° (opcional)" maxLength={40} className="h-9 w-32"
                    value={folios[e.id] ?? ""} onChange={(ev) => setFolios({ ...folios, [e.id]: ev.target.value })} />
                  <Button size="sm" variant="outline" disabled={!!ocupado}
                    onClick={() => correr(`${e.id}-entregada`, () => resolverExcepcion(e.tipo, e.id, "entregada", undefined, folios[e.id]), "Boleta marcada como entregada")}>
                    Entregada
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!!ocupado} onClick={() => setNota({ excepcion: e, accion: "no_entregada", texto: "" })}>
                    No se pudo entregar
                  </Button>
                </>
              )}
            </div>
          </div>
        ))
      )}

      <Dialog open={!!nota} onOpenChange={(o) => { if (!o) setNota(null); }}>
        <DialogContent>
          {nota && (
            <>
              <DialogHeader>
                <DialogTitle>{PEDIR_NOTA[nota.accion].titulo}</DialogTitle>
                <DialogDescription>{PEDIR_NOTA[nota.accion].ayuda}</DialogDescription>
              </DialogHeader>
              <Textarea aria-label="Qué pasó" value={nota.texto} maxLength={500} rows={3}
                onChange={(ev) => setNota({ ...nota, texto: ev.target.value })} placeholder="Escribe qué pasó" />
              <DialogFooter>
                <Button variant="outline" onClick={() => setNota(null)}>Cancelar</Button>
                <Button onClick={guardarNota} disabled={nota.texto.trim().length < 5 || !!ocupado}>
                  {ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} {PEDIR_NOTA[nota.accion].boton}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
