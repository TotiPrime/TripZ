# TripZ · Paneles y comprobantes QR

La portada se mantiene en https://totiprime.github.io/TripZ/. **Mi cuenta** abre `cuenta.html` y **Panel de administración** abre `administracion.html`. Firebase Authentication y las reservas existentes siguen en el proyecto `trip-76b7e`.

## Activar en producción

Cloud Functions para Firebase requiere el plan Blaze para desplegar. El backend usa las credenciales del entorno de Firebase. La clave QR se guarda en Secret Manager. Si ya existe `TRIP_QR_KEY` para esta versión del servicio, conserva su valor. Cambiarlo sin una migración impide leer los comprobantes cifrados con la clave anterior.

1. Extrae el ZIP en una carpeta local y abre una terminal ahí. Con Node.js 22 y Firebase CLI instalados, ejecuta:

   ```sh
   firebase login
   npm ci --prefix functions
   ```

2. Para la primera instalación, genera una clave aleatoria de 32 bytes con `node -p "require('node:crypto').randomBytes(32).toString('hex')"`. Ejecuta el siguiente comando y pega su valor cuando Firebase lo solicite. Guarda un respaldo privado de la clave. El ZIP y GitHub solo contienen el nombre del secreto.

   ```sh
   firebase functions:secrets:set TRIP_QR_KEY --project trip-76b7e
   ```

3. Despliega ambas funciones. Si tu proyecto usa una identidad de servicio restringida, esta debe poder consultar los usuarios de Firebase Authentication y leer y escribir Realtime Database. Firebase CLI asigna al servicio el acceso al secreto que declara la función.

   ```sh
   firebase deploy --only functions:tripReservas,functions:tripCanjes --project trip-76b7e
   ```

4. Publica las reglas desde la [consola de la base `trip-76b7e-default-rtdb`](https://console.firebase.google.com/project/trip-76b7e/database/trip-76b7e-default-rtdb/rules), o usa este comando desde la carpeta extraída. Las reglas reservan la escritura de la ocupación y de los comprobantes al servidor. Publicarlas conserva los registros existentes.

   ```sh
   firebase deploy --only database --project trip-76b7e
   ```

5. En [TotiPrime/TripZ, rama main](https://github.com/TotiPrime/TripZ/upload/main), sube a la raíz `index.html`, `cuenta.html`, `administracion.html`, `firebase-trip.js`, `panel-trip.js` y la carpeta `public` del ZIP. El sitio usa el `firebase-config.js` existente. El ZIP incluye esa configuración por si haces una instalación completa.

## Uso

- **Cliente.** Abre **Mi cuenta → Mis solicitudes y reservas → Ver o actualizar QR** en una reserva confirmada. La ficha muestra el número de mesa y su beneficio. Las reservas confirmadas con la versión anterior emiten sus comprobantes al abrirlos por primera vez.
- **Administrador.** Confirma tras verificar el pago. La mesa y sus comprobantes se registran juntos. Liberar una mesa antes de un canje anula sus códigos. Si algún beneficio ya fue reclamado, la reserva se conserva para auditoría.
- **Viernes.** Un QR por el monto de consumo de la mesa. Las entradas se compran por separado.
- **Sábado.** Un QR por el combo de la mesa y otro por el paquete completo de cinco manillas. Cada QR se canjea por separado y una sola vez.
- **Acceso de canje.** Usa un administrador verificado o asigna a un usuario verificado el valor booleano `true` en `trip/canjeadores/UID` desde Firebase. Ese rol permite canjear. El rol de administración se asigna por separado en `trip/admins`.

## Conexión futura desde App Inventor

URL del componente Web:

```text
https://us-central1-trip-76b7e.cloudfunctions.net/tripCanjes
```

Configura `RequestHeaders` con `Content-Type: application/json` y `Authorization: Bearer <ID_TOKEN_DE_FIREBASE>`. Usa el ID token del usuario verificado que inició sesión. Renueva el token mediante Firebase Authentication si vence. El componente `BarcodeScanner` entrega el texto del código como `result`. Envíalo completo por POST:

```json
{
  "accion": "validar",
  "tipo": "manillas",
  "codigo": "<resultado completo del lector>"
}
```

- `validar` confirma el tipo, evento, mesa y beneficio sin entregarlo.
- Para entregar el beneficio, envía la misma solicitud con `"accion": "canjear"`. Entrega únicamente cuando la respuesta indique `ok: true` y `estado: "reclamado"`. La operación se registra con fecha y UID del encargado.
- `409 qr_reclamado` indica que el código ya se usó. `409 tipo_incorrecto` indica que el código es del otro puesto. `404 qr_invalido` indica un código desconocido o anulado. `401` requiere revisar la sesión y `403` indica falta de permisos o correo sin verificar.

El código impreso es aleatorio y opaco. Su huella SHA-256 permite localizar el registro. El código, la mesa y el beneficio se guardan cifrados con AES-256-GCM. El registro conserva el estado de canje y su auditoría. Los clientes web y la aplicación de canje acceden mediante las funciones HTTPS autenticadas.
