import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/contexts/AdminContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QRCodeCanvas } from "qrcode.react";
import { Download, Printer, QrCode } from "lucide-react";

interface TableRow2 {
  id: string;
  number: number;
  name: string | null;
  status: string | null;
  qr_token: string | null;
}

export default function QRPage() {
  const { branchId } = useAdmin();
  const { toast } = useToast();
  const [tables, setTables] = useState<TableRow2[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState<TableRow2 | null>(null);
  const [showPrintAll, setShowPrintAll] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  const fetchTables = async () => {
    const { data } = await supabase
      .from("tables")
      .select("id, number, name, status, qr_token")
      .eq("branch_id", branchId)
      .order("number");
    setTables(data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchTables(); }, [branchId]);

  const generateToken = async (table: TableRow2) => {
    let token = table.qr_token;
    if (!token) {
      token = crypto.randomUUID();
      await supabase.from("tables").update({ qr_token: token }).eq("id", table.id);
      toast({ title: "Token generado" });
      fetchTables();
    }
    setSelectedTable({ ...table, qr_token: token });
  };

  const downloadQR = () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mesa-${selectedTable?.number}-qr.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const printAll = () => {
    setShowPrintAll(true);
    setTimeout(() => window.print(), 300);
  };

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground">Tarjetas QR</h2>
        <Button variant="outline" onClick={printAll}><Printer className="h-4 w-4 mr-2" />Imprimir todas</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mesa</TableHead>
            <TableHead>Nombre</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Token</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tables.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-bold">{t.number}</TableCell>
              <TableCell>{t.name ?? "—"}</TableCell>
              <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{t.qr_token ? t.qr_token.slice(0, 8) + "…" : "—"}</TableCell>
              <TableCell>
                <Button size="sm" variant="outline" onClick={() => generateToken(t)}>
                  <QrCode className="h-4 w-4 mr-1" />{t.qr_token ? "Ver QR" : "Generar QR"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Single QR modal */}
      <Dialog open={!!selectedTable} onOpenChange={() => setSelectedTable(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mesa {selectedTable?.number}{selectedTable?.name ? ` · ${selectedTable.name}` : ""}</DialogTitle>
          </DialogHeader>
          <div ref={qrRef} className="flex justify-center py-4">
            {selectedTable?.qr_token && (
              <QRCodeCanvas value={selectedTable.qr_token} size={256} level="H" includeMargin />
            )}
          </div>
          <p className="text-center text-xs text-muted-foreground font-mono">{selectedTable?.qr_token}</p>
          <div className="flex gap-2 justify-center mt-2">
            <Button variant="outline" onClick={downloadQR}><Download className="h-4 w-4 mr-1" />Descargar PNG</Button>
            <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Imprimir</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Print-all view (hidden on screen, visible in print) */}
      {showPrintAll && (
        <div className="hidden print:block">
          <style>{`@media print { body > *:not(.print-qr-grid) { display: none !important; } .print-qr-grid { display: grid !important; } }`}</style>
          <div className="print-qr-grid grid grid-cols-3 gap-8 p-8">
            {tables.filter((t) => t.qr_token).map((t) => (
              <div key={t.id} className="flex flex-col items-center border border-border rounded-lg p-4 break-inside-avoid">
                <QRCodeCanvas value={t.qr_token!} size={180} level="H" includeMargin />
                <p className="mt-2 text-lg font-bold">Mesa {t.number}</p>
                {t.name && <p className="text-sm text-muted-foreground">{t.name}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
