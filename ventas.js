import { randomBytes } from 'node:crypto';
import catalog from './beneficios.json' with {type:'json'};
import { hasCompleteProfile, privateProfile } from './perfiles.js';
import {
  TripError, owns, isAdmin, isSeller, requireAdmin, requireStaff, requestFor,
  requireCurrent, confirmReservation, releaseReservation
} from './tickets.js';

const methods=new Set(['efectivo','qr','transferencia','tarjeta','otro']);

function paymentFor(input) {
  const metodoPago=input.metodoPago;
  const referenciaPago=typeof input.referenciaPago==='string'?input.referenciaPago.trim():'';
  if(!methods.has(metodoPago)) throw new TripError(400,'pago_invalido','Selecciona un método de pago.');
  if(referenciaPago && (!/^[A-Za-z0-9-]{1,40}$/.test(referenciaPago) || /^(?:\d[ -]?){13,19}$/.test(referenciaPago))) {
    throw new TripError(400,'referencia_invalida','Usa solo la referencia de la operación, sin números de tarjeta.');
  }
  return referenciaPago?{metodoPago,referenciaPago}:{metodoPago};
}

function fullName(profile) {
  return profile?profile.nombre+' '+profile.apellido:null;
}

function sellerName(state,uid,key) {
  const name=fullName(privateProfile(state,uid,key));
  if(!name) throw new TripError(409,'perfil_requerido','Completa tu perfil antes de registrar una venta.');
  return name;
}

function logSale(state,input,row,uid,key,now,origin,payment) {
  const name=sellerName(state,uid,key);
  const table=catalog[row.evento].mesas[row.mesa];
  const id=randomBytes(16).toString('hex');
  const sale={solicitud:input.solicitud,evento:row.evento,titulo:catalog[row.evento].titulo,
    mesa:row.mesa,mesaOriginal:row.mesa,zona:table.zona,montoBs:table.precio,
    vendedorUid:uid,vendedorNombre:name,rolVendedor:isAdmin(state,uid)?'administrador':'relacionador',
    clienteCorreo:row.correo,clienteNombre:fullName(privateProfile(state,row.uid,key)) || '',
    vendidaEn:now,estado:'confirmada',origen:origin,...payment};
  (state.ventas??={})[id]=sale;
  (state.ventaActiva??={})[input.solicitud]=id;
  return id;
}

export function confirmSale(state,input,uid,key,now,origin='solicitud') {
  requireStaff(state,uid);
  const row=requestFor(state,input.solicitud);
  requireCurrent(row,input);
  const payment=paymentFor(input);
  const active=state.ventaActiva?.[input.solicitud];
  if(state.mesas?.[row.evento]?.[row.mesa]===input.solicitud) {
    const existing=state.ventas?.[active];
    if(existing?.vendedorUid===uid && existing.metodoPago===payment.metodoPago &&
       (existing.referenciaPago||'')===(payment.referenciaPago||'')) return active;
    throw new TripError(409,'reserva_ya_confirmada','La mesa ya está confirmada.');
  }
  if(!hasCompleteProfile(state,row.uid)) {
    throw new TripError(409,'cliente_sin_perfil','El cliente debe completar nombre, apellido y carnet antes de confirmar la venta.');
  }
  const sale=logSale(state,input,row,uid,key,now,origin,payment);
  confirmReservation(state,input,uid,key,now);
  return sale;
}

export function releaseSale(state,input,uid,now) {
  releaseReservation(state,input,uid,now);
  const active=state.ventaActiva?.[input.solicitud];
  if(active) {
    Object.assign(state.ventas[active],{estado:'anulada',anuladaEn:now,anuladaPor:uid});
    delete state.ventaActiva[input.solicitud];
  }
}

