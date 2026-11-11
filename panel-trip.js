import {mountTripFirebase} from './firebase-trip.js?v=ventas-2';

document.querySelector('#trip-panel-content').innerHTML = `<section id="trip-access" class="panel-section" aria-label="Sesión de TRIP">
<p id="trip-access-status" role="status"></p>
<form id="trip-auth" class="form-grid" hidden>
<label>Correo electrónico<input type="email" name="email" autocomplete="username" maxlength="254" required></label>
<label>Contraseña<input type="password" name="password" autocomplete="current-password" maxlength="128" required></label>
<button class="button solid" name="action" value="login">Iniciar sesión</button>
<button class="button ghost" name="action" value="register">Crear cuenta</button>
<button class="button ghost" name="action" value="reset" formnovalidate>Recuperar contraseña</button>
</form>
<div id="trip-session" hidden>
<div class="actions">
<button id="trip-verify" type="button" class="button ghost" hidden>Reenviar verificación</button>
<button id="trip-reload-user" type="button" class="button ghost" hidden>Ya verifiqué mi correo</button>
<button id="trip-retry-access" type="button" class="button ghost" hidden>Reintentar acceso</button>
<button id="trip-signout" type="button" class="button ghost">Cerrar sesión</button>
</div>
<section id="trip-personal-profile" class="my-order" hidden>
<h2>Mi perfil</h2>
<p id="trip-profile-status" class="order-meta" role="status"></p>
<form id="trip-profile-form" class="trip-edit" autocomplete="off">
<label>Nombre <input name="nombre" required minlength="2" maxlength="60" autocomplete="given-name"></label>
<label>Apellido <input name="apellido" required minlength="2" maxlength="60" autocomplete="family-name"></label>
<label>Carnet de identidad <input name="carnet" required maxlength="24" autocomplete="off" spellcheck="false" aria-describedby="trip-profile-carnet"></label>
<p id="trip-profile-carnet" class="order-meta"></p>
<button class="button solid" type="submit">Guardar perfil</button>
</form>
</section>
<p id="trip-account-feedback" class="trip-feedback" role="status"></p>
<div id="trip-requests" class="trip-list"></div>
</div>
</section>
<section id="trip-admin" class="panel-section" aria-label="Gestión de TRIP" hidden>
<div class="actions"><button type="button" class="button solid" data-admin-view="requests" aria-pressed="true">Solicitudes</button><button type="button" class="button ghost" data-admin-view="users" aria-pressed="false" data-admin-only>Usuarios</button><button type="button" class="button ghost" data-admin-view="claims" aria-pressed="false">Reclamos QR</button><button type="button" class="button ghost" data-admin-view="sales" aria-pressed="false">Ventas</button></div>
<p id="trip-admin-feedback" class="trip-feedback" role="status"></p>
<section id="trip-admin-requests">
<div class="trip-tools"><label>Buscar solicitud <input id="trip-search-request" type="search" placeholder="Correo, mesa o referencia"></label><label>Estado <select id="trip-request-state"><option value="">Todos</option><option value="sent">Solicitud enviada</option><option value="confirmed">Reserva confirmada</option><option value="unavailable">Mesa ocupada</option></select></label></div>
<div class="actions"><button id="trip-refresh-pending" type="button" class="button ghost" hidden>Actualizar solicitudes</button></div>
<div id="trip-admin-orders" class="trip-list"></div>
</section>
<section id="trip-admin-users" hidden>
<div class="trip-tools"><label>Buscar usuario <input id="trip-search-user" type="search" placeholder="Nombre, correo o UID"></label></div>
<p class="order-meta">El directorio muestra clientes que verificaron su correo y entraron en TripZ, además de quienes ya tienen solicitudes. Para eliminar una cuenta de acceso, usa <a href="https://console.firebase.google.com/project/trip-76b7e/authentication/users" target="_blank" rel="noopener noreferrer">Firebase Authentication</a>.</p>
<div id="trip-admin-directory" class="trip-list"></div>
</section>
<section id="trip-admin-claims" hidden aria-labelledby="trip-claims-title">
<h2 id="trip-claims-title" tabindex="-1">Reclamos por QR</h2>
<p>Escanea el comprobante. Revisa el beneficio y pulsa <strong>RECLAMADO</strong> al registrarlo.</p>
<div class="actions">
<button type="button" class="button solid" id="trip-claim-start">Activar cámara</button>
<button type="button" class="button ghost" id="trip-claim-stop" hidden>Detener cámara</button>
</div>
<video id="trip-claim-camera" class="claim-camera" playsinline muted autoplay aria-label="Vista de la cámara para escanear el QR" hidden></video>
<p id="trip-claim-status" class="trip-feedback" role="status" aria-live="polite">Activa la cámara y enfoca un QR de TRIP.</p>
<section id="trip-claim-result" class="my-order claim-result" aria-labelledby="trip-claim-table" hidden>
<h3 id="trip-claim-table"></h3>
<p id="trip-claim-event" class="order-meta"></p>
<p id="trip-claim-benefit"></p>
<div class="actions"><button type="button" class="button solid" id="trip-claim-redeem">RECLAMADO</button></div>
</section>
</section>
<section id="trip-admin-sales" hidden aria-labelledby="trip-sales-title">
<h2 id="trip-sales-title">Registro de ventas</h2>
<details class="my-order">
<summary>Registrar venta directa</summary>
<form id="trip-direct-sale" class="trip-edit">
<label>Correo de la cuenta del cliente <input name="clienteCorreo" type="email" required maxlength="254"></label>
<label>Evento <select name="evento" required></select></label>
<label>Mesa disponible <select name="mesa" required></select></label>
<div id="trip-sale-payment" class="trip-tools"></div>
<button type="submit" class="button solid">Registrar pago y confirmar mesa</button>
</form>
</details>
<div class="trip-tools">
<label id="trip-sale-scope-label">Ver <select id="trip-sale-scope"><option value="mias">Mis ventas</option><option value="equipo">Todo el equipo</option></select></label>
<label>Filtrar <input id="trip-sale-search" type="search" placeholder="Vendedor, cliente, mesa o método"></label>
<button id="trip-sales-refresh" type="button" class="button ghost">Actualizar</button>
</div>
<p id="trip-sales-status" class="trip-feedback" role="status"></p>
<div id="trip-sales-list" class="trip-list"></div>
</section>
</section>
<section id="trip-editor" class="panel-section" aria-labelledby="trip-editor-title" hidden>
<h2 id="trip-editor-title" tabindex="-1">Editar</h2>
<form class="trip-edit"></form>
</section>
`;
mountTripFirebase();
