import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/contexts/AdminContext";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  free: { label: "Libre", bg: "bg-green-100", text: "text-green-800" },
  occupied: { label: "Ocupada", bg: "bg-orange-100", text: "text-orange-800" },
  waiting_bill: { label: "Esperando cuenta", bg: "bg-red-100", text: "text-red-800" },
  reserved: { label: "Reservada", bg: "bg-muted", text: "text-muted-foreground" },
};

function minutesSince(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

export default function MesasPage() {
  const { branchId } = useAdmin();
  const { toast } = useToast();
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [closeTarget, setCloseTarget] = useState<TableRow | null>(null);
  const [closing, setClosing] = useState(false);

  const fetchTables = async () => {
    const { data, error } = await supabase
      .from("tables")
      .select("id, number, name, status, capacity")
      .eq("branch_id", branchId)
      .order("number");

    if (error || !data) return;

    // For occupied/waiting_bill tables, get session info
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
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tables", filter: `branch_id=eq.${branchId}` }, () => {
        fetchTables();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [branchId]);

  const handleCloseTable = async () => {
    if (!closeTarget) return;
    setClosing(true);
    try {
      await supabase.from("tables").update({ status: "free" }).eq("id", closeTarget.id);
      await supabase
        .from("table_sessions")
        .update({ is_active: false, closed_at: new Date().toISOString() } as any)
        .eq("table_id", closeTarget.id)
        .eq("is_active", true);
      toast({ title: "Mesa cerrada", description: `Mesa ${closeTarget.number} liberada` });
      setCloseTarget(null);
      fetchTables();
    } catch {
      toast({ title: "Error", description: "No se pudo cerrar la mesa", variant: "destructive" });
    } finally {
      setClosing(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div>
      <h2 className="text-2xl font-bold text-foreground mb-6">Mesas</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {tables.map((t) => {
          const s = STATUS_MAP[t.status ?? "free"] ?? STATUS_MAP.free;
          const isOccupied = t.status === "occupied" || t.status === "waiting_bill";
          return (
            <button
              key={t.id}
              onClick={() => isOccupied ? setCloseTarget(t) : undefined}
              className={cn(
                "rounded-xl p-5 text-left transition-shadow hover:shadow-lg border border-border",
                s.bg,
                isOccupied && "cursor-pointer"
              )}
            >
              <div className="text-3xl font-bold text-foreground">{t.number}</div>
              {t.name && <div className="text-sm text-muted-foreground mt-0.5">{t.name}</div>}
              <Badge variant="outline" className={cn("mt-3", s.text)}>{s.label}</Badge>
              {isOccupied && t.session_total !== undefined && (
                <div className="mt-2 text-sm font-semibold text-foreground">{formatCLP(t.session_total)}</div>
              )}
              {isOccupied && t.session_opened_at && (
                <div className="text-xs text-muted-foreground mt-1">{minutesSince(t.session_opened_at)} min</div>
              )}
            </button>
          );
        })}
      </div>

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
    </div>
  );
}
