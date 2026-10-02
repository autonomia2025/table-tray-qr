// Deja limpio el local de demo: borra pedidos, pagos, sesiones y llamados; libera las mesas.
// Entra como el superadmin del demo (privado/DEMO_CREDENCIALES.md) y llama a reiniciar_demo().
// Uso: bun run demo:reiniciar
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const leer = (ruta) => (fs.existsSync(ruta) ? fs.readFileSync(ruta, "utf-8") : "");
const env = Object.fromEntries(
  leer(".env").split("\n").filter((l) => l.includes("=")).map((l) => {
    const [k, ...v] = l.split("=");
    return [k.trim(), v.join("=").trim().replace(/^"|"$/g, "")];
  }),
);
const url = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const clave = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
const creds = leer(process.env.DEMO_CREDENCIALES ?? "privado/DEMO_CREDENCIALES.md");
const sa = creds.match(/^\| superadmin \| `([^`]+)` \| `([^`]+)` \|$/m);
if (!sa) {
  console.error("No encontré la cuenta superadmin del demo en privado/DEMO_CREDENCIALES.md");
  process.exit(1);
}

const sb = createClient(url, clave, { auth: { persistSession: false } });
const { error: e1 } = await sb.auth.signInWithPassword({ email: sa[1], password: sa[2] });
if (e1) {
  console.error("No pude entrar como superadmin del demo:", e1.message);
  process.exit(1);
}
const { data, error } = await sb.rpc("reiniciar_demo");
if (error) {
  console.error("No se pudo reiniciar el demo:", error.message);
  process.exit(1);
}
console.log(`✅ Demo limpio. Pedidos borrados: ${data.pedidos_borrados}`);
