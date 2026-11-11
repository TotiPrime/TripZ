# TripZ · Ventas, perfiles y reclamos automáticos

Este ZIP actualiza el sitio existente de `TotiPrime/TripZ` y el Worker `tripz-qr`. Usa Firebase Spark, Cloudflare Workers Free y el proyecto `trip-76b7e`.

## Instalar la actualización

1. En tu PC, reemplaza los archivos de la carpeta `servicio-qr` que ya usas por los archivos de `servicio-qr` de este ZIP. Desde esa carpeta ejecuta en PowerShell:

   ```powershell
   npm.cmd ci
   npx.cmd wrangler deploy
   ```

   El Worker usa los secretos existentes `FIREBASE_SERVICE_ACCOUNT` y `TRIP_QR_KEY`. Conserva el valor de la clave para que los QR emitidos y los perfiles cifrados sigan siendo recuperables. El ZIP contiene código y configuración pública.

2. En [Firebase → Realtime Database → Reglas](https://console.firebase.google.com/project/trip-76b7e/database/trip-76b7e-default-rtdb/rules), publica el contenido completo de `database.rules.json` incluido. Ese archivo protege los datos personales y el historial, permite consultar el rol propio y reserva los cambios de mesa al administrador.
3. En [GitHub → TotiPrime/TripZ → main](https://github.com/TotiPrime/TripZ/upload/main), sube **el contenido de la carpeta `github-pages`**, conservando las rutas. La URL pública del Worker ya viene en `qr-config.js`. Después del despliegue, vuelve a abrir Administración o Mi cuenta y recarga la página.

## Relacionadores

Crea o reutiliza una cuenta verificada en Firebase Authentication. En **Realtime Database → Datos**, registra el UID exacto así:

```text
trip
  relacionadores
    UID_DE_LA_CUENTA: true
```

Usa un booleano. Las cuentas administradoras conservan su permiso en `trip/admins/UID`. Si una cuenta figura en los dos grupos, prevalece el rol administrador. Abre [Administración TRIP](https://totiprime.github.io/TripZ/administracion.html) con la cuenta del relacionador, completa su perfil y entra a **Ventas** o **Reclamos QR**.

- **Relacionador.** Confirma solicitudes pendientes con un método de pago o registra una venta directa a un cliente con cuenta verificada y perfil completo. Consulta su propio historial y canjea QR. Las ediciones de solicitudes y las anulaciones pertenecen al administrador.
- **Administrador.** Además puede ver las ventas de todo el equipo, editar o eliminar solicitudes sin confirmar, anular reservas sin canjes y cambiar una reserva confirmada a otra mesa disponible del mismo evento y tarifa antes de que se use algún QR. Al moverla se invalidan los QR anteriores y se generan los de la nueva mesa.
- **Cliente.** Consulta sus solicitudes y reservas, abre sus QR y puede retirar una solicitud sin confirmar. El cambio de mesa lo realiza un administrador.

**Perfil obligatorio para los tres roles.** Después de verificar el correo, guarda nombre, apellido y carnet en **Mi perfil**. Las reservas, solicitudes, ventas y reclamos quedan bloqueados hasta guardar los tres campos. Esto también se aplica a las cuentas existentes. El mapa público sigue disponible. Si una solicitud anterior pertenece a un cliente con perfil pendiente, el cliente debe completarlo antes de que el equipo pueda confirmar el pago.

## Ventas y datos personales

- **Ventas** registra quién confirmó la mesa, su rol, el evento, la mesa, la tarifa, el cliente, el método de pago, la referencia opcional, fecha y hora de Bolivia, estado e historial de anulaciones o cambios. La confirmación registra un pago comprobado por el equipo de TRIP.
- El historial contiene las ventas registradas desde que se activó esta función. Las reservas anteriores conservan los QR válidos de sus beneficios. Si falta un comprobante, se genera al pulsar **Ver o actualizar QR**. Las reservas creadas antes del registro de ventas quedan sin atribución de vendedor ni método de pago.
- El carnet se cifra en el Worker y se guarda en Firebase en un bloque privado. El formulario muestra únicamente su terminación al titular y el historial de ventas excluye el carnet. Cualquier cambio del nombre de una cuenta se refleja en ventas futuras.

## Canje automático

1. Ve a **Reclamos QR → Activar cámara** y apunta al QR.
2. Revisa la mesa, evento y beneficio que detectó TripZ. Verás **Válido para consumo**, **Válido para combo** o **Válido para manillas**.
3. Pulsa **RECLAMADO** al entregar el beneficio. Cada QR corresponde a un solo canje y el historial conserva quién lo canjeó y cuándo. El número de mesa aparece en cada comprobante.

Si la edición anterior emitió un QR de ingreso a la mesa, queda deshabilitado. Su historial se conserva.

Para App Inventor, el POST a `/tripCanjes` usa el encabezado `Authorization: Bearer <ID_TOKEN_FIREBASE>` y el JSON `{"accion":"validar","codigo":"<QR>"}`. Usa `"accion":"canjear"` para confirmar la entrega. El tipo es opcional y el Worker lo obtiene del comprobante. Los clientes antiguos pueden seguir enviando un tipo explícito.
