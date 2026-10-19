"""Cuentas del fundador para probar Tablio de punta a punta en el local "Demo Tablio", sin pagar nada.

- Una cuenta por rol (dueño, encargada, caja, mozo, cocina), dos clientes con cuenta (para probar la
  comunidad entre dos personas) y las de Tablio (superadmin, finanzas, jefa de ventas y vendedor).
- Cuatro mesas solo para él (11 a 14): las pruebas automáticas usan las mesas 1 a 10.
- Las claves se escriben SOLO en privado/ACCESOS_FUNDADOR.md (fuera de git). A la base viaja únicamente su
  versión cifrada (bcrypt), calculada en este computador.

Uso: python3 scripts/demo/accesos_fundador.py  → deja privado/accesos_fundador.sql y privado/ACCESOS_FUNDADOR.md
"""
import json
import secrets
import string
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PRIVADO = RAIZ / "privado"
TENANT = "651c363f-0084-50af-9873-be98cfeaaf47"   # Demo Tablio
BRANCH = "aebe7faa-0e29-5aa9-83c2-1e1b336f1554"   # Barrio Italia
APP = "https://table-tray-qr.vercel.app"
DOMINIO = "fundador.tablio.test"                  # .test: nunca se manda un correo a nadie
NS = uuid.UUID("6f2c2a0e-2c1b-4c55-9d0e-7a1f0c3b9e11")

# (clave, correo, nombre, tipo, rol, dónde entra)
CUENTAS = [
    ("dueno", "dueno", "Dueño (fundador)", "local", "owner", "/login → Inicio del local"),
    ("encargada", "encargada", "Encargada (fundador)", "staff", "manager", "/login → Inicio del local"),
    ("caja", "caja", "Caja (fundador)", "staff", "cashier", "/login → Caja"),
    ("mozo", "mozo", "Fundador (mozo)", "staff", "waiter", "/login → Mesas del mozo"),
    ("cocina", "cocina", "Cocina (fundador)", "staff", "kitchen", "/login → Pantalla de cocina"),
    ("cliente", "cliente", "Cliente Fundador", "cliente", "cliente", "/login → \"Entraste como cliente\" → abre el link de una mesa en ese mismo navegador"),
    ("amiga", "amiga", "Amiga del Fundador", "cliente", "cliente", "Igual que el cliente, en otro celular o en una ventana privada"),
    ("superadmin", "superadmin", "Superadmin (fundador)", "plataforma", "superadmin", "/login → Panel de Tablio"),
    ("finanzas", "finanzas", "Finanzas (fundador)", "backoffice", "finanzas", "/login → Finanzas"),
    ("jefa", "jefa", "Jefa de ventas (fundador)", "backoffice", "jefe_ventas", "/login → Jefatura de ventas"),
    ("vendedor", "vendedor", "Vendedor (fundador)", "backoffice", "vendedor", "/login → Mi día"),
]
MESAS = [11, 12, 13, 14]
RECORRIDO = """
## Recorrido de punta a punta (unos 30 minutos)

Ideal con dos aparatos: tu celular como cliente y el computador para el personal. En el computador, cada rol en una ventana privada distinta (o en otro navegador), para tener varios abiertos a la vez.

1. **Cocina:** en el computador, entra con la cuenta de cocina. Queda en la pantalla de cocina.
2. **Mozo:** en otra ventana, entra con la cuenta del mozo y toca "Empezar turno".
3. **Pedir y pagar (cliente invitado):** en el celular abre el link de la Mesa 11, pide un Pisco Sour y unas papas, elige propina y toca "Pagar con tarjeta". El pago es simulado: no se cobra nada. El pedido aparece solo en cocina.
4. **Cocina → mozo → cliente:** en cocina acepta y marca listo. El mozo ve la mesa en verde y lo entrega. En el celular, el seguimiento cambia en vivo.
5. **Llamar al mozo y pedir la cuenta:** desde el celular, los botones de la carta. Al mozo le llega el aviso.
6. **Pagarle al mozo:** pide otra cosa y elige "Prefiero pagarle al mozo". Te pedirá el código de 4 números de la mesa: lo ve el mozo en el detalle de la mesa. El mozo cobra en "💵 Efectivo" y recién ahí va a cocina.
7. **Cerrar la mesa:** el mozo toca "Cerrar mesa" y en el celular aparece la calificación.
8. **Cliente con cuenta y sellos:** en el celular, en `/login` entra con la cuenta "Cliente Fundador". Abre la Mesa 12 en ese mismo navegador, pide y paga desde $3.000: cae un sello (uno por día).
9. **Comunidad entre dos personas:** con la cuenta "Amiga" en otro navegador (Mesa 13), activen la comunidad los dos ("Tu cuenta" → "Comunidad y amigos") y agréguense con el código TAB-…. Prueben "Invitar a otra mesa", "Avisar a mis amigos que estoy aquí" y "🍻 Salud".
10. **Caja:** con la cuenta de caja, en Caja revisa lo cobrado por la app y en efectivo, toca "Hacer corte de turno" y mira "Excepciones".
11. **Dueño:** con la cuenta del dueño mira Inicio, Reportes, Equipo (desempeño y propinas), Menú, QR (aquí están tus mesas 11 a 14 para imprimir) y Sucursal. La encargada ve casi lo mismo, sin la configuración del dueño.
12. **Tablio por dentro:** superadmin (locales, módulos por plan, salud de la plataforma, comunidad), finanzas (mensualidades e ingresos), jefa de ventas y vendedor (posibles clientes y alta de un local).

**Para dejar todo limpio**, pídeme "reinicia el demo": borra pedidos y pagos de prueba y libera las mesas. Tus cuentas no se borran.

**Lo que no puedes probar con estas cuentas:** recuperar la clave (los correos `.test` no existen), el código por correo de un cliente (eso pruébalo con tu correo real, desde "Sellos" → "Continuar con mi correo" en la carta) y un cobro con tarjeta de verdad (en el demo es simulado; también está Webpay de prueba en Sucursal → "Cómo te pagan con la app").
"""


