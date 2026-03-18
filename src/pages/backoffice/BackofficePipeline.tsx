import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Phone, Mail, MapPin, Calendar, ChevronRight, GripVertical } from 'lucide-react';
import { toast } from 'sonner';

const STAGES = [
  { key: 'contactado', label: 'Contactado', color: 'hsl(16,80%,51%)' },
  { key: 'demo_agendada', label: 'Demo agendada', color: 'hsl(30,90%,55%)' },
  { key: 'demo_hecha', label: 'Demo hecha', color: 'hsl(45,90%,50%)' },
  { key: 'piloto_activo', label: 'Piloto activo', color: 'hsl(200,70%,50%)' },
  { key: 'cliente_pagando', label: 'Pagando', color: 'hsl(145,60%,42%)' },
  { key: 'frio', label: 'Frío', color: 'hsl(220,15%,60%)' },
];

const ZONES = ['Barrio Italia', 'Ñuñoa', 'Lastarria', 'Providencia'];
const SOURCES = ['terreno', 'instagram', 'referido', 'google', 'otro'];
const TEMPERATURES = ['caliente', 'tibio', 'frio'];

interface Lead {
  id: string;
  restaurant_name: string;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  zone: string | null;
  stage: string;
  source: string | null;
  assigned_seller_id: string | null;
  temperature: string | null;
  notes: string | null;
  next_action: string | null;
  next_action_date: string | null;
  monthly_value: number | null;
  created_at: string | null;
  updated_at: string | null;
}

interface Seller {
  id: string;
  name: string;
}

