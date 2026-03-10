import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/contexts/AdminContext";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Plus, Users } from "lucide-react";

interface TableRow {
  id: string;
  number: number;
  name: string | null;
  status: string | null;
  capacity: number | null;
  session_total?: number;
  session_opened_at?: string;
}

const STATUS_MAP: Record<string, { label: string; bg: string; text: string }> = {
  free: { label: "Libre", bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-800 dark:text-green-300" },
  occupied: { label: "Ocupada", bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-800 dark:text-orange-300" },
  waiting_bill: { label: "Esperando cuenta", bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-800 dark:text-red-300" },
  reserved: { label: "Reservada", bg: "bg-muted", text: "text-muted-foreground" },
};

function minutesSince(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

export default function MesasPage() {
  const { branchId, tenantId } = useAdmin();
  const { toast } = useToast();
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [closeTarget, setCloseTarget] = useState<TableRow | null>(null);
  const [closing, setClosing] = useState(false);

  // Create table state
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCapacity, setNewCapacity] = useState("4");

  const fetchTables = async () => {
    const { data, error } = await supabase
      .from("tables")
      .select("id, number, name, status, capacity")
      .eq("branch_id", branchId)
      .order("number");

    if (error || !data) return;

    const occupiedIds = data.filter((t) => t.status === "occupied" || t.status === "waiting_bill").map((t) => t.id);
    let sessionMap: Record<string, { total: number; opened: string }> = {};
    if (occupiedIds.length) {
      const { data: sessions } = await supabase
        .from("table_sessions")
        .select("table_id, total_amount, opened_at")
        .in("table_id", occupiedIds)
        .eq("is_active", true);
      if (sessions) {
        sessions.forEach((s) => {
          sessionMap[s.table_id] = { total: s.total_amount ?? 0, opened: s.opened_at ?? "" };
        });
      }
    }

    setTables(
      data.map((t) => ({
        ...t,
        session_total: sessionMap[t.id]?.total,
        session_opened_at: sessionMap[t.id]?.opened,
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    fetchTables();

    const channel = supabase
      .channel("admin-tables")
      .on("postgres_changes", { event: "*", schema: "public", table: "tables", filter: `branch_id=eq.${branchId}` }, () => {
        fetchTables();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "table_sessions", filter: `branch_id=eq.${branchId}` }, () => {
        fetchTables();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bill_requests", filter: `branch_id=eq.${branchId}` }, () => {
        fetchTables();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [branchId]);

  const handleCloseTable = async () => {
    if (!closeTarget) return;
    setClosing(true);
    try {
      await supabase
        .from("tables")
        .update({ status: "free", assigned_waiter_id: null })
        .eq("id", closeTarget.id);

      await supabase
        .from("table_sessions")
        .update({ is_active: false, closed_at: new Date().toISOString() })
        .eq("table_id", closeTarget.id)
        .eq("is_active", true);

      await supabase
        .from("bill_requests")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("table_id", closeTarget.id)
        .in("status", ["pending", "attending"]);

      toast({ title: "✅ Mesa liberada", description: `Mesa ${closeTarget.number} lista para el siguiente cliente` });
      setCloseTarget(null);
      fetchTables();
    } catch {
      toast({ title: "Error", description: "No se pudo liberar la mesa", variant: "destructive" });
    } finally {
      setClosing(false);
    }
  };

  const handleCreateTable = async () => {
    setCreating(true);
    try {
      const nextNumber = tables.length > 0 ? Math.max(...tables.map((t) => t.number)) + 1 : 1;
      const qrToken = crypto.randomUUID();

      const { error } = await supabase.from("tables").insert({
        number: nextNumber,
        name: newName.trim() || null,
        capacity: parseInt(newCapacity) || 4,
        branch_id: branchId,
        tenant_id: tenantId,
        qr_token: qrToken,
      });

      if (error) throw error;

      toast({ title: "Mesa creada", description: `Mesa ${nextNumber} agregada correctamente` });
      setShowCreate(false);
      setNewName("");
      setNewCapacity("4");
      fetchTables();
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "No se pudo crear la mesa", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  const freeCount = tables.filter((t) => t.status === "free").length;
  const occupiedCount = tables.filter((t) => t.status === "occupied").length;
  const waitingBillCount = tables.filter((t) => t.status === "waiting_bill").length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Mesas</h2>
          <div className="flex items-center gap-4 mt-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="text-sm text-muted-foreground">{freeCount} libres</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-orange-500"></span>
              <span className="text-sm text-muted-foreground">{occupiedCount} ocupadas</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              <span className="text-sm text-muted-foreground">{waitingBillCount} esperando cuenta</span>
            </div>
          </div>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="gap-2 rounded-xl shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95"
          size="lg"
        >
          <Plus className="h-5 w-5" />
          Nueva mesa
        </Button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {tables.map((t) => {
          const s = STATUS_MAP[t.status ?? "free"] ?? STATUS_MAP.free;
          const isOccupied = t.status === "occupied" || t.status === "waiting_bill";
          const isWaitingBill = t.status === "waiting_bill";
          return (
            <button
              key={t.id}
              onClick={() => isOccupied ? setCloseTarget(t) : undefined}
              className={cn(
                "rounded-xl p-4 text-left transition-all hover:shadow-lg border border-border relative",
                s.bg,
                isOccupied && "cursor-pointer"
              )}
            >
              {isWaitingBill && (
                <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                  <div className="absolute inset-0 border-2 border-red-500 animate-pulse-ring rounded-xl" />
                </div>
              )}
              <div className="flex items-start justify-between">
                <div className="text-3xl font-bold text-foreground">{t.number}</div>
                {t.capacity && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    {t.capacity}
                  </div>
                )}
              </div>
              {t.name && <div className="text-sm text-muted-foreground mt-0.5">{t.name}</div>}
              
              {/* Status pill */}
              <div className="mt-3">
                {isWaitingBill ? (
                  <span className="inline-flex items-center gap-1 bg-red-200 text-red-800 text-xs font-semibold px-2 py-1 rounded-full">
                    🧾 Cuenta pedida
                  </span>
                ) : (
                  <Badge variant="outline" className={cn(s.text)}>{s.label}</Badge>
                )}
              </div>
              
              {isOccupied && t.session_total !== undefined && (
                <div className="mt-2 text-lg font-bold text-foreground">{formatCLP(t.session_total)}</div>
              )}
              {isOccupied && t.session_opened_at && (
                <div className="text-xs text-muted-foreground mt-1">{minutesSince(t.session_opened_at)} min</div>
              )}
              
              {/* Action button for occupied/waiting_bill */}
              {isOccupied && (
                <Button
                  variant={isWaitingBill ? "default" : "outline"}
                  size="sm"
                  className={cn("w-full mt-3", isWaitingBill && "bg-green-600 hover:bg-green-700")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCloseTarget(t);
                  }}
                >
                  Liberar mesa
                </Button>
              )}
            </button>
          );
        })}

        {/* Ghost add button inside grid */}
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-xl p-5 border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-2 min-h-[140px] group"
        >
          <div className="h-10 w-10 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors flex items-center justify-center">
            <Plus className="h-5 w-5 text-primary" />
          </div>
          <span className="text-sm font-medium text-muted-foreground group-hover:text-primary transition-colors">Agregar</span>
        </button>
      </div>

      {/* Close table dialog */}
      <Dialog open={!!closeTarget} onOpenChange={() => setCloseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar mesa {closeTarget?.number}</DialogTitle>
            <DialogDescription>¿Deseas liberar esta mesa y cerrar la sesión activa?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleCloseTable} disabled={closing}>
              {closing ? "Cerrando..." : "Cerrar mesa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create table dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Crear nueva mesa</DialogTitle>
            <DialogDescription>
              Se asignará automáticamente el número {tables.length > 0 ? Math.max(...tables.map((t) => t.number)) + 1 : 1}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="table-name">Nombre (opcional)</Label>
              <Input
                id="table-name"
                placeholder="Ej: Terraza 1, VIP..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-capacity">Capacidad</Label>
              <Input
                id="table-capacity"
                type="number"
                min={1}
                max={20}
                value={newCapacity}
                onChange={(e) => setNewCapacity(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreateTable} disabled={creating}>
              {creating ? "Creando..." : "Crear mesa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}