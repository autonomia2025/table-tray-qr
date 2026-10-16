import { useCallback, useEffect, useState } from "react";
import { Loader2, Puzzle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { mensajeError } from "@/lib/errores";
import { catalogoModulos, modulosDelLocal, type Modulo, type ModuloCatalogo, type Modulos } from "@/lib/modulos";

interface Plan { id: string; name: string; display_name: string; max_tables: number; features: Record<string, boolean> }
interface Local { id: string; name: string; plan_id: string | null }
type Ajuste = "plan" | "si" | "no";

/**
 * Planes y módulos (fase 7.9): qué módulos trae cada plan y, para un local en particular, prender o apagar un
 * módulo por encima de su plan. Todo pasa por funciones de la base, con motivo y auditoría.
 */
export default function SAModulosPage() {
  const { toast } = useToast();
  const [catalogo, setCatalogo] = useState<ModuloCatalogo[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [locales, setLocales] = useState<Local[]>([]);
  const [cargando, setCargando] = useState(true);
  const [localId, setLocalId] = useState("");
  const [ajustes, setAjustes] = useState<Partial<Record<Modulo, Ajuste>>>({});
  const [efectivos, setEfectivos] = useState<Modulos>({});
  const [motivo, setMotivo] = useState("");

  const cargar = useCallback(async () => {
    const [cat, { data: ps }, { data: ls }] = await Promise.all([
      catalogoModulos(),
      supabase.from("plans").select("id, name, display_name, max_tables, features").order("max_tables"),
      supabase.rpc("tenants_privado").select("id, name, plan_id").order("name"),
    ]);
    setCatalogo(cat);
    setPlanes((ps ?? []) as Plan[]);
    setLocales((ls ?? []) as Local[]);
    setCargando(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const cargarLocal = useCallback(async (id: string) => {
    const [{ data: flags }, mods] = await Promise.all([
      supabase.from("tenant_feature_flags").select("flag_key, is_enabled").eq("tenant_id", id),
      modulosDelLocal(id),
    ]);
    const a: Partial<Record<Modulo, Ajuste>> = {};
    for (const f of flags ?? []) a[f.flag_key as Modulo] = f.is_enabled ? "si" : "no";
    setAjustes(a);
    setEfectivos(mods);
  }, []);
  useEffect(() => { if (localId) cargarLocal(localId); }, [localId, cargarLocal]);

  const cambiarPlan = async (plan: Plan, modulo: Modulo, valor: boolean) => {
    const { error } = await supabase.rpc("guardar_modulos_plan", { _plan_id: plan.id, _modulos: { [modulo]: valor } });
    if (error) return toast({ title: "No se pudo guardar", description: mensajeError(error), variant: "destructive" });
    setPlanes((ps) => ps.map((p) => (p.id === plan.id ? { ...p, features: { ...p.features, [modulo]: valor } } : p)));
    if (localId) cargarLocal(localId);
  };

  const asignarPlan = async (planId: string) => {
    const { error } = await supabase.rpc("asignar_plan", { _tenant_id: localId, _plan_id: planId === "ninguno" ? null : planId });
    if (error) return toast({ title: "No se pudo cambiar el plan", description: mensajeError(error), variant: "destructive" });
    setLocales((ls) => ls.map((l) => (l.id === localId ? { ...l, plan_id: planId === "ninguno" ? null : planId } : l)));
    toast({ title: "Plan del local cambiado" });
    cargarLocal(localId);
  };

  const ajustar = async (modulo: Modulo, ajuste: Ajuste) => {
    const { error } = await supabase.rpc("ajustar_modulo_local", {
      _tenant_id: localId, _modulo: modulo, _estado: ajuste === "plan" ? null : ajuste === "si", _motivo: motivo,
    });
    if (error) return toast({ title: "No se pudo ajustar", description: mensajeError(error), variant: "destructive" });
    toast({ title: "Módulo ajustado" });
    cargarLocal(localId);
  };

  if (cargando) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const local = locales.find((l) => l.id === localId);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground"><Puzzle className="h-5 w-5 text-primary" /> Planes y módulos</h1>
        <p className="text-sm text-muted-foreground">
          Lo básico (pedir, pagar, mozo, cocina, caja, sellos y reportes) siempre está. Estos módulos pueden ir en un plan u otro.
          Por ahora todos los planes traen todo: el reparto se decide junto con los precios.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Qué trae cada plan</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0" data-testid="modulos-planes">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-2 font-semibold text-foreground">Módulo</th>
                {planes.map((p) => <th key={p.id} className="px-3 py-2 text-center font-semibold text-foreground">{p.display_name}</th>)}
              </tr>
            </thead>
            <tbody>
              {catalogo.map((m) => (
                <tr key={m.modulo} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{m.nombre}</p>
                    <p className="text-xs text-muted-foreground">{m.descripcion}</p>
                  </td>
                  {planes.map((p) => (
                    <td key={p.id} className="px-3 py-3 text-center">
                      <Switch checked={p.features?.[m.modulo] !== false} aria-label={`${m.nombre} en ${p.display_name}`}
                        onCheckedChange={(v) => cambiarPlan(p, m.modulo, v)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Un local en particular</CardTitle></CardHeader>
        <CardContent className="space-y-4" data-testid="modulos-local">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Local</Label>
              <Select value={localId} onValueChange={setLocalId}>
                <SelectTrigger aria-label="Local"><SelectValue placeholder="Elige un local" /></SelectTrigger>
                <SelectContent>{locales.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {local && (
              <div>
                <Label>Plan</Label>
                <Select value={local.plan_id ?? "ninguno"} onValueChange={asignarPlan}>
                  <SelectTrigger aria-label="Plan"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ninguno">Sin plan (tiene todo)</SelectItem>
                    {planes.map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {local && (
            <>
              <div>
                <Label htmlFor="motivo-modulo">Motivo del ajuste</Label>
                <Input id="motivo-modulo" maxLength={500} placeholder="Ej: prueba de campañas por 30 días" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">Queda registrado. Hace falta para prender o apagar un módulo solo para este local.</p>
              </div>
              <div className="divide-y divide-border rounded-xl border">
                {catalogo.map((m) => (
                  <div key={m.modulo} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{m.nombre}</p>
                      <p className="text-xs text-muted-foreground">{efectivos[m.modulo] === false ? "Apagado" : "Prendido"} para este local</p>
                    </div>
                    <Select value={ajustes[m.modulo] ?? "plan"} onValueChange={(v) => ajustar(m.modulo, v as Ajuste)}>
                      <SelectTrigger className="w-44" aria-label={`Ajuste de ${m.nombre}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="plan">Según su plan</SelectItem>
                        <SelectItem value="si">Prendido</SelectItem>
                        <SelectItem value="no">Apagado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <Button variant="outline" onClick={() => cargarLocal(localId)}>Actualizar</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
