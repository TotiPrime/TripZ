import { events } from './catalog.js';
import { statusLabels } from './plan.js';
import { request, orderLabels } from './booking-api.js';
import { whatsappForReservation } from './reserva-whatsapp.js';

const venue = document.querySelector('#mapa');
const plan = document.querySelector('#seat-plan');
const picker = document.querySelector('#table-picker');
const panel = document.querySelector('#map-selection');
const legend = document.querySelector('#map-zones');
const notice = document.querySelector('#map-notice');
const adminLink = document.querySelector('#map-admin');
const admin = document.body.hasAttribute('data-admin');
let night;
let model;
let selected;
let filter;
let seats = new Map();
let busy = false;
let refreshId = 0;
let lastDetail;
const returning = new URLSearchParams(location.search);
const returnTable = Number(returning.get('mesa'));
let restoreSelection = !admin && Number.isInteger(returnTable) && returnTable>=1 && returnTable<=84;
let revision = 0;
let receipt;

const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
function link(label, url, primary = false) {
  const a = el('a',label,'button '+(primary?'solid':'ghost'));
  a.href = url;
  return a;
}
function button(label, action, primary = false) {
  const node = el('button',label,'button '+(primary?'solid':'ghost'));
  node.type = 'button';
  node.addEventListener('click',action);
  return node;
}
function message(text = '') {
  notice.textContent = text;
  notice.hidden = !text;
}
function zoneInfo(zone) {
  return events[night].zones.find(item => item[0] === zone);
}

function setFilter(zone) {
  filter = zone;
  for (const control of legend.children) control.setAttribute('aria-pressed',String(control.dataset.zone === (filter || '')));
  for (const node of seats.values()) node.classList.toggle('filtered',Boolean(filter && filter !== node.dataset.zone));
}

export function focusZone(zone) {
  setFilter(zone);
  venue.scrollIntoView({block:'start'});
}

function select(number, scroll = false) {
  if (number !== selected) receipt = undefined;
  selected = number || undefined;
  picker.value = number || '';
  for (const [key,node] of seats) node.setAttribute('aria-pressed',String(key === selected));
  detail(true);
  if (scroll && matchMedia('(max-width:850px)').matches) panel.scrollIntoView({block:'nearest'});
}

function drawSeats() {
  const sorted = [...model.tables].sort((a,b) => a.number-b.number);
  if (!seats.size) {
    picker.replaceChildren(new Option('Seleccionar número',''));
    for (const table of sorted) {
      const node = el('button','','seat');
      node.type = 'button';
      node.style.setProperty('--x',table.x);
      node.style.setProperty('--y',table.y);
      const logo = el('img');
      logo.src = '/assets/trip-logo.png';
      logo.alt = '';
      logo.hidden = true;
      node.append(logo,el('span',String(table.number)));
      node.addEventListener('click',() => select(table.number,true));
      seats.set(table.number,node);
      plan.append(node);
      picker.add(new Option('Mesa ' + table.number,table.number));
    }
  }
  for (const table of sorted) {
    const node = seats.get(table.number);
    const [,name,price,,color] = zoneInfo(table.zone);
    const label = 'Mesa ' + table.number + ', ' + name + ', ' + statusLabels[table.status] + ', ' + price + ' Bs';
    node.setAttribute('aria-label',label);
    node.title = label;
    node.setAttribute('aria-pressed',String(table.number === selected));
    node.dataset.status = table.status;
    node.dataset.zone = table.zone;
    node.style.setProperty('--seat',color);
    node.firstElementChild.hidden = table.status !== 'reserved';
    picker.options[table.number].textContent = 'Mesa ' + table.number + ' · ' + statusLabels[table.status];
  }
  setFilter(filter);
}

async function refresh({quiet = false} = {}) {
  const id = ++refreshId;
  const query = (admin ? '/api/admin/mapa' : '/api/mapa') + '?evento=' + night;
  try {
    const next = await request(query);
    if (id !== refreshId) return;
    model = next;
    if (adminLink) adminLink.hidden = !next.admin;
    if (!quiet) message();
    drawSeats();
    if (restoreSelection && returning.get('evento') === night) {
      restoreSelection = false;
      select(returnTable);
    } else detail();
  } catch (error) {
    if (id !== refreshId) return;
    if (!quiet || !model) message(error.message);
  }
}

