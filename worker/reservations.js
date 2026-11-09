import { events } from './catalog.js';
import { floorPlan } from './plan.js';

import { json, error } from './http.js';
import { getProfile, profileApi, manageProfiles } from './profiles.js';
import { isConfirmed, receiptStatus, sendReceipt, reference } from './receipts.js';
export const paymentsOn = env => Boolean(env.DB && env.TRIP_PAYMENTS_ENABLED === 'true' && env.LIBELULA_APPKEY);
export const eventInfo = key => Object.hasOwn(events, key) ? events[key] : null;
export const findZone = (event, zone) => [...event.zones, event.birthday].find(option => option[0] === zone);
export const getOrder = (env, id) => env.DB.prepare('SELECT * FROM trip_reservations WHERE id = ?').bind(id).first();
const stopTime = event => Date.parse(event.dateISO + 'T20:00:00-04:00');
const committed = "(state IN ('creating','awaiting','paid','review') OR (state = 'offered' AND confirmed_at IS NOT NULL))";
const confirmed = "(state = 'paid' OR (state = 'offered' AND confirmed_at IS NOT NULL))";
const active = "(state <> 'void' AND (state <> 'offered' OR confirmed_at IS NOT NULL OR expires_at > ?))";

export function present(order,env) {
  const event = events[order.event];
  let state = order.closed_reason === 'table_assigned' ? 'superseded' : order.state;
  if (state === 'offered' && order.confirmed_at) state = 'confirmed';
  else if (state === 'offered' && order.expires_at <= Date.now()) state = 'expired';
  return {
    id:order.id,event:event.title,date:event.date,zone:findZone(event, order.zone)[1],
    lounge:order.lounge,amount:order.amount,state,expiresAt:order.expires_at,channel:order.channel,legacyCheckout:!order.user_id,reference:reference(order),receipt:receiptStatus(env,order)
  };
}

async function mapFor(env, night, viewer, adminMode) {
  const now = Date.now();
  const [settings, orders] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM trip_table_settings WHERE event = ?').bind(night),
    env.DB.prepare(`SELECT * FROM trip_reservations WHERE event = ? AND
      (${committed} OR ((? = 1 OR user_id = ?) AND ${active}))
      ORDER BY created_at DESC`).bind(night,Number(adminMode),viewer?.id || '',now)
  ]);
  const byTable = new Map(settings.results.map(row => [row.lounge,row]));
  const bookings = new Map();
  const ownOrders = new Map();
  const requests = new Map();
  for (const row of orders.results) {
    if (isConfirmed(row) || ['creating','awaiting','review'].includes(row.state)) bookings.set(row.lounge,row);
    else requests.set(row.lounge,(requests.get(row.lounge) || 0) + 1);
    if (viewer?.id === row.user_id && !ownOrders.has(row.lounge)) ownOrders.set(row.lounge,row);
  }
  const event = events[night];
  const profile = viewer && !viewer.admin ? await getProfile(env,viewer.id) : null;
  return {
    signedIn: Boolean(viewer), admin: Boolean(viewer?.admin), profileReady:Boolean(profile), blocked:Boolean(profile?.blocked), online: paymentsOn(env), closed: now >= stopTime(event),
    tables: floorPlan(night).map(table => {
      const config = byTable.get(table.number);
      const order = bookings.get(table.number);
      const zone = config?.zone || table.zone;
      const [,,amount] = findZone(event, zone);
      const base = config?.status || table.base;
      const status = order && isConfirmed(order) ? 'reserved' : base;
      const visibleOrder = adminMode ? order : ownOrders.get(table.number);
      const details = visibleOrder ? present(visibleOrder,env) : null;
      return {...table,zone,amount,status,
        ...(details && {order:details}),
        ...(adminMode && {base,customer:order?.customer_email || '',requests:requests.get(table.number) || 0})
      };
    })
  };
}

