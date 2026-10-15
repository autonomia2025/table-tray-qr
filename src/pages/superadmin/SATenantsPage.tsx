import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSuperAdmin } from '@/contexts/SuperAdminContext';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Loader2, Plus, Eye, UserCheck, Trash2, Download, Search, Filter } from 'lucide-react';
import { exportToCSV } from '@/lib/export-utils';
import AltaLocalDialog from '@/components/backoffice/AltaLocalDialog';
import { enlaceActivacion, estadoActivaciones, nuevoEnlaceActivacion, type EstadoActivacion } from '@/lib/altaLocal';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean | null;
  created_at: string | null;
  email: string;
  phone: string | null;
  plan_status: string | null;
  tablesCount: number;
  ordersToday: number;
  ordersWeek: number;
  lastOrderDate: string | null;
  health: 'healthy' | 'at_risk' | 'critical';
  zone: string | null;
}

interface TenantUser {
  id: string;
  source: 'tenant_member' | 'staff_user';
  name: string | null;
  email: string | null;
  role: string;
  is_active: boolean | null;
  last_sign_in_at: string | null;
}

interface TenantDetail {
  branches: { id: string; name: string; is_open: boolean | null }[];
  totalOrders: number;
  lastOrder: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  manager: 'Encargado',
  waiter: 'Mozo',
  kitchen: 'Cocina',
  cashier: 'Caja',
};


const HEALTH_CONFIG = {
  healthy: { emoji: '🟢', label: 'Saludable', color: 'text-emerald-600' },
  at_risk: { emoji: '🟡', label: 'En riesgo', color: 'text-amber-500' },
  critical: { emoji: '🔴', label: 'Crítico', color: 'text-destructive' },
};

function computeHealth(ordersWeek: number, lastOrderDate: string | null): 'healthy' | 'at_risk' | 'critical' {
  if (!lastOrderDate) return 'critical';
  const daysSince = Math.floor((Date.now() - new Date(lastOrderDate).getTime()) / 86400000);
  if (daysSince > 14 || ordersWeek === 0) return 'critical';
  if (daysSince > 7 || ordersWeek < 3) return 'at_risk';
  return 'healthy';
}

