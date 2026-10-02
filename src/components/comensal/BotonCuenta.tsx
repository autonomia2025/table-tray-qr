import { useState } from "react";
import { Gift } from "lucide-react";
import { useSesion } from "@/contexts/SesionContext";
import CuentaComensal from "@/components/comensal/CuentaComensal";

/** Botón de cuenta en la carta: "Sellos" para el invitado, inicial del correo para el cliente. */
export default function BotonCuenta({ nombreLocal, color }: { nombreLocal: string; color: string }) {
  const { perfil } = useSesion();
  const [abierto, setAbierto] = useState(false);
  const registrado = !!perfil && !perfil.es_anonimo && !!perfil.email;

  return (
    <>
      {registrado ? (
        <button
          onClick={() => setAbierto(true)}
          aria-label="Mi cuenta"
          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {perfil?.email?.charAt(0).toUpperCase()}
        </button>
      ) : (
        <button
          onClick={() => setAbierto(true)}
          className="flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold"
          style={{ backgroundColor: `${color}18`, color }}
        >
          <Gift className="h-3.5 w-3.5" />
          Sellos
        </button>
      )}
      <CuentaComensal abierto={abierto} onCambiar={setAbierto} nombreLocal={nombreLocal} color={color} />
    </>
  );
}
