import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE } from "../_shared/http.ts";
import * as transbank from "../_shared/pasarelas/transbank.ts";

/**
 * El dueño o el administrador conectan la pasarela de su local (fase 4.1). Primero se prueban las
 * claves contra la pasarela; si funcionan, se guardan cifradas en la bóveda. Tablio nunca guarda una
 * clave sin probarla, y nadie la vuelve a ver (ni el dueño): para cambiarla se conecta de nuevo.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: quien } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    const user = quien?.user;
    if (!user || user.is_anonymous) return json({ error: "Entra con tu cuenta del local" }, 401);

    const body = await req.json().catch(() => ({}));
    const branchId = typeof body?.branch_id === "string" && UUID_RE.test(body.branch_id) ? body.branch_id : "";
    if (!branchId) return json({ error: "Sucursal inválida" }, 400);
    const { data: puede } = await admin.rpc("_puede_configurar_pagos", { _user_id: user.id, _branch_id: branchId });
    if (!puede) return json({ error: "Solo el dueño o el administrador conectan los pagos" }, 403);

    if (body?.proveedor !== "transbank") return json({ error: "Ese medio de pago todavía no está disponible" }, 400);
    const ambiente: transbank.Ambiente = body?.ambiente === "produccion" ? "produccion" : "integracion";
    const usarPrueba = ambiente === "integracion" && body?.usar_claves_de_prueba === true;
    const cred: transbank.CredTransbank = usarPrueba
      ? transbank.TRANSBANK_PRUEBA
      : {
          codigo_comercio: String(body?.codigo_comercio ?? "").replace(/\D/g, ""),
          api_key: String(body?.api_key ?? "").trim(),
        };
    if (!/^\d{12}$/.test(cred.codigo_comercio)) return json({ error: "El código de comercio tiene 12 números" }, 400);
    if (cred.api_key.length < 20 || cred.api_key.length > 200) return json({ error: "Revisa la clave (API Key) que te dio Transbank" }, 400);

    const prueba = await transbank.verificar(ambiente, cred);
    if (prueba.ok === false) return json({ error: prueba.error }, 422);

    const { data, error } = await admin.rpc("_guardar_conexion_pago", {
      _user_id: user.id, _branch_id: branchId, _proveedor: "transbank", _ambiente: ambiente,
      _etiqueta: `Código de comercio ${cred.codigo_comercio}`, _secreto: cred,
    });
    if (error) {
      console.error("guardar conexion", error.message);
      return json({ error: "No se pudo guardar la conexión. Intenta de nuevo." }, 500);
    }
    return json({ conexion: data });
  } catch (e) {
    console.error("conectar-pago", e instanceof Error ? e.message : e);
    return json({ error: "No se pudo conectar. Intenta de nuevo." }, 500);
  }
});
