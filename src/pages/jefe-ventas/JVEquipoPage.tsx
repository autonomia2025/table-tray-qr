import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Users, Loader2, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

interface Member {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  zone: string | null;
  is_active: boolean | null;
  role: string;
  created_at: string | null;
}

interface SellerStats {
  totalLeads: number;
  closedLeads: number;
  pipelineLeads: number;
  projectedCommission: number;
}

export default function JVEquipoPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSeller, setSelectedSeller] = useState<Member | null>(null);
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [membersRes, leadsRes] = await Promise.all([
        supabase.from('backoffice_members').select('*').eq('role', 'vendedor').order('created_at', { ascending: false }),
        supabase.from('leads').select('id, stage, assigned_seller_id, monthly_value'),
      ]);
      setMembers((membersRes.data || []) as Member[]);
      setLeads(leadsRes.data || []);
      setLoading(false);
    };
    load();
  }, []);

  const getStats = (sellerId: string): SellerStats => {
    const myLeads = leads.filter(l => l.assigned_seller_id === sellerId);
    const closed = myLeads.filter(l => l.stage === 'cliente_pagando').length;
    const pipeline = myLeads.filter(l => !['cliente_pagando', 'frio'].includes(l.stage)).length;
    const commission = closed * 50000 + closed * 40000; // close + active recurring
    return { totalLeads: myLeads.length, closedLeads: closed, pipelineLeads: pipeline, projectedCommission: commission };
  };

  const toggleActive = async (member: Member) => {
    await supabase.from('backoffice_members').update({ is_active: !member.is_active }).eq('id', member.id);
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, is_active: !m.is_active } : m));
    toast.success(`${member.name} ${!member.is_active ? 'activado' : 'desactivado'}`);
  };

  const createInvite = async () => {
    const { data, error } = await supabase.from('backoffice_invitations').insert({
      role: 'vendedor',
    }).select('token').single();

    if (error) { toast.error(error.message); return; }
    const link = `${window.location.origin}/backoffice/join/${data.token}`;
    setInviteLink(link);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Link copiado');
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Equipo de ventas</h1>
          <p className="text-sm text-muted-foreground">{members.length} vendedores</p>
        </div>
        <Button onClick={createInvite} className="gap-2"><Plus className="w-4 h-4" />Invitar vendedor</Button>
      </div>

      {/* Invite link */}
      {inviteLink && (
        <Card className="border-primary/20">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-foreground mb-2">Link de invitación generado:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted px-3 py-2 rounded-lg text-xs text-foreground break-all">{inviteLink}</code>
              <Button variant="outline" size="sm" onClick={copyLink}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Expira en 7 días. El vendedor debe registrarse con este link.</p>
          </CardContent>
        </Card>
      )}

      {/* Team table */}
      <Card>
        <CardContent className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-3 font-medium text-muted-foreground">Vendedor</th>
                  <th className="pb-3 font-medium text-muted-foreground">Zona</th>
                  <th className="pb-3 font-medium text-muted-foreground text-center">Leads</th>
                  <th className="pb-3 font-medium text-muted-foreground text-center">Cierres</th>
                  <th className="pb-3 font-medium text-muted-foreground text-center">Pipeline</th>
                  <th className="pb-3 font-medium text-muted-foreground text-right">Comisión proj.</th>
                  <th className="pb-3 font-medium text-muted-foreground text-center">Activo</th>
                  <th className="pb-3 font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {members.map(m => {
                  const stats = getStats(m.id);
                  return (
                    <tr key={m.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-3">
                        <p className="font-medium text-foreground">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.email}</p>
                      </td>
                      <td className="py-3">
                        <Badge variant="outline" className="text-xs">{m.zone || 'Sin zona'}</Badge>
                      </td>
                      <td className="py-3 text-center text-foreground">{stats.totalLeads}</td>
                      <td className="py-3 text-center font-semibold text-primary">{stats.closedLeads}</td>
                      <td className="py-3 text-center text-foreground">{stats.pipelineLeads}</td>
                      <td className="py-3 text-right font-medium text-foreground">${stats.projectedCommission.toLocaleString('es-CL')}</td>
                      <td className="py-3 text-center">
                        <Switch checked={!!m.is_active} onCheckedChange={() => toggleActive(m)} />
                      </td>
                      <td className="py-3">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedSeller(m)}>Ver</Button>
                      </td>
                    </tr>
                  );
                })}
                {members.length === 0 && (
                  <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Sin vendedores. Invita al primero.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Seller detail sheet */}
      <Sheet open={!!selectedSeller} onOpenChange={() => setSelectedSeller(null)}>
        <SheetContent>
          {selectedSeller && (() => {
            const stats = getStats(selectedSeller.id);
            const sellerLeads = leads.filter(l => l.assigned_seller_id === selectedSeller.id);
            return (
              <>
                <SheetHeader>
                  <SheetTitle>{selectedSeller.name}</SheetTitle>
                </SheetHeader>
                <div className="space-y-4 mt-4">
                  <div className="space-y-1 text-sm">
                    <p className="text-muted-foreground">{selectedSeller.email}</p>
                    {selectedSeller.phone && <p className="text-muted-foreground">{selectedSeller.phone}</p>}
                    <Badge variant="outline">{selectedSeller.zone || 'Sin zona'}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Leads</p><p className="text-xl font-bold">{stats.totalLeads}</p></CardContent></Card>
                    <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Cierres</p><p className="text-xl font-bold text-primary">{stats.closedLeads}</p></CardContent></Card>
                    <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Pipeline</p><p className="text-xl font-bold">{stats.pipelineLeads}</p></CardContent></Card>
                    <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Comisión</p><p className="text-xl font-bold">${stats.projectedCommission.toLocaleString('es-CL')}</p></CardContent></Card>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Leads recientes</h3>
                    <div className="space-y-1 max-h-60 overflow-auto">
                      {sellerLeads.slice(0, 15).map((l: any) => (
                        <div key={l.id} className="flex justify-between text-sm py-1 border-b border-border/30">
                          <span className="text-foreground">{l.restaurant_name || l.id.slice(0, 8)}</span>
                          <Badge variant="outline" className="text-[10px]">{l.stage}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