def uid(nombre: str) -> str:
    return str(uuid.uuid5(NS, nombre))


def q(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (dict, list)):
        v = json.dumps(v, ensure_ascii=False)
    return "'" + str(v).replace("'", "''") + "'"


def clave(rol: str) -> str:
    """Fácil de escribir en el celular; el superadmin lleva una larga (ve todos los locales)."""
    if rol == "superadmin":
        return "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(20))
    return f"Tablio-{secrets.randbelow(9000) + 1000}-{''.join(secrets.choice('abcdefghjkmnpqrstuvwxyz') for _ in range(3))}"


def bcrypt(texto: str) -> str:
    """Cifra la clave en este computador: la clave en claro nunca sale de aquí. Usa la librería bcrypt de
    Python si está; si no, la base local (Supabase en Docker)."""
    try:
        import bcrypt as bc  # pip install bcrypt
        return bc.hashpw(texto.encode(), bc.gensalt(10)).decode().replace("$2b$", "$2a$", 1)
    except ImportError:
        pass
    salida = subprocess.run(
        ["psql", "postgresql://postgres:postgres@127.0.0.1:54322/postgres", "-At", "-c",
         f"SELECT extensions.crypt({q(texto)}, extensions.gen_salt('bf', 10))"],
        capture_output=True, text=True, check=True)
    return salida.stdout.strip()


