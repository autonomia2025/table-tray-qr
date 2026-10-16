import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BellRing, Loader2, Megaphone, Pencil, Send, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/contexts/AdminContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCLP } from "@/lib/format";
import {
  alcanceCampana, borrarCampana, campanasDelLocal, enviarCampana, guardarCampana, NOMBRE_PUBLICO,
  type Alcance, type Campana, type Publico,
} from "@/lib/campanas";

/**
 * Campañas (fase 7.1): el dueño escribe una promoción corta y elige a quién le llega. Sale como aviso al
 * celular a los clientes que aceptaron promociones y tienen la app instalada; después se ve cuántos
 * volvieron y cuánto gastaron en los 7 días siguientes.
 */

interface Borrador { id: string | null; titulo: string; mensaje: string; publico: Publico; plato: string | null }
const VACIO: Borrador = { id: null, titulo: "", mensaje: "", publico: "todos", plato: null };

const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Metrica({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="text-lg font-bold tabular-nums text-foreground">{valor}</p>
      {detalle && <p className="text-[11px] text-muted-foreground">{detalle}</p>}
    </div>
  );
}

export default function CampanasPage() {
  const { tenantId, tenantName } = useAdmin();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [platos, setPlatos] = useState<{ id: string; name: string }[]>([]);
  const [b, setB] = useState<Borrador>({ ...VACIO, publico: (params.get("publico") as Publico) || "todos" });
  const [alcance, setAlcance] = useState<Alcance | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [aEnviar, setAEnviar] = useState<Campana | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    if (!tenantId) return;
    const [lista, { data: items }] = await Promise.all([
      campanasDelLocal(tenantId),
      supabase.from("menu_items").select("id, name").eq("tenant_id", tenantId).order("name"),
    ]);
    setCampanas(lista);
    setPlatos(items ?? []);
    setCargando(false);
  }, [tenantId]);
  useEffect(() => { cargar(); }, [cargar]);

  // A cuántas personas le llegaría, en vivo mientras se elige el público
  useEffect(() => {
    if (!tenantId || (b.publico === "por_plato" && !b.plato)) { setAlcance(null); return; }
    let vigente = true;
    alcanceCampana(tenantId, b.publico, b.plato).then((a) => { if (vigente) setAlcance(a); });
    return () => { vigente = false; };
  }, [tenantId, b.publico, b.plato]);

  const guardar = async (): Promise<string | null> => {
    setGuardando(true);
    const r = await guardarCampana(tenantId, b);
    setGuardando(false);
    if (r.ok === false) { toast({ title: "No se pudo guardar", description: r.error, variant: "destructive" }); return null; }
    return r.dato;
  };

  const guardarBorrador = async () => {
    if (await guardar()) {
      toast({ title: "Borrador guardado" });
      setB(VACIO);
      cargar();
    }
  };

  const prepararEnvio = async () => {
    const id = await guardar();
    if (!id) return;
    await cargar();
    setB(VACIO);
    const lista = await campanasDelLocal(tenantId);
    setAEnviar(lista.find((c) => c.id === id) ?? null);
  };

  const enviar = async () => {
    if (!aEnviar) return;
    setEnviando(true);
    const r = await enviarCampana(aEnviar.id);
    setEnviando(false);
    setAEnviar(null);
    if (r.ok === false) { toast({ title: "No se pudo enviar", description: r.error, variant: "destructive" }); cargar(); return; }
    const n = r.dato.destinatarios;
    toast({ title: "Campaña enviada", description: n === 0 ? "Nadie la recibió esta vez." : `Le llega a ${n} ${n === 1 ? "persona" : "personas"}.` });
    cargar();
  };

  const borrar = async (c: Campana) => {
    const r = await borrarCampana(c.id);
    if (r.ok === false) { toast({ title: "No se pudo borrar", description: r.error, variant: "destructive" }); return; }
    cargar();
  };

  if (cargando) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const listo = b.titulo.trim().length >= 3 && b.mensaje.trim().length >= 10 && (b.publico !== "por_plato" || !!b.plato);
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="mb-1 text-2xl font-bold text-foreground">Campañas</h2>
        <p className="text-sm text-muted-foreground">
          Escríbele a tus clientes que aceptaron recibir promociones. Les llega como aviso al celular a quienes tienen la app instalada,
          y después ves cuántos volvieron y cuánto gastaron.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Megaphone className="h-4 w-4 text-primary" /> {b.id ? "Editar campaña" : "Nueva campaña"}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 md:grid-cols-[1fr_280px]">
            <div className="space-y-4">
              <div>
                <Label htmlFor="campana-titulo">Título</Label>
                <Input id="campana-titulo" maxLength={50} placeholder="Ej: Volvió el pastel de choclo" value={b.titulo} onChange={(e) => setB({ ...b, titulo: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="campana-mensaje">Mensaje</Label>
                <Textarea id="campana-mensaje" rows={3} maxLength={180} placeholder="Ej: Este viernes y sábado, con la receta de la casa. ¡Te esperamos!"
                  value={b.mensaje} onChange={(e) => setB({ ...b, mensaje: e.target.value })} />
                <p className="mt-1 text-right text-xs text-muted-foreground">{b.mensaje.length}/180</p>
              </div>
              <div>
                <Label>¿A quién le llega?</Label>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="A quién le llega">
                  {(Object.keys(NOMBRE_PUBLICO) as Publico[]).map((p) => (
                    <button key={p} type="button" role="radio" aria-checked={b.publico === p}
                      onClick={() => setB({ ...b, publico: p })}
                      className={`rounded-xl border p-3 text-left transition-colors ${b.publico === p ? "border-primary bg-accent" : "hover:bg-muted/50"}`}>
                      <p className="text-sm font-semibold text-foreground">{NOMBRE_PUBLICO[p].titulo}</p>
                      <p className="text-xs text-muted-foreground">{NOMBRE_PUBLICO[p].detalle}</p>
                    </button>
                  ))}
                </div>
                {b.publico === "por_plato" && (
                  <div className="mt-3">
                    <Select value={b.plato ?? ""} onValueChange={(v) => setB({ ...b, plato: v })}>
                      <SelectTrigger aria-label="Plato"><SelectValue placeholder="Elige el plato" /></SelectTrigger>
                      <SelectContent>{platos.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            {/* Así se ve el aviso en el celular */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Así se ve en el celular</p>
              <div className="rounded-2xl border bg-muted/40 p-3">
                <div className="flex gap-2.5 rounded-xl bg-card p-3 shadow-sm">
                  <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{tenantName}: {b.titulo || "Tu título"}</p>
                    <p className="text-xs text-muted-foreground">{b.mensaje || "Tu mensaje"}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border p-3 text-sm" data-testid="alcance-campana">
                {alcance === null ? (
                  <p className="text-muted-foreground">{b.publico === "por_plato" && !b.plato ? "Elige el plato para ver a cuántos les llega." : "Calculando…"}</p>
                ) : (
                  <>
                    <p className="font-semibold text-foreground">
                      {alcance.total === 1 ? "1 cliente" : `${alcance.total} clientes`} en este público
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      <li>{alcance.con_aviso} con la app instalada: les llega el aviso</li>
                      {alcance.descansando > 0 && <li>{alcance.descansando} descansan (recibieron una campaña hace menos de 7 días)</li>}
                      {alcance.total - alcance.descansando - alcance.con_aviso > 0 && (
                        <li>{alcance.total - alcance.descansando - alcance.con_aviso} sin la app: les llegará por correo cuando activemos los correos</li>
                      )}
                    </ul>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={prepararEnvio} disabled={!listo || guardando}><Send className="mr-1 h-4 w-4" /> Enviar campaña</Button>
            <Button variant="outline" onClick={guardarBorrador} disabled={!listo || guardando}>Guardar borrador</Button>
            {b.id && <Button variant="ghost" onClick={() => setB(VACIO)}>Cancelar</Button>}
          </div>
          <p className="text-xs text-muted-foreground">
            Para que tus clientes no se cansen: hasta 4 campañas cada 30 días, cada persona recibe como máximo una por semana y los avisos
            salen entre las 10:00 y las 22:00. Nada que premie tomar más alcohol, y sin enlaces en el mensaje.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="text-lg font-bold text-foreground">Tus campañas</h3>
        {campanas.length === 0 && <p className="text-sm text-muted-foreground">Todavía no mandas campañas.</p>}
        {campanas.map((c) => (
          <Card key={c.id} data-testid="campana">
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground">{c.titulo}</p>
                    <Badge variant={c.estado === "enviada" ? "default" : "secondary"}>{c.estado === "enviada" ? "Enviada" : "Borrador"}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{c.mensaje}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {NOMBRE_PUBLICO[c.publico].titulo}{c.plato_nombre ? `: ${c.plato_nombre}` : ""} · {c.enviada_at ? `enviada el ${fecha(c.enviada_at)}` : `creada el ${fecha(c.creada_at)}`}
                  </p>
                </div>
                {c.estado === "borrador" && (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => setAEnviar(c)}><Send className="mr-1 h-3.5 w-3.5" /> Enviar</Button>
                    <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setB({ id: c.id, titulo: c.titulo, mensaje: c.mensaje, publico: c.publico, plato: c.plato })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Borrar" onClick={() => borrar(c)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                )}
              </div>
              {c.estado === "enviada" && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metrica titulo="Le llegó a" valor={String(c.entregados)} detalle={`de ${c.destinatarios} ${c.destinatarios === 1 ? "cliente" : "clientes"}`} />
                  <Metrica titulo="La abrieron" valor={String(c.abiertos)} />
                  <Metrica titulo="Volvieron" valor={String(c.volvieron)} detalle={c.medicion_abierta ? "midiendo, 7 días" : "en 7 días"} />
                  <Metrica titulo="Gastaron" valor={formatCLP(c.ventas)} detalle="sin propinas" />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!aEnviar} onOpenChange={(v) => !v && setAEnviar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Enviar la campaña?</DialogTitle>
            <DialogDescription>
              «{aEnviar?.titulo}» va a {aEnviar ? NOMBRE_PUBLICO[aEnviar.publico].titulo.toLowerCase() : ""}. Una vez enviada no se puede cambiar ni deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAEnviar(null)}>Volver</Button>
            <Button onClick={enviar} disabled={enviando}>{enviando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />} Enviar ahora</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
