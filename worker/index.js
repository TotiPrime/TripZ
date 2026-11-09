import { events } from './catalog.js';
import { paymentsOn, findZone, getOrder, present, reservationApi, claimTable } from './reservations.js';
import { json, error } from './http.js';
import { getProfile } from './profiles.js';
import { receiptImage, sendReceipt } from './receipts.js';
import { adminPage } from './admin-page.js';
import { authApi, getViewer } from './auth.js';

const provider = 'https://api.todotix.com/rest/deuda/';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const plain = value => typeof value === 'string' ? value.trim() : '';
const formatDay = time => new Date(time - 4 * 3600000).toISOString().slice(0, 10);
const expired = order => order.expires_at <= Date.now();
const allowedHost = url => url.protocol === 'https:' && !url.username && !url.password && !url.port && /(^|\.)(libelula\.bo|todotix\.com)$/i.test(url.hostname);

async function providerCall(path, payload, env) {
  const response = await fetch(provider + path, {
    method:'POST', headers:{'Content-Type':'application/json', Accept:'application/json'},
    body: JSON.stringify({...payload, appkey:env.LIBELULA_APPKEY}),
    redirect:'error', signal:AbortSignal.timeout(12000)
  });
  const result = await response.json();
  if (!response.ok || (result.error !== 0 && result.error !== false)) throw new Error('Libélula rechazó la operación.');
  return result;
}

async function checkout(env, order, data, origin) {
  if (order.state === 'paid') return error('Esta reserva ya está pagada.', 409);
  if (order.channel === 'manual') return error('Esta solicitud se confirma con el equipo de TRIP.',409);
  if ((order.state === 'offered' && expired(order)) || order.state === 'void' || Date.now() >= Date.parse(events[order.event].dateISO + 'T20:00:00-04:00')) return error('El enlace venció. Comunícate con TRIP.', 410);
  if (order.state === 'awaiting') return json({url:order.checkout_url});
  if (order.state !== 'offered') return error('Estamos revisando el enlace de pago. Comunícate con TRIP si el problema continúa.', 409);
  const email = plain(data.email);
  const name = plain(data.name);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120 || name.length < 2 || name.length > 100) return error('Ingresa tu nombre y un correo válido.', 400);
  if (!await claimTable(env,order,'checkout')) return error('El cobro no se puede iniciar: la mesa cambió, se confirmó o ya tiene otro cobro abierto.',409);
  const event = events[order.event];
  const concept = 'TRIP · ' + event.title + ' · ' + findZone(event, order.zone)[1] + ' · Mesa ' + order.lounge;
  try {
    const result = await providerCall('registrar', {
      identificador:order.id, email_cliente:email, nombre_cliente:name, descripcion:concept,
      moneda:'BOB', fecha_vencimiento:event.dateISO,
      callback_url:origin + '/api/pagos/notificar?id=' + order.id,
      url_retorno:origin + '/pago.html#' + order.id,
      lineas_detalle_deuda:[{concepto:concept, cantidad:1, costo_unitario:order.amount}]
    }, env);
    const url = new URL(result.url_pasarela_pagos);
    if (!allowedHost(url) || !plain(result.id_transaccion)) throw new Error('Respuesta de pago no válida.');
    await env.DB.prepare("UPDATE trip_reservations SET state = 'awaiting', provider_id = ?, checkout_url = ? WHERE id = ? AND state = 'creating'").bind(result.id_transaccion,url.href,order.id).run();
    return json({url:url.href});
  } catch {
    // If the provider received the request before a timeout, retrying could issue a second debt.
    await env.DB.prepare("UPDATE trip_reservations SET state = 'review' WHERE id = ? AND state = 'creating'").bind(order.id).run();
    return error('No pudimos obtener el enlace. Comunícate con TRIP para revisar la reserva.', 502);
  }
}

async function verify(env, order) {
  if (order.state !== 'awaiting') return order;
  const payments = await providerCall('consultar_pagos', {
    fecha_inicial:formatDay(order.created_at) + ' 00:00:00',
    fecha_final:formatDay(Date.now()) + ' 23:59:59'
  }, env);
  if (!Array.isArray(payments.datos)) throw new Error('Respuesta de conciliación no válida.');
  const match = payments.datos.find(payment =>
    payment.id_transaccion === order.provider_id && String(payment.identificador) === order.id &&
    payment.moneda === 'BOB' && Number(payment.monto_pagado) === order.amount && payment.fecha_pago);
  if (match) {
    await env.DB.prepare("UPDATE trip_reservations SET state = 'paid', paid_at = ? WHERE id = ? AND state = 'awaiting'").bind(Date.now(),order.id).run();
    const confirmed = await getOrder(env,order.id);
    await sendReceipt(env,confirmed);
    return getOrder(env,order.id);
  }
  return order;
}

