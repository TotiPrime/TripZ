# TripZ · Gestión de reservas

Esta edición usa el proyecto Firebase `trip-76b7e` y se publica en https://totiprime.github.io/TripZ/. Las cuentas, las solicitudes, los administradores y las mesas que ya existen siguen en la misma base.

## Actualizar

1. En [Firebase → Realtime Database → Reglas](https://console.firebase.google.com/project/trip-76b7e/database/trip-76b7e-default-rtdb/rules), reemplaza el contenido por el archivo `database.rules.json` del ZIP y pulsa **Publicar**.
2. En [TotiPrime/TripZ → Subir a main](https://github.com/TotiPrime/TripZ/upload/main), sube `index.html`, `firebase-trip.js`, `database.rules.json` y `LEEME.md` del ZIP. El ZIP incluye también la configuración web y los recursos por si necesitas reinstalar el sitio completo.
3. Después del despliegue, abre [TripZ](https://totiprime.github.io/TripZ/#lounges) con tu sesión habitual. El botón **Panel de administración** aparece junto a **Mi cuenta** para las cuentas verificadas cuyo UID está en `trip/admins` con valor booleano `true`.

## Clientes

En **Mi cuenta → Mis solicitudes y reservas**, la ficha muestra el evento, la fecha, la mesa, la zona, la tarifa y un enlace al punto del mapa.

- **Solicitud enviada.** La mesa sigue disponible hasta que TRIP confirme el pago.
- **Reserva confirmada.** TRIP asignó la mesa a esa solicitud. La mesa aparece reservada en el mapa.
- **Mesa ocupada.** TRIP asignó la mesa a otra solicitud. Se puede cambiar a una mesa disponible o retirar la solicitud.

El cliente puede cambiar el evento y la mesa de una solicitud sin confirmar. Puede retirar la solicitud con una confirmación en pantalla.

## Administración

- **Solicitudes.** Busca por correo, UID, referencia o mesa y filtra por estado. Puedes cambiar o eliminar solicitudes sin confirmar, confirmar tras verificar el pago o liberar una mesa confirmada. Liberar deja la solicitud visible y devuelve la mesa al mapa.
- **Usuarios.** Busca clientes, edita su nombre en el directorio, consulta sus solicitudes y bloquea o reactiva las nuevas reservas. Un bloqueo también impide confirmar solicitudes pendientes de esa cuenta. Sus reservas ya confirmadas conservan la mesa hasta que se liberen.
- Para eliminar una cuenta de inicio de sesión, abre [Firebase Authentication → Usuarios](https://console.firebase.google.com/project/trip-76b7e/authentication/users) con permisos del proyecto. Gestiona por separado sus solicitudes o reservas en TripZ. Los permisos de administrador se asignan en Firebase.

El pago se verifica manualmente. La pasarela automática, los recibos por correo y la migración desde SQL se gestionan por separado.
