import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lee .env (URL y clave pública de la base de pruebas).
const env = Object.fromEntries(
  (fs.existsSync(".env") ? fs.readFileSync(".env", "utf-8") : "")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const [k, ...v] = l.split("=");
      return [k.trim(), v.join("=").trim().replace(/^"|"$/g, "")];
    }),
);
export const URL_BASE = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL;
export const CLAVE_PUBLICA = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const FUNCIONES = `${URL_BASE}/functions/v1`;

// Identificadores fijos del demo (scripts/demo/crear_demo.py).
export const DEMO = {
  tenant: "651c363f-0084-50af-9873-be98cfeaaf47",
  sucursal: "aebe7faa-0e29-5aa9-83c2-1e1b336f1554",
  dueno: "ef31bd2e-a16b-56be-a1e0-652c170c516c",
};

export const anonimo = (): SupabaseClient =>
  createClient(URL_BASE, CLAVE_PUBLICA, { auth: { persistSession: false, autoRefreshToken: false } });

// Credenciales del demo (privado/, fuera de git). Sin ellas, las pruebas que las usan se saltan.
const archivo = process.env.DEMO_CREDENCIALES ?? "privado/DEMO_CREDENCIALES.md";
const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf-8") : "";
export const hayCredenciales = texto.length > 0;
const cuentas = Object.fromEntries(
  [...texto.matchAll(/^\| (\w+) \| `([^`]+)` \| `([^`]+)` \|$/gm)].map((m) => [m[1], { correo: m[2], clave: m[3] }]),
);

export async function conSesion(rol: string): Promise<{ cliente: SupabaseClient; token: string }> {
  const c = cuentas[rol];
  if (!c) throw new Error(`No hay credenciales para ${rol}`);
  const cliente = anonimo();
  const { data, error } = await cliente.auth.signInWithPassword({ email: c.correo, password: c.clave });
  if (error || !data.session) throw new Error(`No se pudo entrar como ${rol}: ${error?.message}`);
  return { cliente, token: data.session.access_token };
}

export async function llamarFuncion(nombre: string, cuerpo: unknown, token?: string) {
  const r = await fetch(`${FUNCIONES}/${nombre}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CLAVE_PUBLICA,
      Authorization: `Bearer ${token ?? CLAVE_PUBLICA}`,
    },
    body: JSON.stringify(cuerpo),
  });
  return { status: r.status, cuerpo: await r.text() };
}
