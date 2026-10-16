import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";
import type { CartItem } from "@/store/cartStore";

// Dividir un plato (fase 7.4b): quien lo pide elige con quiénes de su mesa lo divide; cada uno paga su parte
// con la app y el plato pasa a cocina cuando están todas. Los montos y el estado los decide la base.

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };

export async function dividirPlato(token: string, item: CartItem, comensales: string[]): Promise<Resultado<{ plato: string; mi_parte: string; total: number; personas: number }>> {
  const linea = {
    menu_item_id: item.menuItemId,
    quantity: item.quantity,
    modifiers: item.selectedModifiers.map((m) => ({ groupName: m.groupName, modifierName: m.modifierName })),
    notes: item.itemNotes || null,
  };
  const { data, error } = await supabase.rpc("dividir_plato", { _qr_token: token, _item: linea, _comensales: comensales });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as unknown as { plato: string; mi_parte: string; total: number; personas: number } };
}

export async function cotizarParte(token: string, parte: string): Promise<Resultado<{ id: string; subtotal: number; expira_at: string }>> {
  const { data, error } = await supabase.rpc("cotizar_parte", { _qr_token: token, _parte_id: parte });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as unknown as { id: string; subtotal: number; expira_at: string } };
}

export async function rechazarParte(token: string, parte: string): Promise<Resultado<null>> {
  const { error } = await supabase.rpc("rechazar_parte", { _qr_token: token, _parte_id: parte });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: null };
}

export async function tomarParte(token: string, parte: string): Promise<Resultado<null>> {
  const { error } = await supabase.rpc("tomar_parte", { _qr_token: token, _parte_id: parte });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: null };
}
