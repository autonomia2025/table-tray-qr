import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";
import { useCartStore } from "@/store/cartStore";

// Planes con amigos (fase 9.3). La primera ronda no se cobra antes: se carga al carrito al llegar al local,
// y el precio lo calcula el servidor al pagar.

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };
export interface Plan {
  id: string; fecha: string; mensaje: string | null; local: string; slug: string; tenant_id: string;
  cancelado: boolean; mio: boolean; organiza: string | null; mi_respuesta: "pendiente" | "voy" | "no_voy" | null;
  invitados: { nombre: string; respuesta: string }[];
  ronda: ({ menu_item_id: string; nombre: string; cantidad: number } | string)[];
}

const llamar = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<Resultado<T>> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as T };
};

export const misPlanes = () => llamar<Plan[]>("mis_planes");
export const localesParaPlan = () => llamar<{ tenant_id: string; nombre: string; slug: string }[]>("locales_para_plan");
export const crearPlan = (tenantId: string, fecha: string, amigos: string[], mensaje: string, ronda: { menu_item_id: string; quantity: number }[]) =>
  llamar<string>("crear_plan", { _tenant_id: tenantId, _fecha: fecha, _amigos: amigos, _mensaje: mensaje || null, _ronda: ronda });
export const responderPlan = (id: string, voy: boolean) => llamar<null>("responder_plan", { _plan_id: id, _voy: voy });
export const cancelarPlan = (id: string) => llamar<null>("cancelar_plan", { _plan_id: id });

/** El plan de hoy en este local (lo armé yo, con primera ronda, entre 3 horas antes y 3 después). */
export const planDeHoy = (planes: Plan[], tenantId: string) =>
  planes.find((p) => p.mio && !p.cancelado && p.tenant_id === tenantId && p.ronda.length > 0
    && Math.abs(new Date(p.fecha).getTime() - Date.now()) < 3 * 3_600_000);

/** Carga la primera ronda al carrito (lo agotado se salta). */
export async function cargarRonda(plan: Plan): Promise<{ agregados: number; agotados: string[] }> {
  const lineas = plan.ronda.filter((r): r is { menu_item_id: string; nombre: string; cantidad: number } => typeof r !== "string");
  const { data: carta } = await supabase.from("menu_items").select("id, name, price, status").in("id", lineas.map((l) => l.menu_item_id));
  const porId = new Map((carta ?? []).map((m) => [m.id, m]));
  const agregar = useCartStore.getState().addItem;
  const agotados: string[] = [];
  let agregados = 0;
  for (const l of lineas) {
    const m = porId.get(l.menu_item_id);
    if (!m || m.status !== "available") { agotados.push(l.nombre); continue; }
    agregar({ menuItemId: m.id, name: m.name, unitPrice: m.price, quantity: l.cantidad, selectedModifiers: [], itemNotes: "" });
    agregados += l.cantidad;
  }
  return { agregados, agotados };
}
