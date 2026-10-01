import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Eres el asistente virtual de soporte de tablio, un software de gestión para restaurantes. Tu nombre es "Soporte tablio".

Información del software tablio:
- tablio es un sistema de gestión integral para restaurantes que incluye: menú digital con QR, gestión de mesas, pedidos en tiempo real, panel de cocina (KDS), panel de mozos, reportes y análisis.
- Los clientes escanean un código QR en la mesa para ver el menú, hacer pedidos y pedir la cuenta.
- El panel de administración permite gestionar mesas, menú, equipo (mozos), ver reportes de ventas, y configurar la sucursal.
- El KDS (Kitchen Display System) muestra los pedidos en cocina en tiempo real.
- Los mozos tienen su propia app donde ven las mesas asignadas, pedidos listos para entregar, y solicitudes de cuenta.
- Los reportes incluyen: ventas, pedidos, mesas, equipo, menú y clientes.
- Se pueden generar códigos QR personalizados por mesa.
- El sistema soporta modificadores de productos (extras, opciones), categorías de menú, y estados de stock.
- Los precios están en pesos chilenos (CLP).
- El contacto de soporte humano es: +56938959429
- Para problemas técnicos graves, recomienda contactar al número de soporte directamente.

Reglas:
- Responde siempre en español.
- Sé amable, conciso y útil.
- Si no sabes algo, sugiere contactar al soporte humano al +56938959429.
- No inventes funcionalidades que no existen.
- Puedes ayudar con: uso del panel admin, configuración de menú, gestión de mesas, reportes, problemas comunes, y dudas generales sobre el software.`;

// Antes usaba el gateway de IA de Lovable (LOVABLE_API_KEY). Ahora usa Claude Haiku 4.5
// con el SDK oficial de Anthropic (ANTHROPIC_API_KEY). La pantalla de soporte espera
// el formato de streaming "OpenAI" (choices[0].delta.content y [DONE]), así que la
// función traduce cada trozo de texto a ese formato y la pantalla no cambia.
const MODEL = "claude-haiku-4-5";

const jsonError = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY no está configurada");

    // La API de Claude solo acepta turnos de usuario y asistente con texto.
    const history: Anthropic.MessageParam[] = (Array.isArray(messages) ? messages : [])
      .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    if (history.length === 0 || history[0].role !== "user") {
      return jsonError("Escribe tu consulta para comenzar.", 400);
    }

    const client = new Anthropic({ apiKey });
    const stream = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: history,
      stream: true,
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send(JSON.stringify({ choices: [{ delta: { content: event.delta.text } }] }));
            }
          }
          send("[DONE]");
        } catch (e) {
          console.error("support-chat stream error:", e);
          send(JSON.stringify({ choices: [{ delta: { content: "\n\nSe cortó la respuesta. Intenta de nuevo." } }] }));
          send("[DONE]");
        } finally {
          controller.close();
        }
      },
    });

    return new Response(body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return jsonError("Demasiadas solicitudes, intenta de nuevo en unos segundos.", 429);
    }
    if (e instanceof Anthropic.APIError) {
      console.error("support-chat API error:", e.status, e.message);
      return jsonError("Servicio no disponible temporalmente.", 502);
    }
    console.error("support-chat error:", e);
    return jsonError("Error en el servicio de IA", 500);
  }
});
