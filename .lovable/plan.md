

# Plan: 4 Features - Centro de Pedidos, Reportes, Modificadores (ya listos), Pedido Manual del Mozo

## Analysis

After reviewing the codebase and the document, here's the status:

- **Modificadores en ItemDetailPage**: Already fully implemented. The page handles `remove`, `add`, `choose_one`, `choose_many` types with proper validation, pricing, and cart integration. No changes needed.
- **Centro de Pedidos (Kanban)**: Does not exist. Needs a new page at `/admin/:slug/pedidos`.
- **Reportes e Insights**: Does not exist. Needs a new page at `/admin/:slug/reportes`.
- **Pedido Manual del Mozo**: Does not exist. Needs a new flow from the waiter app.

## Implementation

### 1. Centro de Pedidos Kanban (`/admin/:slug/pedidos`)

New file: `src/pages/admin/PedidosPage.tsx`

- 5-column Kanban layout: Nuevos (confirmed) | En cocina (in_kitchen) | Listos (ready) | Entregados (delivered) | Cancelados (cancelled)
- Each card: order number, table number, time elapsed, item summary, special notes in red
- Filters: by table number, by time range (today/yesterday/custom)
- Click card to open detail dialog with full breakdown, timestamps per status
- Actions: advance status, cancel with required reason
- Supabase Realtime subscription on `orders` table for live updates
- Desktop: horizontal scroll columns. Mobile: tabs for each column
- Query: `orders` JOIN `tables` (for number) + `order_items` for the detail

### 2. Reportes e Insights (`/admin/:slug/reportes`)

New file: `src/pages/admin/ReportesPage.tsx`

- Summary cards row: ventas del dia, pedidos del dia, ticket promedio, comparativo vs ayer
- Bar chart (recharts): ventas por hora del dia actual
- Top 5 platos: query `order_items` grouped by `menu_item_name`, count, sorted desc
- Category breakdown: orders by category
- All queries scoped to `tenant_id` and `branch_id`
- Date picker to change the day being analyzed

### 3. Pedido Manual del Mozo

New file: `src/pages/mozo/MozoPedidoManualPage.tsx`

- From MozoMesasPage bottom sheet, add button "Pedir por cliente"
- Opens a simplified menu browser (reuse menu fetching logic from MenuPage)
- Category tabs + item cards
- Tap item -> add to a local cart (separate from customer cart store)
- Cart summary with confirm button
- On confirm: INSERT into `orders` with `source = 'waiter'`, linked to the selected table's active session
- Also INSERT `order_items`
- Navigate back to mesas after success

### 4. Route Registration

Update `App.tsx`:
- Add route `/admin/:slug/pedidos` -> `PedidosPage`
- Add route `/admin/:slug/reportes` -> `ReportesPage`  
- Add route `/mozo/pedido-manual/:tableId` -> `MozoPedidoManualPage`

Update `AdminLayout.tsx`:
- Add "Pedidos" and "Reportes" nav items

Update `MozoMesasPage.tsx`:
- Add "Pedir por cliente" button in the bottom sheet

### Files to create
- `src/pages/admin/PedidosPage.tsx`
- `src/pages/admin/ReportesPage.tsx`
- `src/pages/mozo/MozoPedidoManualPage.tsx`

### Files to edit
- `src/App.tsx` (add routes)
- `src/pages/admin/AdminLayout.tsx` (add nav items)
- `src/pages/mozo/MozoMesasPage.tsx` (add manual order button)

### Note on Modifiers
The ItemDetailPage already fully supports all 4 modifier types (remove, add, choose_one, choose_many) with validation, pricing, and cart integration. No work needed here.

