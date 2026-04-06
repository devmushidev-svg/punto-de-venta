# Mapa de módulos — POS propio

Referencia funcional: manual Smart Punto de Venta y capturas de pantalla del usuario. Producto con marca y UI propias.

## Núcleo de acceso y multiempresa

| Módulo | Descripción | Dependencias |
|--------|-------------|--------------|
| Inicio de sesión | Empresa + usuario + contraseña; ajustes avanzados (URL API en PWA) | Organizaciones, usuarios |
| Organizaciones (empresas) | Datos fiscales, logo, moneda, país | — |
| Usuarios y permisos | Roles: admin, cajero, almacén | Organización |

## Facturación y operación

| Módulo | Descripción | Dependencias |
|--------|-------------|--------------|
| Productos | Catálogo, precios, impuesto, stock, código | Organización |
| Nueva venta | Líneas, cliente, términos, totales | Productos, clientes |
| Lista de ventas | Historial, filtros | Ventas |
| Clientes | RTN, crédito, datos de contacto | Organización |
| Compras | Ingreso de mercadería, actualiza stock/costo | Productos, proveedores |
| Proveedores | Datos y compras | Organización |
| Caja / sesión de caja | Apertura, cierre, arqueo | Usuario, ventas |
| Cotizaciones | Presupuesto → opcional conversión a venta | Productos, clientes |
| Pedidos | Pedidos a proveedor | Proveedores, productos |
| Traslados | Entre sucursales/bodegas (fase avanzada) | Productos, ubicaciones |

## Cobranza y pagos

| Módulo | Descripción | Dependencias |
|--------|-------------|--------------|
| Cuentas por cobrar | Ventas a crédito, saldos, abonos | Ventas, clientes |
| Cuentas por pagar | Compras a crédito, abonos | Compras, proveedores |

## Administración

| Módulo | Descripción | Dependencias |
|--------|-------------|--------------|
| Reportes | Ventas, inventario, resumen de caja | Datos transaccionales |
| Configuración general | Factura, productos, columnas visibles, general | Organización |
| Respaldos | Exportación de datos (JSON/SQLite) | Admin |
| Auditoría / historial | Movimientos de producto (fase 3) | Productos |

## Flujos críticos

1. **Venta contado**: abrir sesión de caja (opcional) → nueva venta → descuenta stock → registra pago.
2. **Venta crédito**: nueva venta con término crédito → genera saldo en cuentas por cobrar.
3. **Compra**: nueva compra → aumenta stock → si crédito, saldo en cuentas por pagar.
4. **Cierre de caja**: cierra sesión con totales esperados vs registrados.
