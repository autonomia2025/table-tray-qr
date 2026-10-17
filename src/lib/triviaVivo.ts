import { supabase } from "@/integrations/supabase/client";

// Noche de trivia en vivo (fase 8.4): la base decide todo (preguntas, tiempo y puntaje). La correcta nunca llega
// al celular antes de que termine la pregunta.

export interface TriviaVivo {
  id: string;
  estado: "esperando" | "pregunta" | "resultado" | "terminada";
  actual: number;
  total: number;
  segundos: number;
  quedan: number | null;
  pregunta: { texto: string; opciones: string[]; tema: string; correcta: number | null } | null;
  respondieron: number;
  ranking: { alias: string; mesa: number | null; puntos: number; aciertos: number; yo: boolean }[];
  mi_respuesta?: { opcion: number; correcta: boolean | null; puntos: number | null } | null;
  mis_puntos?: number | null;
}

export async function pantallaTrivia(sucursal: string): Promise<TriviaVivo | null> {
  const { data } = await supabase.rpc("pantalla_trivia_vivo", { _branch_id: sucursal });
  return (data ?? null) as unknown as TriviaVivo | null;
}

export async function crearTrivia(sucursal: string, preguntas: number, segundos: number) {
  return supabase.rpc("crear_trivia_vivo", { _branch_id: sucursal, _preguntas: preguntas, _segundos: segundos });
}

export async function avanzarTrivia(id: string) {
  return supabase.rpc("avanzar_trivia_vivo", { _trivia_id: id });
}

export async function terminarTrivia(id: string) {
  return supabase.rpc("terminar_trivia_vivo", { _trivia_id: id });
}

export async function triviaDeMiMesa(qr: string): Promise<TriviaVivo | null> {
  const { data, error } = await supabase.rpc("trivia_vivo_mesa", { _qr_token: qr });
  if (error) return null;
  return (data ?? null) as unknown as TriviaVivo | null;
}

export async function responderTrivia(qr: string, id: string, numero: number, opcion: number) {
  return supabase.rpc("responder_trivia_vivo", { _qr_token: qr, _trivia_id: id, _numero: numero, _opcion: opcion });
}

export const LETRAS = ["A", "B", "C", "D", "E", "F"];
