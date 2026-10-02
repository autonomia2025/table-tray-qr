import { useEffect, useState } from "react";
import { Gift, Loader2, Mail, ArrowLeft, LogOut, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSesion } from "@/contexts/SesionContext";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

/**
 * Cuenta del comensal (fase 1.3). El invitado paga sin registrarse; si guarda su cuenta,
 * conserva sus sellos y sus pedidos. Su identidad de invitado se convierte en su cuenta:
 * no pierde lo que ya hizo.
 */

type Paso = "inicio" | "correo" | "codigo" | "listo";
type Modo = "guardar" | "entrar";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

interface Props {
  abierto: boolean;
  onCambiar: (abierto: boolean) => void;
  nombreLocal: string;
  color: string;
}

export default function CuentaComensal({ abierto, onCambiar, nombreLocal, color }: Props) {
  const { perfil, recargar } = useSesion();
  const registrado = !!perfil && !perfil.es_anonimo && !!perfil.email;

  const [paso, setPaso] = useState<Paso>("inicio");
  const [modo, setModo] = useState<Modo>("guardar");
  const [correo, setCorreo] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  // Si el comensal confirmó tocando el enlace del correo (en otra pestaña o app),
  // al volver a esta pantalla se actualiza su cuenta y se le muestra "¡Listo!".
  useEffect(() => {
    if (paso !== "codigo") return;
    const alVolver = async () => {
      if (document.visibilityState !== "visible") return;
      await supabase.auth.refreshSession();
      const p = await recargar();
      if (p && !p.es_anonimo && p.email) setPaso("listo");
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [paso, recargar]);

  const volverAlInicio = () => {
    setPaso("inicio");
    setCodigo("");
    setError("");
  };

  const cerrar = (abrir: boolean) => {
    onCambiar(abrir);
    if (!abrir) setTimeout(volverAlInicio, 300);
  };

  const conProveedor = async (provider: "google" | "apple") => {
    setError("");
    setCargando(true);
    const redirectTo = window.location.href;
    // Invitado: se une la cuenta de Google/Apple a su identidad actual (no pierde nada).
    const { error: e1 } = await supabase.auth.linkIdentity({ provider, options: { redirectTo } });
    if (!e1) return; // el navegador se va al proveedor y vuelve
    // Si esa cuenta ya existe, se entra a ella.
    const { error: e2 } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    setCargando(false);
    if (e2) {
      const nombre = provider === "google" ? "Google" : "Apple";
      setError(
        /not enabled|provider/i.test(e1.message + e2.message)
          ? `Muy pronto podrás entrar con ${nombre}. Por ahora usa tu correo.`
          : `No pudimos conectar con ${nombre}. Intenta de nuevo.`,
      );
    }
  };

  const enviarCodigo = async () => {
    const email = correo.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setError("Revisa tu correo.");
      return;
    }
    setError("");
    setCargando(true);
    const emailRedirectTo = window.location.href;

    // Invitado → cliente: se agrega el correo a su identidad actual.
    const { error: e1 } = await supabase.auth.updateUser({ email }, { emailRedirectTo });
    if (!e1) {
      setModo("guardar");
      setPaso("codigo");
      setCargando(false);
      return;
    }

    // Si el correo ya tiene cuenta (otro dispositivo), se entra a esa cuenta con un código.
    const { error: e2 } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } });
    setCargando(false);
    if (e2) {
      setError(/rate|seconds|frequency/i.test(e2.message)
        ? "Espera un minuto antes de pedir otro código."
        : "No pudimos enviarte el código. Intenta de nuevo.");
      return;
    }
    setModo("entrar");
    setPaso("codigo");
  };

  const confirmarCodigo = async (valor: string) => {
    if (valor.length !== 6) return;
    setError("");
    setCargando(true);
    const email = correo.trim().toLowerCase();
    const { error: e } = await supabase.auth.verifyOtp({
      email,
      token: valor,
      type: modo === "guardar" ? "email_change" : "email",
    });
    setCargando(false);
    if (e) {
      setCodigo("");
      setError("Ese código no funciona. Revisa el correo o pide uno nuevo.");
      return;
    }
    await recargar();
    setPaso("listo");
  };

  const salir = async () => {
    setCargando(true);
    await supabase.auth.signOut();
    // Vuelve a ser invitado para seguir pidiendo en la mesa.
    await supabase.auth.signInAnonymously();
    await recargar();
    setCargando(false);
    cerrar(false);
  };

  return (
    <Drawer open={abierto} onOpenChange={cerrar}>
      <DrawerContent className="mx-auto max-w-md">
        <div className="px-5 pb-8 pt-2">
          {registrado && paso !== "listo" ? (
            <>
              <DrawerHeader className="px-0 text-left">
                <DrawerTitle className="text-xl font-extrabold">Tu cuenta</DrawerTitle>
                <DrawerDescription>Tus sellos y tus pedidos quedan guardados en cada visita.</DrawerDescription>
              </DrawerHeader>
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: color }}>
                  {perfil?.email?.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-card-foreground">{perfil?.email}</p>
                  <p className="text-xs text-muted-foreground">Sumas sellos en {nombreLocal} cada vez que pagas</p>
                </div>
              </div>
              <button
                onClick={salir}
                disabled={cargando}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-muted-foreground"
              >
                {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Cerrar sesión
              </button>
            </>
          ) : paso === "inicio" ? (
            <>
              <DrawerHeader className="px-0 text-left">
                <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: `${color}18` }}>
                  <Gift className="h-6 w-6" style={{ color }} />
                </div>
                <DrawerTitle className="text-xl font-extrabold">Guarda tus sellos</DrawerTitle>
                <DrawerDescription>
                  Junta visitas en {nombreLocal} y gana premios. Tus pedidos de hoy quedan en tu cuenta.
                </DrawerDescription>
              </DrawerHeader>

              <div className="space-y-2.5">
                <button
                  onClick={() => conProveedor("google")}
                  disabled={cargando}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold text-card-foreground"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z"/></svg>
                  Continuar con Google
                </button>
                <button
                  onClick={() => conProveedor("apple")}
                  disabled={cargando}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-foreground text-sm font-semibold text-background"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4.1zM13.9 5c.7-.9 1.2-2 1-3.2-1 .1-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z"/></svg>
                  Continuar con Apple
                </button>
                <button
                  onClick={() => { setError(""); setPaso("correo"); }}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold text-foreground"
                >
                  <Mail className="h-4 w-4" />
                  Continuar con mi correo
                </button>
              </div>

              {error && <p className="mt-3 text-center text-xs text-destructive">{error}</p>}
              <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
                Al guardar tu cuenta aceptas que {nombreLocal} reconozca tus visitas para darte sellos y premios.
                Puedes pedir que borremos tus datos cuando quieras.
              </p>
            </>
          ) : paso === "correo" ? (
            <>
              <button onClick={volverAlInicio} className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <ArrowLeft className="h-4 w-4" /> Volver
              </button>
              <DrawerHeader className="px-0 text-left">
                <DrawerTitle className="text-xl font-extrabold">¿Cuál es tu correo?</DrawerTitle>
                <DrawerDescription>Te mandamos un código de 6 dígitos. Sin contraseñas.</DrawerDescription>
              </DrawerHeader>
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="tu@correo.com"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && enviarCodigo()}
                className="h-12 text-base"
                autoFocus
              />
              {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
              <button
                onClick={enviarCodigo}
                disabled={cargando}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: color }}
              >
                {cargando && <Loader2 className="h-4 w-4 animate-spin" />}
                Enviar código
              </button>
            </>
          ) : paso === "codigo" ? (
            <>
              <button onClick={() => setPaso("correo")} className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <ArrowLeft className="h-4 w-4" /> Cambiar correo
              </button>
              <DrawerHeader className="px-0 text-left">
                <DrawerTitle className="text-xl font-extrabold">Revisa tu correo</DrawerTitle>
                <DrawerDescription>
                  Te enviamos un correo a <strong>{correo.trim()}</strong>. Escribe el código o toca el enlace del correo.
                </DrawerDescription>
              </DrawerHeader>
              <div className="flex justify-center py-2">
                <InputOTP
                  maxLength={6}
                  value={codigo}
                  onChange={(v) => { setCodigo(v); confirmarCodigo(v); }}
                  inputMode="numeric"
                  autoFocus
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} className="h-12 w-11 text-lg" />)}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {cargando && <Loader2 className="mx-auto mt-2 h-5 w-5 animate-spin text-muted-foreground" />}
              {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
              <button onClick={enviarCodigo} disabled={cargando} className="mt-3 w-full text-center text-xs font-semibold" style={{ color }}>
                Enviar otro código
              </button>
            </>
          ) : (
            <div className="py-6 text-center">
              <CheckCircle2 className="mx-auto h-14 w-14" style={{ color }} />
              <h3 className="mt-3 text-xl font-extrabold text-foreground">¡Listo!</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Tus sellos en {nombreLocal} quedan guardados en tu cuenta.
              </p>
              <button
                onClick={() => cerrar(false)}
                className="mt-5 h-12 w-full rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: color }}
              >
                Seguir
              </button>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
