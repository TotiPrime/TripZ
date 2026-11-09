# TRIP Cochabamba

## Iniciar en tu PC

Usa Node.js 22.13 o posterior. Extrae el proyecto y abre una terminal en la carpeta de `package.json`.

```bash
npm run setup-admin
npm start
```

Ejecuta la preparación una sola vez. La terminal muestra la contraseña temporal para `admin`. Entra a [Administración local](http://127.0.0.1:3000/admin) y cámbiala. Los clientes se registran e inician sesión en [Mi cuenta](http://127.0.0.1:3000/login.html).

La base local persiste en `.trip-data/trip.sqlite`. Conserva `.env.local` junto con su clave de cifrado si haces una copia de la base. Ambos archivos quedan fuera del repositorio. El servidor local escucha solo en la PC.

Para guardar el código en GitHub, sube los archivos fuente. El `index.html` de la raíz sirve como portada estática en Pages y enlaza al sistema alojado. El login, SQLite, reservas y administración se ejecutan en el servidor. El despliegue con Sites necesita la base D1, el identificador del Site y el secreto de arranque `TRIP_ADMIN_PASSWORD_HASH`. Una vez creada la cuenta administrativa, su contraseña se gestiona en SQL y el arranque no la reemplaza.

## Mapa y reservas

- El plano contiene las 84 mesas numeradas por evento y toma como punto de partida las marcas de los flyers. El precio sigue el tarifario enviado por mensaje. El administrador debe contrastar la distribución de zonas y los cupos con el inventario de TRIP, en especial cuando el flyer y el tarifario difieren.
- **Clientes** se registran e inician sesión por `/login.html` y completan su perfil. Reciben un ID interno. El correo de la cuenta se guarda como destinatario al crear cada reserva. CI y fecha de nacimiento se cifran con AES-GCM usando `TRIP_PROFILE_KEY`. El cliente puede preparar el aviso por WhatsApp con su CI desde el mapa.
- **Administración** entra por `/admin` con una cuenta de rol administrador. El panel permite editar el mapa, confirmar o liberar solicitudes, marcar reservas externas, consultar reservas por cliente y bloquear o reactivar perfiles. Se muestra solo la terminación del CI.
- **Recibos** se habilitan tras confirmación manual o pago validado. La página de estado permite descargar el plano con la mesa destacada e imprimir o guardar el recibo en PDF. Para entrega automática por correo, configura `RESEND_API_KEY` y un remitente en `TRIP_RECEIPT_FROM` con dominio verificado en Resend. La integración adjunta el plano como PNG. El panel muestra el estado del envío y permite reintentar.
- **Secretos** se configuran en el alojamiento. `TRIP_PROFILE_KEY` contiene 32 bytes codificados en hexadecimal. Conserva esa clave para poder leer los perfiles existentes. Una rotación requiere volver a cifrar los datos antes de retirar la clave anterior.
- Con el checkout apagado, cada cliente puede registrar una solicitud por evento durante 45 minutos. La mesa permanece disponible hasta la confirmación del pago. El logo TRIP señala reservas confirmadas.
- Con el checkout activo, el cliente dispone de 10 minutos para iniciar su pago. Una deuda ya enviada al proveedor queda en revisión o en espera hasta que se concilie. La mesa solo se marca pagada cuando coinciden identificador, transacción, moneda e importe. El equipo no debe reasignar deudas no conciliadas.

## Desarrollo y comprobaciones

Usa Node.js 22 o posterior. Ejecuta `npm test` para compilar y comprobar la aplicación. El checkout queda desactivado hasta configurar la pasarela. Tras compilar, ejecuta `node scripts/check-reservations.js` para comprobar roles, concurrencia, cambios del mapa y conciliación con un proveedor simulado.

## Activar cobros

1. Confirma el inventario, los precios y la cuenta comercial de Libélula. Valida el contrato de integración, los medios de pago y la facturación. La integración usa `registrar` y `consultar_pagos` según el [manual del proveedor](https://libelula.bo/wp-content/uploads/2020/12/Libelula-Manual-de-Integracion-v2.7.2.pdf).
2. Guarda `LIBELULA_APPKEY` como secreto del alojamiento. Habilita `TRIP_PAYMENTS_ENABLED=true` solo cuando estén listas las pruebas con el proveedor. La base `DB` requiere las migraciones de `drizzle/`.
3. Comprueba que el dominio definitivo permite tanto el regreso del cliente como la notificación del proveedor. Un sitio privado puede bloquear el webhook externo. El retorno y la página de reserva también permiten solicitar la conciliación desde una cuenta autorizada.
4. Verifica una operación controlada antes de ofrecer pagos a clientes. Si una solicitud quedó en revisión, comprueba si el proveedor creó la deuda antes de intervenir.


## Acceso y seguridad

- Contraseñas con scrypt y sal aleatoria individual. Las sesiones se guardan como huellas en SQL y caducan. En producción la cookie usa HTTPS.
- La contraseña inicial de administración debe cambiarse al primer ingreso y el cambio invalida las sesiones anteriores. Los endpoints comprueban el rol de cada cuenta.
- El registro usa correo y contraseña. La verificación del correo y el restablecimiento de contraseña por correo quedan pendientes de habilitar con un servicio de correo. Los perfiles y reservas anteriores se conservan y pueden revisarse desde el panel.
