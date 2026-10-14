import { Link } from "react-router-dom";

// Página para un enlace que no existe (regla 10: nada en inglés ni técnico frente a nadie).
const NotFound = () => (
  <div className="flex min-h-screen items-center justify-center bg-background px-6">
    <div className="max-w-sm text-center">
      <p className="text-5xl">🧭</p>
      <h1 className="mt-4 text-2xl font-extrabold text-foreground">Esta página no existe</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Si llegaste desde un QR, vuelve a escanear el código de tu mesa. Si no, revisa el enlace.
      </p>
      <Link to="/" className="mt-6 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
        Ir al inicio
      </Link>
    </div>
  </div>
);

export default NotFound;
