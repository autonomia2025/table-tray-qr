import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertTriangle, Copy, UserPlus } from 'lucide-react';

function AdminAccessSection() {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenants, setTenants] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [role, setRole] = useState('owner');
  const [creating, setCreating] = useState(false);
  const [sqlOutput, setSqlOutput] = useState('');

  useEffect(() => {
    supabase.from('tenants').select('id, name, slug').order('name').then(({ data }) => setTenants(data ?? []));
  }, []);

  useEffect(() => {
    if (!selectedTenant) { setBranches([]); return; }
    supabase.from('branches').select('id, name').eq('tenant_id', selectedTenant).then(({ data }) => {
      setBranches(data ?? []);
      if (data?.[0]) setSelectedBranch(data[0].id);
    });
  }, [selectedTenant]);

  const handleCreate = async () => {
    if (!email || !password || !selectedTenant || !selectedBranch) return;
    setCreating(true);
    setSqlOutput('');

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error || !data.user) {
      toast({ title: 'Error', description: error?.message ?? 'Error creando usuario', variant: 'destructive' });
      setCreating(false);
      return;
    }

    // Insert tenant_member
    const { error: memberErr } = await supabase.from('tenant_members').insert({
      user_id: data.user.id,
      tenant_id: selectedTenant,
      branch_id: selectedBranch,
      role,
      is_active: true,
    });

    if (memberErr) {
      // Show SQL fallback
      const sql = `INSERT INTO public.tenant_members (user_id, tenant_id, branch_id, role)
SELECT '${data.user.id}', '${selectedTenant}', '${selectedBranch}', '${role}';`;
      setSqlOutput(sql);
      toast({ title: 'Usuario creado, pero hay que insertar membership manualmente', variant: 'destructive' });
    } else {
      const tenant = tenants.find(t => t.id === selectedTenant);
      toast({ title: 'Acceso creado', description: `${email} puede acceder a /admin/${tenant?.slug}/login` });
    }

    setCreating(false);
    // Sign out from this new account to keep superadmin session
    // Actually signUp doesn't sign in when autoconfirm is on... but just in case
  };

  const copySQL = () => {
    navigator.clipboard.writeText(sqlOutput);
    toast({ title: 'SQL copiado' });
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><UserPlus className="w-4 h-4" />Crear acceso admin</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@restaurante.cl" />
          </div>
          <div>
            <Label>Contraseña</Label>
            <Input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="min 6 chars" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Tenant</Label>
            <Select value={selectedTenant} onValueChange={setSelectedTenant}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sucursal</Label>
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Rol</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={handleCreate} disabled={creating || !email || !password || !selectedTenant || !selectedBranch}>
          {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Crear acceso
        </Button>
        {sqlOutput && (
          <div className="bg-muted rounded-lg p-3 mt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">SQL de fallback:</p>
              <Button variant="ghost" size="sm" onClick={copySQL}><Copy className="w-3 h-3 mr-1" />Copiar</Button>
            </div>
            <pre className="text-xs font-mono whitespace-pre-wrap">{sqlOutput}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SAConfigPage() {
  const { toast } = useToast();
  const [platformName, setPlatformName] = useState('MenuQR');
  const [baseUrl, setBaseUrl] = useState('menuqr.cl');
  const [supportEmail, setSupportEmail] = useState('soporte@menuqr.cl');
  const [creatingDemo, setCreatingDemo] = useState(false);

  const saveConfig = () => {
    toast({ title: 'Configuración guardada' });
  };

  const createDemo = async () => {
    setCreatingDemo(true);
    try {
      const { data: existing } = await supabase.from('tenants').select('id').eq('slug', 'demo-restaurant').maybeSingle();
      if (existing) {
        toast({ title: 'Ya existe', description: 'El tenant demo ya fue creado', variant: 'destructive' });
        setCreatingDemo(false);
        return;
      }

      const { data: tenant } = await supabase.from('tenants').insert({
        name: 'Demo Restaurant',
        slug: 'demo-restaurant',
        email: 'demo@menuqr.cl',
        is_active: true,
        welcome_message: '¡Bienvenido al Demo Restaurant! 🍽',
      }).select('id').single();
      if (!tenant) throw new Error('Failed');

      const { data: restaurant } = await supabase.from('restaurants').insert({
        name: 'Demo Restaurant', tenant_id: tenant.id
      }).select('id').single();
      if (!restaurant) throw new Error('Failed');

      const { data: branch } = await supabase.from('branches').insert({
        name: 'Sede Principal', restaurant_id: restaurant.id, tenant_id: tenant.id
      }).select('id').single();
      if (!branch) throw new Error('Failed');

      const { data: menu } = await supabase.from('menus').insert({
        name: 'Menú Principal', branch_id: branch.id, tenant_id: tenant.id, is_active: true
      }).select('id').single();
      if (!menu) throw new Error('Failed');

      // Seed categories & items
      const cats = [
        { name: 'Entradas', emoji: '🥗', sort_order: 0 },
        { name: 'Platos Fuertes', emoji: '🥩', sort_order: 1 },
        { name: 'Bebidas', emoji: '🥤', sort_order: 2 },
      ];
      for (const cat of cats) {
        const { data: category } = await supabase.from('categories').insert({
          name: cat.name, emoji: cat.emoji, sort_order: cat.sort_order,
          menu_id: menu.id, tenant_id: tenant.id, is_visible: true,
        }).select('id').single();
        if (!category) continue;

        const items = cat.sort_order === 0
          ? [{ name: 'Empanadas de pino', price: 3500 }, { name: 'Ensalada César', price: 5900 }]
          : cat.sort_order === 1
            ? [{ name: 'Lomito completo', price: 8900 }, { name: 'Pasta alfredo', price: 7500 }]
            : [{ name: 'Coca-Cola 350ml', price: 1500 }, { name: 'Limonada natural', price: 2500 }];

        await supabase.from('menu_items').insert(
          items.map((it, i) => ({
            name: it.name, price: it.price, category_id: category.id,
            tenant_id: tenant.id, sort_order: i, status: 'available',
          }))
        );
      }

      toast({ title: 'Demo creado', description: '/demo-restaurant listo con categorías y platos' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message ?? 'Error creando demo', variant: 'destructive' });
    } finally {
      setCreatingDemo(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-xl font-bold text-foreground">Configuración</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">Plataforma</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Nombre</Label>
            <Input value={platformName} onChange={e => setPlatformName(e.target.value)} />
          </div>
          <div>
            <Label>URL base</Label>
            <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
          </div>
          <div>
            <Label>Email de soporte</Label>
            <Input type="email" value={supportEmail} onChange={e => setSupportEmail(e.target.value)} />
          </div>
          <Button onClick={saveConfig}>Guardar</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Seed de prueba</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Crea un tenant demo con categorías y platos de ejemplo para mostrar a clientes potenciales.
          </p>
          <Button variant="outline" onClick={createDemo} disabled={creatingDemo}>
            {creatingDemo ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Crear tenant de demo
          </Button>
        </CardContent>
      </Card>

      <AdminAccessSection />

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" />Zona de peligro
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" disabled className="w-full justify-start text-muted-foreground">
            Limpiar sesiones antiguas — próximamente
          </Button>
          <Button variant="outline" disabled className="w-full justify-start text-muted-foreground">
            Exportar todos los pedidos CSV — próximamente
          </Button>
          <p className="text-xs text-muted-foreground">Estas acciones son irreversibles. Disponibles en v2.</p>
        </CardContent>
      </Card>
    </div>
  );
}
