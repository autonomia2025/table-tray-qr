

## Plan: Waiter Panel Improvements

Three files, no DB changes needed.

### FILE 1: MozoLayout.tsx
- Add `useRef` to imports
- Add `playNotifSound()` function before the component (higher pitch than notifications page sound)
- Add `prevNotifCountRef` and `audioUnlockedRef` refs
- Add click listener effect to unlock AudioContext
- Add effect that plays sound when `notifCount` increases

### FILE 2: MozoMesasPage.tsx
- Add `Dialog, DialogContent, DialogHeader, DialogTitle` imports
- Add `callCount` to `TableData` interface
- Add `transferOpen`, `otherWaiters` state
- In `fetchTables`: fetch pending `waiter_calls` for occupied tables, build `callCountMap`, set `callCount` on each table
- Add `handleTransfer` (fetches other active staff) and `confirmTransfer` (updates `assigned_waiter_id`) functions
- In Sheet footer: add "Transferir a otro mozo" button after "Cerrar mesa" (only when table is mine)
- After Sheet: add Dialog for waiter selection list
- In `TableCard`: add bell badge overlay when `callCount > 0`

### FILE 3: MozoNotificacionesPage.tsx
- Add `timeAgo` helper function (returns "ahora", "hace 1 min", "hace N min")
- Add `isUrgent` computation per notification item (>5 min old)
- Apply `animate-pulse ring-1 ring-red-400` class to urgent notification cards (calls, bills, orders)
- Add `timeAgo` timestamp display to each call and bill card (orders already show "hace X min")

### What stays untouched
- WaitersContext, MozoLoginPage, MozoJoinPage, MozoPerfilPage, MozoPedidoManualPage
- Routing, PIN auth, confirmPaymentAndRelease logic