async function api(request, env, url) {
  const route = url.pathname;
  const viewer = await getViewer(request,env);
  if (route === '/api/pagos/disponibilidad' && request.method === 'GET') return json({enabled:paymentsOn(env)});
  const isNotification = route === '/api/pagos/notificar';
  if (request.method === 'POST' && !isNotification && (request.headers.get('Origin') !== url.origin || !request.headers.get('Content-Type')?.startsWith('application/json'))) return error('Solicitud no válida.', 403);
  let data = {};
  if (request.method === 'POST' && !isNotification) {
    const body = await request.text();
    if (body.length > 4000) return error('Solicitud demasiado grande.', 413);
    try { data = JSON.parse(body); } catch { return error('Solicitud no válida.', 400); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return error('Solicitud no válida.', 400);
  }
  if (!env.DB) return error('El sistema de reservas no está disponible por el momento.',503);
  if (route.startsWith('/api/auth/')) return authApi(request,env,url,data,viewer);
  if (route === '/api/sesion' && request.method === 'GET') return json({role:viewer?(viewer.admin?'admin':'customer'):'anonymous',mustChange:Boolean(viewer?.mustChange)});
  if (viewer?.mustChange && route !== '/api/mapa') return error('Cambia la contraseña temporal antes de continuar.',403);
  const isReceipt = route === '/api/recibo/imagen' && request.method === 'GET';
  const adminReconcile = route === '/api/admin/conciliar' && request.method === 'POST';
  if (adminReconcile && !viewer?.admin) return error('Acceso exclusivo del administrador.',403);
  if (!adminReconcile && !isReceipt && !route.startsWith('/api/pagos/')) return reservationApi(env,url,request.method,viewer,data);
  const id = url.searchParams.get('id') || '';
  if (!uuid.test(id)) return error('Enlace de reserva inválido.', 404);
  const order = await getOrder(env, id);
  if (!order || (!isNotification && order.user_id && order.user_id !== viewer?.id && !viewer?.admin)) return error('Enlace de reserva inválido.',404);
  if (!isReceipt && !adminReconcile && viewer?.admin) return error('Usa el panel administrativo.',403);
  if (isReceipt) return viewer && (viewer.admin || order.user_id === viewer.id) ? receiptImage(env,order) : error('Recibo no encontrado.',404);
  if (route === '/api/pagos/reserva' && request.method === 'GET') {
    const profile = viewer && !viewer.admin ? await getProfile(env,viewer.id) : null;
    return json({...present(order,env),legacyCheckout:!profile});
  }
  if (route === '/api/pagos/iniciar' && request.method === 'POST') {
    if (!paymentsOn(env)) return error('Los pagos en línea están temporalmente desactivados.',503);
    if (order.user_id && order.user_id !== viewer?.id) return error('Solo el titular puede iniciar el pago.',403);
    const profile = viewer ? await getProfile(env,viewer.id) : null;
    if (profile?.blocked) return error('Tu cuenta está bloqueada para iniciar pagos.',403);
    const contact = profile ? {name:profile.first_name+' '+profile.last_name,email:order.customer_email || profile.email} : data;
    return checkout(env,order,contact,url.origin);
  }
  if ((isNotification || adminReconcile || route === '/api/pagos/verificar') && !env.LIBELULA_APPKEY) return error('La conciliación de pagos está desactivada.',503);
  if (adminReconcile || (route === '/api/pagos/verificar' && request.method === 'POST')) return json(present(await verify(env,order),env));
  if (isNotification && ['GET','POST'].includes(request.method)) {
    const transaction = url.searchParams.get('transaction_id');
    if (!transaction || transaction !== order.provider_id) return error('Transacción inválida.', 400);
    const confirmed = await verify(env, order);
    return confirmed.state === 'paid' ? json({error:0,id_transaccion:order.provider_id}) : error('Pago pendiente de conciliación.', 503);
  }
  return error('Ruta no encontrada.', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/equipo.html' || (url.pathname === '/' && url.searchParams.get('modo') === 'admin')) {
      return Response.redirect(url.origin+'/admin#mapa',302);
    }
    if (['/admin','/admin/'].includes(url.pathname)) {
      const viewer = await getViewer(request,env);
      if (!viewer || viewer.mustChange) return Response.redirect(url.origin+'/admin-login.html',302);
      if (!viewer.admin) return new Response('Acceso exclusivo del administrador.',{status:403,headers:{'Cache-Control':'no-store'}});
      return new Response(adminPage,{headers:{
        'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
      }});
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await api(request, env, url); }
    catch { return error('No pudimos completar la solicitud. Intenta más tarde o contacta a TRIP.', 502); }
  }
};
