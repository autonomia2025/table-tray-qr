import { Link } from "react-router-dom";
import { VERSION_POLITICA } from "@/lib/privacidad";

// Política de privacidad para comensales (fase 4.5, Ley 21.719). Texto en lenguaje simple.
// Pendiente: revisión de un abogado antes del lanzamiento (ver docs/MASTER_PLAN.md, fase 4).

const Seccion = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-lg font-bold text-foreground">{titulo}</h2>
    <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
  </section>
);

export default function PoliticaPrivacidad() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 bg-background px-5 py-10">
      <div>
        <p className="font-extrabold text-foreground">tablio<span className="text-primary">.</span></p>
        <h1 className="mt-3 text-2xl font-extrabold text-foreground">Política de privacidad</h1>
        <p className="mt-1 text-xs text-muted-foreground">Versión del {VERSION_POLITICA.split("-").reverse().join("-")}</p>
      </div>

      <Seccion titulo="En simple">
        <p>Tablio es la app con la que pides y pagas en la mesa de un local. Guardamos lo mínimo para que tu pedido llegue, tu pago quede registrado y, si guardas tu cuenta, para darte tus sellos.</p>
      </Seccion>

      <Seccion titulo="Qué datos guardamos">
        <p><strong className="text-foreground">Si pides como invitado:</strong> tus pedidos, tus pagos y el nombre que elijas mostrar en la mesa. No te pedimos correo ni teléfono.</p>
        <p><strong className="text-foreground">Si guardas tu cuenta:</strong> además, tu correo y tus sellos y premios en cada local.</p>
        <p><strong className="text-foreground">Pagos:</strong> los datos de tu tarjeta los recibe la pasarela del local (por ejemplo, Webpay). Tablio nunca los ve ni los guarda.</p>
      </Seccion>

      <Seccion titulo="Para qué los usamos">
        <p>Para preparar y entregar tu pedido, registrar tu pago y la propina para el equipo, darte sellos y premios, y mostrarte "lo de siempre". Las promociones solo te llegan si lo aceptas aparte, y puedes cambiarlo cuando quieras.</p>
      </Seccion>

      <Seccion titulo="Quién los ve">
        <p>El local donde pediste ve tus pedidos y pagos de ese local (lo necesita para atenderte y por ley tributaria). Ningún otro local los ve. No vendemos tus datos.</p>
      </Seccion>

      <Seccion titulo="Comunidad y amigos (si la activas)">
        <p>La comunidad viene apagada. Si la activas con tu cuenta, guardamos el nombre que elijas, tu código para que te agreguen, tus amistades, a quién bloqueaste y los reportes que hagas. Tus amigos solo ven ese nombre; nadie ve dónde estás ahora. Los reportes los revisa Tablio y puede suspender un perfil. Si apagas la comunidad, se borran tus amistades; si borras tu cuenta, se borra todo.</p>
      </Seccion>

      <Seccion titulo="Cuánto tiempo">
        <p>Si pides como invitado y no vuelves en 90 días, tu sesión se borra sola. Los registros de pedidos y pagos el local debe guardarlos por ley tributaria; si borras tu cuenta, quedan sin tu nombre.</p>
      </Seccion>

      <Seccion titulo="Tus derechos">
        <p>Puedes ver y descargar tus datos, cambiar si recibes promociones y borrar tu cuenta en cualquier momento, desde "Mi cuenta" en la carta del local. Para cualquier otra solicitud, avísale al local y nos la hará llegar.</p>
      </Seccion>

      <Link to="/" className="inline-block text-sm font-semibold text-primary underline">Volver</Link>
    </main>
  );
}
