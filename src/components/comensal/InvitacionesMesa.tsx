import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Loader2, Wine } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { formatCLP } from "@/lib/format";
import type { MesaEnVivo } from "@/lib/mesaEnVivo";
import { cancelarInvitacion, invitarOtraMesa, mesasParaInvitar, responderInvitacion } from "@/lib/invitar";

interface Props {
  token: string;
  slug: string;
  tenantId?: string;
  enVivo: MesaEnVivo;
  color: string;
  recargar: () => void;
}

/**
 * Invitar un trago a otra mesa (fase 9.1): las invitaciones que llegaron a mi mesa (aceptar o no), las que yo
 * mandé (cancelar o pagar cuando la aceptan) y el botón para invitar. Solo se ven números de mesa.
 */
export default function InvitacionesMesa({ token, slug, tenantId, enVivo, color, recargar }: Props) {
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");
  const recibidas = (enVivo.invitaciones?.recibidas ?? []).filter((i) => i.estado !== "vencida");
  const enviadas = enVivo.invitaciones?.enviadas ?? [];
  const qs = `?t=${token}`;

  const responder = async (id: string, aceptar: boolean, bloquear = false) => {
    setError("");
    const r = await responderInvitacion(token, id, aceptar, bloquear);
    if (r.ok === false) setError(r.error);
    recargar();
  };
  const cancelar = async (id: string) => {
    const r = await cancelarInvitacion(token, id);
    if (r.ok === false) setError(r.error);
    recargar();
  };

  if (!enVivo.invitar_activo && recibidas.length === 0 && enviadas.length === 0) return null;

  return (
    <div className="mb-6 space-y-3" data-testid="invitaciones-mesa">
      {recibidas.map((i) => (
        <motion.div key={i.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border-2 p-4" style={{ borderColor: color }} data-testid="invitacion-recibida">
          <p className="text-sm font-bold text-card-foreground">🥂 La mesa {i.de_mesa}{i.de_alias ? ` (${i.de_alias})` : ""} te invita: {i.producto}</p>
          {i.mensaje && <p className="mt-1 text-sm italic text-muted-foreground">“{i.mensaje}”</p>}
          {i.estado === "ofrecida" ? (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <button onClick={() => responder(i.id, true)} className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: color }}>Aceptar</button>
                <button onClick={() => responder(i.id, false)} className="flex-1 rounded-xl border py-2.5 text-sm font-semibold text-card-foreground">No, gracias</button>
              </div>
              <button onClick={() => responder(i.id, false, true)} className="w-full text-center text-xs text-muted-foreground underline">No recibir más invitaciones de esa mesa</button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {i.estado === "aceptada" ? `Aceptaste. Cuando la mesa ${i.de_mesa} lo pague, va a la cocina.` : i.estado === "pagada" ? "¡Pagado! Va en camino a tu mesa." : "No la aceptaste."}
            </p>
          )}
        </motion.div>
      ))}

      {enviadas.map((i) => (
        <div key={i.id} className="rounded-2xl border bg-card p-4" data-testid="invitacion-enviada">
          <p className="text-sm font-semibold text-card-foreground">Invitaste a la mesa {i.para_mesa}: {i.producto}</p>
          {i.estado === "ofrecida" && (
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Esperando su respuesta…</span>
              <button onClick={() => cancelar(i.id)} className="underline">Cancelar</button>
            </div>
          )}
          {i.estado === "aceptada" && (
            <div className="mt-2 space-y-1">
              <p className="text-xs font-semibold" style={{ color }}>¡La aceptaron! Págala para que la preparen.</p>
              <div className="flex gap-2">
                <button onClick={() => navigate(`/${slug}/invitacion/${i.id}${qs}`)} className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: color }}>Pagar la invitación</button>
                <button onClick={() => cancelar(i.id)} className="rounded-xl border px-3 py-2.5 text-xs font-semibold text-card-foreground">Cancelar</button>
              </div>
            </div>
          )}
          {i.estado === "pagada" && <p className="mt-1 text-xs text-muted-foreground">Pagada: va en camino a la mesa {i.para_mesa}.</p>}
          {i.estado === "rechazada" && <p className="mt-1 text-xs text-muted-foreground">Esta vez no la aceptaron. No se te cobró nada.</p>}
          {i.estado === "cancelada" && <p className="mt-1 text-xs text-muted-foreground">La cancelaste. No se te cobró nada.</p>}
          {i.estado === "vencida" && <p className="mt-1 text-xs text-muted-foreground">Venció sin respuesta. No se te cobró nada.</p>}
        </div>
      ))}

      {error && <p className="text-center text-xs text-destructive">{error}</p>}

      {enVivo.invitar_activo && (
        <button onClick={() => setAbierto(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 text-sm font-semibold text-foreground active:bg-accent">
          <Wine className="h-4 w-4" /> Invitar algo a otra mesa
        </button>
      )}
      <NuevaInvitacion abierto={abierto} onCambiar={setAbierto} token={token} tenantId={tenantId} color={color} onListo={() => { setAbierto(false); recargar(); }} />
    </div>
  );
}

