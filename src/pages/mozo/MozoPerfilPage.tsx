import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWaiters } from '@/contexts/WaitersContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, LogOut, Timer } from 'lucide-react';
import { NOMBRE_ROL } from '@/lib/roles';
import { formatCLP } from '@/lib/format';
import { abrirTurno, cerrarTurno, duracion, useMiTurno } from '@/lib/turnos';

export default function MozoPerfilPage() {
  const { staffName, role, logout, branchId } = useWaiters();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { turno, cargando, recargar } = useMiTurno(branchId);
  const [confirmar, setConfirmar] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const empezar = async () => {
    setTrabajando(true);
    const r = await abrirTurno(branchId);
    setTrabajando(false);
    if (r.ok === false) { toast({ title: 'No se pudo empezar el turno', description: r.error, variant: 'destructive' }); return; }
    toast({ title: '¡Turno empezado!' });
    recargar();
  };

  const terminar = async () => {
    setTrabajando(true);
    const r = await cerrarTurno();
    setTrabajando(false);
    setConfirmar(false);
    if (r.ok === false) { toast({ title: 'No se pudo terminar el turno', description: r.error, variant: 'destructive' }); return; }
    toast({
      title: 'Turno terminado',
      description: `${duracion(r.dato.minutos)} · propinas ${formatCLP(r.dato.propinas)}. ¡Buen trabajo!`,
    });
    recargar();
  };

  const initial = staffName?.charAt(0)?.toUpperCase() ?? '?';

  return (
    <div className="flex flex-col items-center p-6 pt-10">
      <div className="w-20 h-20 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-3xl font-bold mb-4">
        {initial}
      </div>
      <h2 className="text-xl font-bold text-foreground">{staffName}</h2>
      <Badge className="mt-2">{role ? NOMBRE_ROL[role] : ""}</Badge>

      {/* Mi turno */}
      <div className="mt-8 w-full max-w-sm rounded-2xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Timer className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-bold text-foreground">Mi turno</h3>
          {turno && <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><span className="h-2 w-2 rounded-full bg-emerald-500" />En turno</span>}
        </div>
        {cargando ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        ) : turno ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Desde</dt><dd className="font-semibold text-foreground">{new Date(turno.inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Llevas</dt><dd className="font-semibold text-foreground">{duracion(turno.minutos)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Mesas</dt><dd className="font-semibold text-foreground">{turno.mesas}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Ventas</dt><dd className="font-semibold text-foreground">{formatCLP(turno.ventas)}</dd></div>
              <div className="col-span-2 rounded-xl bg-muted p-3">
                <dt className="text-xs text-muted-foreground">Tus propinas</dt>
                <dd className="text-2xl font-extrabold text-foreground">{formatCLP(turno.propinas)}</dd>
                {turno.propinas_efectivo > 0 && <dd className="text-xs text-muted-foreground">{formatCLP(turno.propinas_efectivo)} en efectivo</dd>}
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">La propina es del mozo que tomó la mesa, aunque cobre la caja.</p>
            <Button variant="outline" className="mt-4 h-11 w-full" onClick={() => setConfirmar(true)} disabled={trabajando}>
              Terminar turno
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">No tienes un turno abierto. Al tomar una mesa empieza solo.</p>
            <Button className="mt-4 h-11 w-full" onClick={empezar} disabled={trabajando}>
              {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Empezar turno'}
            </Button>
          </>
        )}
      </div>

      <Button variant="destructive" className="mt-10 w-full max-w-sm h-12" onClick={handleLogout}>
        <LogOut className="w-5 h-5 mr-2" />
        Cerrar sesión
      </Button>

      <Dialog open={confirmar} onOpenChange={setConfirmar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Terminar tu turno?</DialogTitle>
            <DialogDescription>Antes, transfiere o cierra las mesas que tengas a cargo.</DialogDescription>
          </DialogHeader>
          {turno && (
            <div className="space-y-1.5 rounded-xl bg-muted p-3 text-sm">
              <div className="flex justify-between"><span>Duración</span><span className="font-semibold">{duracion(turno.minutos)}</span></div>
              <div className="flex justify-between"><span>Mesas</span><span className="font-semibold">{turno.mesas}</span></div>
              <div className="flex justify-between"><span>Propinas</span><span className="font-bold">{formatCLP(turno.propinas)}</span></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmar(false)}>Volver</Button>
            <Button onClick={terminar} disabled={trabajando}>
              {trabajando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Terminar turno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
