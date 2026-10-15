// Guías de capacitación (fase 5.5): cortas, por rol, con los nombres exactos de los botones de la app.
// Una prueba (guias.test.ts) revisa que cada botón nombrado entre «comillas» exista en el código: si se
// cambia un texto de la app, la guía avisa que quedó desactualizada.

export type RolGuia = "dueno" | "caja" | "mozo" | "cocina";

export interface Paso { titulo: string; texto: string }
export interface Guia { rol: RolGuia; nombre: string; intro: string; pasos: Paso[]; siFalla: Paso[] }

export const GUIAS: Record<RolGuia, Guia> = {
  mozo: {
    rol: "mozo",
    nombre: "Mozo",
    intro: "Los clientes piden y pagan con el QR de su mesa. Tu trabajo es llevar lo que está listo, atender llamados y cobrar a quien prefiere pagarte a ti.",
    pasos: [
      { titulo: "Empieza tu turno", texto: "Arriba en Mesas toca «Empezar turno». Si tomas una mesa sin haberlo empezado, empieza solo." },
      { titulo: "Lee los colores", texto: "Cada mesa tiene un color según lo que necesita: llamando, comida lista, pide la cuenta, por cobrar, en cocina o libre. Lo más urgente aparece primero." },
      { titulo: "Toma tus mesas", texto: "Abre la mesa y toca «Tomar mesa». Las propinas de esa mesa son tuyas, aunque cobre la caja." },
      { titulo: "Lleva lo que está listo", texto: "Cuando la cocina deja algo listo, la mesa se pone verde. Llévalo y toca «Entregado ✓». Si pasa el tiempo objetivo sin que nadie lo lleve, tu teléfono suena." },
      { titulo: "Atiende los llamados", texto: "Si un cliente te llama, la mesa se pone roja. Toca «Voy en camino» y el cliente lo ve al instante." },
      { titulo: "Cobra a quien te paga a ti", texto: "En la mesa aparece «Por cobrar». Elige «💵 Efectivo», «💳 POS» o «📲 Transferencia», anota la propina (se sugiere 10%) y toca «Registrar cobro». Recién ahí el pedido pasa a la cocina." },
      { titulo: "La boleta en efectivo y transferencia", texto: "Entrega la boleta del sistema del local y marca «Entregué la boleta». Si no alcanzaste, te queda arriba en «Boletas por entregar» con el botón «Ya la entregué»." },
      { titulo: "Premios y cierre", texto: "Si un cliente tiene un premio, te muestra su código para entregarlo. Cuando la mesa se va, toca «Cerrar mesa»." },
      { titulo: "Si usan una tablet compartida", texto: "Crea tu PIN en tu Perfil («Mi PIN para tablets»). En la tablet toca tu nombre y escribe tu PIN; al terminar, toca «Cambiar de mozo». Todo queda a tu nombre." },
    ],
    siFalla: [
      { titulo: "Se cortó internet", texto: "La pantalla se pone al día sola cuando vuelve la conexión. No hace falta recargar." },
      { titulo: "El cliente dice que pagó y no aparece", texto: "Pídele que te muestre la pantalla de su pago y avisa a la caja: lo revisa en Caja → Excepciones." },
      { titulo: "Alguien quiere pedir sin celular", texto: "Abre la mesa y usa «Tomar pedido a mano». Es el respaldo: lo normal es que pidan con el QR." },
    ],
  },
  cocina: {
    rol: "cocina",
    nombre: "Cocina y barra",
    intro: "Tu pantalla muestra lo que hay que preparar, separado por estación. En prepago solo llega lo que ya está pagado.",
    pasos: [
      { titulo: "Elige tu estación", texto: "Arriba elige tu estación (por ejemplo, Cocina o Barra) o «Todas». La pantalla la recuerda." },
      { titulo: "Acepta el pedido", texto: "Cada pedido nuevo suena y aparece en Nuevos. Toca «ACEPTAR» cuando lo empiezas." },
      { titulo: "Márcalo listo", texto: "Cuando está listo toca «LISTO». El mozo y el cliente lo ven al instante." },
      { titulo: "Si lo entregas tú", texto: "Toca «ENTREGADO». Si lo lleva el mozo, él lo marca desde su teléfono." },
      { titulo: "Se acabó un producto", texto: "Toca «86» al lado del producto: desaparece de la carta al momento y nadie más lo puede pedir." },
      { titulo: "Lo que espera demasiado", texto: "Si algo listo nadie lo lleva a tiempo, la tarjeta se pone roja y dice que nadie lo ha llevado." },
      { titulo: "El sonido", texto: "Deja activado «Sonido» para escuchar cada pedido nuevo." },
    ],
    siFalla: [
      { titulo: "Se cortó internet", texto: "Arriba aparece un aviso grande. Al volver la conexión, la pantalla recupera todo lo que pasó mientras tanto." },
      { titulo: "Un pedido dice «esperando pago»", texto: "Es de alguien que le paga al mozo: no lo prepares hasta que el mozo registre el cobro." },
      { titulo: "Pedido pagado con un producto agotado", texto: "La tarjeta lo avisa. Pídele al mozo que hable con el cliente: lo puede cambiar por otro o la caja le devuelve la plata." },
    ],
  },
  caja: {
    rol: "caja",
    nombre: "Caja",
    intro: "La caja cobra cuando hace falta, devuelve con motivo, resuelve lo que la app no pudo resolver sola y cierra el día. La app suma sola: tú solo cuentas el efectivo.",
    pasos: [
      { titulo: "Lo que entró hoy", texto: "En Caja → Ingresos ves cada pago del día: con la app, en efectivo, con POS o por transferencia." },
      { titulo: "Devolver plata", texto: "En el pago toca «Reembolsar», escribe el motivo y el monto. Lo pagado con la app se devuelve por Webpay; el efectivo, en el local." },
      { titulo: "Las excepciones", texto: "En la pestaña «Excepciones» está lo que necesita una persona: un cobro sin pedido por devolver, una diferencia con Transbank, una boleta sin marcar. Cada una tiene su botón." },
      { titulo: "Las boletas", texto: "En Cierre de caja ves las boletas de efectivo y transferencia que faltan. Márcalas «Entregada» con su número si lo tienes." },
      { titulo: "Verificar con Transbank", texto: "Antes de cerrar, toca «Verificar con Transbank»: compara cada pago con Webpay del día con lo que dice Transbank." },
      { titulo: "Cambio de turno", texto: "Si la caja cambia de manos durante el día, toca «Hacer corte de turno», cuenta el efectivo y toca «Guardar corte». Lo que se cobre después es del turno siguiente." },
      { titulo: "Cerrar la caja", texto: "Cuenta el efectivo y escríbelo (si hubo cortes, solo lo que entró desde el último). Si no cuadra, explica la diferencia en las notas. Toca «Cerrar caja del día»: queda bloqueado y nadie lo puede cambiar." },
      { titulo: "Las propinas del equipo", texto: "En «Propinas del equipo» ves cuánto se le debe a cada mozo y hasta cuándo (7 días hábiles con tarjeta). Registra cada pago." },
    ],
    siFalla: [
      { titulo: "La caja no cuadra", texto: "Revisa primero las excepciones y los pedidos sin cobrar que avisa el cierre. Si igual no cuadra, explica la diferencia en las notas: queda registrada." },
      { titulo: "Un reembolso no se pudo hacer", texto: "Aparece en Excepciones como «Reembolso rechazado por la pasarela». Toca «Reintentar reembolso»." },
    ],
  },
  dueno: {
    rol: "dueno",
    nombre: "Dueño o administrador",
    intro: "Desde aquí manejas todo el local. El Inicio te cuenta cómo te fue y qué necesita tu atención.",
    pasos: [
      { titulo: "El Inicio", texto: "Cómo te fue anoche comparado con la semana pasada, tu plato estrella, la mejor zona y hora, y los avisos. Si el local es nuevo, «Para abrir tu local» te guía paso a paso." },
      { titulo: "La carta", texto: "En Menú usa «Pegar carta» para cargarla entera de una vez. Después agrega fotos, opciones y a qué estación va cada categoría." },
      { titulo: "Mesas y QR", texto: "En QR imprime las tarjetas de cada mesa con «Imprimir tarjetas». Cada mesa tiene además un código de 4 números que prueba que el cliente está en el local." },
      { titulo: "Tu equipo", texto: "En Equipo invita a mozos, caja y cocina con un enlace. Desactivar a alguien le quita el acceso al instante. Ahí también ves turnos, desempeño y metas, y activas una tablet compartida con «Activar este dispositivo como tablet»." },
      { titulo: "Qué puede hacer cada rol", texto: "En Equipo → Permisos por rol eliges, por ejemplo, si la caja ve los reportes o si el encargado puede devolver plata. Lo que quitas se bloquea al tiro, aunque alguien tenga la app abierta." },
      { titulo: "Cómo te pagan", texto: "En Sucursal conecta tu Webpay: la plata va directo a tu cuenta. Anota también tus datos para transferir y si quieres el recordatorio de boleta." },
      { titulo: "La caja y los reportes", texto: "La caja cuadra sola y se cierra cada día. En Reportes ves ventas, platos, horas y zonas." },
      { titulo: "Los sellos", texto: "En Lealtad defines cuántas visitas dan un premio. Los sellos se suman solos al pagar." },
    ],
    siFalla: [
      { titulo: "Algo no se ve como debería", texto: "Usa Soporte: el chat te responde al tiro y, si hace falta, pasa a una persona de Tablio." },
      { titulo: "Alguien del equipo se fue", texto: "En Equipo desactívalo: pierde el acceso al instante y sus datos quedan." },
    ],
  },
};

/** Qué guía le corresponde a cada rol del local. */
export const guiaDeRol = (rol: string | null | undefined): RolGuia =>
  rol === "cashier" ? "caja" : rol === "waiter" ? "mozo" : rol === "kitchen" ? "cocina" : "dueno";
