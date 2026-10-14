import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { conectarTransbank, conexionesPago, desconectarPago, NOMBRE_PROVEEDOR, type ConexionPago } from "@/lib/pagos";

/**
 * Cómo le pagan los clientes con la app a este local (fase 4.1). El local conecta su propia cuenta:
 * la plata va directo a ella. Las claves se prueban antes de guardarse y quedan cifradas; nadie las
 * vuelve a ver (para cambiarlas se conecta de nuevo).
 */
export default function PagosSucursal({ branchId }: { branchId: string }) {
  const { toast } = useToast();
  const [conexiones, setConexiones] = useState<ConexionPago[] | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [ambiente, setAmbiente] = useState<"produccion" | "integracion">("produccion");
  const [codigo, setCodigo] = useState("");
  const [clave, setClave] = useState("");
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => setConexiones(await conexionesPago(branchId)), [branchId]);
  useEffect(() => { cargar(); }, [cargar]);

  const activa = conexiones?.find((c) => c.estado === "activa") ?? null;

  const conectar = async (usarClavesDePrueba = false) => {
    setEnviando(true);
    const r = await conectarTransbank(branchId, {
      ambiente: usarClavesDePrueba ? "integracion" : ambiente, codigoComercio: codigo, apiKey: clave, usarClavesDePrueba,
    });
    setEnviando(false);
    if (r.ok === false) {
      toast({ title: "No se pudo conectar", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: "Webpay conectado", description: r.dato.etiqueta });
    setAbierto(false);
    setCodigo("");
    setClave("");
    cargar();
  };

  const desconectar = async () => {
    if (!activa) return;
    const r = await desconectarPago(activa.id);
    if (r.ok === false) {
      toast({ title: "No se pudo desconectar", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: "Pasarela desconectada", description: "Desde ahora no se cobra con la app en esta sucursal." });
    cargar();
  };

  return (
    <Card className="mb-6" data-testid="pagos-sucursal">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-primary" /> Cómo te pagan con la app</CardTitle>
        <p className="text-sm text-muted-foreground">
          Conecta la cuenta de tu pasarela de pago: lo que pagan tus clientes con el QR llega directo a tu cuenta. Tablio nunca toca esa plata.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {conexiones === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : activa ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3">
            <div>
              <p className="flex items-center gap-1.5 font-semibold text-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> {NOMBRE_PROVEEDOR[activa.proveedor]} conectado
              </p>
              <p className="text-xs text-muted-foreground">
                {activa.etiqueta}{activa.ambiente === "integracion" ? " · ambiente de pruebas (no cobra plata real)" : ""}
                {activa.conectado_por_nombre ? ` · por ${activa.conectado_por_nombre}` : ""}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={desconectar}>Desconectar</Button>
          </div>
        ) : (
          <p className="rounded-xl bg-muted p-3 text-sm text-foreground">
            Todavía no tienes una pasarela conectada: tus clientes pueden pedir con el QR y pagarle al mozo, pero no pagar con la app.
          </p>
        )}

        {!abierto ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setAbierto(true)} className="rounded-xl border-2 border-border p-3 text-left hover:border-primary">
              <p className="font-semibold text-foreground">Webpay (Transbank)</p>
              <p className="text-xs text-muted-foreground">Con tu código de comercio y la clave que te da Transbank.</p>
            </button>
            <div className="rounded-xl border-2 border-dashed border-border p-3 text-left opacity-70">
              <p className="font-semibold text-foreground">Mercado Pago</p>
              <p className="text-xs text-muted-foreground">Muy pronto: conectarás tu cuenta con un botón.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-border p-4">
            <p className="font-semibold text-foreground">Conectar Webpay (Transbank)</p>
            <div className="flex gap-2" role="group" aria-label="Ambiente">
              {(["produccion", "integracion"] as const).map((a) => (
                <button key={a} type="button" aria-pressed={ambiente === a} onClick={() => setAmbiente(a)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-sm font-semibold ${ambiente === a ? "border-primary bg-accent text-foreground" : "border-border text-muted-foreground"}`}>
                  {a === "produccion" ? "Cobrar de verdad" : "Ambiente de pruebas"}
                </button>
              ))}
            </div>
            <div>
              <Label htmlFor="tbk-codigo">Código de comercio (12 números)</Label>
              <Input id="tbk-codigo" inputMode="numeric" maxLength={12} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} placeholder="5970…" />
            </div>
            <div>
              <Label htmlFor="tbk-clave">Clave (API Key)</Label>
              <Input id="tbk-clave" type="password" autoComplete="off" value={clave} onChange={(e) => setClave(e.target.value)} />
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Probamos la clave con Transbank antes de guardarla, y queda cifrada: nadie la vuelve a ver.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => conectar(false)} disabled={enviando || codigo.length !== 12 || clave.length < 20}>
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Probar y conectar"}
              </Button>
              <Button variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button variant="ghost" onClick={() => conectar(true)} disabled={enviando} className="text-xs">
                Probar con las claves de prueba de Transbank
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
