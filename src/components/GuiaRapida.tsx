import { HelpCircle, Printer } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { GUIAS, type RolGuia } from "@/lib/guias";

/**
 * Guía rápida (fase 5.5): un botón "?" en la pantalla de cada rol que abre su guía corta, con los mismos
 * nombres de botones que ve en la app, y un enlace para imprimirla.
 */
export function ContenidoGuia({ rol }: { rol: RolGuia }) {
  const g = GUIAS[rol];
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{g.intro}</p>
      <ol className="space-y-3">
        {g.pasos.map((p, i) => (
          <li key={p.titulo} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{p.titulo}</p>
              <p className="text-sm text-muted-foreground">{p.texto}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="rounded-xl border bg-muted/40 p-3">
        <p className="mb-2 text-sm font-bold text-foreground">Si algo falla</p>
        <ul className="space-y-2">
          {g.siFalla.map((p) => (
            <li key={p.titulo} className="text-sm"><span className="font-semibold text-foreground">{p.titulo}.</span> <span className="text-muted-foreground">{p.texto}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function GuiaRapida({ rol, className = "" }: { rol: RolGuia; className?: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button type="button" aria-label="Cómo se usa" title="Cómo se usa" className={`p-2 text-muted-foreground hover:text-foreground ${className}`}>
          <HelpCircle className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Cómo se usa: {GUIAS[rol].nombre}</SheetTitle>
          <SheetDescription className="sr-only">Guía corta para tu rol</SheetDescription>
        </SheetHeader>
        <div className="mt-4"><ContenidoGuia rol={rol} /></div>
        <a href={`/ayuda/${rol}`} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline">
          <Printer className="h-4 w-4" /> Abrir para imprimir
        </a>
      </SheetContent>
    </Sheet>
  );
}
