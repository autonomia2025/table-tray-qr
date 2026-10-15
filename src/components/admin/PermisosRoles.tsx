import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { NOMBRE_ROL } from "@/lib/roles";
import { guardarPermiso, permisosDelLocal, ROLES_AJUSTABLES, type FilaPermiso, type RolAjustable } from "@/lib/permisos";

/**
 * Permisos por rol (fase 6.3): el dueño o el administrador eligen qué puede hacer cada rol. Lo que no se le
 * puede dar a un rol (por ejemplo, devolver plata al mozo) no tiene interruptor. La base lo hace cumplir.
 */
export default function PermisosRoles({ tenantId }: { tenantId: string }) {
  const { toast } = useToast();
  const [filas, setFilas] = useState<FilaPermiso[]>([]);
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => setFilas(await permisosDelLocal(tenantId)), [tenantId]);
  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = async (fila: FilaPermiso, rol: RolAjustable, permitido: boolean) => {
    const llave = `${fila.permiso}-${rol}`;
    setGuardando(llave);
    const r = await guardarPermiso(tenantId, rol, fila.permiso, permitido);
    setGuardando(null);
    if (r.ok === false) { toast({ title: "No se pudo guardar", description: r.error, variant: "destructive" }); return; }
    toast({ title: permitido ? "Permiso dado" : "Permiso quitado", description: `${NOMBRE_ROL[rol]}: ${fila.nombre.toLowerCase()}. Rige desde que vuelvan a abrir la app.` });
    cargar();
  };

  if (!filas.length) return null;
  return (
    <div className="rounded-2xl border bg-card p-4" data-testid="permisos-roles">
      <p className="flex items-center gap-1.5 font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-primary" /> Permisos por rol</p>
      <p className="text-xs text-muted-foreground">Elige qué puede hacer cada rol. El dueño y el administrador siempre pueden todo. Lo que no tiene interruptor no se le puede dar a ese rol.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">Permiso</th>
              {ROLES_AJUSTABLES.map((r) => <th key={r} className="px-2 py-2 text-center font-medium">{NOMBRE_ROL[r]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {filas.map((f) => (
              <tr key={f.permiso}>
                <td className="py-2.5 pr-3">
                  <p className="font-medium text-foreground">{f.nombre}</p>
                  <p className="text-xs text-muted-foreground">{f.descripcion}</p>
                </td>
                {ROLES_AJUSTABLES.map((r) => {
                  const celda = f.roles[r];
                  return (
                    <td key={r} className="px-2 py-2.5 text-center">
                      {celda.posible ? (
                        <Switch
                          aria-label={`${f.nombre} · ${NOMBRE_ROL[r]}`}
                          checked={celda.permitido}
                          disabled={guardando === `${f.permiso}-${r}`}
                          onCheckedChange={(v) => cambiar(f, r, v)}
                        />
                      ) : (
                        <span className="text-muted-foreground" aria-label="No disponible">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
