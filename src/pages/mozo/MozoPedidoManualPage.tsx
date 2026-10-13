import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWaiters } from "@/contexts/WaitersContext";
import { supabase } from "@/integrations/supabase/client";
import { crearPedidoMozo } from "@/lib/pedidos";
import { formatCLP } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Plus, Minus, ShoppingCart, Trash2, Check } from "lucide-react";

interface Category {
  id: string;
  name: string;
  emoji: string | null;
  sort_order: number | null;
}

interface MenuItem {
  id: string;
  name: string;
  price: number;
  description_short: string | null;
  image_url: string | null;
  category_id: string;
  status: string | null;
}

interface Opcion {
  id: string;
  name: string;
  extra_price: number;
  is_available: boolean;
}

interface Grupo {
  id: string;
  menu_item_id: string;
  name: string;
  type: string;
  required: boolean;
  min_selections: number;
  max_selections: number;
  opciones: Opcion[];
}

interface OpcionElegida {
  groupName: string;
  modifierName: string;
  extraPrice: number;
}

interface LineaCarrito {
  clave: string;
  item: MenuItem;
  cantidad: number;
  opciones: OpcionElegida[];
  nota: string;
}

const precioUnitario = (l: Pick<LineaCarrito, "item" | "opciones">) =>
  l.item.price + l.opciones.reduce((s, o) => s + o.extraPrice, 0);

const maximoDe = (g: Grupo) => (g.type === "choose_one" ? 1 : g.max_selections > 0 ? g.max_selections : 99);
const minimoDe = (g: Grupo) => (g.required ? Math.max(g.min_selections || 1, 1) : 0);

/**
 * Pedido tomado por el mozo (fase 1.9). El precio, las opciones obligatorias y el número de pedido
 * los valida y calcula el servidor (crear_pedido_mozo); esta pantalla solo arma el pedido.
 */
