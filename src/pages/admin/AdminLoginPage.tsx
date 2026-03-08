import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/contexts/AdminContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function AdminLoginPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAdmin();

  const [tenant, setTenant] = useState<{ id: string; name: string; logo_url: string | null; primary_color: string | null } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // If already authenticated, redirect
  useEffect(() => {
    if (isAuthenticated && slug) {
      navigate(`/admin/${slug}/mesas`, { replace: true });
    }
  }, [isAuthenticated, slug, navigate]);

  // Load tenant by slug
  useEffect(() => {
    async function load() {
      if (!slug) return;
      const { data } = await supabase
        .from("tenants")
        .select("id, name, logo_url, primary_color")
        .eq("slug", slug)
        .eq("is_active", true)
        .single();

      if (data) {
        setTenant(data);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    }
    load();
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    setError("");
    setSubmitting(true);

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError || !authData.user) {
      setError(authError?.message ?? "Error al iniciar sesión");
      setSubmitting(false);
      return;
    }

    // Verify membership
    const { data: member } = await supabase
      .from("tenant_members")
      .select("id")
      .eq("user_id", authData.user.id)
      .eq("tenant_id", tenant.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!member) {
      await supabase.auth.signOut();
      setError("No tienes acceso a este restaurante");
      setSubmitting(false);
      return;
    }

    navigate(`/admin/${slug}/mesas`, { replace: true });
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-sm mx-4">
          <CardContent className="pt-6 text-center">
            <p className="text-lg font-semibold text-foreground">Restaurante no encontrado</p>
            <p className="text-sm text-muted-foreground mt-2">El slug "/{slug}" no existe o está desactivado.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-3 pb-2">
          {tenant?.logo_url ? (
            <img src={tenant.logo_url} alt={tenant.name} className="h-16 w-16 rounded-full mx-auto object-cover" />
          ) : (
            <div
              className="h-16 w-16 rounded-full mx-auto flex items-center justify-center text-2xl font-bold text-white"
              style={{ backgroundColor: tenant?.primary_color ?? "#E8531D" }}
            >
              {tenant?.name.charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className="text-xl font-bold text-foreground">{tenant?.name}</h1>
          <p className="text-sm text-muted-foreground">Panel de administración</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@restaurante.cl"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••"
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={submitting}
              style={{ backgroundColor: tenant?.primary_color ?? undefined }}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
