import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Pencil, Plus, X } from "lucide-react";

// Estaciones de la sucursal (fase 3.2): cada una tiene su pantalla de cocina y recibe solo lo suyo.
// La principal recibe todo lo que no tenga estación y no se puede desactivar.

interface Estacion {
  id: string;
  name: string;
  es_predeterminada: boolean;
  is_active: boolean;
  sort_order: number;
}

export default function EstacionesSucursal({ branchId, tenantId }: { branchId: string; tenantId: string }) {
  const { toast } = useToast();
  const [estaciones, setEstaciones] = useState<Estacion[]>([]);
  const [nueva, setNueva] = useState("");
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    if (!branchId) return;
    const { data } = await supabase
      .from("stations")
      .select("id, name, es_predeterminada, is_active, sort_order")
      .eq("branch_id", branchId)
      .order("sort_order");
    setEstaciones((data ?? []) as Estacion[]);
  }, [branchId]);

  useEffect(() => { cargar(); }, [cargar]);

  const avisar = (error: { message: string } | null, ok: string) => {
    if (error) toast({ title: "No se pudo guardar", description: mensajeAmigable(error.message), variant: "destructive" });
    else toast({ title: ok });
  };

  const agregar = async () => {
    const nombre = nueva.trim();
    if (!nombre) return;
    setGuardando(true);
    const { error } = await supabase.from("stations").insert({
      tenant_id: tenantId, branch_id: branchId, name: nombre.slice(0, 40),
      sort_order: Math.max(0, ...estaciones.map((e) => e.sort_order)) + 1,
    });
    setGuardando(false);
    avisar(error, `Estación "${nombre}" creada`);
    if (!error) { setNueva(""); cargar(); }
  };

  const renombrar = async () => {
    if (!editando || !editando.nombre.trim()) return;
    const { error } = await supabase.from("stations").update({ name: editando.nombre.trim().slice(0, 40) }).eq("id", editando.id);
    avisar(error, "Nombre actualizado");
    if (!error) { setEditando(null); cargar(); }
  };

  const activar = async (e: Estacion, activa: boolean) => {
    const { error } = await supabase.from("stations").update({ is_active: activa }).eq("id", e.id);
    avisar(error, activa ? `${e.name} activada` : `${e.name} desactivada: lo pendiente pasó a la estación principal`);
    cargar();
  };

  return (
    <Card className="mb-6">
      <CardHeader><CardTitle>Estaciones</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Cada estación tiene su propia pantalla de cocina (por ejemplo, Cocina y Barra) y recibe solo sus productos.
          En Carta eliges a qué estación va cada categoría.
        </p>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {estaciones.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-4 py-3">
              {editando?.id === e.id ? (
                <>
                  <Input
                    value={editando.nombre}
                    onChange={(ev) => setEditando({ id: e.id, nombre: ev.target.value })}
                    onKeyDown={(ev) => { if (ev.key === "Enter") renombrar(); }}
                    maxLength={40}
                    className="h-9 flex-1"
                    aria-label="Nombre de la estación"
                    autoFocus
                  />
                  <Button size="icon" variant="ghost" onClick={renombrar} aria-label="Guardar nombre"><Check className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditando(null)} aria-label="Cancelar"><X className="h-4 w-4" /></Button>
                </>
              ) : (
                <>
                  <span className={`flex-1 font-medium ${e.is_active ? "text-foreground" : "text-muted-foreground line-through"}`}>{e.name}</span>
                  {e.es_predeterminada && <Badge variant="secondary" className="text-[10px]">Principal</Badge>}
                  <Button size="icon" variant="ghost" onClick={() => setEditando({ id: e.id, nombre: e.name })} aria-label={`Renombrar ${e.name}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Switch
                    checked={e.is_active}
                    disabled={e.es_predeterminada}
                    onCheckedChange={(v) => activar(e, v)}
                    aria-label={`${e.name} activa`}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") agregar(); }}
            placeholder="Nueva estación (ej: Barra, Parrilla)"
            maxLength={40}
            aria-label="Nueva estación"
          />
          <Button onClick={agregar} disabled={!nueva.trim() || guardando}>
            <Plus className="mr-1 h-4 w-4" /> Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
