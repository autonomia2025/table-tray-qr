import { Link, useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContenidoGuia } from "@/components/GuiaRapida";
import { GUIAS, type RolGuia } from "@/lib/guias";

/**
 * Guía imprimible por rol (fase 5.5), para que el dueño se la entregue a su equipo el primer día.
 * Sin datos de ningún local: es la misma para todos.
 */
export default function AyudaPage() {
  const { rol = "mozo" } = useParams<{ rol: string }>();
  const g = GUIAS[rol as RolGuia];
  if (!g) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <p className="text-sm text-muted-foreground">No encontramos esa guía.</p>
        <Otras />
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-extrabold text-foreground">tablio<span className="text-primary">.</span></p>
            <h1 className="mt-1 text-2xl font-extrabold text-foreground">Guía para {g.nombre.toLowerCase()}</h1>
          </div>
          <Button variant="outline" onClick={() => window.print()} className="print:hidden"><Printer className="mr-1.5 h-4 w-4" /> Imprimir</Button>
        </div>
        <ContenidoGuia rol={g.rol} />
        <div className="print:hidden"><Otras /></div>
      </div>
    </div>
  );
}

function Otras() {
  return (
    <p className="mt-8 text-sm text-muted-foreground">
      Otras guías:{" "}
      {Object.values(GUIAS).map((x, i) => (
        <span key={x.rol}>{i > 0 && " · "}<Link to={`/ayuda/${x.rol}`} className="font-semibold text-primary underline">{x.nombre}</Link></span>
      ))}
    </p>
  );
}
