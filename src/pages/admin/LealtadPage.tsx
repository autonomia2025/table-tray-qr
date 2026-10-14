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
import { Download, Gift, Loader2 } from "lucide-react";
import { formatCLP } from "@/lib/format";
import { premiosPorEntregar, type PremiosLocal } from "@/lib/sellos";
import { exportToCSV } from "@/lib/export-utils";

interface ProgramForm {
  id: string | null;
  is_active: boolean;
  type: "stamps" | "points";
  goal_visits: number;
  points_per_thousand: number;
  points_goal: number;
  reward_description: string;
  monto_minimo: number;
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
  monto_minimo: 3000,
};

export default function LealtadPage() {
  const { tenantId, branchId } = useAdmin();
  const { toast } = useToast();

  const [form, setForm] = useState<ProgramForm>(DEFAULT_FORM);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [premios, setPremios] = useState<PremiosLocal | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [{ data: programs }, { data: custs }, listaPremios] = await Promise.all([
      supabase.from("loyalty_programs").select("*").eq("tenant_id", tenantId),
      supabase
        .from("loyalty_customers")
        .select("id, email, visits, points, total_spent, last_visit_at")
        .eq("tenant_id", tenantId)
        .order("last_visit_at", { ascending: false, nullsFirst: false })
        .limit(500),
      premiosPorEntregar(tenantId),
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
          monto_minimo: program.monto_minimo ?? 0,
        }
      : DEFAULT_FORM);
    setCustomers((custs ?? []) as CustomerRow[]);
    setPremios(listaPremios);
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
      goal_visits: Math.min(30, Math.max(2, form.goal_visits)),
      points_per_thousand: Math.min(100, Math.max(1, form.points_per_thousand)),
      points_goal: Math.max(1, form.points_goal),
      reward_description: form.reward_description.trim().slice(0, 80) || "Recompensa",
      monto_minimo: Math.min(1_000_000, Math.max(0, Math.round(form.monto_minimo))),
    };

    const { error } = form.id
      ? await supabase.from("loyalty_programs").update(payload).eq("id", form.id)
      : await supabase.from("loyalty_programs").insert(payload);

    setSaving(false);
    if (error) {
      toast({ title: "No se pudo guardar", description: "Revisa los valores: entre 2 y 30 visitas y una recompensa de 2 a 80 letras.", variant: "destructive" });
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
        Tus clientes con cuenta suman un sello por visita (uno al día, desde el monto mínimo), también si le pagan al mozo.
        Al completar la tarjeta ganan el premio: se lo muestran al mozo en su celular y él lo entrega con ese código.
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
                type="number" min={2} max={30} value={form.goal_visits}
                onChange={(e) => setForm((p) => ({ ...p, goal_visits: parseInt(e.target.value) || 2 }))}
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
              value={form.reward_description} maxLength={80}
              onChange={(e) => setForm((p) => ({ ...p, reward_description: e.target.value }))}
              placeholder="Ej: Café gratis"
            />
          </div>

          {form.type === "stamps" && (
            <div>
              <Label htmlFor="monto-minimo">Compra mínima para sumar un sello</Label>
              <Input
                id="monto-minimo" type="number" min={0} step={500} value={form.monto_minimo}
                onChange={(e) => setForm((p) => ({ ...p, monto_minimo: parseInt(e.target.value) || 0 }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">Evita que alguien junte sellos comprando una bebida suelta. 0 = cualquier compra.</p>
            </div>
          )}

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
          <p className="text-xs text-muted-foreground">Premios entregados</p>
          <p className="text-xl font-bold text-foreground">{premios?.entregados.length ?? 0}</p>
        </CardContent></Card>
      </div>

      {premios && (premios.por_entregar.length > 0 || premios.entregados.length > 0) && (
        <Card className="mb-6">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Gift className="h-4 w-4 text-primary" /> Premios</CardTitle></CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Por entregar ({premios.por_entregar.length})</p>
              {premios.por_entregar.length ? (
                <ul className="space-y-1.5 text-sm">
                  {premios.por_entregar.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <span className="truncate text-foreground">{r.correo}</span>
                      <span className="shrink-0 text-muted-foreground">desde el {new Date(r.ganado_at).toLocaleDateString("es-CL")}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Nada pendiente.</p>}
              <p className="mt-2 text-xs text-muted-foreground">Se entregan cuando el cliente vuelve: el mozo los ve en el detalle de su mesa.</p>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Últimos entregados</p>
              {premios.entregados.length ? (
                <ul className="space-y-1.5 text-sm">
                  {premios.entregados.slice(0, 10).map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <span className="truncate text-foreground">{r.correo}</span>
                      <span className="shrink-0 text-muted-foreground">{new Date(r.entregado_at).toLocaleDateString("es-CL")} · {r.entregado_por ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Todavía ninguno.</p>}
            </div>
          </CardContent>
        </Card>
      )}

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
