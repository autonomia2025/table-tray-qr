import { supabase } from "@/integrations/supabase/client";
import { mensajeError } from "@/lib/errores";

// Privacidad del comensal (fase 4.5, Ley 21.719): ver y descargar sus datos, elegir si recibe
// promociones y borrar su cuenta. Los registros de plata del local quedan, sin su nombre.

export const VERSION_POLITICA = "2026-10-17";

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };

export async function misDatos(): Promise<Resultado<Record<string, unknown>>> {
  const { data, error } = await supabase.rpc("mis_datos");
  if (error) return { ok: false, error: mensajeError(error) };
  return { ok: true, dato: data as Record<string, unknown> };
}

/** Descarga un archivo con todo lo que Tablio guarda de la persona. */
export async function descargarMisDatos(): Promise<Resultado<null>> {
  const r = await misDatos();
  if (r.ok === false) return r;
  const blob = new Blob([JSON.stringify(r.dato, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mis-datos-tablio-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
  return { ok: true, dato: null };
}

export async function miConsentimiento(): Promise<{ promociones: boolean } | null> {
  const { data } = await supabase.from("consentimientos_comensal").select("promociones").maybeSingle();
  return data ? { promociones: data.promociones } : null;
}

export async function guardarConsentimiento(promociones: boolean): Promise<Resultado<null>> {
  const { error } = await supabase.rpc("guardar_consentimiento", { _promociones: promociones });
  if (error) return { ok: false, error: mensajeError(error) };
  return { ok: true, dato: null };
}

export async function borrarMiCuenta(): Promise<Resultado<null>> {
  const { error } = await supabase.functions.invoke("borrar-mi-cuenta", { body: { confirmar: true } });
  if (error) {
    const cuerpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
    return { ok: false, error: mensajeError({ message: cuerpo?.error }, "No pudimos borrar tu cuenta. Intenta de nuevo.") };
  }
  return { ok: true, dato: null };
}
