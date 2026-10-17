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
  /** Lo que su rol puede hacer en este local (fase 6.3; el dueño lo ajusta y la base lo hace cumplir). */
  permisos?: Permiso[];
}

/** Permisos finos (fase 6.3). El catálogo vive en la base (_catalogo_permisos). */
export type Permiso =
  | "cobrar" | "tomar_pedidos" | "anular_pedidos" | "reembolsar" | "cerrar_caja" | "ver_reportes" | "editar_carta" | "marcar_agotado"
  | "enviar_campanas";

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
  | "inicio" | "mesas" | "pedidos" | "menu" | "caja" | "lealtad" | "campanas" | "trivia" | "reportes"
  | "equipo" | "qr" | "sucursal" | "soporte" | "kds";

const TODAS: SeccionLocal[] = ["inicio", "mesas", "pedidos", "menu", "caja", "lealtad", "campanas", "trivia", "reportes", "equipo", "qr", "sucursal", "soporte", "kds"];

export const SECCIONES_POR_ROL: Record<RolLocal, SeccionLocal[]> = {
  owner: TODAS,
  admin: TODAS,
  manager: ["inicio", "mesas", "pedidos", "menu", "caja", "lealtad", "campanas", "trivia", "reportes", "qr", "soporte", "kds"],
  cashier: ["caja", "pedidos", "mesas"],
  waiter: [],
  kitchen: ["kds"],
};

/** Secciones que dependen de un permiso (fase 6.3): aparecen o desaparecen según lo que el dueño ajustó. */
const SECCION_CON_PERMISO: Partial<Record<SeccionLocal, Permiso>> = {
  inicio: "ver_reportes", reportes: "ver_reportes", menu: "editar_carta", campanas: "enviar_campanas",
};

/** Sin la lista de permisos (todavía cargando), se usan las secciones del rol. */
export const puedeVer = (rol: RolLocal | "superadmin", seccion: SeccionLocal, permisos?: Permiso[]) => {
  if (rol === "superadmin" || rol === "owner" || rol === "admin") return true;
  const permiso = SECCION_CON_PERMISO[seccion];
  if (permiso && permisos) return permisos.includes(permiso);
  return !!SECCIONES_POR_ROL[rol]?.includes(seccion);
};

/** Primera sección del panel para cada rol. */
export const inicioPanel = (rol: RolLocal | "superadmin", permisos?: Permiso[]): SeccionLocal =>
  rol === "cashier" ? "caja" : puedeVer(rol, "inicio", permisos) ? "inicio" : "mesas";

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
    default: return `/admin/${local.slug}/${inicioPanel(local.rol, local.permisos)}`;
  }
}
