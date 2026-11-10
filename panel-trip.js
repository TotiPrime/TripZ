import {mountTripFirebase} from './firebase-trip.js';

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
<p id="trip-account-feedback" class="trip-feedback" role="status"></p>
<div id="trip-requests" class="trip-list"></div>
</div>
</section>
<section id="trip-admin" class="panel-section" aria-label="Gestión de TRIP" hidden>
<div class="actions"><button type="button" class="button solid" data-admin-view="requests" aria-pressed="true">Solicitudes</button><button type="button" class="button ghost" data-admin-view="users" aria-pressed="false">Usuarios</button></div>
<p id="trip-admin-feedback" class="trip-feedback" role="status"></p>
<section id="trip-admin-requests">
<div class="trip-tools"><label>Buscar solicitud <input id="trip-search-request" type="search" placeholder="Correo, mesa o referencia"></label><label>Estado <select id="trip-request-state"><option value="">Todos</option><option value="sent">Solicitud enviada</option><option value="confirmed">Reserva confirmada</option><option value="unavailable">Mesa ocupada</option></select></label></div>
<div id="trip-admin-orders" class="trip-list"></div>
</section>
<section id="trip-admin-users" hidden>
<div class="trip-tools"><label>Buscar usuario <input id="trip-search-user" type="search" placeholder="Nombre, correo o UID"></label></div>
<p class="order-meta">El directorio muestra clientes que verificaron su correo y entraron en TripZ, además de quienes ya tienen solicitudes. Para eliminar una cuenta de acceso, usa <a href="https://console.firebase.google.com/project/trip-76b7e/authentication/users" target="_blank" rel="noopener noreferrer">Firebase Authentication</a>.</p>
<div id="trip-admin-directory" class="trip-list"></div>
</section>
</section>
<section id="trip-editor" class="panel-section" aria-labelledby="trip-editor-title" hidden>
<h2 id="trip-editor-title" tabindex="-1">Editar</h2>
<form class="trip-edit"></form>
</section>
`;
mountTripFirebase();
