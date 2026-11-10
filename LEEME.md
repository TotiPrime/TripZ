# TripZ · QR con Firebase Spark

La web sigue en GitHub Pages y las cuentas, solicitudes y canjes se mantienen en el proyecto Firebase `trip-76b7e`. El backend de QR se ejecuta en Cloudflare Workers Free. Esta edición no usa Cloud Functions ni Secret Manager de Google.

## 1. Crear una identidad para el Worker

1. Abre [Google Cloud → Cuentas de servicio de trip-76b7e](https://console.cloud.google.com/iam-admin/serviceaccounts?project=trip-76b7e) con la cuenta dueña del proyecto.
2. Crea una cuenta de servicio llamada `tripz-qr-worker`. Asígnale **Firebase Realtime Database Admin** y **Firebase Authentication Viewer**. Puedes buscarlos por los identificadores `roles/firebasedatabase.admin` y `roles/firebaseauth.viewer`. El Worker necesita leer y escribir el estado de la reserva y consultar si el usuario de Firebase sigue activo. Usa solo esos roles y no le asignes el rol de propietario.
3. En la cuenta creada, entra a **Claves → Agregar clave → Crear clave nueva → JSON**. Guarda la descarga fuera de la carpeta del proyecto, por ejemplo `Descargas\tripz-worker.private.json`. Este JSON es una credencial privada de servidor. Súbela únicamente al secreto de Cloudflare en el siguiente paso.
4. Firebase Authentication suele tener activa la API Identity Toolkit. Si el Worker indica que esa API está deshabilitada, ábrela en la [biblioteca de APIs del proyecto](https://console.cloud.google.com/apis/library/identitytoolkit.googleapis.com?project=trip-76b7e).

## 2. Desplegar en Cloudflare Free

Crea o abre una [cuenta de Cloudflare](https://dash.cloudflare.com/) y usa **Workers Free**. Abre PowerShell en la carpeta `servicio-qr` del ZIP extraído y ejecuta:

```powershell
npm.cmd ci
npx.cmd wrangler login
npx.cmd wrangler deploy
```

Autoriza Wrangler en el navegador. Si Cloudflare pide un subdominio `workers.dev`, configúralo en **Workers & Pages**. Copia la URL HTTPS que muestra Wrangler después del despliegue.

Guarda la credencial de servicio como secreto. Cambia la ruta del ejemplo por el nombre real de tu archivo:

```powershell
Get-Content "$env:USERPROFILE\Downloads\tripz-worker.private.json" -Raw | npx.cmd wrangler secret put FIREBASE_SERVICE_ACCOUNT
```

Si la edición anterior nunca llegó a emitir QR, genera una clave nueva y guárdala en el segundo secreto, sin mostrarla en la terminal:

```powershell
node -p "require('node:crypto').randomBytes(32).toString('hex')" | npx.cmd wrangler secret put TRIP_QR_KEY
```

Si ya emitiste QR con otra instalación, usa **la misma clave privada** en el secreto `TRIP_QR_KEY` para conservar su validez. Guarda un respaldo privado. El formato de la clave es hexadecimal de 64 caracteres.

Abre la URL del Worker seguida de `/salud`. Debe mostrar `"ok":true`. Esa ruta comprueba la configuración de los secretos. La conexión a Firebase se prueba al consultar una reserva con sesión.

## 3. Conectar GitHub Pages y Firebase

1. En la carpeta principal del ZIP, abre `qr-config.js`. Sustituye las comillas vacías por la URL real que mostró Wrangler, por ejemplo `export const qrApiBase = 'https://tripz-qr.tu-subdominio.workers.dev';`.
2. En [TotiPrime/TripZ, rama main](https://github.com/TotiPrime/TripZ/upload/main), sube el `qr-config.js` editado, `firebase-trip.js` y `public/qr-browser.js` en sus rutas originales. Esos tres archivos bastan si ya publicaste las páginas separadas de la edición QR. Para una instalación completa, sube también los HTML, `panel-trip.js`, `firebase-config.js` y la carpeta `public`. La carpeta `servicio-qr` se usa para desplegar el Worker.
3. En [Firebase → Realtime Database → Reglas](https://console.firebase.google.com/project/trip-76b7e/database/trip-76b7e-default-rtdb/rules), publica el contenido completo de `database.rules.json`. Si ya publicaste las reglas del paquete QR anterior, puedes conservarlas. Verifica que `mesas` tenga `.write: false` y que `qrActivos`, `qrHistorial` y `canjeadores` sean privados.
4. Entra a **Administración** en TripZ con una cuenta verificada. Confirma una solicitud de prueba y desde **Mi cuenta** pulsa **Ver o actualizar QR**. Una reserva ya confirmada recibe los QR al abrir esa opción si todavía no los tiene.

## Canje desde App Inventor

El endpoint es `URL_DEL_WORKER/tripCanjes`. Envía un POST JSON con el encabezado `Authorization: Bearer <ID_TOKEN_FIREBASE>`. La cuenta debe ser una administradora verificada o estar habilitada en `trip/canjeadores/UID` con valor booleano `true`.

```json
{"accion":"validar","tipo":"manillas","codigo":"<texto completo del lector QR>"}
```

Usa `"tipo":"consumo"` en el puesto de consumo. La operación `validar` muestra mesa y beneficio sin reclamarlo. Para entregarlo, envía `"accion":"canjear"`. Entrega solo si la respuesta indica `ok: true` y `estado: "reclamado"`. Si el código ya se usó, el servidor devuelve `409` con `code: "qr_reclamado"`. El historial queda en Firebase.

El consumo del viernes corresponde al saldo según mesa. El sábado incluye un combo y un QR aparte para las cinco manillas. Los QR siguen cifrados con AES-256-GCM y se canjean en una sola operación condicional de Firebase, aunque dos lectores envíen el mismo código a la vez.
