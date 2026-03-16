

## Plan: Customer Panel Improvements

Two files, no DB changes needed.

### FILE 1: TrackingPage.tsx

**Change 1A — Status sublabels**
- Update `STATUS_MAP` type to include `sublabel: string` field (line 41-47)
- Add sublabels: "El cocinero lo verá en un momento", "Listo en aprox. 10-15 min", "El mozo lo trae ahora", "", ""
- Render sublabel below the status in the progress bar area (after the ready message around line 550-562), showing it for the current status

**Change 1B — Session order list**
- Already implemented (lines 638-715). The existing "Tu visita completa" section already shows all orders with expand/collapse and session total. No changes needed here -- the request is already satisfied by the current code.

**Change 1C — Waiter call improvements**
- Add state: `waiterCallId`, `waiterCallStatus` (track the last call made)
- After inserting waiter_call (line 353-360), store the returned ID in `waiterCallId` and set status to "pending"
- Add realtime subscription on `waiter_calls` table for the stored call ID to track status changes
- Add `cancelWaiterCall` function that updates status to "cancelled" and clears state
- Render a banner below the action buttons when a call is active: green bg for pending ("El mozo está en camino"), checkmark for attended
- Show "Cancelar llamada" underline button when pending

**Change 1D — Session total above actions**
- Already implemented (lines 707-714). The session total card exists below the history. Since the user wants it *above* the action buttons, move the total rendering to appear before the action buttons section (line 599) instead of after the history section. Add it as a simple flex row (not a card) when `orders.length > 0`.

### FILE 2: ItemDetailPage.tsx

**Change 2A — Full-width hero with overlaid back button**
- The current image is already `aspect-video w-full` (line 360) with a separate back button above it (lines 352-357)
- Modify: set the image container to `height: 280` instead of `aspect-video`
- Move the back button inside the image container as an absolute overlay with `bg-black/40 backdrop-blur-sm text-white`
- When `image_is_real` is true, overlay labels at bottom-left
- When no real image exists, render a spacer `div` with `h-14` and keep the back button in its original position (non-overlaid)

**Change 2B — Social proof**
- Add `total_orders` to the `ItemDetail` interface (already exists in the type, line 39 area -- need to check)
- Need to add `total_orders` to the fetch query and interface
- Below the item name `h1` (line 382), render "🔥 X personas lo pidieron" when `total_orders > 5`

**Change 2C — Prep time pill**
- Already rendered inline with price (lines 388-392). Make it more prominent: render as a separate pill below the name/social-proof area using `bg-muted` rounded-full style with Clock icon.

### Files changed
- `src/pages/TrackingPage.tsx`
- `src/pages/ItemDetailPage.tsx`