export default function SATenantsPage() {
  const { setImpersonating } = useSuperAdmin();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTenant, setSelectedTenant] = useState<TenantRow | null>(null);
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');


  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterHealth, setFilterHealth] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<TenantRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Wizard state
  const [createOpen, setCreateOpen] = useState(false);
  const [activacion, setActivacion] = useState<EstadoActivacion | null>(null);
  const [enlaceNuevo, setEnlaceNuevo] = useState('');



  const fetchTenants = async () => {
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

    const { data: tenantsData } = await supabase
      .rpc('tenants_privado')
      .select('id, name, slug, is_active, created_at, email, phone, plan_status')
      .order('created_at', { ascending: false });

    if (!tenantsData) { setLoading(false); return; }

    const enriched = await Promise.all(tenantsData.map(async (t) => {
      const [tablesRes, ordersTodayRes, ordersWeekRes, lastOrderRes] = await Promise.all([
        supabase.from('tables').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id).gte('confirmed_at', new Date().toISOString().split('T')[0]),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id).gte('confirmed_at', weekAgo.toISOString()),
        supabase.from('orders').select('confirmed_at').eq('tenant_id', t.id).order('confirmed_at', { ascending: false }).limit(1),
      ]);
      const lastOrderDate = lastOrderRes.data?.[0]?.confirmed_at ?? null;
      const ordersWeek = ordersWeekRes.count ?? 0;
      return {
        ...t,
        tablesCount: tablesRes.count ?? 0,
        ordersToday: ordersTodayRes.count ?? 0,
        ordersWeek,
        lastOrderDate,
        health: computeHealth(ordersWeek, lastOrderDate),
        zone: null, // Could be enriched from branches
      };
    }));

    setTenants(enriched);
    setLoading(false);
  };

  useEffect(() => { fetchTenants(); }, []);

  const filteredTenants = useMemo(() => {
    return tenants.filter(t => {
      if (searchQuery && !t.name.toLowerCase().includes(searchQuery.toLowerCase()) && !t.slug.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterHealth !== 'all' && t.health !== filterHealth) return false;
      if (filterStatus === 'active' && !t.is_active) return false;
      if (filterStatus === 'inactive' && t.is_active) return false;
      if (filterStatus === 'trial' && t.plan_status !== 'trial') return false;
      if (filterStatus === 'paying' && t.plan_status !== 'active') return false;
      return true;
    });
  }, [tenants, searchQuery, filterHealth, filterStatus]);

  const handleExportCSV = () => {
    exportToCSV(filteredTenants.map(t => ({
      Nombre: t.name, Slug: t.slug, Email: t.email, Teléfono: t.phone || '',
      Estado: t.is_active ? 'Activo' : 'Inactivo', Plan: t.plan_status || 'trial',
      Salud: HEALTH_CONFIG[t.health].label, Mesas: t.tablesCount, 'Pedidos hoy': t.ordersToday,
      'Pedidos semana': t.ordersWeek, 'Último pedido': t.lastOrderDate ? new Date(t.lastOrderDate).toLocaleDateString('es-CL') : '-',
      Creado: t.created_at ? new Date(t.created_at).toLocaleDateString('es-CL') : '-',
    })), 'clientes-tablio');
    toast({ title: 'CSV exportado' });
  };

  const toggleActive = async (tenant: TenantRow) => {
    // Por el servidor (fase 1.7): solo el superadmin, y queda en la auditoría.
    const { error } = await supabase.rpc('sa_activar_local', { _tenant_id: tenant.id, _activo: !tenant.is_active });
    if (error) {
      toast({ title: 'No se pudo cambiar el local', description: 'Intenta de nuevo.', variant: 'destructive' });
      return;
    }
    setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, is_active: !t.is_active } : t));
    toast({ title: `${tenant.name} ${!tenant.is_active ? 'activado' : 'desactivado'}` });
  };

  const fetchTenantUsers = async (tenantId: string) => {
    setUsersLoading(true); setUsersError(''); setTenantUsers([]);
    const { data, error } = await supabase.functions.invoke('list-tenant-users', {
      body: { tenant_id: tenantId },
    });
    if (error || data?.error) {
      setUsersError(data?.error || error?.message || 'No se pudieron cargar los usuarios');
    } else {
      setTenantUsers((data?.users ?? []) as TenantUser[]);
    }
    setUsersLoading(false);
  };

  const openDetail = async (tenant: TenantRow) => {
    setSelectedTenant(tenant); setSheetOpen(true); setDetailLoading(true); setEnlaceNuevo(''); setActivacion(null);
    fetchTenantUsers(tenant.id);
    estadoActivaciones().then((l) => setActivacion(l.find((x) => x.tenant_id === tenant.id) ?? null));
    const [branchesRes, ordersRes, lastRes] = await Promise.all([
      supabase.from('branches').select('id, name, is_open').eq('tenant_id', tenant.id),
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
      supabase.from('orders').select('confirmed_at').eq('tenant_id', tenant.id).order('confirmed_at', { ascending: false }).limit(1),
    ]);
    setDetail({ branches: branchesRes.data ?? [], totalOrders: ordersRes.count ?? 0, lastOrder: lastRes.data?.[0]?.confirmed_at ?? null });
    setDetailLoading(false);

  };

  const impersonate = async (tenantId: string) => {
    const { data: t } = await supabase.from('tenants').select('slug').eq('id', tenantId).single();
    setImpersonating(tenantId);
    sessionStorage.setItem('superadmin_impersonating_slug', t?.slug ?? '');
    navigate(`/admin/${t?.slug ?? ''}/mesas`);
  };

  const deleteTenant = async (tenant: TenantRow) => {
    setDeleting(true);
    try {
      const tenantId = tenant.id;
      const { data: menuItems } = await supabase.from('menu_items').select('id').eq('tenant_id', tenantId);
      if (menuItems?.length) {
        const itemIds = menuItems.map(i => i.id);
        const { data: groups } = await supabase.from('modifier_groups').select('id').in('menu_item_id', itemIds);
        if (groups?.length) {
          await supabase.from('modifiers').delete().in('group_id', groups.map(g => g.id));
          await supabase.from('modifier_groups').delete().in('id', groups.map(g => g.id));
        }
        await supabase.from('menu_items').delete().eq('tenant_id', tenantId);
      }
      await supabase.from('categories').delete().eq('tenant_id', tenantId);
      await supabase.from('menus').delete().eq('tenant_id', tenantId);
      const { data: orders } = await supabase.from('orders').select('id').eq('tenant_id', tenantId);
      if (orders?.length) {
        await supabase.from('order_items').delete().in('order_id', orders.map(o => o.id));
        await supabase.from('orders').delete().eq('tenant_id', tenantId);
      }
      await Promise.all([
        supabase.from('bill_requests').delete().eq('tenant_id', tenantId),
        supabase.from('waiter_calls').delete().eq('tenant_id', tenantId),
        supabase.from('table_sessions').delete().eq('tenant_id', tenantId),
        supabase.from('staff_invitations').delete().eq('tenant_id', tenantId),
        supabase.from('audit_logs').delete().eq('tenant_id', tenantId),
        supabase.from('tenant_feature_flags').delete().eq('tenant_id', tenantId),
        supabase.from('staff_users').delete().eq('tenant_id', tenantId),
      ]);
      await supabase.from('tables').delete().eq('tenant_id', tenantId);
      await supabase.from('branches').delete().eq('tenant_id', tenantId);
      await supabase.from('restaurants').delete().eq('tenant_id', tenantId);
      await supabase.from('tenant_members').delete().eq('tenant_id', tenantId);
      await supabase.from('tenants').delete().eq('id', tenantId);
      toast({ title: `${tenant.name} eliminado` });
      setTenants(prev => prev.filter(t => t.id !== tenantId));
    } catch (e: any) {
      toast({ title: 'Error eliminando', description: e?.message, variant: 'destructive' });
    } finally { setDeleting(false); setDeleteTarget(null); }
  };

  const generarEnlace = async (tenantId: string) => {
    const r = await nuevoEnlaceActivacion(tenantId);
    if (r.ok === false) { toast({ title: 'No se pudo crear el enlace', description: r.error, variant: 'destructive' }); return; }
    setEnlaceNuevo(enlaceActivacion(r.dato));
    setActivacion((await estadoActivaciones()).find((x) => x.tenant_id === tenantId) ?? null);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const healthCounts = { healthy: tenants.filter(t => t.health === 'healthy').length, at_risk: tenants.filter(t => t.health === 'at_risk').length, critical: tenants.filter(t => t.health === 'critical').length };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-foreground">Clientes</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV}><Download className="w-4 h-4 mr-1" />CSV</Button>
          <Button onClick={() => setCreateOpen(true)} size="sm"><Plus className="w-4 h-4 mr-1" />Nuevo</Button>
        </div>
      </div>

      {/* Health summary */}
      <div className="flex gap-3 mb-4">
        {Object.entries(HEALTH_CONFIG).map(([k, v]) => (
          <button key={k} onClick={() => setFilterHealth(filterHealth === k ? 'all' : k)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${filterHealth === k ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}>
            <span>{v.emoji}</span>
            <span className="font-medium">{healthCounts[k as keyof typeof healthCounts]}</span>
            <span className="text-muted-foreground text-xs hidden sm:inline">{v.label}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar cliente..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="inactive">Inactivos</SelectItem>
            <SelectItem value="trial">En prueba</SelectItem>
            <SelectItem value="paying">Pagando</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Salud</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Activo</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Mesas</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Hoy</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Semana</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Inicio</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredTenants.map(t => (
                <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <span title={HEALTH_CONFIG[t.health].label}>{HEALTH_CONFIG[t.health].emoji}</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{t.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">/{t.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={t.plan_status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                      {t.plan_status === 'active' ? 'Pagando' : t.plan_status === 'trial' ? 'Trial' : t.plan_status || 'trial'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3"><Switch checked={!!t.is_active} onCheckedChange={() => toggleActive(t)} /></td>
                  <td className="px-4 py-3 text-right">{t.tablesCount}</td>
                  <td className="px-4 py-3 text-right font-semibold">{t.ordersToday}</td>
                  <td className="px-4 py-3 text-right">{t.ordersWeek}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {t.created_at ? new Date(t.created_at).toLocaleDateString('es-CL') : '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openDetail(t)} title="Ver detalle"><Eye className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => impersonate(t.id)} title="Impersonar"><UserCheck className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(t)} title="Eliminar" className="text-destructive hover:text-destructive"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredTenants.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Sin resultados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader><SheetTitle>{selectedTenant?.name}</SheetTitle></SheetHeader>
          {detailLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : selectedTenant && detail ? (
            <div className="mt-4 space-y-4">
              <div className="space-y-2 text-sm">
                <p><span className="text-muted-foreground">Slug:</span> <span className="font-mono">/{selectedTenant.slug}</span></p>
                <p><span className="text-muted-foreground">Email:</span> {selectedTenant.email}</p>
                <p><span className="text-muted-foreground">Teléfono:</span> {selectedTenant.phone ?? '-'}</p>
                <p><span className="text-muted-foreground">Plan:</span> <Badge variant="outline" className="text-xs ml-1">{selectedTenant.plan_status || 'trial'}</Badge></p>
                <p><span className="text-muted-foreground">Salud:</span> {HEALTH_CONFIG[selectedTenant.health].emoji} {HEALTH_CONFIG[selectedTenant.health].label}</p>
              </div>
              {activacion && (
                <div className="rounded-lg border border-border p-3 text-sm" data-testid="activacion-local">
                  <h4 className="mb-1 font-semibold">Activación del dueño</h4>
                  {activacion.activado_at ? (
                    <p className="text-muted-foreground">Activado el {new Date(activacion.activado_at).toLocaleDateString('es-CL')} ({activacion.correo})</p>
                  ) : (
                    <>
                      <p className="text-muted-foreground">
                        Pendiente para {activacion.correo}. {new Date(activacion.vence_at) < new Date() ? 'El enlace venció.' : `El enlace vence el ${new Date(activacion.vence_at).toLocaleDateString('es-CL')}.`}
                      </p>
                      {enlaceNuevo ? (
                        <p className="mt-2 break-all rounded-md bg-muted/50 p-2 font-medium text-foreground">{enlaceNuevo}</p>
                      ) : (
                        <Button size="sm" variant="outline" className="mt-2" onClick={() => generarEnlace(activacion.tenant_id)}>Crear un enlace nuevo</Button>
                      )}
                    </>
                  )}
                </div>
              )}
              <div>
                <h4 className="text-sm font-semibold mb-2">Sucursales</h4>
                {detail.branches.map(b => (
                  <div key={b.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span>{b.name}</span>
                    <Badge variant={b.is_open ? 'default' : 'secondary'} className="text-[10px]">{b.is_open ? 'Abierta' : 'Cerrada'}</Badge>
                  </div>
                ))}
              </div>

              {/* Usuarios del tenant */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">Usuarios ({tenantUsers.length})</h4>
                  <span className="text-[10px] text-muted-foreground">Contraseñas no visibles</span>
                </div>
                {usersLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin" /></div>
                ) : usersError ? (
                  <p className="text-sm text-destructive">{usersError}</p>
                ) : tenantUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin usuarios registrados</p>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {tenantUsers.map(u => (
                      <div key={`${u.source}-${u.id}`} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {u.email ?? u.name ?? 'Sin email'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {u.name && u.email ? `${u.name} · ` : ''}
                            {u.last_sign_in_at
                              ? `Último acceso ${new Date(u.last_sign_in_at).toLocaleDateString('es-CL')}`
                              : 'Sin accesos'}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">{ROLE_LABELS[u.role] ?? u.role}</Badge>
                          <Badge variant={u.is_active ? 'default' : 'secondary'} className="text-[10px]">
                            {u.is_active ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{detail.totalOrders}</p>
                  <p className="text-xs text-muted-foreground">Pedidos totales</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-sm font-medium text-foreground">{detail.lastOrder ? new Date(detail.lastOrder).toLocaleDateString('es-CL') : '-'}</p>
                  <p className="text-xs text-muted-foreground">Último pedido</p>
                </div>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Alta del local (fase 5.1): se crea completo en el servidor y el dueño activa su cuenta con un enlace */}
      <AltaLocalDialog open={createOpen} onOpenChange={setCreateOpen} onCreado={fetchTenants} />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Se eliminarán todos los datos asociados. Acción irreversible.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteTenant(deleteTarget)} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
