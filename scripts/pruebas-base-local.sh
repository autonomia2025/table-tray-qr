#!/usr/bin/env bash
# Corre TODAS las pruebas contra una base desechable (Supabase local en Docker):
#  1. reconstruye la base desde cero con las migraciones del repositorio (detecta cambios manuales);
#  2. carga el local de demo y "Local Ajeno" con contraseñas nuevas;
#  3. corre las pruebas de seguridad y las de navegador contra esa base.
# Requisito: Docker andando y `supabase start` ya levantado.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d /opt/homebrew/opt/postgresql@18/bin ] && export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"

echo "▶ Reconstruyendo la base local desde cero…"
supabase db reset --local --no-seed >/dev/null

eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|DB_URL)=' | sed 's/^/export /')"

DIR=.pruebas-local
rm -rf "$DIR"
python3 scripts/demo/crear_demo.py --salida "$DIR" --local-ajeno >/dev/null
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$DIR/demo_seed.sql" >/dev/null
echo "▶ Demo y Local Ajeno cargados"

export VITE_SUPABASE_URL="$API_URL"
export VITE_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY"
export VITE_SUPABASE_PROJECT_ID="local"
export DEMO_CREDENCIALES="$DIR/DEMO_CREDENCIALES.md"
export E2E_BASE_DATOS="local"
export E2E_PORT="${E2E_PORT:-8090}"
export E2E_SUPABASE_REF="127.0.0.1"

echo "▶ Pruebas de seguridad"
bun run test:seguridad
echo "▶ Pruebas de navegador"
bunx playwright test
