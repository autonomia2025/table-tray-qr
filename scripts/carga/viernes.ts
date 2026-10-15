/**
 * Prueba de carga "un viernes lleno" (fase 5.3). SOLO contra la base desechable de este computador.
 *
 * Arma un local de prueba (40 mesas, carta de 20 platos, cobros simulados) y suelta comensales virtuales:
 * cada uno entra por el QR de una mesa, mira la carta, pide y paga en rondas (con pausas como una persona) y
 * mira su mesa en vivo. Al mismo tiempo hay pantallas escuchando en vivo (cocina, mozos y caja) y una cocina
 * que avanza los pedidos. Mide cuánto tarda cada paso, cuántos fallan y cuánto demora un pedido pagado en
 * aparecer en la pantalla de cocina.
 *
 * Uso: COMENSALES=150 RONDAS=2 PANTALLAS=8 bun scripts/carga/viernes.ts
 * (necesita las variables de la base local, como `bun run test:local`, y .pruebas-local/DEMO_CREDENCIALES.md)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const URL = process.env.VITE_SUPABASE_URL ?? "";
const CLAVE = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const COMENSALES = Number(process.env.COMENSALES ?? 100);
const RONDAS = Number(process.env.RONDAS ?? 2);
const PANTALLAS = Number(process.env.PANTALLAS ?? 8);
const PAUSA_MS = Number(process.env.PAUSA_MS ?? 3000);
const SALIDA = process.env.SALIDA ?? "";

if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL)) {
  console.error("La prueba de carga corre solo contra la base de este computador (nunca contra la real).");
  process.exit(1);
}
const credenciales = fs.readFileSync(process.env.DEMO_CREDENCIALES ?? ".pruebas-local/DEMO_CREDENCIALES.md", "utf-8");
const cuenta = (rol: string) => {
  const m = credenciales.match(new RegExp(`^\\| ${rol} \\| \`([^\`]+)\` \\| \`([^\`]+)\` \\|$`, "m"));
  if (!m) throw new Error(`Falta la cuenta ${rol}`);
  return { email: m[1], password: m[2] };
};
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const cliente = () => createClient(URL, CLAVE, { auth: { persistSession: false, autoRefreshToken: false } });
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const azar = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

// ── Medición ────────────────────────────────────────────────────────────────
const tiempos: Record<string, number[]> = {};
const errores: Record<string, Record<string, number>> = {};
async function medir<T>(paso: string, fn: () => Promise<T>, ok: (r: T) => boolean, motivo: (r: T) => string): Promise<T | null> {
  const t0 = performance.now();
  try {
    const r = await fn();
    const ms = performance.now() - t0;
    if (ok(r)) { (tiempos[paso] ??= []).push(ms); return r; }
    const m = motivo(r).slice(0, 90);
    ((errores[paso] ??= {})[m] = (errores[paso][m] ?? 0) + 1);
    return null;
  } catch (e) {
    const m = (e instanceof Error ? e.message : String(e)).slice(0, 90);
    ((errores[paso] ??= {})[m] = (errores[paso][m] ?? 0) + 1);
    return null;
  }
}
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return Math.round(o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))]);
};

// ── 1. El local de carga ────────────────────────────────────────────────────
async function prepararLocal() {
  const sa = cliente();
  await sa.auth.signInWithPassword(cuenta("superadmin"));
  const id = Date.now().toString(36);
  const correo = `carga-${id}@demo.tablio.test`;
  const { data, error } = await sa.rpc("crear_local", { _nombre: `Bar de Carga ${id}`, _slug: `bar-carga-${id}`, _correo_dueno: correo, _mesas: 40 });
  if (error) throw new Error(`No se pudo crear el local de carga: ${error.message}`);
  const local = data as { tenant_id: string; branch_id: string; token: string; slug: string };
  const act = await fetch(`${URL}/functions/v1/activar-local`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: CLAVE },
    body: JSON.stringify({ token: local.token, nombre: "Dueño de Carga", password: "clave-de-carga-123" }),
  });
  if (!act.ok) throw new Error(`No se pudo activar el local de carga (${act.status})`);
  const dueno = cliente();
  await dueno.auth.signInWithPassword({ email: correo, password: "clave-de-carga-123" });
  const platos = ["Schop Kunstmann", "Schop Austral", "Pisco sour", "Mojito", "Piscola", "Agua mineral", "Bebida", "Limonada",
    "Papas fritas", "Empanaditas de queso", "Chorrillana", "Barros Luco", "Churrasco", "Ceviche", "Tabla de quesos",
    "Alitas BBQ", "Nachos", "Hamburguesa", "Brownie", "Helado"];
  const r = await dueno.rpc("importar_carta", { _branch_id: local.branch_id, _lineas: platos.map((nombre, i) => ({
    categoria: i < 8 ? "Para tomar" : i < 18 ? "Para comer" : "Postres", nombre, precio: 2000 + (i % 7) * 1500 })) });
  if (r.error) throw new Error(`No se pudo cargar la carta: ${r.error.message}`);
  // Solo en esta base: cobros simulados y local abierto en prepago
  sql(`UPDATE branches SET pagos_simulados = true, is_open = true, payment_mode = 'prepaid' WHERE id = '${local.branch_id}'`);
  const mesas = sql(`SELECT string_agg(qr_token, ',') FROM tables WHERE branch_id = '${local.branch_id}'`).split(",");
  const items = sql(`SELECT string_agg(mi.id::text, ',') FROM menu_items mi JOIN categories c ON c.id = mi.category_id JOIN menus m ON m.id = c.menu_id WHERE m.branch_id = '${local.branch_id}'`).split(",");
  return { ...local, dueno, mesas, items };
}

// ── 2. Pantallas en vivo (cocina, mozos, caja) ──────────────────────────────
async function pantallas(local: Awaited<ReturnType<typeof prepararLocal>>, pagados: Map<string, number>) {
  const llegadas: number[] = [];
  const canales: { cliente: SupabaseClient; listo: Promise<void> }[] = [];
  for (let i = 0; i < PANTALLAS; i++) {
    const c = cliente();
    // Todas usan la sesión del dueño (ve todo lo del local, como cocina, mozo o caja)
    const { data: s } = await local.dueno.auth.getSession();
    await c.realtime.setAuth(s.session!.access_token);
    const listo = new Promise<void>((resolver) => {
      c.channel(`carga-${i}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `branch_id=eq.${local.branch_id}` }, (p) => {
          const pedido = (p.new as { id?: string })?.id;
          if (i === 0 && pedido && pagados.has(pedido)) {
            llegadas.push(performance.now() - pagados.get(pedido)!);
            pagados.delete(pedido);
          }
        })
        .subscribe((estado) => { if (estado === "SUBSCRIBED") resolver(); });
    });
    canales.push({ cliente: c, listo });
  }
  await Promise.race([Promise.all(canales.map((x) => x.listo)), dormir(15000)]);
  return { llegadas, cerrar: () => Promise.all(canales.map((x) => x.cliente.removeAllChannels())) };
}

// ── 3. Un comensal ──────────────────────────────────────────────────────────
async function comensal(n: number, local: Awaited<ReturnType<typeof prepararLocal>>, pagados: Map<string, number>, pedidos: string[]) {
  await dormir(Math.random() * PAUSA_MS * 2); // no llegan todos al mismo milisegundo
  const c = cliente();
  if (!(await medir("entrar como invitado", () => c.auth.signInAnonymously(), (r) => !r.error, (r) => r.error!.message))) return;
  const qr = local.mesas[n % local.mesas.length];
  if (!(await medir("unirse a la mesa", () => c.rpc("unirse_a_mesa", { _qr_token: qr }), (r) => !r.error, (r) => r.error!.message))) return;
  await medir("ver la carta", () => c.from("menu_items").select("id, name, price, status").eq("tenant_id", local.tenant_id), (r) => !r.error, (r) => r.error!.message);
  const token = (await c.auth.getSession()).data.session!.access_token;
  for (let ronda = 0; ronda < RONDAS; ronda++) {
    await dormir(PAUSA_MS / 2 + Math.random() * PAUSA_MS);
    const carrito = [{ menu_item_id: azar(local.items), quantity: 1 + Math.floor(Math.random() * 2) }, { menu_item_id: azar(local.items), quantity: 1 }];
    const pago = await medir("pedir y pagar", async () => {
      const r = await fetch(`${URL}/functions/v1/process-payment`, {
        method: "POST", headers: { "Content-Type": "application/json", apikey: CLAVE, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ table_token: qr, method: "card", tip_amount: 500, cart_items: carrito, idempotency_key: `carga-${n}-${ronda}-${Date.now()}` }),
      });
      return { status: r.status, cuerpo: await r.json().catch(() => ({})) as { order?: { id: string }; error?: string } };
    }, (r) => r.status === 200 && !!r.cuerpo.order, (r) => `${r.status} ${r.cuerpo.error ?? ""}`);
    if (pago?.cuerpo.order) { pagados.set(pago.cuerpo.order.id, performance.now()); pedidos.push(pago.cuerpo.order.id); }
    await medir("ver su mesa en vivo", () => c.rpc("mi_mesa_en_vivo", { _qr_token: qr }), (r) => !r.error, (r) => r.error!.message);
  }
  if (Math.random() < 0.15) {
    await medir("llamar al mozo", () => c.rpc("llamar_mozo", { _qr_token: qr, _motivo: "Necesito ayuda" }), (r) => !r.error, (r) => r.error!.message);
  }
}

// ── 4. La cocina avanza los pedidos ─────────────────────────────────────────
async function cocina(local: Awaited<ReturnType<typeof prepararLocal>>, pedidos: string[], hasta: () => boolean) {
  while (!hasta() || pedidos.length) {
    const id = pedidos.shift();
    if (!id) { await dormir(200); continue; }
    await medir("cocina: en preparación", () => local.dueno.rpc("cambiar_estado_pedido", { _order_id: id, _estado: "in_kitchen" }), (r) => !r.error, (r) => r.error!.message);
    await medir("cocina: listo", () => local.dueno.rpc("cambiar_estado_pedido", { _order_id: id, _estado: "ready" }), (r) => !r.error, (r) => r.error!.message);
  }
}

// Después de la carga, las tres auditorías tienen que seguir vacías
async function auditorias() {
  const sa = cliente();
  await sa.auth.signInWithPassword(cuenta("superadmin"));
  const salida: Record<string, number> = {};
  for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"]) {
    const { data, error } = await sa.rpc(fn);
    salida[fn] = error ? -1 : ((data as unknown[]) ?? []).length;
  }
  return salida;
}

async function main() {
  console.log(`Preparando el local de carga…`);
  const local = await prepararLocal();
  const pagados = new Map<string, number>();
  const pedidos: string[] = [];
  const vivo = await pantallas(local, pagados);
  console.log(`Local listo (40 mesas, 20 platos). ${PANTALLAS} pantallas en vivo. Entran ${COMENSALES} comensales, ${RONDAS} rondas cada uno…`);
  const t0 = performance.now();
  let terminaron = false;
  const enCocina = cocina(local, pedidos, () => terminaron);
  await Promise.all(Array.from({ length: COMENSALES }, (_, i) => comensal(i, local, pagados, pedidos)));
  terminaron = true;
  await enCocina;
  await dormir(3000); // últimas llegadas a las pantallas
  const segundos = (performance.now() - t0) / 1000;
  await vivo.cerrar();

  const resumen = {
    comensales: COMENSALES, rondas: RONDAS, pantallas: PANTALLAS, segundos: Math.round(segundos),
    pagos_por_minuto: Math.round(((tiempos["pedir y pagar"]?.length ?? 0) / segundos) * 60),
    pasos: Object.fromEntries(Object.entries(tiempos).map(([k, xs]) => [k, { ok: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), errores: Object.values(errores[k] ?? {}).reduce((a, b) => a + b, 0) }])),
    errores,
    pantalla_cocina: { llegaron: vivo.llegadas.length, sin_llegar: pagados.size, p50: pct(vivo.llegadas, 50), p95: pct(vivo.llegadas, 95), p99: pct(vivo.llegadas, 99) },
    auditorias: await auditorias(),
  };
  console.log(JSON.stringify(resumen, null, 2));
  if (SALIDA) fs.writeFileSync(SALIDA, JSON.stringify(resumen, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
