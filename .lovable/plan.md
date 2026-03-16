

## Plan: Admin Panel Improvements

Three files, no DB changes needed.

### FILE 1: PedidosPage.tsx

**Change 1A — Elapsed time warning badge**
- Add `ElapsedBadge` component using a custom `useElapsedMinutes` hook (updates every 30s)
- Shows nothing for orders <10min, yellow badge for 10-19min, red badge for ≥20min
- Render it inside the `OrderCard` component, in the top row next to the clock/timeAgo display (line ~184)

**Change 1B — Quick cancel button on order cards**
- Add `handleCancelOrder` function using `window.confirm()` for quick cancellation (no reason dialog needed for this shortcut)
- Add a small "Cancelar pedido" link below the total in `OrderCard` for orders with status `confirmed` or `in_kitchen`
- The existing cancel-with-reason dialog remains available from the detail view

### FILE 2: MenuAdminPage.tsx

**Change 2A — "86" quick stock toggle button**
- Add `handleToggleStock` function that toggles between `available` and `out_of_stock`, updates DB and local state optimistically
- Add a small button next to existing action buttons in item cards (line ~391-396 area) showing "86" or "✓ Agotado"

**Change 2B — "Ver menú del cliente" preview link**
- Destructure `slug` from `useAdmin()` (line 52, already has `tenantId, branchId`)
- Add a small link in the header area (line 332) next to the "Menú" title

### FILE 3: ReportesPage.tsx

**Change 3A — Export CSV button**
- Add `exportOrdersCSV` utility function before the component that generates a semicolon-delimited CSV with BOM for Excel compatibility
- Add an export button next to `PeriodSelector` in the header (line 122-125), wrapping both in a flex row with gap

### Files changed
- `src/pages/admin/PedidosPage.tsx`
- `src/pages/admin/MenuAdminPage.tsx`
- `src/pages/admin/ReportesPage.tsx`