function NuevaInvitacion({ abierto, onCambiar, token, tenantId, color, onListo }: {
  abierto: boolean; onCambiar: (v: boolean) => void; token: string; tenantId?: string; color: string; onListo: () => void;
}) {
  const [mesas, setMesas] = useState<number[] | null>(null);
  const [mesa, setMesa] = useState<number | null>(null);
  const [producto, setProducto] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const { data: carta } = useQuery({
    queryKey: ["carta-invitar", tenantId],
    queryFn: async () => (await supabase.from("menu_items").select("id, name, price").eq("tenant_id", tenantId!).eq("status", "available").order("name")).data ?? [],
    enabled: abierto && !!tenantId,
  });
  useEffect(() => {
    if (!abierto) return;
    setMesa(null); setProducto(null); setMensaje(""); setError(""); setMesas(null);
    mesasParaInvitar(token).then((r) => setMesas(r.ok ? r.dato : []));
  }, [abierto, token]);
  const lista = useMemo(() => (carta ?? []).filter((m) => m.name.toLowerCase().includes(busca.toLowerCase())).slice(0, 30), [carta, busca]);

  const enviar = async () => {
    if (mesa === null || !producto || enviando) return;
    setEnviando(true);
    setError("");
    const r = await invitarOtraMesa(token, mesa, producto, mensaje.trim());
    setEnviando(false);
    if (r.ok === false) { setError(r.error); return; }
    onListo();
  };

  return (
    <Drawer open={abierto} onOpenChange={onCambiar}>
      <DrawerContent className="max-h-[90vh]">
        <div className="mx-auto w-full max-w-md overflow-y-auto px-4 pb-6">
          <DrawerHeader className="px-0 text-left">
            <DrawerTitle className="text-xl font-extrabold">Invitar a otra mesa</DrawerTitle>
            <DrawerDescription>La otra mesa decide si la acepta. Recién ahí pagas: si no la aceptan, no se te cobra nada.</DrawerDescription>
          </DrawerHeader>
          <p className="mb-2 text-sm font-bold text-foreground">¿A qué mesa?</p>
          {mesas === null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : mesas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ahora no hay otras mesas a las que invitar.</p>
          ) : (
            <div className="flex flex-wrap gap-2" data-testid="elegir-mesa">
              {mesas.map((n) => (
                <button key={n} onClick={() => setMesa(n)} className={`h-11 min-w-11 rounded-xl border-2 px-3 text-sm font-bold ${mesa === n ? "text-white" : "text-foreground"}`}
                  style={mesa === n ? { backgroundColor: color, borderColor: color } : undefined}>Mesa {n}</button>
              ))}
            </div>
          )}
          <p className="mb-2 mt-5 text-sm font-bold text-foreground">¿Qué le invitas?</p>
          <Input placeholder="Busca en la carta" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto" data-testid="elegir-producto">
            {lista.map((m) => (
              <button key={m.id} onClick={() => setProducto(m.id)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${producto === m.id ? "font-bold" : ""}`}
                style={producto === m.id ? { borderColor: color } : undefined}>
                <span className="text-foreground">{m.name}</span><span className="tabular-nums text-muted-foreground">{formatCLP(m.price)}</span>
              </button>
            ))}
          </div>
          <p className="mb-2 mt-5 text-sm font-bold text-foreground">Un mensaje (opcional)</p>
          <Input maxLength={80} placeholder="Ej: ¡Salud desde la mesa del rincón!" value={mensaje} onChange={(e) => setMensaje(e.target.value)} aria-label="Mensaje para la otra mesa" />
          <p className="mt-1 text-[11px] text-muted-foreground">Sin enlaces, teléfonos ni redes. La otra mesa solo ve tu número de mesa y tu nombre en la mesa.</p>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <button onClick={enviar} disabled={mesa === null || !producto || enviando} className="mt-5 w-full rounded-2xl py-3.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: color }}>
            {enviando ? "Enviando…" : "Enviar invitación"}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
