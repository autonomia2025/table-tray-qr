import { useCallback, useEffect, useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { entregarPremio, premiosEnMesa, type PremioMesa } from "@/lib/sellos";

/**
 * Premios de lealtad por entregar a los clientes de esta mesa (fase 3.7). El cliente muestra el código
 * en su celular y el mozo lo escribe: así nadie marca entregado un premio sin el cliente presente.
 */
export default function PremiosMesa({ mesaId }: { mesaId: string }) {
  const { toast } = useToast();
  const [premios, setPremios] = useState<PremioMesa[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => setPremios(await premiosEnMesa(mesaId)), [mesaId]);
  useEffect(() => { cargar(); }, [cargar]);

  const entregar = async (id: string) => {
    setEnviando(true);
    const r = await entregarPremio(id, codigo);
    setEnviando(false);
    if (r.ok === false) {
      toast({ title: "No se pudo entregar", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: `Entregado: ${r.dato.descripcion}` });
    setAbierto(null);
    setCodigo("");
    cargar();
  };

  if (premios.length === 0) return null;
  return (
    <div className="mb-4 rounded-xl border border-primary/30 bg-accent p-3" data-testid="premios-mesa">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-foreground">
        <Gift className="h-4 w-4 text-primary" /> {premios.length === 1 ? "Un premio para entregar" : `${premios.length} premios para entregar`}
      </p>
      <div className="space-y-2">
        {premios.map((p) => (
          <div key={p.id} className="rounded-lg bg-background p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{p.descripcion}</p>
                <p className="text-[11px] text-muted-foreground">{p.alias ? `Para ${p.alias}` : "Para un cliente de la mesa"}</p>
              </div>
              {abierto !== p.id && (
                <Button size="sm" variant="outline" onClick={() => { setAbierto(p.id); setCodigo(""); }}>Entregar</Button>
              )}
            </div>
            {abierto === p.id && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  autoFocus
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.toUpperCase().slice(0, 4))}
                  placeholder="Código del cliente"
                  aria-label="Código del premio"
                  className="h-9 font-mono uppercase tracking-[0.3em]"
                />
                <Button size="sm" disabled={codigo.length !== 4 || enviando} onClick={() => entregar(p.id)}>
                  {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">El cliente te muestra el código en su celular.</p>
    </div>
  );
}