def main() -> None:
    PRIVADO.mkdir(exist_ok=True)
    sql = ["-- Cuentas y mesas del fundador en Demo Tablio. Generado por scripts/demo/accesos_fundador.py. NO subir a git.",
           "BEGIN;"]
    filas_md = []
    for k, local_part, nombre, tipo, rol, donde in CUENTAS:
        correo = f"{local_part}@{DOMINIO}"
        u = uid(f"user-{k}")
        texto = clave(rol)
        hash_ = bcrypt(texto)
        sql.append(
            "INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, "
            "raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, "
            "email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token) VALUES ("
            f"'00000000-0000-0000-0000-000000000000', '{u}', 'authenticated', 'authenticated', {q(correo)}, {q(hash_)}, now(), "
            f"{q({'provider': 'email', 'providers': ['email']})}, {q({'name': nombre, 'demo': True})}, now(), now(), '', '', '', '', '', '', '', '') "
            f"ON CONFLICT (id) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password, updated_at = now();")
        sql.append(
            "INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at) VALUES ("
            f"'{uid(f'identity-{k}')}', '{u}', '{u}', {q({'sub': u, 'email': correo, 'email_verified': True})}, 'email', now(), now()) "
            "ON CONFLICT DO NOTHING;")
        if tipo in ("local", "staff"):
            sql.append("INSERT INTO public.tenant_members (id, user_id, tenant_id, branch_id, role, is_active) VALUES ("
                       f"'{uid(f'tm-{k}')}', '{u}', '{TENANT}', '{BRANCH}', {q(rol)}, true) ON CONFLICT (id) DO NOTHING;")
        if tipo == "staff":
            sql.append("INSERT INTO public.staff_users (id, tenant_id, branch_id, auth_user_id, name, role, is_active) VALUES ("
                       f"'{uid(f'staff-{k}')}', '{TENANT}', '{BRANCH}', '{u}', {q(nombre)}, {q(rol)}, true) ON CONFLICT (id) DO NOTHING;")
        if tipo == "plataforma":
            sql.append(f"INSERT INTO public.platform_admins (id, user_id) VALUES ('{uid(f'pa-{k}')}', '{u}') ON CONFLICT DO NOTHING;")
        if tipo == "backoffice":
            sql.append("INSERT INTO public.backoffice_members (id, user_id, name, email, role, zone, is_active) VALUES ("
                       f"'{uid(f'bo-{k}')}', '{u}', {q(nombre)}, {q(correo)}, {q(rol)}, 'Santiago Oriente', true) ON CONFLICT (id) DO NOTHING;")
        filas_md.append(f"| {nombre} | `{correo}` | `{texto}` | {donde} |")

    mesas_md = []
    for n in MESAS:
        token = secrets.token_hex(16)
        sql.append("INSERT INTO public.tables (id, tenant_id, branch_id, number, name, zone, capacity, qr_token, status) VALUES ("
                   f"'{uid(f'mesa-{n}')}', '{TENANT}', '{BRANCH}', {n}, 'Mesa {n}', 'terraza', 4, '{token}', 'free') "
                   "ON CONFLICT (id) DO UPDATE SET qr_token = EXCLUDED.qr_token;")  # el link del archivo siempre calza
        mesas_md.append((n, f"{APP}/demo-tablio?t={token}"))
    sql.append("COMMIT;")
    (PRIVADO / "accesos_fundador.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")

    md = ["# Tus accesos para probar Tablio (privado, no compartir)", "",
          f"App: **{APP}** · Local: **Demo Tablio** (pagos simulados: no se cobra plata real).", "",
          "Los correos son de prueba (`.test`): no existen, así que \"¿Olvidaste tu contraseña?\" no les sirve. "
          "Si pierdes una clave, pídemela y la cambio.", "",
          "## Cuentas", "", "| Quién | Correo | Clave | Dónde entra |", "|---|---|---|---|", *filas_md, "",
          "## Tus mesas (solo tuyas: las pruebas automáticas no las tocan)", "",
          "Abre el link en el celular (o escanéalo desde el panel del dueño → QR).", ""]
    md += [f"- **Mesa {n}:** {link}" for n, link in mesas_md]
    md += ["", f"Pantalla de cocina: {APP}/kds?branch={BRANCH}", RECORRIDO]
    (PRIVADO / "ACCESOS_FUNDADOR.md").write_text("\n".join(md), encoding="utf-8")
    print("listo: privado/accesos_fundador.sql y privado/ACCESOS_FUNDADOR.md (las claves no se imprimen)")


if __name__ == "__main__":
    sys.exit(main())