export default function MozoPedidoManualPage() {
  const { tableId } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const { branchId, tenantId } = useWaiters();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [cart, setCart] = useState<LineaCarrito[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tableNumber, setTableNumber] = useState<number>(0);

  // Hoja para elegir opciones de un producto
  const [eligiendo, setEligiendo] = useState<MenuItem | null>(null);
  const [seleccion, setSeleccion] = useState<Record<string, string[]>>({});
  const [cantidad, setCantidad] = useState(1);
  const [nota, setNota] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data: table } = await supabase.from("tables").select("number").eq("id", tableId!).single();
      if (table) setTableNumber(table.number);

      const { data: menu } = await supabase
        .from("menus")
        .select("id")
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (!menu) { setLoading(false); return; }

      const [catsRes, itemsRes, gruposRes] = await Promise.all([
        supabase.from("categories").select("id, name, emoji, sort_order").eq("menu_id", menu.id).eq("is_visible", true).order("sort_order"),
        supabase.from("menu_items").select("id, name, price, description_short, image_url, category_id, status").eq("tenant_id", tenantId).eq("status", "available").order("sort_order"),
        supabase
          .from("modifier_groups")
          .select("id, menu_item_id, name, type, required, min_selections, max_selections, sort_order, modifiers(id, name, extra_price, is_available, sort_order)")
          .eq("tenant_id", tenantId)
          .order("sort_order"),
      ]);

      const cats = catsRes.data ?? [];
      setCategories(cats);
      setItems(itemsRes.data ?? []);
      setGrupos(
        (gruposRes.data ?? []).map((g) => ({
          id: g.id,
          menu_item_id: g.menu_item_id,
          name: g.name,
          type: g.type ?? "choose_one",
          required: g.required ?? false,
          min_selections: g.min_selections ?? 0,
          max_selections: g.max_selections ?? 1,
          opciones: ((g.modifiers ?? []) as Array<Opcion & { sort_order: number | null }>)
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map((m) => ({ id: m.id, name: m.name, extra_price: m.extra_price ?? 0, is_available: m.is_available !== false })),
        })),
      );
      if (cats.length > 0) setSelectedCat(cats[0].id);
      setLoading(false);
    };
    load();
  }, [tableId, branchId, tenantId]);

  const filteredItems = useMemo(() => {
    if (!selectedCat) return items;
    return items.filter((i) => i.category_id === selectedCat);
  }, [items, selectedCat]);

  const gruposDe = (itemId: string) => grupos.filter((g) => g.menu_item_id === itemId);

  const agregarLinea = (item: MenuItem, opciones: OpcionElegida[], cant: number, notaLinea: string) => {
    const clave = `${item.id}|${opciones.map((o) => `${o.groupName}:${o.modifierName}`).sort().join(",")}|${notaLinea}`;
    setCart((prev) => {
      const existente = prev.find((l) => l.clave === clave);
      if (existente) return prev.map((l) => (l.clave === clave ? { ...l, cantidad: Math.min(20, l.cantidad + cant) } : l));
      return [...prev, { clave, item, cantidad: cant, opciones, nota: notaLinea }];
    });
  };

  const tocarProducto = (item: MenuItem) => {
    if (gruposDe(item.id).length === 0) {
      agregarLinea(item, [], 1, "");
      return;
    }
    setEligiendo(item);
    setSeleccion({});
    setCantidad(1);
    setNota("");
  };

  const alternarOpcion = (g: Grupo, nombre: string) => {
    setSeleccion((prev) => {
      const actual = prev[g.id] ?? [];
      if (g.type === "choose_one") return { ...prev, [g.id]: [nombre] };
      if (actual.includes(nombre)) return { ...prev, [g.id]: actual.filter((n) => n !== nombre) };
      if (actual.length >= maximoDe(g)) return prev;
      return { ...prev, [g.id]: [...actual, nombre] };
    });
  };

  const gruposEligiendo = eligiendo ? gruposDe(eligiendo.id) : [];
  const faltantes = gruposEligiendo.filter((g) => (seleccion[g.id]?.length ?? 0) < minimoDe(g));
  const opcionesElegidas: OpcionElegida[] = gruposEligiendo.flatMap((g) =>
    (seleccion[g.id] ?? []).map((nombre) => ({
      groupName: g.name,
      modifierName: nombre,
      extraPrice: g.opciones.find((o) => o.name === nombre)?.extra_price ?? 0,
    })),
  );
  const precioEligiendo = eligiendo ? (eligiendo.price + opcionesElegidas.reduce((s, o) => s + o.extraPrice, 0)) * cantidad : 0;

  const confirmarOpciones = () => {
    if (!eligiendo || faltantes.length > 0) return;
    agregarLinea(eligiendo, opcionesElegidas, cantidad, nota.trim().slice(0, 200));
    setEligiendo(null);
  };

  const updateQty = (clave: string, delta: number) => {
    setCart((prev) =>
      prev.map((l) => (l.clave !== clave ? l : { ...l, cantidad: Math.max(1, Math.min(20, l.cantidad + delta)) })),
    );
  };

  const removeFromCart = (clave: string) => setCart((prev) => prev.filter((l) => l.clave !== clave));

  const cantidadEn = (itemId: string) => cart.filter((l) => l.item.id === itemId).reduce((s, l) => s + l.cantidad, 0);
  const cartTotal = cart.reduce((s, l) => s + precioUnitario(l) * l.cantidad, 0);
  const cartCount = cart.reduce((s, l) => s + l.cantidad, 0);

  const submitOrder = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    const r = await crearPedidoMozo(
      tableId!,
      cart.map((l) => ({
        menu_item_id: l.item.id,
        quantity: l.cantidad,
        modifiers: l.opciones.map((o) => ({ groupName: o.groupName, modifierName: o.modifierName })),
        notes: l.nota || null,
      })),
    );
    setSubmitting(false);
    if (r.ok === false) {
      toast({ title: "No se pudo crear el pedido", description: r.error, variant: "destructive" });
      return;
    }
    toast({
      title: `Pedido #${r.numero} creado · ${formatCLP(r.total)}`,
      description: r.esperaPago
        ? `Mesa ${tableNumber}: cóbralo para que pase a cocina.`
        : `Mesa ${tableNumber}: ya va a cocina.`,
    });
    navigate("/mozo/mesas");
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border bg-card">
        <Button variant="ghost" size="icon" onClick={() => navigate("/mozo/mesas")} aria-label="Volver">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h2 className="text-sm font-bold">Pedido manual · Mesa {tableNumber}</h2>
          <p className="text-xs text-muted-foreground">Selecciona productos de la carta</p>
        </div>
        {cartCount > 0 && (
          <Button variant="outline" size="sm" className="relative" onClick={() => setCartOpen(true)} aria-label="Ver pedido">
            <ShoppingCart className="h-4 w-4 mr-1" />
            {cartCount}
          </Button>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3 border-b border-border bg-background no-scrollbar">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCat(cat.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              selectedCat === cat.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {cat.emoji} {cat.name}
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-2">
          {filteredItems.map((item) => {
            const enCarrito = cantidadEn(item.id);
            const conOpciones = gruposDe(item.id).length > 0;
            return (
              <div key={item.id} className="flex items-center gap-3 bg-card border border-border rounded-xl p-3">
                {item.image_url && (
                  <img src={item.image_url} alt={item.name} className="w-12 h-12 rounded-md object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  {item.description_short && <p className="text-xs text-muted-foreground truncate">{item.description_short}</p>}
                  <p className="text-sm font-semibold text-primary">
                    {formatCLP(item.price)}
                    {conOpciones && <span className="ml-1 text-[11px] font-normal text-muted-foreground">· con opciones</span>}
                  </p>
                </div>
                {enCarrito > 0 && <Badge variant="secondary">{enCarrito}</Badge>}
                <Button size="sm" variant="outline" onClick={() => tocarProducto(item)} aria-label={`Agregar ${item.name}`}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating cart bar */}
      {cartCount > 0 && (
        <div className="border-t border-border bg-card p-4 safe-area-bottom">
          <Button className="w-full h-12" disabled={submitting} onClick={submitOrder}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Confirmar pedido · {formatCLP(cartTotal)}
          </Button>
        </div>
      )}

      {/* Elegir opciones */}
      <Sheet open={!!eligiendo} onOpenChange={(o) => { if (!o) setEligiendo(null); }}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-auto rounded-t-2xl px-4 pb-8">
          <SheetHeader className="mb-3 text-left">
            <SheetTitle>{eligiendo?.name}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            {gruposEligiendo.map((g) => {
              const elegidas = seleccion[g.id] ?? [];
              return (
                <div key={g.id}>
                  <div className="mb-2 flex items-center gap-2">
                    <p className="text-sm font-semibold">{g.name}</p>
                    {g.required ? (
                      <Badge variant={elegidas.length >= minimoDe(g) ? "secondary" : "default"} className="text-[10px]">Obligatorio</Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Opcional · hasta {maximoDe(g)}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {g.opciones.map((o) => {
                      const activa = elegidas.includes(o.name);
                      const bloqueada = !o.is_available || (!activa && g.type !== "choose_one" && elegidas.length >= maximoDe(g));
                      return (
                        <button
                          key={o.id}
                          disabled={bloqueada}
                          onClick={() => alternarOpcion(g, o.name)}
                          className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-40 ${
                            activa ? "border-primary bg-primary/10 font-semibold" : "border-border bg-card"
                          }`}
                        >
                          <span className="truncate">{o.name}</span>
                          <span className="ml-2 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                            {o.extra_price > 0 && `+${formatCLP(o.extra_price)}`}
                            {activa && <Check className="h-3.5 w-3.5 text-primary" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <Input placeholder="Nota para cocina (opcional)" value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} />

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Cantidad</span>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCantidad((c) => Math.max(1, c - 1))} aria-label="Menos">
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-6 text-center text-sm font-bold">{cantidad}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCantidad((c) => Math.min(20, c + 1))} aria-label="Más">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <Button className="w-full h-12" disabled={faltantes.length > 0} onClick={confirmarOpciones}>
              {faltantes.length > 0 ? `Elige ${faltantes[0].name.toLowerCase()}` : `Agregar · ${formatCLP(precioEligiendo)}`}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Cart sheet */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="max-h-[70vh] rounded-t-2xl px-4 pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle>Pedido ({cartCount} productos)</SheetTitle>
          </SheetHeader>
          <div className="space-y-2 max-h-[40vh] overflow-auto">
            {cart.map((l) => (
              <div key={l.clave} className="flex items-center gap-3 p-2 bg-muted/50 rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{l.item.name}</p>
                  {l.opciones.length > 0 && (
                    <p className="text-xs text-muted-foreground truncate">{l.opciones.map((o) => o.modifierName).join(" · ")}</p>
                  )}
                  {l.nota && <p className="text-xs italic text-muted-foreground truncate">"{l.nota}"</p>}
                  <p className="text-xs text-muted-foreground">{formatCLP(precioUnitario(l))} × {l.cantidad}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQty(l.clave, -1)} aria-label="Menos">
                    <Minus className="h-3 w-3" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQty(l.clave, 1)} aria-label="Más">
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <span className="w-16 text-right text-sm font-semibold">{formatCLP(precioUnitario(l) * l.cantidad)}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeFromCart(l.clave)} aria-label="Quitar">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center mt-4 text-lg font-bold">
            <span>Total</span>
            <span>{formatCLP(cartTotal)}</span>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
