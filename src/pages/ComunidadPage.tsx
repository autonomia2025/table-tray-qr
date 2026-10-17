import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Copy, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSesion } from "@/contexts/SesionContext";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import PlanesAmigos from "@/components/comensal/PlanesAmigos";
import {
  activarComunidad, apagarComunidad, bloquearUsuario, miComunidad, pedirAmistadEnMesa, pedirAmistadPorCodigo,
  quitarAmistad, reportarUsuario, responderAmistad, type Comunidad,
} from "@/lib/comunidad";

/**
 * Comunidad y amigos (fase 9.2): solo con cuenta, apagada por defecto y con permiso explícito. Amigos por
 * código o con quien está en tu mesa; bloquear y reportar siempre a mano.
 */
export default function ComunidadPage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const token = params.get("t");
  const navigate = useNavigate();
  const { perfil } = useSesion();
  const registrado = !!perfil && !perfil.es_anonimo && !!perfil.email;
  const { data: color = "#E8531D" } = useQuery({
    queryKey: ["primary-color", slug],
    queryFn: async () => (await supabase.from("tenants").select("primary_color").eq("slug", slug!).maybeSingle()).data?.primary_color || "#E8531D",
    enabled: !!slug,
    staleTime: Infinity,
  });
  const [c, setC] = useState<Comunidad | null | undefined>(undefined);
  const [nombre, setNombre] = useState("");
  const [acepto, setAcepto] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const [reportando, setReportando] = useState<{ user_id: string; nombre: string } | null>(null);
  const [motivo, setMotivo] = useState("");

  const cargar = useCallback(async () => {
    const r = await miComunidad(token);
    setC(r.ok ? r.dato : null);
  }, [token]);
  useEffect(() => { if (registrado) cargar(); else setC(null); }, [registrado, cargar]);

  const hacer = async (p: Promise<{ ok: boolean; error?: string }>, ok?: string) => {
    setError(""); setAviso("");
    const r = await p;
    if (!r.ok) setError((r as { error: string }).error);
    else if (ok) setAviso(ok);
    cargar();
  };

  const volver = () => (window.history.length > 1 ? navigate(-1) : navigate(`/${slug}/menu${token ? `?t=${token}` : ""}`));

  return (
    <div className="min-h-screen bg-background pb-10">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background px-4">
        <button onClick={volver} className="flex h-9 w-9 items-center justify-center rounded-full text-foreground"><ArrowLeft className="h-5 w-5" /></button>
        <span className="text-sm font-bold text-foreground">Comunidad y amigos</span>
      </header>
      <div className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {!registrado ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Guarda tu cuenta para usar la comunidad.</p>
        ) : c === undefined ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : c?.suspendido ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Tu perfil de comunidad está suspendido. Si crees que es un error, escríbenos.</p>
        ) : !c?.activo ? (
          <div className="space-y-4 rounded-2xl border bg-card p-5" data-testid="activar-comunidad">
            <p className="text-3xl">👥</p>
            <p className="text-lg font-extrabold text-card-foreground">Junta a tus amigos en Tablio</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Tus amigos te agregan con tu código, o cuando están en tu misma mesa.</li>
              <li>Solo ven el nombre que elijas. Nadie ve dónde estás ahora.</li>
              <li>Puedes bloquear o reportar a cualquiera, y apagar la comunidad cuando quieras: se borran tus amistades.</li>
            </ul>
            <div>
              <p className="mb-1 text-sm font-semibold text-card-foreground">Tu nombre en la comunidad</p>
              <Input maxLength={30} placeholder="Ej: Cami" value={nombre} onChange={(e) => setNombre(e.target.value)} aria-label="Tu nombre en la comunidad" />
            </div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox checked={acepto} onCheckedChange={(v) => setAcepto(v === true)} aria-label="Acepto usar la comunidad" />
              <span>Acepto que mis amigos de Tablio vean mi nombre. Puedo apagarlo y borrar mis amistades cuando quiera.</span>
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button onClick={() => hacer(activarComunidad(nombre, acepto))} disabled={!acepto || nombre.trim().length < 2}
              className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: color }}>Activar comunidad</button>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border bg-card p-5" data-testid="mi-comunidad">
              <p className="text-sm text-muted-foreground">Hola, <strong className="text-card-foreground">{c.nombre}</strong></p>
              <p className="mt-3 text-xs text-muted-foreground">Tu código para que te agreguen</p>
              <div className="mt-1 flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2">
                <span className="font-mono text-lg font-extrabold tracking-wider text-card-foreground" data-testid="mi-codigo">{c.codigo}</span>
                <button onClick={() => navigator.clipboard?.writeText(c.codigo!).then(() => setAviso("Código copiado"), () => undefined)} aria-label="Copiar código"><Copy className="h-4 w-4 text-muted-foreground" /></button>
              </div>
              <div className="mt-4 flex gap-2">
                <Input placeholder="Código de un amigo (TAB-…)" value={codigo} onChange={(e) => setCodigo(e.target.value)} aria-label="Código de un amigo" />
                <button onClick={() => hacer(pedirAmistadPorCodigo(codigo), "Solicitud enviada").then(() => setCodigo(""))} disabled={codigo.trim().length < 5}
                  className="shrink-0 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: color }}>Agregar</button>
              </div>
            </div>
            {aviso && <p className="text-center text-sm" style={{ color }}>{aviso}</p>}
            {error && <p className="text-center text-sm text-destructive">{error}</p>}

            {!!c.solicitudes?.length && (
              <Seccion titulo="Te quieren agregar">
                {c.solicitudes.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2" data-testid="solicitud-amistad">
                    <span className="text-sm text-card-foreground">{s.nombre}</span>
                    <span className="flex gap-2">
                      <button onClick={() => hacer(responderAmistad(s.id, true), `Ahora eres amigo de ${s.nombre}`)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: color }}>Aceptar</button>
                      <button onClick={() => hacer(responderAmistad(s.id, false))} className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-card-foreground">No</button>
                    </span>
                  </li>
                ))}
              </Seccion>
            )}

            {!!c.en_mi_mesa?.length && token && (
              <Seccion titulo="En tu mesa">
                {c.en_mi_mesa.map((p) => (
                  <li key={p.user_id} className="flex items-center justify-between gap-2 py-2">
                    <span className="text-sm text-card-foreground">{p.nombre}</span>
                    <button onClick={() => hacer(pedirAmistadEnMesa(token, p.user_id), "Solicitud enviada")} className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-card-foreground">Agregar</button>
                  </li>
                ))}
              </Seccion>
            )}

            <Seccion titulo={`Tus amigos (${c.amigos?.length ?? 0})`}>
              {!c.amigos?.length && <li className="py-2 text-sm text-muted-foreground">Todavía no tienes amigos agregados. Comparte tu código.</li>}
              {c.amigos?.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2" data-testid="amigo">
                  <span className="text-sm font-semibold text-card-foreground">{a.nombre}</span>
                  <span className="flex gap-3 text-xs text-muted-foreground">
                    <button onClick={() => hacer(quitarAmistad(a.id))} className="underline">Quitar</button>
                    <button onClick={() => hacer(bloquearUsuario(a.user_id), "Bloqueado")} className="underline">Bloquear</button>
                    <button onClick={() => { setReportando({ user_id: a.user_id, nombre: a.nombre }); setMotivo(""); }} className="underline">Reportar</button>
                  </span>
                </li>
              ))}
            </Seccion>

            <PlanesAmigos amigos={c.amigos ?? []} color={color} />

            {!!c.enviadas?.length && (
              <Seccion titulo="Esperando respuesta">
                {c.enviadas.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-muted-foreground">{s.nombre}</span>
                    <button onClick={() => hacer(quitarAmistad(s.id))} className="text-xs text-muted-foreground underline">Retirar</button>
                  </li>
                ))}
              </Seccion>
            )}

            {reportando && (
              <div className="space-y-2 rounded-2xl border p-4">
                <p className="text-sm font-semibold text-foreground">Reportar a {reportando.nombre}</p>
                <Input maxLength={500} placeholder="Cuéntanos qué pasó" value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo del reporte" />
                <div className="flex gap-2">
                  <button onClick={() => hacer(reportarUsuario(reportando.user_id, motivo), "Gracias. Lo revisaremos.").then(() => setReportando(null))}
                    className="flex-1 rounded-xl py-2 text-sm font-semibold text-white" style={{ backgroundColor: color }}>Enviar reporte</button>
                  <button onClick={() => setReportando(null)} className="rounded-xl border px-3 text-sm text-foreground">Cancelar</button>
                </div>
              </div>
            )}

            <button onClick={() => hacer(apagarComunidad())} className="w-full text-center text-xs text-muted-foreground underline">Apagar la comunidad (se borran mis amistades)</button>
          </>
        )}
      </div>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="mb-1 flex items-center gap-2 text-sm font-bold text-card-foreground"><Users className="h-4 w-4 text-muted-foreground" /> {titulo}</p>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}
