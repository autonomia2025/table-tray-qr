import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/contexts/AdminContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QRCodeCanvas } from "qrcode.react";
import { Download, Printer, QrCode, AlertTriangle, RefreshCw } from "lucide-react";
import { cambiarCodigosMesa } from "@/lib/mesa";

interface TableRow2 {
  id: string;
  number: number;
  name: string | null;
  zone: string | null;
  status: string | null;
  qr_token: string | null;
}

export default function QRPage() {
  const { branchId, slug } = useAdmin();
  const { toast } = useToast();
  const [tables, setTables] = useState<TableRow2[]>([]);
  const [tenantName, setTenantName] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TableRow2 | null>(null);
  // Código de presencia de cada mesa (fase 3.5)
  const [codigos, setCodigos] = useState<Record<string, string>>({});
  const [confirmarCambio, setConfirmarCambio] = useState(false);
  const cargarCodigos = useCallback(async () => {
    if (!branchId) return;
    const { data } = await supabase.from("codigos_mesa").select("table_id, codigo").eq("branch_id", branchId);
    setCodigos(Object.fromEntries((data ?? []).map((c) => [c.table_id, c.codigo])));
  }, [branchId]);
  const cambiarCodigos = async () => {
    setConfirmarCambio(false);
    const r = await cambiarCodigosMesa(branchId);
    if (r.ok === false) { toast({ title: "No se pudieron cambiar los códigos", description: r.error, variant: "destructive" }); return; }
    toast({ title: "Códigos nuevos listos", description: "Imprime las tarjetas otra vez: los códigos anteriores ya no sirven." });
    cargarCodigos();
  };
  const dialogQrRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const tableUrl = (token: string) => `${window.location.origin}/${slug}/menu?t=${token}`;

  useEffect(() => {
    if (!branchId) return;
    (async () => {
      const { data } = await supabase
        .from("tables")
        .select("id, number, name, zone, status, qr_token")
        .eq("branch_id", branchId)
        .order("number");
      setTables(data ?? []);
      setLoading(false);
    })();
    cargarCodigos();
  }, [branchId, cargarCodigos]);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data } = await supabase.from("tenants").select("name").eq("slug", slug).maybeSingle();
      setTenantName(data?.name ?? "");
    })();
  }, [slug]);

  const downloadCanvas = (canvas: HTMLCanvasElement | null | undefined, filename: string) => {
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const downloadAll = () => {
    const canvases = sheetRef.current?.querySelectorAll("canvas");
    if (!canvases?.length) return;
    withToken.forEach((t, i) => {
      setTimeout(() => downloadCanvas(canvases[i] as HTMLCanvasElement, `qr-mesa-${t.number}.png`), i * 250);
    });
    toast({ title: "Descargando QRs", description: `${withToken.length} imágenes` });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const withToken = tables.filter((t) => t.qr_token);
  const withoutToken = tables.filter((t) => !t.qr_token);

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-sheet, #print-sheet * { visibility: visible; }
          #print-sheet { position: absolute; inset: 0; padding: 12mm; }
          .qr-card { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold text-foreground">QR por mesa</h1>
          <p className="text-sm text-muted-foreground">
            Un solo QR por mesa. El comensal escanea, pide y paga desde su teléfono.
          </p>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Cada mesa tiene además un <strong>código de 4 números</strong> que prueba que el cliente está en el local. Se pide para lo que no se paga al pedir
            (se configura en Sucursal). Si puedes, pégalo en la mesa aparte del QR: así una foto del QR no basta.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setConfirmarCambio(true)} disabled={!tables.length}>
            <RefreshCw className="mr-2 h-4 w-4" /> Cambiar códigos
          </Button>
          <Button variant="outline" onClick={downloadAll} disabled={!withToken.length}>
            <Download className="mr-2 h-4 w-4" /> Descargar todos
          </Button>
          <Button onClick={() => window.print()} disabled={!withToken.length}>
            <Printer className="mr-2 h-4 w-4" /> Imprimir tarjetas
          </Button>
        </div>
      </div>

      {withoutToken.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 no-print">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-foreground">
            {withoutToken.length} mesa(s) sin QR generado ({withoutToken.map((t) => t.number).join(", ")}). Vuelve a
            guardarlas en Mesas para generar su código.
          </p>
        </div>
      )}

      <Card className="no-print">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <QrCode className="h-4 w-4" /> Mesas
          </CardTitle>
          <CardDescription>Cada QR abre el menú con la mesa ya identificada.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mesa</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Zona</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tables.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-bold">{t.number}</TableCell>
                  <TableCell className="text-muted-foreground">{t.name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{t.zone || "—"}</TableCell>
                  <TableCell className="font-mono font-semibold tracking-widest">{codigos[t.id] ?? "—"}</TableCell>
                  <TableCell>
                    {t.qr_token ? (
                      <Badge variant="secondary">QR listo</Badge>
                    ) : (
                      <Badge variant="destructive">Sin QR</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" disabled={!t.qr_token} onClick={() => setSelected(t)}>
                      Ver QR
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {tables.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Aún no hay mesas creadas.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Hoja imprimible */}
      <div id="print-sheet" ref={sheetRef} className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {withToken.map((t) => (
          <div
            key={t.id}
            className="qr-card flex flex-col items-center rounded-2xl border-2 border-dashed border-border bg-white p-5 text-center"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">{tenantName}</p>
            <p className="mt-1 text-2xl font-black text-neutral-900">Mesa {t.number}</p>
            <div className="my-3">
              <QRCodeCanvas value={tableUrl(t.qr_token!)} size={168} level="M" includeMargin />
            </div>
            <p className="text-[11px] font-semibold text-neutral-700">
              Escanea, pide y paga desde tu teléfono
            </p>
            {codigos[t.id] && (
              <p className="mt-2 rounded-lg border border-neutral-300 px-3 py-1 text-xs text-neutral-700">
                Código de mesa: <span className="font-mono text-base font-black tracking-widest text-neutral-900">{codigos[t.id]}</span>
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Cambiar los códigos de todas las mesas */}
      <Dialog open={confirmarCambio} onOpenChange={setConfirmarCambio}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Cambiar los códigos de todas las mesas?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Úsalo si crees que alguien conoce los códigos. Después hay que imprimir las tarjetas otra vez: los códigos anteriores dejan de servir al instante.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmarCambio(false)}>Volver</Button>
            <Button onClick={cambiarCodigos}>Cambiar códigos</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detalle */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mesa {selected?.number}</DialogTitle>
          </DialogHeader>
          {selected?.qr_token && (
            <div className="flex flex-col items-center gap-4">
              <div ref={dialogQrRef} className="rounded-xl bg-white p-4">
                <QRCodeCanvas value={tableUrl(selected.qr_token)} size={220} level="M" includeMargin />
              </div>
              <p className="break-all text-center text-[11px] text-muted-foreground">
                {tableUrl(selected.qr_token)}
              </p>
              <Button
                className="w-full"
                onClick={() =>
                  downloadCanvas(
                    dialogQrRef.current?.querySelector("canvas") as HTMLCanvasElement,
                    `qr-mesa-${selected.number}.png`,
                  )
                }
              >
                <Download className="mr-2 h-4 w-4" /> Descargar PNG
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
