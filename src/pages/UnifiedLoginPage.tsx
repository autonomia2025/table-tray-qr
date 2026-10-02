import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Link } from "react-router-dom";
import { useSesion } from "@/contexts/SesionContext";
import { destinoTrasLogin } from "@/lib/roles";

export default function UnifiedLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);

  const { cargando, perfil, recargar } = useSesion();

  // Si ya hay sesión, va directo a su panel.
  useEffect(() => {
    if (cargando) return;
    const destino = destinoTrasLogin(perfil);
    if (destino) {
      navigate(destino, { replace: true });
      return;
    }
    setChecking(false);
  }, [cargando, perfil, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError || !data.user) {
        setError(authError?.message === "Invalid login credentials"
          ? "Email o contraseña incorrectos"
          : "No pudimos iniciar sesión. Intenta de nuevo.");
        setSubmitting(false);
        return;
      }

      const destino = destinoTrasLogin(await recargar());

      if (!destino) {
        await supabase.auth.signOut();
        setError("Esta cuenta no tiene acceso a ningún panel");
        setSubmitting(false);
        return;
      }

      navigate(destino, { replace: true });
    } catch (err) {
      setError("Error de conexión. Intenta de nuevo.");
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#111110]">
        <Loader2 className="h-8 w-8 animate-spin text-[#E8531D]" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* Background */}
      <div className="absolute inset-0 bg-[#111110]">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background: "radial-gradient(ellipse at 30% 20%, #E8531D 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, #E8531D 0%, transparent 50%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          }}
        />
      </div>

      {/* Login card */}
      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-black tracking-tight text-white">
            tablio<span className="text-[#E8531D]">.</span>
          </h1>
          <p className="mt-2 text-sm text-white/50">
            Plataforma de gestión para restaurantes
          </p>
        </div>

        {/* Glass card */}
        <div
          className="rounded-2xl border border-white/10 p-8 shadow-2xl"
          style={{
            background: "rgba(255,255,255,0.05)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
          }}
        >
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-white/70">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
                className="h-12 rounded-xl border-white/10 bg-white/5 text-white placeholder:text-white/30 focus-visible:ring-[#E8531D] focus-visible:border-[#E8531D]"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-white/70">Contraseña</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="h-12 rounded-xl border-white/10 bg-white/5 pr-12 text-white placeholder:text-white/30 focus-visible:ring-[#E8531D] focus-visible:border-[#E8531D]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-12 rounded-xl text-base font-bold text-white transition-all hover:brightness-110"
              style={{ backgroundColor: "#E8531D" }}
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : null}
              Iniciar sesión
            </Button>
          </form>

          <div className="mt-5 text-center">
            <Link
              to="/admin/forgot-password"
              className="text-sm text-white/40 hover:text-[#E8531D] transition-colors"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-white/20">
          © {new Date().getFullYear()} tablio — Todos los derechos reservados
        </p>
      </div>
    </div>
  );
}
