import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Lock, Store, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { activarLocal, verActivacion, type Activacion } from "@/lib/altaLocal";

// Fuera del componente: si se definiera adentro, los campos perderían el foco con cada letra
function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
        <p className="mb-4 text-center text-2xl font-extrabold tracking-tight text-foreground">tablio<span className="text-primary">.</span></p>
        <Card className="rounded-2xl">{children}</Card>
      </motion.div>
    </div>
  );
}

/**
 * Activar el local (fase 5.1). El dueño llega con el enlace que le mandó Tablio, escribe su nombre y elige su
 * contraseña (el correo ya viene anotado). Si ya tiene una cuenta con ese correo, entra con ella y el local
 * se suma a su cuenta. Al terminar queda dentro de su panel.
 */
export default function ActivarLocalPage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [act, setAct] = useState<Activacion | null>(null);
  const [nombre, setNombre] = useState("");
  const [clave, setClave] = useState("");
  const [clave2, setClave2] = useState("");
  const [yaTieneCuenta, setYaTieneCuenta] = useState(false);
  const [correo, setCorreo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    verActivacion(token).then((a) => {
      setAct(a);
      if (a.nombre) setNombre(a.nombre);
    });
  }, [token]);

  const entrarAlPanel = (slug: string) => {
    setListo(true);
    setTimeout(() => navigate(`/admin/${slug}/inicio`, { replace: true }), 1200);
  };

  const crearCuenta = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (nombre.trim().length < 2) { setError("Escribe tu nombre."); return; }
    if (clave.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (clave !== clave2) { setError("Las contraseñas no coinciden."); return; }
    setEnviando(true);
    // Si el navegador tenía una sesión de invitado (de la carta), se cierra antes
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.is_anonymous) await supabase.auth.signOut();
    const r = await activarLocal(token, nombre.trim(), clave);
    if (r.ok === false) {
      setEnviando(false);
      if (r.yaTieneCuenta) { setYaTieneCuenta(true); setClave(""); setClave2(""); return; }
      setError(r.error);
      return;
    }
    const { error: errEntrar } = await supabase.auth.signInWithPassword({ email: r.correo, password: clave });
    setEnviando(false);
    if (errEntrar) { navigate("/login", { replace: true }); return; }
    entrarAlPanel(r.slug);
  };

  const entrarYSumar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setEnviando(true);
    const { error: errEntrar } = await supabase.auth.signInWithPassword({ email: correo.trim(), password: clave });
    if (errEntrar) { setEnviando(false); setError("El correo o la contraseña no coinciden."); return; }
    const r = await activarLocal(token);
    setEnviando(false);
    if (r.ok === false) { setError(r.error); return; }
    entrarAlPanel(r.slug);
  };

  if (!act) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (act.estado !== "vigente" && !listo) {
    const textos: Record<string, [string, string]> = {
      usado: ["Este local ya está activado", "Entra con tu correo y contraseña."],
      vencido: ["Este enlace venció", "Pídele a Tablio un enlace nuevo."],
      anulado: ["Este enlace ya no sirve", "Tablio te mandó uno más nuevo: usa ese."],
      no_existe: ["Enlace no válido", "Revisa que el enlace esté completo, o pídele uno nuevo a Tablio."],
    };
    const [titulo, detalle] = textos[act.estado] ?? textos.no_existe;
    return (
      <Marco>
        <CardContent className="space-y-3 pt-6 text-center">
          <p className="text-lg font-bold text-foreground">{titulo}</p>
          <p className="text-sm text-muted-foreground">{detalle}</p>
          {act.estado === "usado" && <Button className="w-full" onClick={() => navigate("/login")}>Entrar</Button>}
        </CardContent>
      </Marco>
    );
  }

  if (listo) {
    return (
      <Marco>
        <CardContent className="space-y-3 pt-6 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
          <p className="text-lg font-bold text-foreground">¡{act.local} está activado!</p>
          <p className="text-sm text-muted-foreground">Te llevamos a tu panel…</p>
        </CardContent>
      </Marco>
    );
  }

  return (
    <Marco>
      <CardHeader className="space-y-1 pb-2 text-center">
        <Store className="mx-auto h-8 w-8 text-primary" aria-hidden />
        <h1 className="text-xl font-extrabold text-foreground">Activa {act.local}</h1>
        <p className="text-sm text-muted-foreground">
          {yaTieneCuenta ? "Ya tienes una cuenta con este correo: entra con ella y sumamos el local." : `Crea tu cuenta para ${act.correo}.`}
        </p>
      </CardHeader>
      <CardContent>
        {yaTieneCuenta ? (
          <form onSubmit={entrarYSumar} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="activar-correo">Tu correo ({act.correo})</Label>
              <Input id="activar-correo" type="email" autoComplete="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="activar-clave-actual">Tu contraseña</Label>
              <Input id="activar-clave-actual" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="h-11 w-full" disabled={enviando}>
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar y activar el local"}
            </Button>
          </form>
        ) : (
          <form onSubmit={crearCuenta} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="activar-nombre">Tu nombre</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input id="activar-nombre" autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} className="pl-9" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="activar-clave">Elige tu contraseña</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input id="activar-clave" type="password" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} className="pl-9" placeholder="Al menos 8 caracteres" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="activar-clave2">Repítela</Label>
              <Input id="activar-clave2" type="password" autoComplete="new-password" value={clave2} onChange={(e) => setClave2(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="h-11 w-full" disabled={enviando}>
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Activar mi local"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Nadie de Tablio conoce tu contraseña.</p>
          </form>
        )}
      </CardContent>
    </Marco>
  );
}
