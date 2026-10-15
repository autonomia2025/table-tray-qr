#!/usr/bin/env bash
# Prueba de carga "un viernes lleno" (fase 5.3) contra la base desechable de este computador.
# Requisito: `supabase start` levantado y el demo cargado (`bun run test:local` lo deja así).
# Uso: bun run carga            (50, 150 y 300 comensales)
#      COMENSALES=80 bun run carga
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -d /opt/homebrew/opt/postgresql@18/bin ] && export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|DB_URL)=' | sed 's/^/export /')"
export VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY"
export DEMO_CREDENCIALES="${DEMO_CREDENCIALES:-.pruebas-local/DEMO_CREDENCIALES.md}"
for n in ${COMENSALES:-50 150 300}; do
  echo "▶ $n comensales"
  COMENSALES=$n RONDAS="${RONDAS:-2}" PANTALLAS="${PANTALLAS:-10}" bun scripts/carga/viernes.ts
done
