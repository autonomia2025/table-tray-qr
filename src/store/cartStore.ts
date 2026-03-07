import { create } from "zustand";

export interface CartModifier {
  groupName: string;
  modifierName: string;
  extraPrice: number;
}

export interface CartItem {
  id: string; // unique cart line id
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  selectedModifiers: CartModifier[];
  itemNotes: string;
  subtotal: number;
}

interface CartState {
  items: CartItem[];
  tableToken: string | null;
  tenantId: string | null;
  branchId: string | null;
  addItem: (item: Omit<CartItem, "id" | "subtotal">) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  setTableContext: (tableToken: string | null, tenantId: string | null, branchId: string | null) => void;
  getTotalItems: () => number;
  getTotalPrice: () => number;
}

const calcSubtotal = (item: Pick<CartItem, "unitPrice" | "quantity" | "selectedModifiers">) =>
  (item.unitPrice + item.selectedModifiers.reduce((s, m) => s + m.extraPrice, 0)) * item.quantity;

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  tableToken: null,
  tenantId: null,
  branchId: null,

  addItem: (item) => {
    const id = crypto.randomUUID();
    const subtotal = calcSubtotal(item);
    set((s) => ({ items: [...s.items, { ...item, id, subtotal }] }));
  },

  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

  updateQuantity: (id, quantity) => {
    if (quantity <= 0) {
      set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      return;
    }
    set((s) => ({
      items: s.items.map((i) =>
        i.id === id ? { ...i, quantity, subtotal: calcSubtotal({ ...i, quantity }) } : i
      ),
    }));
  },

  clearCart: () => set({ items: [] }),

  setTableContext: (tableToken, tenantId, branchId) => set({ tableToken, tenantId, branchId }),

  getTotalItems: () => get().items.reduce((s, i) => s + i.quantity, 0),

  getTotalPrice: () => get().items.reduce((s, i) => s + i.subtotal, 0),
}));
