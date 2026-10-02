import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSesion } from "@/contexts/SesionContext";
import CuentaComensal from "@/components/comensal/CuentaComensal";

/**
 * Sellos de fidelización en el pago (fase 1.3).
 * Cliente registrado: ve su progreso y puede canjear premios. Invitado: puede guardar su cuenta.
 * Los sellos se suman en el servidor, solo con la cuenta verificada del cliente (DIAGNOSTICO N4).
 */

interface EstadoSellos {
  program: { type: "stamps" | "points"; goal_visits: number; points_goal: number; reward_description: string } | null;
  customer: { visits: number; points: number } | null;
  rewards: Array<{ id: string; description: string }>;
}

interface Props {
  tenantId?: string;
  branchId?: string;
  nombreLocal: string;
  color: string;
  premioElegido: string | null;
  onElegirPremio: (id: string | null) => void;
}

export default function BloqueSellos({ tenantId, branchId, nombreLocal, color, premioElegido, onElegirPremio }: Props) {
  const { perfil } = useSesion();
  const registrado = !!perfil && !perfil.es_anonimo && !!perfil.email;
  const [cuentaAbierta, setCuentaAbierta] = useState(false);

  const { data: estado } = useQuery<EstadoSellos | null>({
    queryKey: ["sellos", tenantId, branchId, perfil?.user_id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("loyalty-status", {
        body: { tenant_id: tenantId, branch_id: branchId },
      });
      if (error) return null;
      return data as EstadoSellos;
    },
    enabled: !!tenantId && registrado,
    staleTime: 30_000,
  });

  const programa = estado?.program;
  const visitas = estado?.customer?.visits ?? 0;

  return (
    <>
      <div className="mb-4 rounded-2xl border border-border bg-card p-4">
        {registrado ? (
          <>
            <div className="flex items-center gap-2">
              <Gift className="h-4 w-4" style={{ color }} />
              <span className="text-sm font-bold text-card-foreground">
                {programa ? "Sumas un sello con este pago" : "Tu cuenta"}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{perfil?.email}</p>

            {programa?.type === "stamps" && (
              <>
                <div className="mt-3 flex gap-1.5">
                  {Array.from({ length: programa.goal_visits }).map((_, i) => (
                    <div
                      key={i}
                      className="flex h-7 flex-1 items-center justify-center rounded-lg text-[10px] font-bold"
                      style={{
                        backgroundColor: i < visitas % programa.goal_visits ? color : "hsl(var(--muted))",
                        color: i < visitas % programa.goal_visits ? "#fff" : "hsl(var(--muted-foreground))",
                      }}
                    >
                      {i + 1}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Te faltan {programa.goal_visits - (visitas % programa.goal_visits)} para <strong>{programa.reward_description}</strong>
                </p>
              </>
            )}
            {programa?.type === "points" && (
              <p className="mt-2 text-xs font-semibold text-foreground">
                {estado?.customer?.points ?? 0} de {programa.points_goal} puntos para {programa.reward_description}
              </p>
            )}

            {estado?.rewards?.length ? (
              <div className="mt-3 space-y-2">
                {estado.rewards.map((r) => {
                  const activo = premioElegido === r.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => onElegirPremio(activo ? null : r.id)}
                      className="flex w-full items-center justify-between rounded-xl border-2 px-3 py-2.5 text-left"
                      style={{ borderColor: activo ? color : "hsl(var(--border))", backgroundColor: activo ? `${color}12` : "transparent" }}
                    >
                      <span className="text-xs font-semibold text-foreground">🎁 {r.description}</span>
                      <span className="text-[11px] text-muted-foreground">{activo ? "Se canjea ahora" : "Canjear"}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : (
          <button onClick={() => setCuentaAbierta(true)} className="flex w-full items-center gap-3 text-left">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}18` }}>
              <Gift className="h-5 w-5" style={{ color }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-card-foreground">Guarda tus sellos</p>
              <p className="text-[11px] text-muted-foreground">Junta visitas en {nombreLocal} y gana premios. Toma 10 segundos.</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>
      <CuentaComensal abierto={cuentaAbierta} onCambiar={setCuentaAbierta} nombreLocal={nombreLocal} color={color} />
    </>
  );
}
