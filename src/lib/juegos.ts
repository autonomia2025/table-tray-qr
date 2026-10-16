import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";

// Juegos en la mesa (fase 7.8): la trivia la corrige el servidor (las respuestas correctas nunca llegan al
// celular antes de responder) y la ruleta la sortea el servidor. Ninguno mueve plata.

export interface PreguntaTrivia { id: string; pregunta: string; opciones: string[] }
export interface PartidaTrivia { partida: string; preguntas: PreguntaTrivia[] }
export interface ResultadoTrivia { puntaje: number; de: number; correctas: number[] }

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };

export async function empezarTrivia(token: string): Promise<Resultado<PartidaTrivia>> {
  const { data, error } = await supabase.rpc("empezar_trivia", { _qr_token: token });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as unknown as PartidaTrivia };
}

export async function responderTrivia(token: string, partida: string, respuestas: number[]): Promise<Resultado<ResultadoTrivia>> {
  const { data, error } = await supabase.rpc("responder_trivia", { _qr_token: token, _partida: partida, _respuestas: respuestas });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as unknown as ResultadoTrivia };
}

export async function girarRuleta(token: string): Promise<Resultado<{ elegido: string; soy_yo: boolean }>> {
  const { data, error } = await supabase.rpc("girar_ruleta", { _qr_token: token });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as unknown as { elegido: string; soy_yo: boolean } };
}
