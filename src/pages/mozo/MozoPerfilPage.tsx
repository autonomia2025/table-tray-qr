import { useNavigate } from 'react-router-dom';
import { useWaiters } from '@/contexts/WaitersContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogOut } from 'lucide-react';
import { NOMBRE_ROL } from '@/lib/roles';

export default function MozoPerfilPage() {
  const { staffName, role, logout } = useWaiters();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const initial = staffName?.charAt(0)?.toUpperCase() ?? '?';

  return (
    <div className="flex flex-col items-center justify-center p-8 pt-16">
      <div className="w-20 h-20 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-3xl font-bold mb-4">
        {initial}
      </div>
      <h2 className="text-xl font-bold text-foreground">{staffName}</h2>
      <Badge className="mt-2">{role ? NOMBRE_ROL[role] : ""}</Badge>

      <Button variant="destructive" className="mt-12 w-full max-w-xs h-12" onClick={handleLogout}>
        <LogOut className="w-5 h-5 mr-2" />
        Cerrar sesión
      </Button>
    </div>
  );
}
