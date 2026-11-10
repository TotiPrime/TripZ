# TripZ con Firebase

La configuración web del proyecto `trip-76b7e` ya está incluida en `firebase-config.js`. La portada, el mapa y el acceso a las cuentas se abren desde https://totiprime.github.io/TripZ/.

## Configurar y publicar

1. En **Firebase → Authentication**, pulsa **Comenzar** si aparece. En **Método de acceso**, habilita **Correo electrónico/contraseña**. En **Configuración → Dominios autorizados**, agrega `totiprime.github.io`.
2. En **Firebase → Realtime Database → Reglas**, pega el contenido completo de `database.rules.json` y pulsa **Publicar**. La ocupación del mapa es pública y contiene solamente referencias de reserva. Las solicitudes y sus correos están restringidos a la cuenta que los registró y a la administración.
3. Extrae el ZIP y sube su contenido a la raíz de `TotiPrime/TripZ`. Confirma que `index.html` quede directamente en la raíz junto con `firebase-trip.js`, `firebase-config.js` y la carpeta `public`. En **Settings → Pages**, selecciona `main / (root)`.
4. Desde **Mi cuenta** crea tu cuenta de administración y verifica el correo. En **Firebase → Authentication → Usuarios**, copia el UID de esa cuenta. En **Realtime Database → Datos**, agrega `trip/admins/UID_DE_TU_CUENTA` con valor booleano `true`. Si ya estás dentro de la página, actualízala después de asignar el rol. Usa una contraseña propia y guárdala de forma privada.

## Comprobar la reserva

- Registra una cuenta de cliente y verifica su correo. Vuelve a TripZ, pulsa **Ya verifiqué mi correo**, selecciona una mesa y elige **Solicitar esta mesa**. El cliente puede consultar lo enviado en **Mi cuenta → Mis solicitudes**. La mesa sigue disponible hasta que TRIP confirme el pago.
- Ingresa con la cuenta administradora. En **Mi cuenta → Solicitudes de TRIP**, pulsa **Confirmar pago verificado** tras revisar el pago. El mapa muestra el logo de TRIP en la mesa confirmada y el cliente ve **Reserva confirmada**. Para devolverla al mapa, usa **Liberar mesa**.
- El mapa toma la ocupación de Firebase. Verifica las mesas previamente marcadas en los flyers contra el inventario antes de anunciar la disponibilidad.
- Los pagos se verifican manualmente. La pasarela automática, el envío de recibos por correo y la migración de datos de la versión SQL quedan pendientes. Esta versión de Firebase guarda el UID, el correo y los datos de la mesa solicitada.
