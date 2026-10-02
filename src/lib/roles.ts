/**
 * Roles de Tablio: el único lugar que decide a dónde llega cada persona y qué secciones ve.
 * La fuente de verdad del rol es la base (tenant_members, función mi_perfil()).
 * Las reglas de acceso de la base son las que realmente protegen; esto ordena la interfaz.
 */

export type RolLocal = "owner" | "admin" | "manager" | "cashier" | "waiter" | "kitchen";
export type RolBackoffice = "vendedor" | "jefe_ventas" | "finanzas" | "marketing";

export interface LocalDelPerfil {
  tenant_id: string;
  slug: string;
  nombre: string;
  color: string | null;
  rol: RolLocal;
  branch_id: string | null;
  staff_id: string | null;
  staff_nombre: string | null;
}

export interface Perfil {
  user_id: string;
  email: string | null;
  /** Comensal invitado (sin registrarse). */
  es_anonimo: boolean;
  es_superadmin: boolean;
  backoffice: { id: string; rol: RolBackoffice; nombre: string } | null;
  locales: LocalDelPerfil[];
}

export const NOMBRE_ROL: Record<RolLocal, string> = {
  owner: "Dueño",
  admin: "Administrador",
  manager: "Encargado",
  cashier: "Cajero",
  waiter: "Mozo",
  kitchen: "Cocina",
};

/** Secciones del panel del local (las rutas /admin/:slug/<seccion>). */
export type SeccionLocal =
  | "mesas" | "pedidos" | "menu" | "caja" | "lealtad" | "reportes"
  | "equipo" | "qr" | "sucursal" | "soporte" | "kds";

const TODAS: SeccionLocal[] = ["mesas", "pedidos", "menu", "caja", "lealtad", "reportes", "equipo", "qr", "sucursal", "soporte", "kds"];

export const SECCIONES_POR_ROL: Record<RolLocal, SeccionLocal[]> = {
  owner: TODAS,
  admin: TODAS,
  manager: ["mesas", "pedidos", "menu", "caja", "lealtad", "reportes", "qr", "soporte", "kds"],
  cashier: ["caja", "pedidos", "mesas"],
  waiter: [],
  kitchen: ["kds"],
};

export const puedeVer = (rol: RolLocal | "superadmin", seccion: SeccionLocal) =>
  rol === "superadmin" || SECCIONES_POR_ROL[rol]?.includes(seccion);

/** Primera sección del panel para cada rol. */
export const inicioPanel = (rol: RolLocal | "superadmin"): SeccionLocal =>
  rol === "cashier" ? "caja" : "mesas";

/** Roles que pueden abrir la pantalla de cocina (KDS). */
export const ROLES_KDS: RolLocal[] = ["owner", "admin", "manager", "kitchen"];

/** A dónde llega cada persona después de iniciar sesión. Vacío = no tiene acceso. */
export function destinoTrasLogin(perfil: Perfil | null): string {
  if (!perfil) return "";
  if (perfil.es_superadmin) return "/superadmin";
  if (perfil.backoffice) {
    switch (perfil.backoffice.rol) {
      case "vendedor": return "/vendedor/mi-dia";
      case "finanzas": return "/finanzas/revenue";
      default: return "/jefe-ventas/dashboard";
    }
  }
  const local = perfil.locales[0];
  if (!local) return "";
  switch (local.rol) {
    case "waiter": return "/mozo/mesas";
    case "kitchen": return local.branch_id ? `/kds?branch=${local.branch_id}` : "/kds";
    default: return `/admin/${local.slug}/${inicioPanel(local.rol)}`;
  }
}
