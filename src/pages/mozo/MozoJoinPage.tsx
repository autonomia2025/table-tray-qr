import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function MozoJoinPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<{
    id: string;
    tenant_id: string;
    branch_id: string;
    role: string;
    tenantName: string;
  } | null>(null);
  const [expired, setExpired] = useState(false);
  const [used, setUsed] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function load() {
      if (!token) return;
      const { data } = await supabase
        .from("staff_invitations")
        .select("id, tenant_id, branch_id, role, expires_at, used_at")
        .eq("token", token)
        .maybeSingle();

      if (!data) {
        setExpired(true);
        setLoading(false);
        return;
      }

      if (data.used_at) {
        setUsed(true);
        setLoading(false);
        return;
      }

      if (new Date(data.expires_at) < new Date()) {
        setExpired(true);
        setLoading(false);
        return;
      }

      // Get tenant name
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", data.tenant_id)
        .single();

      setInvitation({
        id: data.id,
        tenant_id: data.tenant_id,
        branch_id: data.branch_id,
        role: data.role,
        tenantName: tenant?.name ?? "Restaurante",
      });
      setLoading(false);
    }
    load();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitation) return;
    setError("");

    if (!name.trim()) { setError("Nombre obligatorio"); return; }
    if (!/^\d{4}$/.test(pin)) { setError("PIN debe ser exactamente 4 dígitos"); return; }

    setSaving(true);

    // Check PIN collision
    const { data: collision } = await supabase
      .from("staff_users")
      .select("id")
      .eq("pin", pin)
      .eq("branch_id", invitation.branch_id)
      .eq("is_active", true)
      .maybeSingle();

    if (collision) {
      setError("Este PIN ya está en uso, elige otro");
      setSaving(false);
      return;
    }

    // Create staff user
    const { error: insertError } = await supabase
      .from("staff_users")
      .insert({
        name: name.trim(),
        pin,
        role: invitation.role,
        branch_id: invitation.branch_id,
        tenant_id: invitation.tenant_id,
        is_active: true,
      });

    if (insertError) {
      setError("Error al registrarse");
      setSaving(false);
      return;
    }

    // Mark invitation as used
    await supabase
      .from("staff_invitations")
      .update({ used_at: new Date().toISOString() })
      .eq("id", invitation.id);

    setSuccess(true);
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (expired || used) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm">
          <CardContent className="pt-6 text-center">
            <p className="text-lg font-semibold text-foreground">
              {used ? "Invitación ya utilizada" : "Invitación expirada"}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              {used ? "Este enlace ya fue usado." : "Este enlace ha expirado. Pide uno nuevo a tu administrador."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm">
          <CardContent className="pt-6 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
            <p className="text-lg font-semibold text-foreground">¡Registro exitoso!</p>
            <p className="text-sm text-muted-foreground">Ya puedes ingresar a la app de mozo con tu PIN.</p>
            <Button onClick={() => navigate("/mozo/login")} className="w-full">
              Ir al login de mozo
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-2 pb-2">
          <h1 className="text-xl font-bold text-foreground">{invitation?.tenantName}</h1>
          <p className="text-sm text-muted-foreground">Te han invitado a unirte al equipo</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Tu nombre</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Juan Pérez" />
            </div>
            <div className="space-y-2">
              <Label>Elige un PIN (4 dígitos)</Label>
              <Input
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="1234"
                maxLength={4}
                inputMode="numeric"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Unirme al equipo
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
