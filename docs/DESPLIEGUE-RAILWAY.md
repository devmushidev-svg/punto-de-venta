# Despliegue de la API en Railway

La interfaz se publica en Vercel y la API se ejecuta como un servicio separado en Railway. Nunca suba archivos `.env` ni secretos al repositorio.

## 1. Crear el proyecto

1. En Railway, cree un proyecto desde el repositorio `devmushidev-svg/punto-de-venta`.
2. Agregue un servicio PostgreSQL al mismo proyecto.
3. En el servicio de la API, Railway detectará `railway.toml` y usará la ruta `/health` para comprobar que está listo.

## 2. Variables de la API

Configure estas variables en el servicio de API:

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | Referencia a la URL interna del servicio PostgreSQL de Railway. |
| `JWT_SECRET` | Valor aleatorio de al menos 32 caracteres. Nunca use un texto de ejemplo. |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | URL de producción de Vercel, sin barra final. |
| `API_PUBLIC_URL` | Dominio público HTTPS de este servicio API, sin barra final. |
| `SEED_DEMO` | `true` solo si desea cargar datos de demostración. |
| `DEMO_ADMIN_PASSWORD` | Contraseña nueva y privada para el usuario `ADMIN` si `SEED_DEMO=true`. |
| `DEMO_CASHIER_PASSWORD` | Contraseña nueva y privada para el usuario `CAJERO` si `SEED_DEMO=true`. |

Las dos contraseñas de demostración son obligatorias en producción. El despliegue falla cerrado si faltan, para no exponer `ADMIN/admin` públicamente.

## 3. Conectar la interfaz

En Vercel, agregue la variable de entorno de producción `VITE_API_BASE` con la URL pública de Railway y ejecute Redeploy. La aplicación web deberá iniciar sesión usando las contraseñas configuradas en Railway.
