import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { MapPin, ArrowRight, ShoppingBag } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import defaultCover from "@/assets/default-cover.jpg";

interface TenantData {
  id: string;
  name: string;
  primary_color: string | null;
  secondary_color: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  welcome_message: string | null;
  branch_name: string;
  branch_id: string;
  is_open: boolean;
}

const fetchTenantBySlug = async (slug: string): Promise<TenantData | null> => {
  const { data, error } = await supabase
    .from("tenants")
    .select(`
      id, name, primary_color, secondary_color, logo_url, cover_image_url, welcome_message,
      restaurants!inner(
        branches!inner(id, name, is_open)
      )
    `)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;

  const restaurants = data.restaurants as any[];
  const branch = restaurants?.[0]?.branches?.[0];
  if (!branch) return null;

  return {
    id: data.id,
    name: data.name,
    primary_color: data.primary_color,
    secondary_color: data.secondary_color,
    logo_url: data.logo_url,
    cover_image_url: data.cover_image_url,
    welcome_message: data.welcome_message,
    branch_name: branch.name,
    branch_id: branch.id,
    is_open: branch.is_open ?? true,
  };
};

const SplashSkeleton = () => (
  <div className="fixed inset-0 bg-muted flex flex-col items-center justify-center gap-4 p-6">
    <Skeleton className="h-24 w-24 rounded-full" />
    <Skeleton className="h-8 w-48" />
    <Skeleton className="h-5 w-64" />
    <div className="absolute bottom-8 left-6 right-6">
      <Skeleton className="h-14 w-full rounded-2xl" />
    </div>
  </div>
);

const NotFound = () => (
  <div className="fixed inset-0 bg-background flex flex-col items-center justify-center gap-4 p-6 text-center">
    <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center">
      <MapPin className="h-10 w-10 text-muted-foreground" />
    </div>
    <h1 className="text-xl font-bold text-foreground">Restaurante no encontrado</h1>
    <p className="text-muted-foreground text-sm max-w-[260px]">
      Revisa el enlace o escanea nuevamente el QR de tu mesa.
    </p>
  </div>
);

export default function RestaurantSplash() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tableToken = searchParams.get("t");

  const { data: tenant, isLoading, isError } = useQuery({
    queryKey: ["tenant-splash", slug],
    queryFn: () => fetchTenantBySlug(slug!),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });

  // Check for active session if table token exists
  const { data: activeSession } = useQuery({
    queryKey: ["active-session", tableToken],
    queryFn: async () => {
      if (!tableToken) return null;
      const { data: table } = await supabase
        .from("tables")
        .select("id")
        .eq("qr_token", tableToken)
        .maybeSingle();
      if (!table) return null;

      const { data: session } = await supabase
        .from("table_sessions")
        .select("id")
        .eq("table_id", table.id)
        .eq("is_active", true)
        .maybeSingle();
      return session;
    },
    enabled: !!tableToken,
  });

  if (isLoading) return <SplashSkeleton />;
  if (isError || !tenant) return <NotFound />;

  const primaryColor = tenant.primary_color || "#E8531D";
  const coverImage = tenant.cover_image_url || defaultCover;
  const initial = tenant.name.charAt(0).toUpperCase();

  const handleGoToMenu = () => {
    const params = new URLSearchParams();
    if (tableToken) params.set("t", tableToken);
    const qs = params.toString();
    navigate(`/${slug}/menu${qs ? `?${qs}` : ""}`, {
      state: { tenantId: tenant.id, branchId: tenant.branch_id },
    });
  };

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* Cover image */}
      <motion.div
        className="absolute inset-0"
        initial={{ scale: 1.1 }}
        animate={{ scale: 1 }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      >
        <img
          src={coverImage}
          alt={tenant.name}
          className="h-full w-full object-cover"
        />
      </motion.div>

      {/* Overlay */}
      <div className="absolute inset-0 bg-[hsl(var(--overlay-dark))]" />

      {/* Active session banner */}
      {activeSession && (
        <motion.button
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          onClick={() => navigate(`/${slug}/tracking${tableToken ? `?t=${tableToken}` : ""}`)}
          className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center gap-2 py-3 px-4 text-sm font-medium"
          style={{ backgroundColor: primaryColor, color: "#fff" }}
        >
          <ShoppingBag className="h-4 w-4" />
          Tienes un pedido activo →
        </motion.button>
      )}

      {/* Content */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6">
        <motion.div
          className="flex flex-col items-center gap-4 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          {/* Logo */}
          {tenant.logo_url ? (
            <img
              src={tenant.logo_url}
              alt={`Logo ${tenant.name}`}
              className="h-24 w-24 rounded-full object-cover shadow-xl border-2"
              style={{ borderColor: `${primaryColor}40` }}
            />
          ) : (
            <div
              className="flex h-24 w-24 items-center justify-center rounded-full text-3xl font-bold shadow-xl"
              style={{ backgroundColor: primaryColor, color: "#fff" }}
            >
              {initial}
            </div>
          )}

          {/* Restaurant name */}
          <h1 className="text-[28px] font-bold leading-tight text-[hsl(var(--text-on-overlay))]">
            {tenant.name}
          </h1>

          {/* Welcome message */}
          {tenant.welcome_message && (
            <p className="max-w-[280px] text-base text-[hsl(var(--text-on-overlay-muted))]">
              {tenant.welcome_message}
            </p>
          )}

          {/* Branch info */}
          <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--text-on-overlay-muted))]">
            <MapPin className="h-3.5 w-3.5" />
            <span>{tenant.branch_name}</span>
            <span className="mx-1">·</span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{
                backgroundColor: tenant.is_open ? "#22c55e20" : "#ef444420",
                color: tenant.is_open ? "#4ade80" : "#f87171",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: tenant.is_open ? "#4ade80" : "#f87171" }}
              />
              {tenant.is_open ? "Abierto" : "Cerrado"}
            </span>
          </div>
        </motion.div>
      </div>

      {/* Bottom CTA */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 z-10 p-6 pb-8"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.7 }}
      >
        <button
          onClick={handleGoToMenu}
          disabled={!tenant.is_open}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-semibold shadow-lg transition-transform active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: tenant.is_open ? primaryColor : "#6b7280",
            color: "#fff",
            minHeight: "var(--touch-min)",
          }}
        >
          {tenant.is_open ? (
            <>
              Ver el menú
              <ArrowRight className="h-5 w-5" />
            </>
          ) : (
            "Cerrado por ahora"
          )}
        </button>
      </motion.div>
    </div>
  );
}
