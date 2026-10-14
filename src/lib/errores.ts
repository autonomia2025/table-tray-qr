// Un solo traductor de errores para lo que ve una persona (regla 10: nunca un error técnico ni en
// inglés). Los mensajes que escribimos en la base (P0001) ya vienen en español y pasan tal cual; el
// resto se traduce o se reemplaza por un texto claro.

const TECNICO = /[a-z]{3,}_[a-z]{3,}|violates|permission denied|JWT|duplicate key|null value|syntax|relation|column|function|schema|constraint|fetch|network|timeout|failed|error|invalid|unexpected|undefined/i;

const ESPANOL = /[áéíóúñ¿¡]|\b(el|la|los|las|de|del|no|un|una|tu|que|para|con|por|es|ya|se|al|lo|hay|este|esta)\b/i;

interface ErrorConCodigo {
  message?: string;
  code?: string;
  status?: number;
}

export function mensajeError(error: unknown, alternativo = "No se pudo hacer el cambio. Intenta de nuevo."): string {
  if (!error) return alternativo;
  const e = (typeof error === "string" ? { message: error } : error) as ErrorConCodigo;
  const texto = (e.message ?? "").trim();

  if (/failed to fetch|networkerror|load failed|network request failed/i.test(texto)) {
    return "Sin conexión. Revisa tu internet e intenta de nuevo.";
  }
  if (/jwt expired|refresh token|not authenticated|invalid jwt/i.test(texto) || e.status === 401) {
    return "Tu sesión se cerró. Vuelve a entrar.";
  }
  if (e.code === "42501" && (!texto || TECNICO.test(texto))) return "No tienes permiso para hacer esto.";
  if (e.code === "23505") return "Eso ya existe. Revisa que no esté repetido.";
  if (e.code === "23503") return "No se puede, porque otra información depende de esto.";
  if (/payload too large|exceeded the maximum allowed size|too large/i.test(texto)) return "El archivo es muy grande.";
  if (/mime type|invalid file type/i.test(texto)) return "Ese tipo de archivo no se puede subir.";

  // Mensajes nuestros (en español, sin jerga técnica) pasan tal cual; uno en inglés, no
  if (texto && !TECNICO.test(texto) && ESPANOL.test(texto)) return texto;
  return alternativo;
}
