import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Pencil, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';

interface Seller {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  zone: string | null;
  is_active: boolean;
  created_at: string | null;
}

interface LeadCount {
  assigned_seller_id: string;
  stage: string;
}

const ZONES = ['Barrio Italia', 'Ñuñoa', 'Lastarria', 'Providencia'];
const ROLES = [
  { value: 'vendedor', label: 'Vendedor' },
  { value: 'jefe_ventas', label: 'Jefe de Ventas' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'finanzas', label: 'Finanzas' },
  { value: 'customer_success', label: 'Customer Success' },
];

export default function BackofficeVendedores() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [leads, setLeads] = useState<LeadCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Seller | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'vendedor', zone: '' });

  const load = async () => {
    const [sellersRes, leadsRes] = await Promise.all([
      supabase.from('backoffice_members').select('*').order('created_at', { ascending: false }),
      supabase.from('leads').select('assigned_seller_id, stage'),
    ]);
    setSellers((sellersRes.data as Seller[]) || []);
    setLeads((leadsRes.data as LeadCount[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', email: '', phone: '', role: 'vendedor', zone: '' });
    setDialogOpen(true);
  };

  const openEdit = (s: Seller) => {
    setEditing(s);
    setForm({ name: s.name, email: s.email, phone: s.phone || '', role: s.role, zone: s.zone || '' });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.email) return toast.error('Nombre y email son requeridos');
    if (editing) {
      const { error } = await supabase.from('backoffice_members').update({
        name: form.name, email: form.email, phone: form.phone || null, role: form.role, zone: form.zone || null,
      }).eq('id', editing.id);
      if (error) return toast.error(error.message);
      toast.success('Miembro actualizado');
    } else {
      const { error } = await supabase.from('backoffice_members').insert({
        name: form.name, email: form.email, phone: form.phone || null, role: form.role, zone: form.zone || null,
      });
      if (error) return toast.error(error.message);
      toast.success('Miembro creado');
    }
    setDialogOpen(false);
    load();
  };

  const toggleActive = async (s: Seller) => {
    await supabase.from('backoffice_members').update({ is_active: !s.is_active }).eq('id', s.id);
    toast.success(s.is_active ? 'Desactivado' : 'Activado');
    load();
  };

  const getSellerStats = (id: string) => {
    const sl = leads.filter(l => l.assigned_seller_id === id);
    return {
      total: sl.length,
      demos: sl.filter(l => ['demo_agendada', 'demo_hecha'].includes(l.stage)).length,
      pilotos: sl.filter(l => l.stage === 'piloto_activo').length,
      pagando: sl.filter(l => l.stage === 'cliente_pagando').length,
      conversion: sl.length > 0 ? ((sl.filter(l => l.stage === 'cliente_pagando').length / sl.length) * 100).toFixed(0) : '0',
    };
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Equipo</h1>
          <p className="text-sm text-muted-foreground">{sellers.length} miembros</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" />Agregar</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? 'Editar miembro' : 'Nuevo miembro'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Nombre completo" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <Input placeholder="Email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              <Input placeholder="Teléfono" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={form.zone} onValueChange={v => setForm(f => ({ ...f, zone: v }))}>
                <SelectTrigger><SelectValue placeholder="Zona" /></SelectTrigger>
                <SelectContent>
                  {ZONES.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={handleSave} className="w-full">{editing ? 'Guardar cambios' : 'Crear miembro'}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Zona</TableHead>
                <TableHead className="text-center">Leads</TableHead>
                <TableHead className="text-center">Demos</TableHead>
                <TableHead className="text-center">Pilotos</TableHead>
                <TableHead className="text-center">Pagando</TableHead>
                <TableHead className="text-center">Conv.</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sellers.map(s => {
                const stats = getSellerStats(s.id);
                return (
                  <TableRow key={s.id} className={!s.is_active ? 'opacity-50' : ''}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground text-sm">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">{s.role.replace('_', ' ')}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.zone || '—'}</TableCell>
                    <TableCell className="text-center font-semibold text-sm">{stats.total}</TableCell>
                    <TableCell className="text-center text-sm">{stats.demos}</TableCell>
                    <TableCell className="text-center text-sm">{stats.pilotos}</TableCell>
                    <TableCell className="text-center text-sm font-semibold text-primary">{stats.pagando}</TableCell>
                    <TableCell className="text-center text-sm">{stats.conversion}%</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => toggleActive(s)}>
                          {s.is_active ? <UserX className="w-3.5 h-3.5 text-destructive" /> : <UserCheck className="w-3.5 h-3.5 text-primary" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {sellers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">No hay miembros registrados</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
