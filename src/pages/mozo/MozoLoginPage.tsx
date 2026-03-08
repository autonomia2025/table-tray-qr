import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWaiters, WAITER_BRANCH_ID } from '@/contexts/WaitersContext';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Delete } from 'lucide-react';

export default function MozoLoginPage() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useWaiters();

  const handleDigit = useCallback((d: string) => {
    if (pin.length >= 4 || loading) return;
    const newPin = pin + d;
    setPin(newPin);
    setError(false);

    if (newPin.length === 4) {
      attemptLogin(newPin);
    }
  }, [pin, loading]);

  const handleDelete = useCallback(() => {
    setPin(p => p.slice(0, -1));
    setError(false);
  }, []);

  const attemptLogin = async (code: string) => {
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('staff_users')
        .select('id, name, role, branch_id, tenant_id')
        .eq('pin', code)
        .eq('branch_id', WAITER_BRANCH_ID)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (err || !data) {
        setError(true);
        setPin('');
        return;
      }

      login({
        staffId: data.id,
        staffName: data.name,
        role: data.role,
        branchId: data.branch_id!,
        tenantId: data.tenant_id,
      });
      navigate('/mozo/mesas', { replace: true });
    } catch {
      setError(true);
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const digits = ['1','2','3','4','5','6','7','8','9','','0','del'];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-foreground mb-1">MenuQR Mozo</h1>
        <p className="text-muted-foreground text-sm">Ingresa tu PIN para continuar</p>
      </div>

      {/* PIN dots */}
      <motion.div
        className="flex gap-4 mb-10"
        animate={error ? { x: [0, -12, 12, -12, 12, 0] } : {}}
        transition={{ duration: 0.4 }}
      >
        {[0,1,2,3].map(i => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
              i < pin.length
                ? 'bg-primary border-primary scale-110'
                : error
                  ? 'border-destructive'
                  : 'border-muted-foreground/40'
            }`}
          />
        ))}
      </motion.div>

      {error && (
        <p className="text-destructive text-sm mb-4 font-medium">PIN incorrecto</p>
      )}

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
        {digits.map((d, i) => {
          if (d === '') return <div key={i} />;
          if (d === 'del') {
            return (
              <button
                key={i}
                onClick={handleDelete}
                className="h-16 rounded-xl flex items-center justify-center text-muted-foreground active:bg-muted transition-colors"
              >
                <Delete className="w-6 h-6" />
              </button>
            );
          }
          return (
            <button
              key={i}
              onClick={() => handleDigit(d)}
              disabled={loading}
              className="h-16 rounded-xl bg-card border border-border text-xl font-semibold text-foreground active:bg-muted transition-colors disabled:opacity-50"
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