export function setMapNight(value) {
  if (value === night) return;
  night = value;
  revision++;
  receipt = undefined;
  model = undefined;
  selected = undefined;
  filter = undefined;
  for (const node of seats.values()) node.remove();
  seats = new Map();
  picker.replaceChildren(new Option('Seleccionar número',''));
  const filters = [['','Todas las zonas'],...events[night].zones];
  legend.replaceChildren(...filters.map(([zone,name,price,,color]) => {
    const control = el('button','','zone-filter');
    control.type = 'button';
    control.dataset.zone = zone;
    if (color) {
      const marker = el('i');
      marker.style.setProperty('--seat',color);
      control.append(marker);
    }
    control.append(name + (price ? ' · ' + price + ' Bs' : ''));
    control.addEventListener('click',() => setFilter(filter === zone ? undefined : zone));
    return control;
  }));
  setFilter();
  document.querySelector('#map-kicker').textContent = admin ? 'ADMINISTRACIÓN DEL MAPA' : 'PLANO DE MESAS';
  message('Consultando disponibilidad…');
  detail(true);
  refresh();
}

function makeSelect(label, list, initial) {
  const wrap = el('label',label,'table-picker');
  const input = el('select');
  for (const [value,caption] of list) input.add(new Option(caption,value,value===initial,value===initial));
  wrap.append(input);
  return [wrap,input];
}

async function mutate(path,data,control,success) {
  const started = revision;
  busy = true;
  control.disabled = true;
  try {
    const result = await request(path,data);
    if (started === revision) success(result);
    if (admin) window.dispatchEvent(new Event('trip:admin-change'));
  } catch (error) {
    if (started === revision) message(error.message);
  } finally {
    busy = false;
    control.disabled = false;
    refresh({quiet:true});
  }
}

function adminControls(card, table) {
  const order = table.order;
  if (order) {
    if (table.customer) card.append(el('p','Cuenta: ' + table.customer));
    card.append(el('p',(orderLabels[order.state] || order.state) + ' · ' + order.amount + ' Bs'));
    card.append(el('p','Referencia web: ' + order.id.slice(0,8).toUpperCase()));
    if (order.state === 'confirmed') {
      card.append(button('Cancelar y liberar mesa',event => {
        if (confirm('¿Cancelar esta reserva y liberar la mesa?')) mutate('/api/admin/reserva',{id:order.id,action:'cancel'},event.currentTarget,() => message('Reserva cancelada.'));
      }));
    }
    if (order.state === 'awaiting') {
      card.append(button('Conciliar pago',event => mutate('/api/admin/conciliar?id='+encodeURIComponent(order.id),{},event.currentTarget,result => message(result.state === 'paid' ? 'Pago confirmado.' : 'El proveedor todavía no confirma el pago.'))));
    }
    return;
  }
  if (table.requests) {
    card.append(el('p',table.requests + (table.requests === 1 ? ' solicitud sin confirmar.' : ' solicitudes sin confirmar.')));
    card.append(button('Ver solicitudes de esta mesa',()=>{
      window.dispatchEvent(new CustomEvent('trip:table-requests',{detail:{night,table:table.number}}));
    }));
  }
  const [zoneLabel,zone] = makeSelect('Zona',events[night].zones,table.zone);
  const [statusLabel,status] = makeSelect('Estado de la mesa', [['available','Disponible'],['blocked','Bloqueada'],['reserved','Reservada fuera de la web']],table.base);
  card.append(zoneLabel,statusLabel,button('Guardar cambios',event => {
    mutate('/api/admin/mesa',{evento:night,mesa:table.number,zone:zone.value,status:status.value},event.currentTarget,() => message('Cambios guardados.'));
  },true));
}