export default function BackofficePipeline() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newLead, setNewLead] = useState({
    restaurant_name: '', owner_name: '', phone: '', email: '', zone: '', stage: 'contactado',
    source: 'terreno', assigned_seller_id: '', temperature: 'tibio', notes: '', monthly_value: 299,
  });

  const load = async () => {
    const [leadsRes, sellersRes] = await Promise.all([
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
      supabase.from('backoffice_members').select('id, name').eq('role', 'vendedor'),
    ]);
    setLeads((leadsRes.data as Lead[]) || []);
    setSellers((sellersRes.data as Seller[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const moveStage = async (leadId: string, newStage: string) => {
    await supabase.from('leads').update({ stage: newStage, updated_at: new Date().toISOString() }).eq('id', leadId);
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: newStage } : l));
    if (detailLead?.id === leadId) setDetailLead(prev => prev ? { ...prev, stage: newStage } : null);
    toast.success(`Movido a ${STAGES.find(s => s.key === newStage)?.label}`);
  };

  const handleCreate = async () => {
    if (!newLead.restaurant_name) return toast.error('Nombre del local es requerido');
    const { error } = await supabase.from('leads').insert({
      restaurant_name: newLead.restaurant_name,
      owner_name: newLead.owner_name || null,
      phone: newLead.phone || null,
      email: newLead.email || null,
      zone: newLead.zone || null,
      stage: newLead.stage,
      source: newLead.source,
      assigned_seller_id: newLead.assigned_seller_id || null,
      temperature: newLead.temperature,
      notes: newLead.notes || null,
      monthly_value: newLead.monthly_value,
    });
    if (error) return toast.error(error.message);
    toast.success('Lead creado');
    setCreateOpen(false);
    setNewLead({ restaurant_name: '', owner_name: '', phone: '', email: '', zone: '', stage: 'contactado', source: 'terreno', assigned_seller_id: '', temperature: 'tibio', notes: '', monthly_value: 299 });
    load();
  };

  const getSellerName = (id: string | null) => sellers.find(s => s.id === id)?.name || '';

  const tempColor = (t: string | null) => {
    if (t === 'caliente') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    if (t === 'frio') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Pipeline</h1>
          <p className="text-sm text-muted-foreground">{leads.length} leads totales</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="w-4 h-4" />Nuevo lead</Button>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map(stage => {
          const stageLeads = leads.filter(l => l.stage === stage.key);
          return (
            <div key={stage.key} className="min-w-[260px] w-[260px] flex-shrink-0">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="text-sm font-semibold text-foreground">{stage.label}</span>
                <Badge variant="secondary" className="text-[10px] ml-auto">{stageLeads.length}</Badge>
              </div>
              <div className="space-y-2 min-h-[100px]">
                {stageLeads.map(lead => (
                  <Card
                    key={lead.id}
                    className="cursor-pointer hover:shadow-md transition-shadow border-l-[3px]"
                    style={{ borderLeftColor: stage.color }}
                    onClick={() => setDetailLead(lead)}
                  >
                    <CardContent className="p-3 space-y-1.5">
                      <p className="text-sm font-semibold text-foreground leading-tight">{lead.restaurant_name}</p>
                      {lead.owner_name && <p className="text-xs text-muted-foreground">{lead.owner_name}</p>}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {lead.zone && (
                          <Badge variant="outline" className="text-[10px] gap-0.5">
                            <MapPin className="w-2.5 h-2.5" />{lead.zone}
                          </Badge>
                        )}
                        <Badge className={`text-[10px] ${tempColor(lead.temperature)}`}>
                          {lead.temperature === 'caliente' ? '🔥' : lead.temperature === 'frio' ? '❄️' : '🌤️'}
                        </Badge>
                      </div>
                      {lead.assigned_seller_id && (
                        <p className="text-[10px] text-muted-foreground">📌 {getSellerName(lead.assigned_seller_id)}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lead Detail Dialog */}
      <Dialog open={!!detailLead} onOpenChange={() => setDetailLead(null)}>
        <DialogContent className="max-w-md">
          {detailLead && (
            <>
              <DialogHeader>
                <DialogTitle>{detailLead.restaurant_name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                {detailLead.owner_name && <p className="text-sm text-muted-foreground">👤 {detailLead.owner_name}</p>}
                <div className="flex flex-wrap gap-2">
                  {detailLead.phone && (
                    <a href={`tel:${detailLead.phone}`} className="flex items-center gap-1 text-xs text-primary">
                      <Phone className="w-3 h-3" />{detailLead.phone}
                    </a>
                  )}
                  {detailLead.email && (
                    <a href={`mailto:${detailLead.email}`} className="flex items-center gap-1 text-xs text-primary">
                      <Mail className="w-3 h-3" />{detailLead.email}
                    </a>
                  )}
                </div>
                {detailLead.zone && <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{detailLead.zone}</p>}
                <div className="flex items-center gap-2">
                  <Badge className={tempColor(detailLead.temperature)}>{detailLead.temperature}</Badge>
                  <Badge variant="outline" className="text-xs capitalize">{detailLead.source}</Badge>
                  {detailLead.monthly_value && <Badge variant="secondary">${detailLead.monthly_value}/mes</Badge>}
                </div>
                {detailLead.notes && <p className="text-sm text-muted-foreground bg-muted p-2 rounded-lg">{detailLead.notes}</p>}
                {detailLead.next_action && (
                  <div className="flex items-center gap-1 text-xs text-foreground">
                    <Calendar className="w-3 h-3" />
                    {detailLead.next_action} {detailLead.next_action_date && `— ${detailLead.next_action_date}`}
                  </div>
                )}
                {detailLead.assigned_seller_id && (
                  <p className="text-xs text-muted-foreground">Asignado: {getSellerName(detailLead.assigned_seller_id)}</p>
                )}

                {/* Move to stage */}
                <div className="pt-2 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Mover a:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {STAGES.filter(s => s.key !== detailLead.stage).map(s => (
                      <Button
                        key={s.key}
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1"
                        onClick={() => moveStage(detailLead.id, s.key)}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Lead Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo lead</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh]">
            <div className="space-y-3 pr-2">
              <Input placeholder="Nombre del local *" value={newLead.restaurant_name} onChange={e => setNewLead(f => ({ ...f, restaurant_name: e.target.value }))} />
              <Input placeholder="Dueño / contacto" value={newLead.owner_name} onChange={e => setNewLead(f => ({ ...f, owner_name: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Teléfono" value={newLead.phone} onChange={e => setNewLead(f => ({ ...f, phone: e.target.value }))} />
                <Input placeholder="Email" type="email" value={newLead.email} onChange={e => setNewLead(f => ({ ...f, email: e.target.value }))} />
              </div>
              <Select value={newLead.zone} onValueChange={v => setNewLead(f => ({ ...f, zone: v }))}>
                <SelectTrigger><SelectValue placeholder="Zona" /></SelectTrigger>
                <SelectContent>{ZONES.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={newLead.source} onValueChange={v => setNewLead(f => ({ ...f, source: v }))}>
                <SelectTrigger><SelectValue placeholder="Fuente" /></SelectTrigger>
                <SelectContent>{SOURCES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={newLead.assigned_seller_id} onValueChange={v => setNewLead(f => ({ ...f, assigned_seller_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Asignar vendedor" /></SelectTrigger>
                <SelectContent>{sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={newLead.temperature} onValueChange={v => setNewLead(f => ({ ...f, temperature: v }))}>
                <SelectTrigger><SelectValue placeholder="Temperatura" /></SelectTrigger>
                <SelectContent>{TEMPERATURES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
              </Select>
              <Textarea placeholder="Notas" value={newLead.notes} onChange={e => setNewLead(f => ({ ...f, notes: e.target.value }))} rows={2} />
              <Button onClick={handleCreate} className="w-full">Crear lead</Button>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
