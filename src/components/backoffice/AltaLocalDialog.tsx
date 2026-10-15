import { useState } from "react";
import { CheckCircle2, Copy, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { crearLocal, enlaceActivacion, sugerirSlug } from "@/lib/altaLocal";

/**
 * Dar de alta un local (fase 5.1). Se crea completo de una vez en el servidor: local, sucursal, carta vacía,
 * mesas con su QR y código, y estación principal. Al final se entrega el enlace para que el dueño active su
 * cuenta con su propia contraseña (se le manda por WhatsApp o correo).
 */

interface Props {
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
  onCreado?: () => void;
  /** Datos de un posible cliente (vendedor), si viene de ahí */
  inicial?: { nombre?: string; correo?: string; dueno?: string; telefono?: string; leadId?: string };
}

const VACIO = { nombre: "", slug: "", correo: "", dueno: "", telefono: "", color: "#E8531D", mesas: "10", modo: "prepaid" as "prepaid" | "open_tab" };

export default function AltaLocalDialog({ open, onOpenChange, onCreado, inicial }: Props) {
  const [f, setF] = useState(() => ({ ...VACIO, nombre: inicial?.nombre ?? "", slug: sugerirSlug(inicial?.nombre ?? ""), correo: inicial?.correo ?? "", dueno: inicial?.dueno ?? "", telefono: inicial?.telefono ?? "" }));
  const [slugTocado, setSlugTocado] = useState(false);
  const [error, setError] = useState("");
  const [creando, setCreando] = useState(false);
  const [resultado, setResultado] = useState<{ enlace: string; nombre: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const cerrar = (abierto: boolean) => {
    onOpenChange(abierto);
    if (!abierto) {
      setF({ ...VACIO }); setSlugTocado(false); setError(""); setResultado(null); setCopiado(false);
    }
  };

  const crear = async () => {
    setError("");
    const mesas = parseInt(f.mesas, 10);
    if (f.nombre.trim().length < 2) { setError("Escribe el nombre del local."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.correo.trim())) { setError("Escribe un correo válido para el dueño."); return; }
    if (!mesas || mesas < 1 || mesas > 200) { setError("Las mesas van de 1 a 200."); return; }
    setCreando(true);
    const r = await crearLocal({
      nombre: f.nombre.trim(), slug: f.slug.trim(), correoDueno: f.correo.trim(), nombreDueno: f.dueno.trim(),
      telefono: f.telefono.trim(), color: f.color, mesas, modo: f.modo, leadId: inicial?.leadId,
    });
    setCreando(false);
    if (r.ok === false) { setError(r.error); return; }
    setResultado({ enlace: enlaceActivacion(r.dato.token), nombre: f.nombre.trim() });
    onCreado?.();
  };

  const mensaje = resultado
    ? `Hola${f.dueno.trim() ? ` ${f.dueno.trim().split(" ")[0]}` : ""}: ya está listo ${resultado.nombre} en Tablio. Actívalo aquí y elige tu contraseña (el enlace sirve 14 días): ${resultado.enlace}`
    : "";

  const copiar = async () => {
    try { await navigator.clipboard.writeText(mensaje); setCopiado(true); } catch { setCopiado(false); }
  };

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent className="sm:max-w-md">
        {resultado ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-primary" /> {resultado.nombre} está creado</DialogTitle>
              <DialogDescription>Mándale este enlace al dueño. Con él crea su cuenta y elige su contraseña; sirve una sola vez y por 14 días.</DialogDescription>
            </DialogHeader>
            <div className="rounded-xl border bg-muted/40 p-3 text-sm">
              <p className="break-all font-medium text-foreground" data-testid="enlace-activacion">{resultado.enlace}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copiar}><Copy className="mr-1 h-4 w-4" /> {copiado ? "Copiado" : "Copiar mensaje"}</Button>
              <Button variant="outline" asChild>
                <a href={`https://wa.me/${f.telefono.replace(/\D/g, "")}?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-1 h-4 w-4" /> Enviar por WhatsApp
                </a>
              </Button>
            </div>
            <DialogFooter><Button onClick={() => cerrar(false)}>Listo</Button></DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Dar de alta un local</DialogTitle>
              <DialogDescription>Se crea completo: sucursal, mesas con su QR y código, y carta vacía. El dueño activa su cuenta con un enlace.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="alta-nombre">Nombre del local</Label>
                <Input id="alta-nombre" value={f.nombre} maxLength={80}
                  onChange={(e) => setF({ ...f, nombre: e.target.value, slug: slugTocado ? f.slug : sugerirSlug(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor="alta-slug">Dirección en Tablio</Label>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <span className="shrink-0">tablio/</span>
                  <Input id="alta-slug" value={f.slug} maxLength={40} onChange={(e) => { setSlugTocado(true); setF({ ...f, slug: e.target.value.toLowerCase() }); }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="alta-dueno">Nombre del dueño</Label>
                  <Input id="alta-dueno" value={f.dueno} maxLength={60} onChange={(e) => setF({ ...f, dueno: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="alta-telefono">Teléfono</Label>
                  <Input id="alta-telefono" value={f.telefono} inputMode="tel" maxLength={20} placeholder="+56 9…" onChange={(e) => setF({ ...f, telefono: e.target.value })} />
                </div>
              </div>
              <div>
                <Label htmlFor="alta-correo">Correo del dueño</Label>
                <Input id="alta-correo" type="email" value={f.correo} onChange={(e) => setF({ ...f, correo: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="alta-mesas">Mesas</Label>
                  <Input id="alta-mesas" inputMode="numeric" value={f.mesas} onChange={(e) => setF({ ...f, mesas: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="alta-color">Color de la marca</Label>
                  <div className="flex items-center gap-2">
                    <input id="alta-color" type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-10 w-12 cursor-pointer rounded-lg border" />
                    <span className="text-sm text-muted-foreground">{f.color}</span>
                  </div>
                </div>
              </div>
              <div>
                <Label>Cómo cobra</Label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {([["prepaid", "Prepago", "Pagan al pedir"], ["open_tab", "Cuenta abierta", "Pagan al final"]] as const).map(([v, t, d]) => (
                    <button key={v} type="button" aria-pressed={f.modo === v} onClick={() => setF({ ...f, modo: v })}
                      className={`rounded-xl border-2 p-2.5 text-left ${f.modo === v ? "border-primary bg-primary/5" : "border-border"}`}>
                      <p className="text-sm font-semibold text-foreground">{t}</p>
                      <p className="text-xs text-muted-foreground">{d}</p>
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => cerrar(false)}>Cancelar</Button>
              <Button onClick={crear} disabled={creando}>{creando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Crear local</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
