import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Loader2, Tablet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAdmin } from "@/contexts/AdminContext";
import { tiene, useModulos } from "@/lib/modulos";
import {
  activarEsteDispositivo, borrarPin, desactivarTablet, estadoPines, esModoTablet, tabletsDeLaSucursal,
} from "@/lib/tablet";

/**
 * Tablets compartidas (fase 6.1): el dueño o el encargado deja un dispositivo como tablet del local, ve
 * cuáles están activas y quién del equipo tiene PIN. Cada mozo crea su PIN en su Perfil.
 */
export default function TabletsEquipo({ branchId, staff }: { branchId: string; staff: { id: string; name: string; role: string; is_active: boolean | null }[] }) {
  const { toast } = useToast();
  const { tenantId } = useAdmin();
  const modulos = useModulos(tenantId);
  const [tablets, setTablets] = useState<Awaited<ReturnType<typeof tabletsDeLaSucursal>>>([]);
  const [pines, setPines] = useState<Record<string, { tiene_pin: boolean; bloqueado: boolean }>>({});
  const [nombre, setNombre] = useState("Tablet de sala");
  const [activando, setActivando] = useState(false);
  const [estaEsTablet, setEstaEsTablet] = useState(esModoTablet());

  const cargar = useCallback(async () => {
    setTablets(await tabletsDeLaSucursal(branchId));
    const lista = await estadoPines(branchId);
    setPines(Object.fromEntries(lista.map((p) => [p.staff_id, p])));
  }, [branchId]);
  useEffect(() => { cargar(); }, [cargar]);

  const activar = async () => {
    setActivando(true);
    const r = await activarEsteDispositivo(branchId, nombre);
    setActivando(false);
    if (r.ok === false) { toast({ title: "No se pudo activar", description: r.error, variant: "destructive" }); return; }
    setEstaEsTablet(true);
    toast({ title: "Este dispositivo quedó como tablet", description: "Abre la pantalla de la tablet para que los mozos entren con su PIN." });
    cargar();
  };

  const conPin = staff.filter((s) => s.is_active && ["waiter", "manager", "cashier"].includes(s.role));

  if (!tiene(modulos, "tablets")) {
    return (
      <section className="mt-8 space-y-1" aria-labelledby="tablets" data-testid="tablets-equipo">
        <h3 id="tablets" className="flex items-center gap-2 text-lg font-bold text-foreground"><Tablet className="h-5 w-5 text-primary" /> Tablets compartidas</h3>
        <p className="text-sm text-muted-foreground" data-testid="modulo-no-incluido">Tablets compartidas no está incluido en el plan de tu local. Si te interesa, escríbenos desde Soporte.</p>
      </section>
    );
  }

  return (
    <section className="mt-8 space-y-3" aria-labelledby="tablets" data-testid="tablets-equipo">
      <div>
        <h3 id="tablets" className="flex items-center gap-2 text-lg font-bold text-foreground"><Tablet className="h-5 w-5 text-primary" /> Tablets compartidas</h3>
        <p className="text-sm text-muted-foreground">Si tus mozos comparten una tablet, cada uno entra con su nombre y un PIN de 4 números. Lo que hace queda a su nombre, sin compartir contraseñas.</p>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        {estaEsTablet ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Este dispositivo es una tablet del local.</p>
            <Button asChild size="sm"><Link to="/tablet">Abrir la pantalla de la tablet</Link></Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <label htmlFor="nombre-nueva-tablet" className="text-xs text-muted-foreground">Nombre de esta tablet</label>
              <Input id="nombre-nueva-tablet" value={nombre} maxLength={40} onChange={(e) => setNombre(e.target.value)} />
            </div>
            <Button onClick={activar} disabled={activando || !nombre.trim()}>
              {activando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Activar este dispositivo como tablet
            </Button>
          </div>
        )}
        {tablets.length > 0 && (
          <ul className="mt-3 divide-y border-t">
            {tablets.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className={t.revocado_at ? "text-muted-foreground line-through" : "text-foreground"}>
                  {t.nombre}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t.revocado_at ? "desactivada" : t.ultimo_uso_at ? `último uso ${new Date(t.ultimo_uso_at).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "sin usar"}
                  </span>
                </span>
                {!t.revocado_at && (
                  <Button size="sm" variant="ghost" onClick={async () => {
                    const r = await desactivarTablet(t.id);
                    if (r.ok === false) { toast({ title: "No se pudo", description: r.error, variant: "destructive" }); return; }
                    toast({ title: "Tablet desactivada", description: "Ya nadie puede entrar desde ella." });
                    cargar();
                  }}>Desactivar</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-foreground"><KeyRound className="h-4 w-4" /> PIN del equipo</p>
        <ul className="divide-y">
          {conPin.map((s) => {
            const p = pines[s.id];
            return (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="text-foreground">{s.name}</span>
                <span className="flex items-center gap-2">
                  <span className={`text-xs ${p?.bloqueado ? "font-semibold text-destructive" : p?.tiene_pin ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                    {p?.bloqueado ? "Bloqueado por intentos" : p?.tiene_pin ? "Tiene PIN" : "Sin PIN (lo crea en su Perfil)"}
                  </span>
                  {p?.tiene_pin && (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      const r = await borrarPin(s.id);
                      if (r.ok === false) { toast({ title: "No se pudo", description: r.error, variant: "destructive" }); return; }
                      toast({ title: `PIN de ${s.name} borrado`, description: "Puede crear uno nuevo en su Perfil." });
                      cargar();
                    }}>Borrar PIN</Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
