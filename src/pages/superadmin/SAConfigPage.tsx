import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertTriangle } from 'lucide-react';

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
