import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/contexts/AdminContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Loader2 } from "lucide-react";
import { formatCLP } from "@/lib/format";
import { exportToCSV } from "@/lib/export-utils";

interface ProgramForm {
  id: string | null;
  is_active: boolean;
  type: "stamps" | "points";
  goal_visits: number;
  points_per_thousand: number;
  points_goal: number;
  reward_description: string;
}

interface CustomerRow {
  id: string;
  email: string;
  visits: number;
  points: number;
  total_spent: number;
  last_visit_at: string | null;
}

const DEFAULT_FORM: ProgramForm = {
  id: null,
  is_active: false,
  type: "stamps",
  goal_visits: 5,
  points_per_thousand: 1,
  points_goal: 100,
  reward_description: "Bebida gratis",
};

export default function LealtadPage() {
  const { tenantId, branchId } = useAdmin();
  const { toast } = useToast();

  const [form, setForm] = useState<ProgramForm>(DEFAULT_FORM);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [redeemed, setRedeemed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [{ data: programs }, { data: custs }, { count }] = await Promise.all([
      supabase.from("loyalty_programs").select("*").eq("tenant_id", tenantId),
      supabase
        .from("loyalty_customers")
        .select("id, email, visits, points, total_spent, last_visit_at")
        .eq("tenant_id", tenantId)
        .order("last_visit_at", { ascending: false, nullsFirst: false })
        .limit(500),
      supabase
        .from("loyalty_rewards")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "redeemed"),
    ]);

    const program =
      (programs ?? []).find((p) => p.branch_id === branchId) ??
      (programs ?? []).find((p) => p.branch_id === null) ??
      null;

    setForm(program
      ? {
          id: program.id,
          is_active: program.is_active,
          type: program.type === "points" ? "points" : "stamps",
          goal_visits: program.goal_visits,
          points_per_thousand: program.points_per_thousand,
          points_goal: program.points_goal,
          reward_description: program.reward_description,
        }
      : DEFAULT_FORM);
    setCustomers((custs ?? []) as CustomerRow[]);
    setRedeemed(count ?? 0);
    setLoading(false);
  }, [tenantId, branchId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    const payload = {
      tenant_id: tenantId,
      branch_id: branchId || null,
      is_active: form.is_active,
      type: form.type,
      goal_visits: Math.max(1, form.goal_visits),
      points_per_thousand: Math.max(1, form.points_per_thousand),
      points_goal: Math.max(1, form.points_goal),
      reward_description: form.reward_description.trim().slice(0, 120) || "Recompensa",
    };

    const { error } = form.id
      ? await supabase.from("loyalty_programs").update(payload).eq("id", form.id)
      : await supabase.from("loyalty_programs").insert(payload);

    setSaving(false);
    if (error) {
      toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Programa de lealtad guardado" });
    load();
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-bold text-foreground mb-1">Lealtad</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Reconoce a tus clientes por email y premia sus visitas. Los datos son solo de tu local.
      </p>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Programa</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm((p) => ({ ...p, is_active: v }))} />
            <Label className="text-base font-semibold">{form.is_active ? "Activo" : "Desactivado"}</Label>
          </div>

          <div>
            <Label>Tipo</Label>
            <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v as "stamps" | "points" }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="stamps">Sellos por visita</SelectItem>
                <SelectItem value="points">Puntos por gasto</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.type === "stamps" ? (
            <div>
              <Label>Visitas para la recompensa</Label>
              <Input
                type="number" min={1} value={form.goal_visits}
                onChange={(e) => setForm((p) => ({ ...p, goal_visits: parseInt(e.target.value) || 1 }))}
              />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Puntos por cada $1.000</Label>
                <Input
                  type="number" min={1} value={form.points_per_thousand}
                  onChange={(e) => setForm((p) => ({ ...p, points_per_thousand: parseInt(e.target.value) || 1 }))}
                />
              </div>
              <div>
                <Label>Puntos para la recompensa</Label>
                <Input
                  type="number" min={1} value={form.points_goal}
                  onChange={(e) => setForm((p) => ({ ...p, points_goal: parseInt(e.target.value) || 1 }))}
                />
              </div>
            </div>
          )}

          <div>
            <Label>Recompensa</Label>
            <Input
              value={form.reward_description} maxLength={120}
              onChange={(e) => setForm((p) => ({ ...p, reward_description: e.target.value }))}
              placeholder="Ej: Café gratis"
            />
          </div>

          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar programa"}</Button>
        </CardContent>
      </Card>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Clientes</p>
          <p className="text-xl font-bold text-foreground">{customers.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Visitas registradas</p>
          <p className="text-xl font-bold text-foreground">{customers.reduce((s, c) => s + c.visits, 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Canjes</p>
          <p className="text-xl font-bold text-foreground">{redeemed}</p>
        </CardContent></Card>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Clientes</h3>
        <Button
          variant="outline" size="sm" disabled={!customers.length}
          onClick={() => exportToCSV(customers.map((c) => ({
            Email: c.email,
            Visitas: c.visits,
            Puntos: c.points,
            GastoTotal: c.total_spent,
            UltimaVisita: c.last_visit_at ? new Date(c.last_visit_at).toLocaleString("es-CL") : "",
          })), "clientes-lealtad")}
        >
          <Download className="mr-1 h-4 w-4" /> Exportar CSV
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead className="text-right">Visitas</TableHead>
            <TableHead className="text-right">Puntos</TableHead>
            <TableHead className="text-right">Gasto total</TableHead>
            <TableHead>Última visita</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{c.email}</TableCell>
              <TableCell className="text-right">{c.visits}</TableCell>
              <TableCell className="text-right">{c.points}</TableCell>
              <TableCell className="text-right">{formatCLP(c.total_spent)}</TableCell>
              <TableCell>{c.last_visit_at ? new Date(c.last_visit_at).toLocaleDateString("es-CL") : "—"}</TableCell>
            </TableRow>
          ))}
          {!customers.length && (
            <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">Aún no hay clientes registrados</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