async function registerRequest(env, night, table, viewer, expectedZone, origin) {
  if (!viewer) return error('Inicia sesión para reservar.',401);
  if (viewer.admin) return error('El administrador gestiona el mapa desde su panel.',403);
  const profile = await getProfile(env,viewer.id);
  if (profile?.blocked) return error('Tu cuenta está bloqueada para nuevas reservas.',403);
  if (!profile) return error('Completa tu perfil antes de reservar.',409);
  const event = events[night];
  const now = Date.now();
  const limit = stopTime(event);
  if (now >= limit) return error('Las reservas en línea de este evento ya cerraron.',410);
  const current = await env.DB.prepare('SELECT zone FROM trip_table_settings WHERE event = ? AND lounge = ?').bind(night,table.number).first();
  const zone = current?.zone || table.zone;
  if (zone !== expectedZone) return error('La zona de la mesa cambió. Actualiza el mapa antes de continuar.',409);
  const [,,amount] = findZone(event,zone);
  const online = paymentsOn(env);
  const duration = online ? 10 : 45;
  const id = crypto.randomUUID();
  const insertion = await env.DB.prepare(`INSERT INTO trip_reservations (id,event,zone,lounge,amount,created_at,expires_at,user_id,customer_email,channel)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE
      COALESCE((SELECT status FROM trip_table_settings WHERE event = ? AND lounge = ?), ?) = 'available'
      AND COALESCE((SELECT zone FROM trip_table_settings WHERE event = ? AND lounge = ?), ?) = ?
      AND EXISTS (SELECT 1 FROM trip_profiles WHERE user_id = ? AND blocked = 0)
      AND NOT EXISTS (SELECT 1 FROM trip_reservations WHERE event = ? AND lounge = ? AND ${confirmed})
      AND NOT EXISTS (SELECT 1 FROM trip_reservations WHERE user_id = ? AND event = ? AND confirmed_at IS NULL
        AND state IN ('offered','creating','awaiting','review') AND ${active})`)
    .bind(id,night,zone,table.number,amount,now,Math.min(limit,now+duration*60000),viewer.id,profile.email,online?'online':'manual',
      night,table.number,table.base,night,table.number,table.zone,zone,viewer.id,night,table.number,viewer.id,night,now).run();
  if (!insertion.meta.changes) return error('La mesa ya no está disponible o ya tienes una solicitud abierta para este evento.',409);
  return json({order:present(await getOrder(env,id),env),url:origin+'/pago.html#'+id},201);
}

async function editTable(env, night, table, data) {
  const event = events[night];
  const number = table.number;
  if (!event.zones.some(zone => zone[0] === data.zone) || !['available','blocked','reserved'].includes(data.status)) {
    return error('Elige una zona y un estado válidos.',400);
  }
  const result = await env.DB.prepare(`INSERT INTO trip_table_settings (event,lounge,zone,status)
    SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM trip_reservations WHERE event = ? AND lounge = ? AND ${committed})
    ON CONFLICT(event,lounge) DO UPDATE SET zone = excluded.zone, status = excluded.status`)
    .bind(night,number,data.zone,data.status,night,number).run();
  return result.meta.changes ? json({ok:true}) : error('La mesa tiene una reserva activa. Revisa su estado antes de editarla.',409);
}

// Solo un cobro abierto o una confirmación pueden reclamar una mesa.
export async function claimTable(env,order,action) {
  const table = floorPlan(order.event).find(item=>item.number === order.lounge);
  if (!table) return false;
  const now = Date.now();
  const manual = action === 'confirm';
  const set = manual ? 'confirmed_at = ?' : "state = 'creating'";
  const channels = manual ? "channel = 'manual'" : "channel IN ('online','staff')";
  const result = await env.DB.prepare(`UPDATE trip_reservations SET ${set}
    WHERE id = ? AND state = 'offered' AND confirmed_at IS NULL AND expires_at > ? AND ${channels}
      AND COALESCE((SELECT status FROM trip_table_settings WHERE event = ? AND lounge = ?),?) = 'available'
      AND COALESCE((SELECT zone FROM trip_table_settings WHERE event = ? AND lounge = ?),?) = ?
      AND NOT EXISTS (SELECT 1 FROM trip_reservations WHERE event = ? AND lounge = ? AND id <> ? AND ${committed})`)
    .bind(...(manual ? [now] : []),order.id,now,
      order.event,order.lounge,table.base,order.event,order.lounge,table.zone,order.zone,
      order.event,order.lounge,order.id).run();
  return Boolean(result.meta.changes);
}

