import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Camera, X, AlertTriangle, Loader2, Check } from "lucide-react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { useCartStore } from "@/store/cartStore";
import { formatCLP } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

/* ---------- helpers ---------- */
function extractTokenFromScan(raw: string): string {
  try {
    const url = new URL(raw);
    return url.searchParams.get("t") || raw;
  } catch {
    return raw;
  }
}

async function fetchTenantId(slug: string): Promise<string | null> {
  const { data } = await supabase
    .from("tenants")
    .select("id, primary_color")
    .eq("slug", slug)
    .maybeSingle();
  return data ? data.id : null;
}

async function fetchPrimaryColor(slug: string): Promise<string> {
  const { data } = await supabase
    .from("tenants")
    .select("primary_color")
    .eq("slug", slug)
    .maybeSingle();
  return data?.primary_color || "#E8531D";
}

/* ---------- types ---------- */
type PageState = "summary" | "scanning" | "processing" | "error" | "success";

/* ---------- component ---------- */
export default function ConfirmPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const tableTokenFromUrl = searchParams.get("t");
  const orderNotes = (location.state as any)?.orderNotes || "";
  const { toast } = useToast();

  const items = useCartStore((s) => s.items);
  const getTotalPrice = useCartStore((s) => s.getTotalPrice);
  const clearCart = useCartStore((s) => s.clearCart);
  const storedTenantId = useCartStore((s) => s.tenantId);

  const { data: primaryColor = "#E8531D" } = useQuery({
    queryKey: ["primary-color", slug],
    queryFn: () => fetchPrimaryColor(slug!),
    enabled: !!slug,
    staleTime: Infinity,
  });

  const { data: tenantId } = useQuery({
    queryKey: ["tenant-id", slug],
    queryFn: () => fetchTenantId(slug!),
    enabled: !!slug && !storedTenantId,
    staleTime: Infinity,
  });

  const resolvedTenantId = storedTenantId || tenantId;

  const [pageState, setPageState] = useState<PageState>("summary");
  const [errorMsg, setErrorMsg] = useState("");
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<BrowserQRCodeReader | null>(null);
  const controlsRef = useRef<ReturnType<BrowserQRCodeReader["decodeFromVideoDevice"]> | null>(null);

  const totalPrice = getTotalPrice();

  // Redirect if cart is empty
  useEffect(() => {
    if (items.length === 0 && pageState !== "success" && pageState !== "processing") {
      navigate(`/${slug}/menu${tableTokenFromUrl ? `?t=${tableTokenFromUrl}` : ""}`, { replace: true });
    }
  }, [items.length, pageState, slug, navigate, tableTokenFromUrl]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  const startScanning = useCallback(async () => {
    setCameraError("");
    setPageState("scanning");

    try {
      const reader = new BrowserQRCodeReader();
      codeReaderRef.current = reader;

      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result, error) => {
          if (result) {
            const token = extractTokenFromScan(result.getText());
            stopCamera();
            handleScannedToken(token);
          }
          // Ignore errors during scanning (they're continuous)
        }
      );
      controlsRef.current = controls as any;
    } catch (err: any) {
      console.error("Camera error:", err);
      if (err.name === "NotAllowedError" || err.message?.includes("Permission")) {
        setCameraError("camera_denied");
      } else {
        setCameraError("camera_error");
      }
      setPageState("summary");
    }
  }, [stopCamera]);

  const cancelScanning = useCallback(() => {
    stopCamera();
    setPageState("summary");
  }, [stopCamera]);

  /* ---------- Order creation ---------- */
  const handleScannedToken = useCallback(
    async (scannedToken: string) => {
      setPageState("processing");

      try {
        // 1. Validate the scanned QR token
        const { data: tableData, error: tableError } = await supabase
          .from("tables")
          .select("id, number, name, tenant_id, branch_id, status")
          .eq("qr_token", scannedToken)
          .maybeSingle();

        if (tableError || !tableData) {
          throw new Error("QR no válido. Escanea la tarjeta de tu mesa.");
        }

        if (resolvedTenantId && tableData.tenant_id !== resolvedTenantId) {
          throw new Error("Este QR pertenece a otro restaurante.");
        }

        // 2. Find or create active table_session
        const { data: existingSession } = await supabase
          .from("table_sessions")
          .select("id, total_amount")
          .eq("table_id", tableData.id)
          .eq("is_active", true)
          .maybeSingle();

        let sessionId: string;
        let existingAmount = 0;

        if (existingSession) {
          sessionId = existingSession.id;
          existingAmount = existingSession.total_amount || 0;
        } else {
          const { data: newSession, error: sessionError } = await supabase
            .from("table_sessions")
            .insert({
              tenant_id: tableData.tenant_id,
              table_id: tableData.id,
              branch_id: tableData.branch_id,
              opened_at: new Date().toISOString(),
              is_active: true,
              total_amount: 0,
            })
            .select("id")
            .single();

          if (sessionError || !newSession) {
            throw new Error("Error creando la sesión de mesa.");
          }
          sessionId = newSession.id;
        }

        // 3. Generate order number
        const { count } = await supabase
          .from("orders")
          .select("*", { count: "exact", head: true })
          .eq("branch_id", tableData.branch_id);

        const orderNumber = (count || 0) + 1;

        // 4. Create the order
        const currentItems = useCartStore.getState().items;
        const currentTotalPrice = useCartStore.getState().getTotalPrice();

        const { data: order, error: orderError } = await supabase
          .from("orders")
          .insert({
            tenant_id: tableData.tenant_id,
            session_id: sessionId,
            table_id: tableData.id,
            branch_id: tableData.branch_id,
            order_number: orderNumber,
            status: "confirmed",
            source: "customer_qr",
            total_amount: currentTotalPrice,
            notes: orderNotes || null,
            confirmed_at: new Date().toISOString(),
          })
          .select("id, order_number")
          .single();

        if (orderError || !order) {
          throw new Error("Error al crear el pedido. Intenta de nuevo.");
        }

        // 5. Create order_items
        const orderItems = currentItems.map((item) => ({
          tenant_id: tableData.tenant_id,
          order_id: order.id,
          menu_item_id: item.menuItemId,
          menu_item_name: item.name,
          unit_price: item.unitPrice,
          quantity: item.quantity,
          subtotal: item.subtotal,
          selected_modifiers: item.selectedModifiers,
          item_notes: item.itemNotes || null,
        }));

        const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
        if (itemsError) {
          throw new Error("Error al guardar los ítems del pedido.");
        }

        // 6. Update table status + session total
        await supabase
          .from("tables")
          .update({ status: "occupied" })
          .eq("id", tableData.id);

        await supabase
          .from("table_sessions")
          .update({ total_amount: existingAmount + currentTotalPrice })
          .eq("id", sessionId);

        // 7. Increment total_orders for each menu item
        const itemCounts = new Map<string, number>();
        for (const ci of currentItems) {
          itemCounts.set(ci.menuItemId, (itemCounts.get(ci.menuItemId) || 0) + ci.quantity);
        }
        for (const [menuItemId, qty] of itemCounts) {
          const { data: mi } = await supabase
            .from("menu_items")
            .select("total_orders")
            .eq("id", menuItemId)
            .maybeSingle();
          if (mi) {
            await supabase
              .from("menu_items")
              .update({ total_orders: (mi.total_orders || 0) + qty })
              .eq("id", menuItemId);
          }
        }

        // 8. Success
        setPageState("success");
        clearCart();

        setTimeout(() => {
          navigate(`/${slug}/tracking?t=${scannedToken}&order=${order.id}`, { replace: true });
        }, 1500);
      } catch (err: any) {
        console.error("Order creation error:", err);
        setErrorMsg(err.message || "Error desconocido");
        setPageState("error");
      }
    },
    [resolvedTenantId, orderNotes, clearCart, navigate, slug],
  );

  const qs = tableTokenFromUrl ? `?t=${tableTokenFromUrl}` : "";

  /* ========== RENDER ========== */
  return (
    <div className="min-h-screen bg-background">
      {/* Hidden video element for QR scanning */}
      <video ref={videoRef} className="hidden" />

      {/* Header — always visible except during scanning */}
      {pageState !== "scanning" && pageState !== "processing" && pageState !== "success" && (
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background px-4">
          <button
            onClick={() => navigate(`/${slug}/cart${qs}`)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="text-sm font-bold text-foreground">Confirmar pedido</span>
          <div className="w-9" />
        </header>
      )}

      <AnimatePresence mode="wait">
        {/* STATE: SUMMARY */}
        {pageState === "summary" && (
          <motion.div
            key="summary"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-4 pt-4 pb-6"
          >
            {/* Order summary */}
            <div className="rounded-xl border border-border bg-card p-4 mb-4">
              <h3 className="text-sm font-bold text-card-foreground mb-3">Resumen del pedido</h3>
              {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-card-foreground">
                    {item.quantity}× {item.name}
                  </span>
                  <span className="text-sm text-muted-foreground">{formatCLP(item.subtotal)}</span>
                </div>
              ))}
              <hr className="my-2 border-border" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-card-foreground">Total</span>
                <span className="text-base font-bold" style={{ color: primaryColor }}>
                  {formatCLP(totalPrice)}
                </span>
              </div>
            </div>

            {orderNotes && (
              <div className="rounded-xl border border-border bg-card p-3 mb-4">
                <p className="text-xs text-muted-foreground">Nota: {orderNotes}</p>
              </div>
            )}

            <hr className="my-5 border-border" />

            {/* Scan section */}
            <div className="text-center">
              <h2 className="text-xl font-bold text-foreground mb-2">Último paso 🎯</h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-[280px] mx-auto">
                Escanea el QR de la tarjeta de tu mesa para enviar el pedido a cocina
              </p>

              {/* Animated viewfinder illustration */}
              <div className="flex justify-center mb-6">
                <motion.div
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="relative h-40 w-40"
                >
                  {/* Corner brackets */}
                  <div className="absolute top-0 left-0 h-8 w-8 border-t-[3px] border-l-[3px] rounded-tl-md" style={{ borderColor: primaryColor }} />
                  <div className="absolute top-0 right-0 h-8 w-8 border-t-[3px] border-r-[3px] rounded-tr-md" style={{ borderColor: primaryColor }} />
                  <div className="absolute bottom-0 left-0 h-8 w-8 border-b-[3px] border-l-[3px] rounded-bl-md" style={{ borderColor: primaryColor }} />
                  <div className="absolute bottom-0 right-0 h-8 w-8 border-b-[3px] border-r-[3px] rounded-br-md" style={{ borderColor: primaryColor }} />
                  {/* QR icon */}
                  <div className="flex h-full w-full items-center justify-center text-5xl opacity-30">📱</div>
                </motion.div>
              </div>

              {/* Camera permission error */}
              {cameraError && (
                <div className="mx-auto mb-4 max-w-[300px] rounded-xl bg-yellow-50 border border-yellow-200 p-3">
                  <p className="text-xs text-yellow-800 font-medium">
                    {cameraError === "camera_denied"
                      ? "Necesitamos acceso a la cámara para escanear el QR. Habilita el permiso en la configuración de tu navegador."
                      : "Error al acceder a la cámara. Intenta de nuevo."}
                  </p>
                </div>
              )}

              <button
                onClick={startScanning}
                className="flex items-center justify-center gap-2 mx-auto rounded-2xl px-8 py-4 text-base font-semibold text-white shadow-lg transition-transform active:scale-[0.97]"
                style={{ backgroundColor: primaryColor, minHeight: "3.5rem" }}
              >
                <Camera className="h-5 w-5" />
                Abrir cámara y escanear
              </button>
            </div>
          </motion.div>
        )}

        {/* STATE: SCANNING */}
        {pageState === "scanning" && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black"
          >
            {/* Camera feed */}
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              autoPlay
              playsInline
              muted
            />

            {/* Dark overlay with cutout */}
            <div className="absolute inset-0 flex items-center justify-center">
              {/* Top */}
              <div className="absolute top-0 left-0 right-0 bg-black/60" style={{ height: "calc(50% - 130px)" }} />
              {/* Bottom */}
              <div className="absolute bottom-0 left-0 right-0 bg-black/60" style={{ height: "calc(50% - 130px)" }} />
              {/* Left */}
              <div className="absolute bg-black/60" style={{ top: "calc(50% - 130px)", bottom: "calc(50% - 130px)", left: 0, width: "calc(50% - 130px)" }} />
              {/* Right */}
              <div className="absolute bg-black/60" style={{ top: "calc(50% - 130px)", bottom: "calc(50% - 130px)", right: 0, width: "calc(50% - 130px)" }} />

              {/* Viewfinder */}
              <div className="relative h-[260px] w-[260px]">
                {/* Corners */}
                <div className="absolute top-0 left-0 h-10 w-10 border-t-[3px] border-l-[3px] rounded-tl" style={{ borderColor: primaryColor }} />
                <div className="absolute top-0 right-0 h-10 w-10 border-t-[3px] border-r-[3px] rounded-tr" style={{ borderColor: primaryColor }} />
                <div className="absolute bottom-0 left-0 h-10 w-10 border-b-[3px] border-l-[3px] rounded-bl" style={{ borderColor: primaryColor }} />
                <div className="absolute bottom-0 right-0 h-10 w-10 border-b-[3px] border-r-[3px] rounded-br" style={{ borderColor: primaryColor }} />

                {/* Scan line */}
                <motion.div
                  className="absolute left-2 right-2 h-0.5 rounded-full"
                  style={{ backgroundColor: primaryColor }}
                  animate={{ top: ["10%", "90%", "10%"] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
            </div>

            {/* Text */}
            <div className="absolute bottom-32 left-0 right-0 text-center">
              <p className="text-white text-sm font-medium">Apunta al QR de la tarjeta de mesa</p>
            </div>

            {/* Cancel button */}
            <button
              onClick={cancelScanning}
              className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-white/20 backdrop-blur-sm px-6 py-3 text-sm font-semibold text-white"
            >
              <X className="h-4 w-4" /> Cancelar
            </button>
          </motion.div>
        )}

        {/* STATE: PROCESSING */}
        {pageState === "processing" && (
          <motion.div
            key="processing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background"
          >
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
            <p className="mt-4 text-base font-semibold text-foreground">Creando tu pedido...</p>
            <p className="mt-1 text-sm text-muted-foreground">No cierres esta pantalla</p>
          </motion.div>
        )}

        {/* STATE: SUCCESS */}
        {pageState === "success" && (
          <motion.div
            key="success"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="flex h-24 w-24 items-center justify-center rounded-full"
              style={{ backgroundColor: "#22c55e" }}
            >
              <Check className="h-12 w-12 text-white" />
            </motion.div>
            <p className="mt-5 text-xl font-bold text-foreground">¡Pedido enviado! 🎉</p>
            <p className="mt-1 text-sm text-muted-foreground">Tu pedido ya está en cocina</p>
          </motion.div>
        )}

        {/* STATE: ERROR */}
        {pageState === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center px-6 pt-20 text-center"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-10 w-10 text-destructive" />
            </div>
            <p className="mt-4 text-base font-bold text-foreground">Error al crear el pedido</p>
            <p className="mt-1 text-sm text-muted-foreground max-w-[280px]">{errorMsg}</p>
            <button
              onClick={() => {
                setErrorMsg("");
                startScanning();
              }}
              className="mt-6 flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-semibold text-white"
              style={{ backgroundColor: primaryColor }}
            >
              <Camera className="h-4 w-4" /> Intentar de nuevo
            </button>
            <button
              onClick={() => navigate(`/${slug}/cart${qs}`)}
              className="mt-3 text-sm text-muted-foreground underline"
            >
              Volver al carrito
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
