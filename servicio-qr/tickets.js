import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import catalog from './beneficios.json' with {type:'json'};

export const digest=code=>createHash('sha256').update(code).digest('hex');

export class TripError extends Error {
  constructor(status,code,message) {
    super(message);
    Object.assign(this,{status,code});
  }
}

function encrypt(payload,key,hash) {
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(hash,'hex'));
  const data=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  return {version:1,iv:iv.toString('base64url'),datos:data.toString('base64url'),tag:cipher.getAuthTag().toString('base64url')};
}

export function decrypt(entry,key,hash) {
  if(entry.cifrado.version!==1) throw new Error('Versión de cifrado inválida');
  const {iv,datos,tag}=entry.cifrado;
  const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));
  cipher.setAAD(Buffer.from(hash,'hex'));
  cipher.setAuthTag(Buffer.from(tag,'base64url'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(datos,'base64url')),cipher.final()]).toString('utf8'));
}

export function owns(object,key) {
  return Boolean(object && Object.hasOwn(object,key));
}

export function isAdmin(state,uid) {
  return owns(state?.admins,uid) && state.admins[uid]===true;
}

export function canRedeem(state,uid) {
  return isAdmin(state,uid) || (owns(state?.canjeadores,uid) && state.canjeadores[uid]===true);
}

export function requestFor(state,id) {
  const row=state?.solicitudes?.[id];
  if(!row) throw new TripError(404,'solicitud_no_encontrada','La solicitud ya no existe.');
  if(!owns(catalog,row.evento) || !owns(catalog[row.evento].mesas,row.mesa)) {
    throw new TripError(409,'mesa_invalida','La mesa solicitada no está en el catálogo.');
  }
  return row;
}

export function requireAdmin(state,uid) {
  if(!isAdmin(state,uid)) throw new TripError(403,'sin_permiso','Esta acción requiere una cuenta administradora.');
}

export function requireOwnerOrAdmin(state,uid,row) {
  if(row.uid!==uid) requireAdmin(state,uid);
}

export function requireCurrent(row,input) {
  if(row.evento!==input.evento || row.mesa!==input.mesa || (row.revision??0)!==input.revision) {
    throw new TripError(409,'solicitud_modificada','La solicitud cambió. Actualiza antes de continuar.');
  }
}

export function issued(state,id,row) {
  if(state?.mesas?.[row.evento]?.[row.mesa]!==id) {
    throw new TripError(409,'reserva_sin_confirmar','La mesa debe estar confirmada para mostrar sus QR.');
  }
  return state.qrActivos?.[id];
}

export function ensureTickets(state,id,row,key,now) {
  if(issued(state,id,row)) return;
  const event=catalog[row.evento];
  const table=event.mesas[row.mesa];
  const values={consumo:row.evento==='viernes'
    ? {modalidad:'saldo',montoBs:table.precio}
    : {modalidad:'combo',cantidad:1,detalle:'Singani o Ron 37 Lenguas'}};
  if(event.manillas) values.manillas={cantidad:event.manillas};
  const active={};
  state.qrHistorial??={};
  for(const [tipo,beneficio] of Object.entries(values)) {
    const codigo='TRIP1.'+randomBytes(32).toString('base64url');
    const hash=digest(codigo);
    const payload={codigo,solicitud:id,uid:row.uid,evento:row.evento,titulo:event.titulo,
      fecha:event.fecha,mesa:row.mesa,zona:table.zona,tipo,beneficio};
    state.qrHistorial[hash]={cifrado:encrypt(payload,key,hash),estado:'disponible',emitidoEn:now};
    active[tipo]=hash;
  }
  (state.qrActivos??={})[id]=active;
}

export function confirmReservation(state,input,uid,key,now) {
  requireAdmin(state,uid);
  const row=requestFor(state,input.solicitud);
  requireCurrent(row,input);
  const seats=(state.mesas??={})[row.evento]??={};
  if(seats[row.mesa] && seats[row.mesa]!==input.solicitud) {
    throw new TripError(409,'mesa_ocupada','Esa mesa ya está confirmada para otra solicitud.');
  }
  if(seats[row.mesa]!==input.solicitud && state.bloqueados?.[row.uid]===true) {
    throw new TripError(409,'cuenta_bloqueada','La cuenta está bloqueada para nuevas reservas.');
  }
  seats[row.mesa]=input.solicitud;
  ensureTickets(state,input.solicitud,row,key,now);
}

export function releaseReservation(state,input,uid,now) {
  requireAdmin(state,uid);
  const row=requestFor(state,input.solicitud);
  requireCurrent(row,input);
  const seats=state.mesas?.[row.evento];
  if(seats?.[row.mesa]!==input.solicitud) {
    throw new TripError(409,'reserva_sin_confirmar','La mesa ya no está confirmada para esta solicitud.');
  }
  const active=state.qrActivos?.[input.solicitud]??{};
  for(const hash of Object.values(active)) {
    const entry=state.qrHistorial[hash];
    if(entry.estado==='reclamado') {
      throw new TripError(409,'reserva_con_canje','Esta reserva ya registra un canje y debe conservarse para auditoría.');
    }
    Object.assign(entry,{estado:'anulado',anuladoEn:now,anuladoPor:uid});
  }
  if(state.qrActivos) delete state.qrActivos[input.solicitud];
  delete seats[row.mesa];
}

export function checkTicket(state,input,uid,key) {
  if(!canRedeem(state,uid)) throw new TripError(403,'sin_permiso','La cuenta no está autorizada para canjear.');
  const hash=digest(input.codigo);
  const entry=state.qrHistorial?.[hash];
  if(!entry || entry.estado==='anulado') throw new TripError(404,'qr_invalido','Código inválido o anulado.');
  const {solicitud,uid:owner,evento,titulo,fecha,mesa,zona,tipo,beneficio}=decrypt(entry,key,hash);
  if(tipo!==input.tipo) throw new TripError(409,'tipo_incorrecto','El QR corresponde a otro tipo de canje.');
  if(entry.estado==='reclamado') throw new TripError(409,'qr_reclamado','Este QR ya fue reclamado.');
  if(entry.estado!=='disponible' || state.qrActivos?.[solicitud]?.[tipo]!==hash ||
    state.mesas?.[evento]?.[mesa]!==solicitud || state.solicitudes?.[solicitud]?.uid!==owner) {
    throw new TripError(404,'qr_invalido','El comprobante ya no está vinculado a una reserva activa.');
  }
  return {entry,details:{solicitud,evento,titulo,fecha,mesa,zona,tipo,beneficio}};
}