async function changeOrder(env, viewer, data, adminMode) {
  const order = await getOrder(env,typeof data.id === 'string' ? data.id : '');
  if (!order || (!adminMode && order.user_id !== viewer.id)) return error('Reserva no encontrada.',404);
  if (adminMode && data.action === 'confirm') {
    if (!await claimTable(env,order,'confirm')) return error('La solicitud venció, la mesa cambió o existe otra confirmación o cobro abierto.',409);
    await sendReceipt(env,await getOrder(env,order.id));
  } else if (data.action === 'cancel') {
    const restriction = adminMode ? '' : ' AND confirmed_at IS NULL';
    const result = await env.DB.prepare("UPDATE trip_reservations SET state = 'void' WHERE id = ? AND state = 'offered'" + restriction).bind(order.id).run();
    if (!result.meta.changes) return error('El estado actual de la reserva impide esta operación.',409);
  } else return error('Operación no válida.',400);
  return json({order:present(await getOrder(env,order.id),env)});
}

export async function reservationApi(env,url,method,viewer,data) {
  const route = url.pathname;
  if (['/api/mapa','/api/admin/mapa'].includes(route) && method === 'GET') {
    const night = url.searchParams.get('evento');
    const adminMode = route === '/api/admin/mapa';
    if ((adminMode || url.searchParams.get('modo') === 'admin') && !viewer?.admin) return error('Acceso exclusivo del administrador.',403);
    if (!eventInfo(night)) return error('Evento no encontrado.',404);
    return json(await mapFor(env,night,viewer,adminMode));
  }
  if (route === '/api/perfil') return profileApi(env,method,viewer,data);
  if (!viewer) return error('Inicia sesión para continuar.',401);
  const adminRoute = route.startsWith('/api/admin/');
  if (adminRoute && !viewer.admin) return error('Acceso exclusivo del administrador.',403);
  if (!adminRoute && viewer.admin) return error('Esta cuenta corresponde al panel administrativo.',403);
  if (route === '/api/admin/usuarios') return manageProfiles(env,method,url,data);
  if (route === '/api/admin/reservas' && method === 'GET') {
    const night = url.searchParams.get('evento') || '';
    const customer = url.searchParams.get('cliente') || '';
    const lounge = Number(url.searchParams.get('mesa') || 0);
    if (!Number.isInteger(lounge) || lounge < 0 || lounge > 84) return error('Número de mesa no válido.',400);
    const rows = await env.DB.prepare(`SELECT r.*,p.public_id,p.first_name,p.last_name FROM trip_reservations r
      LEFT JOIN trip_profiles p ON r.user_id = p.user_id WHERE (? = '' OR r.event = ?) AND (? = '' OR p.public_id = ?) AND (? = 0 OR r.lounge = ?)
      ORDER BY r.created_at DESC LIMIT 200`).bind(night,night,customer,customer,lounge,lounge).all();
    return json({orders:rows.results.map(row=>({...present(row,env),customer:[row.first_name,row.last_name].filter(Boolean).join(' '),email:row.customer_email,customerId:row.public_id}))});
  }
  if (route === '/api/admin/recibo' && method === 'POST') {
    const order = await getOrder(env,typeof data.id === 'string' ? data.id : '');
    if (!order || !isConfirmed(order)) return error('La reserva todavía no tiene recibo.',409);
    await sendReceipt(env,order);
    return json({receipt:receiptStatus(env,await getOrder(env,order.id))});
  }
  if (route === '/api/mis-reservas' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM trip_reservations WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(viewer.id).all();
    return json({orders:rows.results.map(row=>present(row,env))});
  }
  if (method !== 'POST') return error('Ruta no encontrada.',404);
  if (route === '/api/mis-reservas/cancelar') return changeOrder(env,viewer,{id:data.id,action:'cancel'},false);
  if (route === '/api/admin/reserva') return changeOrder(env,viewer,data,true);
  const night = data.evento;
  if (!eventInfo(night)) return error('Evento no encontrado.',404);
  const table = floorPlan(night).find(item => item.number === data.mesa);
  if (!table) return error('Mesa no encontrada.',404);
  if (route === '/api/mapa/reservar') return registerRequest(env,night,table,viewer,data.zone,url.origin);
  if (route === '/api/admin/mesa') return editTable(env,night,table,data);
  return error('Ruta no encontrada.',404);
}
