import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSuperAdmin } from '@/contexts/SuperAdminContext';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Eye, UserCheck } from 'lucide-react';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean | null;
  created_at: string | null;
  email: string;
  phone: string | null;
  tablesCount: number;
  ordersToday: number;
}

interface TenantDetail {
  branches: { id: string; name: string; is_open: boolean | null }[];
  totalOrders: number;
  lastOrder: string | null;
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
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchTenants = async () => {
    const { data: tenantsData } = await supabase
      .from('tenants')
      .select('id, name, slug, is_active, created_at, email, phone')
      .order('created_at', { ascending: false });

    if (!tenantsData) { setLoading(false); return; }

    // Get counts
    const enriched = await Promise.all(tenantsData.map(async (t) => {
      const [tablesRes, ordersRes] = await Promise.all([
        supabase.from('tables').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id).gte('confirmed_at', new Date().toISOString().split('T')[0]),
      ]);
      return { ...t, tablesCount: tablesRes.count ?? 0, ordersToday: ordersRes.count ?? 0 };
    }));

    setTenants(enriched);
    setLoading(false);
  };

  useEffect(() => { fetchTenants(); }, []);

  const toggleActive = async (tenant: TenantRow) => {
    await supabase.from('tenants').update({ is_active: !tenant.is_active }).eq('id', tenant.id);
    setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, is_active: !t.is_active } : t));
    toast({ title: `${tenant.name} ${!tenant.is_active ? 'activado' : 'desactivado'}` });
  };

  const openDetail = async (tenant: TenantRow) => {
    setSelectedTenant(tenant);
    setSheetOpen(true);
    setDetailLoading(true);
    const [branchesRes, ordersRes, lastRes] = await Promise.all([
      supabase.from('branches').select('id, name, is_open').eq('tenant_id', tenant.id),
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
      supabase.from('orders').select('confirmed_at').eq('tenant_id', tenant.id).order('confirmed_at', { ascending: false }).limit(1),
    ]);
    setDetail({
      branches: branchesRes.data ?? [],
      totalOrders: ordersRes.count ?? 0,
      lastOrder: lastRes.data?.[0]?.confirmed_at ?? null,
    });
    setDetailLoading(false);
  };

  const impersonate = async (tenantId: string) => {
    // Get slug for the tenant
    const { data: t } = await supabase.from('tenants').select('slug').eq('id', tenantId).single();
    setImpersonating(tenantId);
    sessionStorage.setItem('superadmin_impersonating_slug', t?.slug ?? '');
    navigate(`/admin/${t?.slug ?? ''}/mesas`);
  };

  const createTenant = async () => {
    if (!newName.trim() || !newSlug.trim() || !newEmail.trim()) return;
    setCreating(true);
    try {
      // Check slug uniqueness
      const { data: existing } = await supabase.from('tenants').select('id').eq('slug', newSlug.toLowerCase().trim()).maybeSingle();
      if (existing) { toast({ title: 'Error', description: 'El slug ya existe', variant: 'destructive' }); setCreating(false); return; }

      const { data: tenant, error: tErr } = await supabase.from('tenants').insert({
        name: newName.trim(),
        slug: newSlug.toLowerCase().trim(),
        email: newEmail.trim(),
        is_active: true,
      }).select('id').single();
      if (tErr || !tenant) throw tErr;

      const { data: restaurant } = await supabase.from('restaurants').insert({
        name: newName.trim(),
        tenant_id: tenant.id,
      }).select('id').single();
      if (!restaurant) throw new Error('Failed to create restaurant');

      const { data: branch } = await supabase.from('branches').insert({
        name: 'Principal',
        restaurant_id: restaurant.id,
        tenant_id: tenant.id,
      }).select('id').single();
      if (!branch) throw new Error('Failed to create branch');

      await supabase.from('menus').insert({
        name: 'Menú Principal',
        branch_id: branch.id,
        tenant_id: tenant.id,
        is_active: true,
      });

      toast({ title: 'Tenant creado', description: `/${newSlug} listo` });
      setCreateOpen(false);
      setNewName(''); setNewSlug(''); setNewEmail('');
      fetchTenants();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message ?? 'Error creando tenant', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-foreground">Tenants</h1>
        <Button onClick={() => setCreateOpen(true)} size="sm"><Plus className="w-4 h-4 mr-1" />Nuevo tenant</Button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Slug</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Activo</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Mesas</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Hoy</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Creado</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tenants.map(t => (
                <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{t.name}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">/{t.slug}</td>
                  <td className="px-4 py-3">
                    <Switch checked={!!t.is_active} onCheckedChange={() => toggleActive(t)} />
                  </td>
                  <td className="px-4 py-3 text-right">{t.tablesCount}</td>
                  <td className="px-4 py-3 text-right font-semibold">{t.ordersToday}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {t.created_at ? new Date(t.created_at).toLocaleDateString('es-CL') : '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openDetail(t)} title="Ver detalle">
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => impersonate(t.id)} title="Impersonar">
                        <UserCheck className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selectedTenant?.name}</SheetTitle>
          </SheetHeader>
          {detailLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : selectedTenant && detail ? (
            <div className="mt-4 space-y-4">
              <div className="space-y-2 text-sm">
                <p><span className="text-muted-foreground">Slug:</span> <span className="font-mono">/{selectedTenant.slug}</span></p>
                <p><span className="text-muted-foreground">Email:</span> {selectedTenant.email}</p>
                <p><span className="text-muted-foreground">Teléfono:</span> {selectedTenant.phone ?? '-'}</p>
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-2">Sucursales</h4>
                {detail.branches.map(b => (
                  <div key={b.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span>{b.name}</span>
                    <Badge variant={b.is_open ? 'default' : 'secondary'} className="text-[10px]">
                      {b.is_open ? 'Abierta' : 'Cerrada'}
                    </Badge>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{detail.totalOrders}</p>
                  <p className="text-xs text-muted-foreground">Pedidos totales</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-sm font-medium text-foreground">
                    {detail.lastOrder ? new Date(detail.lastOrder).toLocaleDateString('es-CL') : '-'}
                  </p>
                  <p className="text-xs text-muted-foreground">Último pedido</p>
                </div>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo tenant</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Mi Restaurante" />
            </div>
            <div>
              <Label>Slug</Label>
              <Input value={newSlug} onChange={e => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="mi-restaurante" />
              <p className="text-xs text-muted-foreground mt-1">menuqr.cl/{newSlug || '...'}</p>
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="contacto@email.com" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={createTenant} disabled={creating || !newName.trim() || !newSlug.trim() || !newEmail.trim()}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
