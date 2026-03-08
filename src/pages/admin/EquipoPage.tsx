import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/contexts/AdminContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Eye, EyeOff, Loader2, Users } from "lucide-react";

interface StaffRow {
  id: string;
  name: string;
  pin: string | null;
  role: string;
  is_active: boolean | null;
}

const ROLE_LABELS: Record<string, string> = {
  waiter: "Mozo",
  cashier: "Cajero",
  host: "Host",
};

export default function EquipoPage() {
  const { branchId, tenantId } = useAdmin();
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState("waiter");
  const [saving, setSaving] = useState(false);
  const [revealedPins, setRevealedPins] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const fetchStaff = async () => {
    const { data } = await supabase
      .from("staff_users")
      .select("id, name, pin, role, is_active")
      .eq("branch_id", branchId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    setStaff(data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchStaff(); }, [branchId, tenantId]);

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setPin("");
    setRole("waiter");
    setError("");
    setModalOpen(true);
  };

  const openEdit = (s: StaffRow) => {
    setEditingId(s.id);
    setName(s.name);
    setPin(s.pin ?? "");
    setRole(s.role);
    setError("");
    setModalOpen(true);
  };

  const save = async () => {
    setError("");
    if (!name.trim()) { setError("Nombre obligatorio"); return; }
    if (!/^\d{4}$/.test(pin)) { setError("PIN debe ser exactamente 4 dígitos"); return; }

    setSaving(true);

    // Check PIN collision
    const { data: collision } = await supabase
      .from("staff_users")
      .select("id")
      .eq("pin", pin)
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .neq("id", editingId ?? "00000000-0000-0000-0000-000000000000")
      .maybeSingle();

    if (collision) {
      setError("Este PIN ya está en uso, elige otro");
      setSaving(false);
      return;
    }

    if (editingId) {
      await supabase
        .from("staff_users")
        .update({ name: name.trim(), pin, role })
        .eq("id", editingId);
      toast({ title: "Mozo actualizado" });
    } else {
      await supabase
        .from("staff_users")
        .insert({ name: name.trim(), pin, role, branch_id: branchId, tenant_id: tenantId, is_active: true });
      toast({ title: "Mozo creado" });
    }

    setModalOpen(false);
    setSaving(false);
    fetchStaff();
  };

  const toggleActive = async (s: StaffRow) => {
    await supabase.from("staff_users").update({ is_active: !s.is_active }).eq("id", s.id);
    toast({ title: `${s.name} ${!s.is_active ? "activado" : "desactivado"}` });
    fetchStaff();
  };

  const toggleReveal = (id: string) => {
    setRevealedPins(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-bold text-foreground">Equipo</h1>
        </div>
        <Button onClick={openCreate} size="sm"><Plus className="w-4 h-4 mr-1" />Agregar mozo</Button>
      </div>

      {staff.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No hay mozos registrados</p>
          <p className="text-sm mt-1">Agrega tu primer mozo para que pueda usar la app</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">PIN</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Rol</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Activo</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {staff.map(s => (
                <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-xs">
                        {revealedPins.has(s.id) ? s.pin : "••••"}
                      </span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleReveal(s.id)}>
                        {revealedPins.has(s.id) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </Button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-[10px]">
                      {ROLE_LABELS[s.role] ?? s.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Switch checked={!!s.is_active} onCheckedChange={() => toggleActive(s)} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar mozo" : "Agregar mozo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Juan Pérez" />
            </div>
            <div>
              <Label>PIN (4 dígitos)</Label>
              <Input
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="1234"
                maxLength={4}
                inputMode="numeric"
              />
            </div>
            <div>
              <Label>Rol</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="waiter">Mozo</SelectItem>
                  <SelectItem value="cashier">Cajero</SelectItem>
                  <SelectItem value="host">Host</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              {editingId ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
