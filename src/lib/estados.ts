// Única capa de traducción de estados (pista P). La base los guarda en inglés (decisión del fundador
// del 1 de octubre de 2026); todo lo que ve una persona pasa por aquí. Las pantallas pueden agregar
// íconos, pero no inventar su propio texto para un estado.

export type EstadoPedidoBase = "confirmed" | "in_kitchen" | "ready" | "delivered" | "cancelled";
export type EstadoMesa = "free" | "occupied" | "waiting_bill";
export type EstadoPago = "approved" | "pending" | "failed" | "refunded" | "partially_refunded";
export type EstadoLlamado = "pending" | "attended" | "cancelled";

/** Quién lee: el equipo del local (mozo, cocina, caja, dueño) o el cliente en su celular. */
export type Para = "personal" | "comensal";

export const ESTADOS_PEDIDO: Record<EstadoPedidoBase, Record<Para, string>> = {
  confirmed: { personal: "Nuevo", comensal: "Recibido" },
  in_kitchen: { personal: "En cocina", comensal: "En cocina" },
  ready: { personal: "Listo", comensal: "¡Listo!" },
  delivered: { personal: "Entregado", comensal: "Entregado" },
  cancelled: { personal: "Cancelado", comensal: "Cancelado" },
};

/** Para títulos de columnas (pedidos del dueño, pantalla de cocina). */
export const ESTADOS_PEDIDO_PLURAL: Record<EstadoPedidoBase, string> = {
  confirmed: "Nuevos",
  in_kitchen: "En cocina",
  ready: "Listos",
  delivered: "Entregados",
  cancelled: "Cancelados",
};

export const ESTADOS_MESA: Record<EstadoMesa, string> = {
  free: "Libre",
  occupied: "Ocupada",
  waiting_bill: "Esperando cuenta",
};

export const ESTADOS_PAGO: Record<EstadoPago, string> = {
  approved: "Aprobado",
  pending: "Pendiente",
  failed: "Rechazado",
  refunded: "Reembolsado",
  partially_refunded: "Reemb. parcial",
};

export const ESTADOS_LLAMADO: Record<EstadoLlamado, string> = {
  pending: "Esperando al mozo",
  attended: "Atendido",
  cancelled: "Cancelado",
};

// Un estado desconocido nunca se muestra en inglés: se muestra un texto neutro.
const NEUTRO = "En proceso";

export const textoPedido = (estado: string | null | undefined, para: Para = "personal") =>
  ESTADOS_PEDIDO[estado as EstadoPedidoBase]?.[para] ?? NEUTRO;
export const textoPedidoPlural = (estado: string | null | undefined) =>
  ESTADOS_PEDIDO_PLURAL[estado as EstadoPedidoBase] ?? NEUTRO;
export const textoMesa = (estado: string | null | undefined) => ESTADOS_MESA[estado as EstadoMesa] ?? NEUTRO;
export const textoPago = (estado: string | null | undefined) => ESTADOS_PAGO[estado as EstadoPago] ?? NEUTRO;
export const textoLlamado = (estado: string | null | undefined) => ESTADOS_LLAMADO[estado as EstadoLlamado] ?? NEUTRO;
