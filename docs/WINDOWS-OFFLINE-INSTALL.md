# Instalacion Windows offline/local

Punto Flow esta pensado para venderse como PWA cloud-first con respaldo local. El flujo comercial recomendado es:

1. La app trabaja normalmente contra la nube Supabase.
2. Si el negocio pierde internet, la PC Windows usa la API local y SQLite.
3. Las ventas, caja, productos, clientes e inventario quedan guardados localmente.
4. Cuando vuelve internet, la PC sincroniza cambios con Supabase.

El cliente final no debe instalar PostgreSQL, Node ni editar `.env` manualmente. Esos pasos se automatizaran dentro del instalador Windows.

## Arranque local para desarrollo

Desde la raiz del repo:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows-local-start.ps1
```

El script:

- crea `apps\api\.env` si no existe;
- usa `DATABASE_URL="file:./dev.db"`;
- instala dependencias;
- prepara SQLite con Prisma;
- ejecuta el seed;
- levanta API y web local.

URLs locales:

- API: `http://localhost:3001`
- Web/PWA: `http://localhost:5173`

## Empaque comercial pendiente

Para el instalador profesional se debe empaquetar:

- API Node/Hono compilada;
- frontend web compilado;
- runtime necesario;
- base SQLite local;
- servicio o launcher de Windows;
- asistente visual para configurar Supabase;
- acceso directo de escritorio con apariencia de app instalada.

El usuario final solo deberia abrir Punto Flow, iniciar sesion y escoger si opera en nube o en modo local offline.
