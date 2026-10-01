"""Genera el SQL del local de demo "Demo Tablio" con todos los roles.

Uso: python3 scripts/demo/crear_demo.py
Escribe en privado/ (fuera de git):
  - demo_seed.sql          -> se carga con la CLI de Supabase
  - DEMO_CREDENCIALES.md   -> correos y contraseñas de cada rol

Los identificadores son fijos (uuid5), así el reinicio del demo sabe qué borrar.
Los correos usan el dominio reservado .test: nunca se envía un correo a nadie.
"""
import json
import secrets
import string
import uuid
from pathlib import Path

NS = uuid.UUID("6f1d3c52-7a0e-4c4b-9a55-0d1e2f3a4b5c")
DOMINIO = "demo.tablio.test"
PRIVADO = Path(__file__).resolve().parents[2] / "privado"


def uid(nombre: str) -> str:
    return str(uuid.uuid5(NS, nombre))


def q(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "'{" + ",".join(v) + "}'"
    if isinstance(v, dict):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


def ins(tabla: str, fila: dict) -> str:
    return f"INSERT INTO {tabla} ({', '.join(fila)}) VALUES ({', '.join(q(v) for v in fila.values())});"


def clave() -> str:
    alfabeto = string.ascii_letters + string.digits
    return "Demo-" + "".join(secrets.choice(alfabeto) for _ in range(14))


TENANT = uid("tenant")
RESTAURANT = uid("restaurant")
BRANCH = uid("branch")
MENU = uid("menu")

CUENTAS = [
    # (clave interna, correo, nombre, tipo, rol)
    ("dueno", f"dueno@{DOMINIO}", "Dueño Demo", "local", "owner"),
    ("admin", f"admin@{DOMINIO}", "Administración Demo", "local", "admin"),
    ("mozo1", f"mozo1@{DOMINIO}", "Camila (mozo)", "staff", "waiter"),
    ("mozo2", f"mozo2@{DOMINIO}", "Diego (mozo)", "staff", "waiter"),
    ("cocina", f"cocina@{DOMINIO}", "Cocina y barra", "staff", "kitchen"),
    ("superadmin", f"superadmin@{DOMINIO}", "Superadmin Demo", "plataforma", "superadmin"),
    ("jefe", f"jefe@{DOMINIO}", "Jefa de ventas Demo", "backoffice", "jefe_ventas"),
    ("vendedor", f"vendedor@{DOMINIO}", "Vendedor Demo", "backoffice", "vendedor"),
    ("finanzas", f"finanzas@{DOMINIO}", "Finanzas Demo", "backoffice", "finanzas"),
]

# (categoría, emoji, [(nombre, descripción, precio, alérgenos, etiquetas, minutos, modificadores)])
CARTA = [
    ("Cervezas", "🍺", [
        ("Schop Torobayo 500cc", "Ale ámbar de Valdivia, bien helada.", 4900, ["gluten"], ["recomendado"], 2, None),
        ("Schop Calafate 500cc", "Cerveza austral con notas frutales.", 4900, ["gluten"], [], 2, None),
        ("IPA artesanal 330cc", "Amarga, aromática y lupulada.", 4500, ["gluten"], ["nuevo"], 1, None),
        ("Michelada", "Cerveza con limón, sal y salsas.", 5900, ["gluten"], ["picante"], 3, "michelada"),
    ]),
    ("Tragos", "🍹", [
        ("Pisco Sour", "Clásico chileno, con limón de pica.", 5500, ["huevo"], ["recomendado"], 4, None),
        ("Piscola", "Pisco con bebida, como te gusta.", 6500, [], [], 2, "piscola"),
        ("Mojito", "Ron, menta fresca, limón y soda.", 6500, [], [], 4, None),
        ("Aperol Spritz", "Aperol, espumante y soda.", 7500, ["sulfitos"], [], 3, None),
        ("Terremoto", "Pipeño, helado de piña y granadina.", 5000, ["sulfitos", "lactosa"], [], 3, None),
    ]),
    ("Sin alcohol", "🥤", [
        ("Bebida en lata", "Coca-Cola, Zero o Sprite.", 2500, [], [], 1, "bebida"),
        ("Limonada menta jengibre", "Recién hecha.", 3900, [], ["vegano"], 3, None),
        ("Jugo natural", "Frambuesa, mango o piña.", 3500, [], ["vegano"], 3, None),
        ("Agua mineral", "Con o sin gas.", 2000, [], ["vegano"], 1, None),
    ]),
    ("Picoteo", "🍟", [
        ("Papas fritas", "Corte casero, con salsas.", 5900, [], ["vegano"], 8, "papas"),
        ("Chorrillana para 2", "Papas, carne, cebolla y huevo frito.", 14900, ["huevo"], ["recomendado"], 15, None),
        ("Empanaditas de queso (6)", "Fritas al momento.", 6500, ["gluten", "lactosa"], [], 10, None),
        ("Nachos con guacamole", "Totopos, cheddar, pico de gallo y palta.", 8900, ["lactosa"], ["picante"], 10, None),
        ("Tabla de quesos y carnes", "Para compartir entre 3 o 4.", 15900, ["lactosa", "frutos_secos"], [], 10, None),
    ]),
    ("Platos", "🍔", [
        ("Hamburguesa Tablio", "180 g de carne, cheddar, tocino y salsa de la casa.", 10900, ["gluten", "lactosa"], ["recomendado"], 15, "hamburguesa"),
        ("Barros Luco", "Carne y queso fundido en marraqueta.", 8900, ["gluten", "lactosa"], [], 12, None),
        ("Chacarero", "Carne, porotos verdes, tomate y ají verde.", 9500, ["gluten"], ["picante"], 12, None),
        ("Ensalada César", "Pollo grillado, crutones y parmesano.", 8500, ["gluten", "lactosa", "huevo"], [], 10, None),
    ]),
    ("Postres", "🍰", [
        ("Brownie con helado", "Tibio, con helado de vainilla.", 4900, ["gluten", "lactosa", "huevo", "frutos_secos"], [], 5, None),
        ("Mote con huesillo", "Bien helado.", 3500, [], ["vegano"], 2, None),
    ]),
]

MODIFICADORES = {
    "michelada": [("Picor", "choose_one", True, 1, 1, [("Suave", 0), ("Picante", 0), ("Muy picante", 0)])],
    "piscola": [
        ("Pisco", "choose_one", True, 1, 1, [("Pisco 35°", 0), ("Pisco 40° premium", 1500)]),
        ("Bebida", "choose_one", True, 1, 1, [("Coca-Cola", 0), ("Coca-Cola Zero", 0), ("Ginger ale", 0)]),
    ],
    "bebida": [("Sabor", "choose_one", True, 1, 1, [("Coca-Cola", 0), ("Coca-Cola Zero", 0), ("Sprite", 0)])],
    "papas": [
        ("Tamaño", "choose_one", True, 1, 1, [("Normal", 0), ("XL", 2000)]),
        ("Salsas", "choose_many", False, 0, 3, [("Mayo casera", 0), ("Ketchup", 0), ("Ají", 0), ("Cheddar", 1000)]),
    ],
    "hamburguesa": [
        ("Punto de la carne", "choose_one", True, 1, 1, [("A punto", 0), ("Tres cuartos", 0), ("Bien cocida", 0)]),
        ("Extras", "choose_many", False, 0, 3, [("Palta", 1500), ("Huevo frito", 1000), ("Doble carne", 3500)]),
    ],
}


def main() -> None:
    PRIVADO.mkdir(exist_ok=True)
    claves = {k: clave() for k, *_ in CUENTAS}
    sql = [
        "-- Local de demo 'Demo Tablio'. Generado por scripts/demo/crear_demo.py. NO subir a git.",
        "BEGIN;",
    ]

    # Cuentas (auth)
    for k, correo, nombre, _, _ in CUENTAS:
        u = uid(f"user-{k}")
        sql.append(
            "INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, "
            "raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, "
            "email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token) VALUES ("
            f"'00000000-0000-0000-0000-000000000000', '{u}', 'authenticated', 'authenticated', {q(correo)}, "
            f"extensions.crypt({q(claves[k])}, extensions.gen_salt('bf')), now(), "
            f"{q({'provider': 'email', 'providers': ['email']})}, {q({'name': nombre, 'demo': True})}, now(), now(), '', '', '', '', '', '', '', '');"
        )
        identidad = {"sub": u, "email": correo, "email_verified": True}
        sql.append(
            "INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at) VALUES ("
            f"'{uid(f'identity-{k}')}', '{u}', '{u}', {q(identidad)}, 'email', now(), now());"
        )

    # Local
    plan = "(SELECT id FROM public.plans ORDER BY created_at LIMIT 1)"
    sql.append(
        "INSERT INTO public.tenants (id, name, slug, email, phone, plan_id, plan_status, primary_color, secondary_color, welcome_message, timezone, is_active, trial_ends_at) VALUES ("
        f"'{TENANT}', 'Demo Tablio', 'demo-tablio', 'contacto@{DOMINIO}', '+56 2 2345 6789', {plan}, 'active', '#E8531D', '#1A1A2E', "
        "'¡Bienvenido! Pide y paga desde tu mesa, sin esperar.', 'America/Santiago', true, now() + interval '10 years');"
    )
    sql.append(ins("public.restaurants", {"id": RESTAURANT, "tenant_id": TENANT, "name": "Demo Tablio"}))
    sql.append(ins("public.branches", {
        "id": BRANCH, "tenant_id": TENANT, "restaurant_id": RESTAURANT, "name": "Barrio Italia",
        "address": "Av. Italia 1234, Providencia", "city": "Santiago", "phone": "+56 2 2345 6789",
        "is_open": True, "payment_mode": "prepaid",
    }))
    sql.append(ins("public.menus", {"id": MENU, "tenant_id": TENANT, "branch_id": BRANCH, "name": "Carta Principal", "is_active": True}))

    # Carta
    for ci, (cat, emoji, platos) in enumerate(CARTA):
        cid = uid(f"cat-{cat}")
        sql.append(ins("public.categories", {"id": cid, "tenant_id": TENANT, "menu_id": MENU, "name": cat, "emoji": emoji, "sort_order": ci, "is_visible": True}))
        for pi, (nombre, desc, precio, alerg, etiq, mins, mod) in enumerate(platos):
            pid = uid(f"item-{nombre}")
            sql.append(ins("public.menu_items", {
                "id": pid, "tenant_id": TENANT, "category_id": cid, "name": nombre, "description_short": desc,
                "price": precio, "status": "available", "labels": etiq, "allergens": alerg,
                "prep_time_minutes": mins, "sort_order": pi,
            }))
            for gi, (gname, gtype, req, mn, mx, opciones) in enumerate(MODIFICADORES.get(mod, [])):
                gid = uid(f"grp-{nombre}-{gname}")
                sql.append(ins("public.modifier_groups", {
                    "id": gid, "tenant_id": TENANT, "menu_item_id": pid, "name": gname, "type": gtype,
                    "required": req, "min_selections": mn, "max_selections": mx, "sort_order": gi,
                }))
                for oi, (oname, extra) in enumerate(opciones):
                    sql.append(ins("public.modifiers", {
                        "id": uid(f"mod-{nombre}-{gname}-{oname}"), "tenant_id": TENANT, "group_id": gid,
                        "name": oname, "extra_price": extra, "is_available": True, "sort_order": oi,
                    }))

    # Mesas: 6 interior y 4 terraza
    mesas = []
    for n in range(1, 11):
        zona = "interior" if n <= 6 else "terraza"
        token = secrets.token_hex(16)
        mesas.append((n, zona, token))
        sql.append(ins("public.tables", {
            "id": uid(f"mesa-{n}"), "tenant_id": TENANT, "branch_id": BRANCH, "number": n,
            "name": f"Mesa {n}", "zone": zona, "capacity": 4 if n <= 6 else 6, "qr_token": token, "status": "free",
        }))

    # Equipo del local
    for k, correo, nombre, tipo, rol in CUENTAS:
        u = uid(f"user-{k}")
        if tipo in ("local", "staff"):
            sql.append(ins("public.tenant_members", {"id": uid(f"tm-{k}"), "user_id": u, "tenant_id": TENANT, "branch_id": BRANCH, "role": rol, "is_active": True}))
        if tipo == "staff":
            sql.append(ins("public.staff_users", {"id": uid(f"staff-{k}"), "tenant_id": TENANT, "branch_id": BRANCH, "auth_user_id": u, "name": nombre, "role": rol, "is_active": True}))
        if tipo == "plataforma":
            sql.append(ins("public.platform_admins", {"id": uid(f"pa-{k}"), "user_id": u}))
        if tipo == "backoffice":
            sql.append(ins("public.backoffice_members", {"id": uid(f"bo-{k}"), "user_id": u, "name": nombre, "email": correo, "role": rol, "zone": "Santiago Oriente", "is_active": True}))

    # Lealtad: 5 visitas = un schop gratis
    sql.append(ins("public.loyalty_programs", {
        "id": uid("loyalty"), "tenant_id": TENANT, "branch_id": None, "is_active": True, "type": "stamps",
        "goal_visits": 5, "points_per_thousand": 1, "points_goal": 100, "reward_description": "Un schop gratis",
    }))
    sql.append("COMMIT;")
    (PRIVADO / "demo_seed.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")

    filas = "\n".join(f"| {rol} | `{correo}` | `{claves[k]}` |" for k, correo, _, _, rol in CUENTAS)
    mesas_md = "\n".join(f"| {n} | {z} | `/demo-tablio/menu?t={t}` |" for n, z, t in mesas)
    (PRIVADO / "DEMO_CREDENCIALES.md").write_text(
        "# Local de demo — credenciales (PRIVADO, no subir a git)\n\n"
        "Local: **Demo Tablio** · `/demo-tablio`\n\n"
        "| Rol | Correo | Contraseña |\n|---|---|---|\n" + filas + "\n\n"
        "## Mesas\n\n| Mesa | Zona | Link de la carta |\n|---|---|---|\n" + mesas_md + "\n",
        encoding="utf-8",
    )
    print(f"{len(sql)} líneas SQL → privado/demo_seed.sql · credenciales → privado/DEMO_CREDENCIALES.md")


if __name__ == "__main__":
    main()
