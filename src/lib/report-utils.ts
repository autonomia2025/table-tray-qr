import { supabase } from "@/integrations/supabase/client";

// ── Date helpers ──────────────────────────────────────────────
export function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
export function endOfDay(d: Date) { const r = new Date(d); r.setHours(23,59,59,999); return r; }
export function startOfWeek(d: Date) { const r = startOfDay(d); r.setDate(r.getDate() - r.getDay()); return r; }
export function startOfMonth(d: Date) { const r = startOfDay(d); r.setDate(1); return r; }
export function startOfYear(d: Date) { const r = startOfDay(d); r.setMonth(0,1); return r; }
export function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return startOfDay(d); }

export type Period = "day" | "week" | "month" | "year";

export function periodRange(period: Period, offset = 0): { from: Date; to: Date } {
  const now = new Date();
  let from: Date, to: Date;
  switch (period) {
    case "day":
      from = startOfDay(now); from.setDate(from.getDate() + offset);
      to = endOfDay(from);
      break;
    case "week":
      from = startOfWeek(now); from.setDate(from.getDate() + offset * 7);
      to = new Date(from); to.setDate(to.getDate() + 6); to = endOfDay(to);
      break;
    case "month":
      from = startOfMonth(now); from.setMonth(from.getMonth() + offset);
      to = new Date(from); to.setMonth(to.getMonth() + 1); to.setDate(0); to = endOfDay(to);
      break;
    case "year":
      from = startOfYear(now); from.setFullYear(from.getFullYear() + offset);
      to = new Date(from); to.setFullYear(to.getFullYear() + 1); to.setDate(to.getDate() - 1); to = endOfDay(to);
      break;
  }
  return { from, to };
}

export function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

// ── Formatters ──────────────────────────────────────────────
export function fmtCLP(n: number) { return "$" + n.toLocaleString("es-CL"); }
export function fmtPct(n: number) { return (n >= 0 ? "+" : "") + n + "%"; }
export function fmtMin(seconds: number) { return Math.round(seconds / 60) + " min"; }

// ── Fetch all rows (bypasses 1000 limit) ──────────────────
export async function fetchAll<T>(
  table: string,
  select: string,
  filters: { column: string; op: string; value: string | boolean | number }[]
): Promise<T[]> {
  const PAGE = 1000;
  let all: T[] = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    let q = supabase.from(table).select(select).range(page * PAGE, (page + 1) * PAGE - 1);
    for (const f of filters) {
      if (f.op === "eq") q = q.eq(f.column, f.value);
      else if (f.op === "gte") q = q.gte(f.column, f.value);
      else if (f.op === "lte") q = q.lte(f.column, f.value);
      else if (f.op === "neq") q = q.neq(f.column, f.value);
    }
    const { data } = await q;
    if (!data || data.length === 0) { hasMore = false; break; }
    all = all.concat(data as T[]);
    if (data.length < PAGE) hasMore = false;
    page++;
  }
  return all;
}