export function moveSale(state,input,uid,now) {
  requireAdmin(state,uid);
  const row=requestFor(state,input.solicitud);
  requireCurrent(row,input);
  if(typeof input.nuevaMesa!=='string' || !owns(catalog[row.evento].mesas,input.nuevaMesa) || input.nuevaMesa===row.mesa) {
    throw new TripError(400,'mesa_invalida','Selecciona otra mesa del mismo evento.');
  }
  const {mesas}=catalog[row.evento];
  if(mesas[row.mesa].precio!==mesas[input.nuevaMesa].precio) {
    throw new TripError(409,'tarifa_distinta','Selecciona una mesa de la misma tarifa para conservar el pago registrado.');
  }
  if(state.mesas?.[row.evento]?.[input.nuevaMesa]) throw new TripError(409,'mesa_ocupada','La mesa de destino está ocupada.');
  const oldSeat=row.mesa;
  releaseReservation(state,input,uid,now);
  row.mesa=input.nuevaMesa;
  row.revision=(row.revision??0)+1;
  state.mesas[row.evento][row.mesa]=input.solicitud;
  const active=state.ventaActiva?.[input.solicitud];
  if(active) {
    const sale=state.ventas[active];
    sale.mesa=row.mesa;
    sale.zona=mesas[row.mesa].zona;
    (sale.movimientos??={})[randomBytes(8).toString('hex')]={desde:oldSeat,hacia:row.mesa,fecha:now,administradorUid:uid};
  }
  return row;
}

export function directSale(state,input,uid,key,now,customer) {
  requireStaff(state,uid);
  const {evento,mesa,operacion}=input;
  if(typeof evento!=='string' || typeof mesa!=='string' || !owns(catalog,evento) || !owns(catalog[evento].mesas,mesa) ||
     typeof operacion!=='string' || !/^[0-9a-f-]{36}$/.test(operacion)) {
    throw new TripError(400,'mesa_invalida','Selecciona un evento y una mesa válidos.');
  }
  if(!customer || customer.disabled || !customer.emailVerified || !hasCompleteProfile(state,customer.localId) ||
     isAdmin(state,customer.localId) || isSeller(state,customer.localId)) {
    throw new TripError(409,'cliente_invalido','El cliente debe tener cuenta verificada y perfil completo.');
  }
  const payment=paymentFor(input);
  const previous=state.ventas?.[state.ventasDirectas?.[uid]?.[operacion]];
  if(previous) {
    if(previous.evento!==evento || previous.mesaOriginal!==mesa ||
       previous.clienteCorreo.toLowerCase()!==customer.email.toLowerCase() ||
       previous.metodoPago!==payment.metodoPago ||
       (previous.referenciaPago||'')!==(payment.referenciaPago||'')) {
      throw new TripError(409,'operacion_usada','La referencia de esta operación ya corresponde a otra venta.');
    }
    if(previous.estado==='confirmada') return previous.solicitud;
    throw new TripError(409,'operacion_anulada','La venta anterior fue anulada. Abre un nuevo registro.');
  }
  if(state.mesas?.[evento]?.[mesa]) throw new TripError(409,'mesa_ocupada','Esa mesa ya está confirmada.');
  const existing=Object.entries(state.solicitudes??{}).find(([,row])=>row.uid===customer.localId && row.evento===evento && row.mesa===mesa);
  const id=existing?.[0]??randomBytes(15).toString('base64url');
  const row=existing?.[1]??{uid:customer.localId,correo:customer.email,evento,mesa,creada:now};
  (state.solicitudes??={})[id]=row;
  const sale=confirmSale(state,{...input,solicitud:id,revision:row.revision??0},uid,key,now,'directa');
  ((state.ventasDirectas??={})[uid]??={})[operacion]=sale;
  return id;
}

export function listSales(state,input,uid) {
  requireStaff(state,uid);
  const all=isAdmin(state,uid) && input.alcance==='equipo';
  return Object.entries(state.ventas??{}).filter(([,sale])=>all || sale.vendedorUid===uid)
    .map(([id,sale])=>({id,...sale})).sort((a,b)=>b.vendidaEn-a.vendidaEn);
}

export function pendingSales(state,uid) {
  requireStaff(state,uid);
  return Object.fromEntries(Object.entries(state.solicitudes??{}).filter(([,row])=>
    !state.mesas?.[row.evento]?.[row.mesa] && state.bloqueados?.[row.uid]!==true
  ));
}
