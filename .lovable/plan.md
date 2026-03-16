

## Plan: KDS Page Enhancements (Single File)

All changes are in `src/pages/KDSPage.tsx`. Six changes applied together:

### 1. Imports
Add `useMemo` to the React import on line 1.

### 2. OrderCard updates
- Add `onDisableItem` optional prop
- Replace item name rendering with flex row containing "86" button (for `new`/`kitchen` columns)
- Add "ENTREGADO" button for `ready` column
- Increase all 3 button sizes: `py-4 text-lg`, `minHeight: 56`

### 3. KDSColumn updates
- Add optional props: `recentlyDelivered`, `onDisableItem`, `groupedNewItems`
- Render grouped summary at top of "new" column (before AnimatePresence) when `newOrders.length > 1`
- Render recently delivered log at bottom of "ready" column (after AnimatePresence)
- Pass `onDisableItem` through to OrderCard

### 4. KDSBoard updates
- New state: `deliveredToday`, `recentlyDelivered`, `disabledItems`
- `handleAction`: when `newStatus === "delivered"`, set `delivered_at`, increment counter, add to recent log, and remove from active orders optimistically
- `groupedNewItems` useMemo computed from `newOrders`
- `handleDisableItem` callback: looks up `menu_item_id` from `order_items`, updates `menu_items` status to `out_of_stock`
- Header: add delivered counter next to clock
- Pass new props to KDSColumn instances

### Files changed
- `src/pages/KDSPage.tsx` only

