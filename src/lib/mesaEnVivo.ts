import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";
import { useCartStore, type CartModifier } from "@/store/cartStore";

// La mesa en vivo (fase 3.4): lo calcula la base; el comensal no lee estaciones ni pedidos ajenos.

export interface ItemEnVivo {
  id: string;
  nombre: string;
  cantidad: number;
  estado: "confirmed" | "in_kitchen" | "ready" | "delivered" | "cancelled";
  estacion: string | null;
}

export interface PedidoEnVivo {
  id: string;
  numero: number;
  estado: string;
  pagado: boolean;
  forma_pago: string | null;
  items: ItemEnVivo[];
  /** Minutos estimados para que quede todo listo (null si ya está listo o falta pagar). */
  faltan_min: number | null;
}

/** Una ronda que alguien de la mesa invitó (fase 7.4). */
export interface RondaEnVivo {
  id: string;
  creado: string;
  estado: ItemEnVivo["estado"];
  mia: boolean;
  quien: string;
  items: { nombre: string; cantidad: number }[];
}

/** Un plato dividido donde estoy (fase 7.4b). */
export interface DivididoEnVivo {
  id: string;
  estado: "esperando" | "pagado" | "anulado";
  total: number;
  plato: string;
  soy_creador: boolean;
  pedido_estado: ItemEnVivo["estado"];
  partes: { id: string; monto: number; estado: "pendiente" | "pagada" | "rechazada"; yo: boolean; quien: string }[];
}

export interface MesaEnVivo {
  mesa: number;
  personas: { id?: string; alias: string | null; yo: boolean }[];
  divididos?: DivididoEnVivo[];
  pedidos: PedidoEnVivo[];
  rondas?: RondaEnVivo[];
  /** Juegos (fase 7.8): el mejor puntaje de cada uno en la trivia y la última vuelta de la ruleta. */
  trivia?: { quien: string; puntaje: number; yo: boolean }[];
  ruleta?: { elegido: string; cuando: string; soy_yo: boolean } | null;
}

export interface LoDeSiempre {
  menu_item_id: string;
  nombre: string;
  precio: number;
  imagen: string | null;
  visitas: number;
  veces: number;
}

export async function miMesaEnVivo(token: string): Promise<MesaEnVivo | null> {
  const { data, error } = await supabase.rpc("mi_mesa_en_vivo", { _qr_token: token });
  if (error) return null;
  return data as unknown as MesaEnVivo;
}

export async function loDeSiempre(token: string): Promise<LoDeSiempre[]> {
  const { data, error } = await supabase.rpc("lo_de_siempre", { _qr_token: token });
  if (error) return [];
  return (data ?? []) as unknown as LoDeSiempre[];
}

/** Ponerse un nombre en la mesa (lo ven los demás comensales de la mesa). */
export async function ponerAlias(token: string, alias: string) {
  const { error } = await supabase.rpc("unirse_a_mesa", { _qr_token: token, _alias: alias.trim().slice(0, 30) });
  return error ? { ok: false as const, error: mensajeAmigable(error.message) } : { ok: true as const };
}

/**
 * "Otra ronda": pone en el carrito lo mismo que un pedido anterior (con sus opciones).
 * El precio final lo vuelve a calcular el servidor al pagar; lo agotado se deja fuera.
 */
export async function otraRonda(pedidoId: string): Promise<{ agregados: number; agotados: string[] }> {
  const { data: items } = await supabase
    .from("order_items")
    .select("menu_item_id, menu_item_name, quantity, selected_modifiers, item_notes, status")
    .eq("order_id", pedidoId);
  const vivos = (items ?? []).filter((i) => i.menu_item_id && i.status !== "cancelled");
  if (!vivos.length) return { agregados: 0, agotados: [] };

  const { data: carta } = await supabase
    .from("menu_items")
    .select("id, name, price, status")
    .in("id", vivos.map((i) => i.menu_item_id!));
  const porId = new Map((carta ?? []).map((m) => [m.id, m]));

  const agregar = useCartStore.getState().addItem;
  const agotados: string[] = [];
  let agregados = 0;
  for (const it of vivos) {
    const plato = porId.get(it.menu_item_id!);
    if (!plato || plato.status !== "available") {
      agotados.push(it.menu_item_name);
      continue;
    }
    const opciones = (Array.isArray(it.selected_modifiers) ? it.selected_modifiers : []) as unknown as CartModifier[];
    agregar({
      menuItemId: plato.id,
      name: plato.name,
      unitPrice: plato.price,
      quantity: it.quantity,
      selectedModifiers: opciones.map((o) => ({ groupName: o.groupName, modifierName: o.modifierName, extraPrice: o.extraPrice ?? 0 })),
      itemNotes: it.item_notes ?? "",
    });
    agregados += it.quantity;
  }
  return { agregados, agotados };
}

/** Estado de mi pedido por estación: "Ya está listo: Agua mineral. Sigue en Cocina: Barros Luco." */
export function resumenPorEstacion(p: PedidoEnVivo): string | null {
  const vivos = p.items.filter((i) => i.estado !== "cancelled" && i.estado !== "delivered");
  const listos = vivos.filter((i) => i.estado === "ready");
  const pendientes = vivos.filter((i) => i.estado === "confirmed" || i.estado === "in_kitchen");
  if (!listos.length || !pendientes.length) return null;
  const nombres = (xs: ItemEnVivo[]) => xs.map((i) => i.nombre).join(", ");
  const donde = [...new Set(pendientes.map((i) => i.estacion).filter(Boolean))].join(" y ");
  return `Ya está listo: ${nombres(listos)}. ${donde ? `Sigue en ${donde}` : "Sigue en preparación"}: ${nombres(pendientes)}.`;
}
