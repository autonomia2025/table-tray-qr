import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/contexts/AdminContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QRCodeCanvas } from "qrcode.react";
import { Download, Printer, QrCode, UtensilsCrossed, CreditCard } from "lucide-react";

interface TableRow2 {
  id: string;
  number: number;
  name: string | null;
  status: string | null;
  qr_token: string | null;
}

export default function QRPage() {
  const { branchId, slug } = useAdmin();
  const { toast } = useToast();
  const [tables, setTables] = useState<TableRow2[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState<TableRow2 | null>(null);
  const [selectedQrType, setSelectedQrType] = useState<"mesa" | "tarjeta">("mesa");
  const [showPrintAll, setShowPrintAll] = useState(false);
  const [printAllType, setPrintAllType] = useState<"mesa" | "tarjeta">("mesa");
  const qrRef = useRef<HTMLDivElement>(null);

  const menuBaseUrl = `${window.location.origin}/${slug}/menu`;
  const menuUrlForTable = (tableNumber: number) => `${menuBaseUrl}?mesa=${tableNumber}`;

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
    return token;
  };

  const openQrModal = async (table: TableRow2, type: "mesa" | "tarjeta") => {
    if (type === "tarjeta") {
      const token = await generateToken(table);
      setSelectedTable({ ...table, qr_token: token });
    } else {
      setSelectedTable(table);
    }
    setSelectedQrType(type);
  };

  const getQrValue = () => {
    if (selectedQrType === "mesa") return menuUrlForTable(selectedTable?.number ?? 0);
    return selectedTable?.qr_token || "";
  };

  const downloadQR = () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const prefix = selectedQrType === "mesa" ? "mesa-menu" : "tarjeta";
      a.download = `${prefix}-${selectedTable?.number}-qr.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const printAll = (type: "mesa" | "tarjeta") => {
    setPrintAllType(type);
    setShowPrintAll(true);
    setTimeout(() => window.print(), 300);
  };

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground">Tarjetas QR</h2>
      </div>

      <Tabs defaultValue="mesa" className="w-full">
        <TabsList className="w-full mb-4">
          <TabsTrigger value="mesa" className="flex-1 gap-1.5">
            <UtensilsCrossed className="h-4 w-4" />
            QR Mesa
          </TabsTrigger>
          <TabsTrigger value="tarjeta" className="flex-1 gap-1.5">
            <CreditCard className="h-4 w-4" />
            QR Tarjeta
          </TabsTrigger>
        </TabsList>

        {/* ── QR MESA ── */}
        <TabsContent value="mesa">
          <div className="rounded-xl border border-border bg-card p-4 mb-4">
            <p className="text-sm text-muted-foreground">
              Este QR va <strong>pegado en la mesa</strong>. Al escanearlo, el cliente abre el menú e identifica automáticamente su mesa.
              Ejemplo: <code className="text-xs bg-muted px-1 py-0.5 rounded">{menuUrlForTable(1)}</code>
            </p>
          </div>

          <div className="flex justify-end mb-3">
            <Button variant="outline" size="sm" onClick={() => printAll("mesa")}>
              <Printer className="h-4 w-4 mr-2" />Imprimir todas
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mesa</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tables.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-bold">{t.number}</TableCell>
                  <TableCell>{t.name ?? "—"}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => openQrModal(t, "mesa")}>
                      <QrCode className="h-4 w-4 mr-1" />Ver QR
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        {/* ── QR TARJETA ── */}
        <TabsContent value="tarjeta">
          <div className="rounded-xl border border-border bg-card p-4 mb-4">
            <p className="text-sm text-muted-foreground">
              Este QR va en la <strong>tarjeta que entrega el mozo</strong> al cliente. Se usa para confirmar pedidos, llamar al mozo y pedir la cuenta.
              Cada mesa tiene un token único.
            </p>
          </div>

          <div className="flex justify-end mb-3">
            <Button variant="outline" size="sm" onClick={() => printAll("tarjeta")}>
              <Printer className="h-4 w-4 mr-2" />Imprimir todas
            </Button>
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
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {t.qr_token ? t.qr_token.slice(0, 8) + "…" : "—"}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => openQrModal(t, "tarjeta")}>
                      <QrCode className="h-4 w-4 mr-1" />{t.qr_token ? "Ver QR" : "Generar QR"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>

      {/* Single QR modal */}
      <Dialog open={!!selectedTable} onOpenChange={() => setSelectedTable(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {selectedQrType === "mesa" ? "QR Mesa" : "QR Tarjeta"} · Mesa {selectedTable?.number}
              {selectedTable?.name ? ` · ${selectedTable.name}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div ref={qrRef} className="flex flex-col items-center py-4">
            <QRCodeCanvas value={getQrValue()} size={256} level="H" includeMargin />
            <p className="mt-3 text-center text-sm font-semibold text-foreground">
              {selectedQrType === "mesa"
                ? "Escanea para ver el menú 🍽"
                : "Escanea para confirmar tu pedido ✅"}
            </p>
          </div>
          <p className="text-center text-xs text-muted-foreground font-mono break-all">
            {selectedQrType === "mesa" ? menuUrlForTable(selectedTable?.number ?? 0) : selectedTable?.qr_token}
          </p>
          <div className="flex gap-2 justify-center mt-2">
            <Button variant="outline" onClick={downloadQR}><Download className="h-4 w-4 mr-1" />Descargar PNG</Button>
            <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Imprimir</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Print-all view */}
      {showPrintAll && (
        <div className="hidden print:block">
          <style>{`@media print { body > *:not(.print-qr-grid) { display: none !important; } .print-qr-grid { display: grid !important; } }`}</style>
          <div className="print-qr-grid grid grid-cols-3 gap-8 p-8">
            {printAllType === "mesa"
              ? tables.map((t) => (
                  <div key={t.id} className="flex flex-col items-center border border-border rounded-lg p-4 break-inside-avoid">
                    <QRCodeCanvas value={menuUrl} size={180} level="H" includeMargin />
                    <p className="mt-2 text-lg font-bold">Mesa {t.number}</p>
                    {t.name && <p className="text-sm text-muted-foreground">{t.name}</p>}
                    <p className="text-xs text-muted-foreground mt-1">Escanea para ver el menú 🍽</p>
                  </div>
                ))
              : tables.filter((t) => t.qr_token).map((t) => (
                  <div key={t.id} className="flex flex-col items-center border border-border rounded-lg p-4 break-inside-avoid">
                    <QRCodeCanvas value={t.qr_token!} size={180} level="H" includeMargin />
                    <p className="mt-2 text-lg font-bold">Mesa {t.number}</p>
                    {t.name && <p className="text-sm text-muted-foreground">{t.name}</p>}
                    <p className="text-xs text-muted-foreground mt-1">Escanea para confirmar ✅</p>
                  </div>
                ))}
          </div>
        </div>
      )}
    </div>
  );
}