async function prepareReservation(table,description,control) {
  if (busy) return;
  const current = revision;
  const eventNight = night;
  control.disabled = true;
  try {
    const {profile,blocked} = await request('/api/perfil');
    if (current !== revision || selected !== table.number) return;
    if (!profile) {
      location.assign(loginPath(table));
      return;
    }
    if (blocked && !table.order) throw new Error('Tu cuenta está bloqueada para nuevas reservas.');
    const showReceipt = ({order,url}) => {
      if (selected !== table.number) return;
      const whatsapp = whatsappForReservation(order,profile,{year:events[eventNight].dateISO.slice(0,4),description});
      receipt = {order,url,whatsapp};
      detail(true);
      panel.querySelector('.whatsapp-reservation-link').focus();
    };
    if (table.order) showReceipt({order:table.order,url:'/pago.html#'+table.order.id});
    else await mutate('/api/mapa/reservar',{evento:eventNight,mesa:table.number,zone:table.zone},control,showReceipt);
  } catch(error) {
    if (current === revision) message(error.message);
  } finally {
    control.disabled = false;
  }
}

function receiptControls(card) {
  const {order,url,whatsapp} = receipt;
  card.append(el('p','Solicitud registrada · '+order.reference,'eyebrow'));
  card.append(el('p',order.channel === 'online' ? 'Completa el pago para confirmar tu mesa. La disponibilidad se verifica al iniciar el cobro.' : 'La mesa sigue disponible hasta que TRIP verifique el pago y confirme la reserva.'));
  card.append(el('p','Puedes avisar a TRIP por WhatsApp. El mensaje incluye los datos del titular y el CI.'));
  const send = link('Abrir WhatsApp y enviar',whatsapp,true);
  send.classList.add('whatsapp-reservation-link');
  send.target = '_blank';
  send.rel = 'noopener noreferrer';
  card.append(send,link(order.channel === 'online' ? 'Continuar al pago' : 'Ver mi reserva',url));
}

function loginPath(table) {
  return '/login.html?'+new URLSearchParams({volver:'mapa',evento:night,mesa:table.number});
}

function detail(force = false) {
  const table = model?.tables.find(item => item.number === selected);
  const key = JSON.stringify([night,table,model?.online,model?.closed,model?.signedIn,model?.profileReady,model?.blocked,receipt?.order.id]);
  if ((!force && key === lastDetail) || (busy && !force)) return;
  lastDetail = key;
  const card = el('div','','map-selection');
  if (!table) {
    card.append(el('p','TU SELECCIÓN','eyebrow'),el('h4','Elige una mesa'),el('p','Toca un número del plano para ver su zona, precio y estado.'));
    panel.replaceChildren(card);
    return;
  }
  const [,zone,price,description] = zoneInfo(table.zone);
  card.append(el('p',statusLabels[table.status],'eyebrow'),el('h4','Mesa ' + table.number),el('p',zone + ' · ' + price + ' Bs'),el('p',description));
  if (admin) adminControls(card,table);
  else if (receipt && receipt.order.lounge === table.number && table.status === 'available' && (!table.order || ['offered','awaiting'].includes(table.order.state))) receiptControls(card);
  else if (table.order) {
    const order = table.order;
    card.append(el('p',orderLabels[order.state]),link('Ver mi reserva','/pago.html#'+order.id,true));
    if (table.status === 'available' && ['offered','awaiting'].includes(order.state)) {
      card.append(button('Preparar mensaje para TRIP',event=>prepareReservation(table,description,event.currentTarget)));
    }
  } else if (table.status === 'available' && !model.closed) {
    if (model.admin) card.append(link('Abrir panel administrativo','/admin',true));
    else if (!model.signedIn) card.append(link('Iniciar sesión para reservar',loginPath(table),true));
    else if (model.blocked) card.append(el('p','Tu cuenta está bloqueada para nuevas reservas.'));
    else if (!model.profileReady) card.append(link('Completar perfil para reservar',loginPath(table),true));
    else {
      card.append(el('p',model.online ? 'Tienes 10 minutos para iniciar el pago con Libélula.' : 'Registrar la solicitud deja la mesa disponible. TRIP confirma la reserva después de verificar el pago.'));
      card.append(button('Registrar solicitud',event=>prepareReservation(table,description,event.currentTarget),true));
    }
  } else if (model.closed) card.append(el('p','Las reservas web para esta noche ya cerraron.'));
  panel.replaceChildren(card);
}

picker.addEventListener('change',() => select(Number(picker.value)));
document.querySelector('#map-reload').addEventListener('click',() => refresh());
setInterval(() => { if (night && !document.hidden && !busy) refresh({quiet:true}); },20000);
window.addEventListener('pageshow',event => { if (event.persisted && night) refresh(); });
