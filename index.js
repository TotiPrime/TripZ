import { authenticate, connectFirebase, lookupAccount } from './firebase-rest.js';
import {
  TripError, decrypt, requestFor, requireOwnerOrAdmin, issued, ensureTickets,
  requireStaff, checkTicket, ticketTypes
} from './tickets.js';
import { personalProfiles, requireCompleteProfile } from './perfiles.js';
import { confirmSale, releaseSale, moveSale, directSale, listSales, pendingSales } from './ventas.js';

const requestActions=new Set(['confirmar','liberar','comprobantes','mover']);
const scannerActions=new Set(['validar','canjear']);

function getKey(env) {
  if(!/^[0-9a-f]{64}$/i.test(env.TRIP_QR_KEY || '')) throw new Error('Falta configurar TRIP_QR_KEY');
  return Buffer.from(env.TRIP_QR_KEY,'hex');
}

function present(state,id,key) {
  const row=requestFor(state,id);
  const active=issued(state,id,row);
  return Object.entries(active).filter(([tipo])=>ticketTypes.has(tipo)).map(([tipo,hash])=>{
    const entry=state.qrHistorial[hash];
    const {codigo,evento,titulo,fecha,mesa,zona,beneficio}=decrypt(entry,key,hash);
    return {tipo,evento,titulo,fecha,mesa,zona,beneficio,estado:entry.estado,
      codigo:entry.estado==='disponible'?codigo:null,reclamadoEn:entry.reclamadoEn??null};
  });
}

async function reservations(db,input,uid,key) {
  if(!requestActions.has(input.accion) || typeof input.solicitud!=='string' || !/^[A-Za-z0-9_-]{20}$/.test(input.solicitud)) {
    throw new TripError(400,'solicitud_invalida','Indica una acción y una referencia válidas.');
  }
  const now=Date.now();
  if(input.accion==='confirmar') {
    await db.change(state=>confirmSale(state,input,uid,key,now));
    return {estado:'confirmada'};
  }
  if(input.accion==='liberar') {
    await db.change(state=>releaseSale(state,input,uid,now));
    return {estado:'liberada'};
  }
  if(input.accion==='mover') {
    await db.change(state=>{
      const row=moveSale(state,input,uid,now);
      ensureTickets(state,input.solicitud,row,key,now);
    });
    return {estado:'movida'};
  }
  let state=await db.get();
  const row=requestFor(state,input.solicitud);
  requireOwnerOrAdmin(state,uid,row);
  const active=issued(state,input.solicitud,row);
  if(!active?.consumo || (row.evento==='sabado' && !active.manillas)) {
    ({state}=await db.change(latest=>{
      const current=requestFor(latest,input.solicitud);
      requireOwnerOrAdmin(latest,uid,current);
      ensureTickets(latest,input.solicitud,current,key,now);
    }));
  }
  return {comprobantes:present(state,input.solicitud,key)};
}

async function claims(db,input,uid,key) {
  if(!scannerActions.has(input.accion) || (input.tipo!==undefined && !ticketTypes.has(input.tipo)) ||
    typeof input.codigo!=='string' || !/^TRIP1\.[A-Za-z0-9_-]{43}$/.test(input.codigo)) {
    throw new TripError(400,'qr_invalido','Formato de QR o tipo de canje inválido.');
  }
  if(input.accion==='validar') {
    const {details}=checkTicket(await db.get() ?? {},input,uid,key);
    return {estado:'disponible',...details};
  }
  const now=Date.now();
  const {result}=await db.change(state=>{
    const {entry,details}=checkTicket(state ?? {},input,uid,key);
    Object.assign(entry,{estado:'reclamado',reclamadoEn:now,reclamadoPor:uid});
    return details;
  });
  return {estado:'reclamado',reclamadoEn:now,...result};
}

async function sales(db,input,uid,key,env,token) {
  if(input.accion==='listar') return {ventas:listSales(await db.get(),input,uid)};
  if(input.accion==='solicitudes') return {solicitudes:pendingSales(await db.get(),uid)};
  if(input.accion!=='registrar') throw new TripError(400,'accion_invalida','Acción de ventas inválida.');
  requireStaff(await db.get(),uid);
  const correo=typeof input.clienteCorreo==='string'?input.clienteCorreo.trim():'';
  if(correo.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    throw new TripError(400,'correo_invalido','Ingresa el correo del cliente.');
  }
  const customer=await lookupAccount(env.FIREBASE_PROJECT_ID,token,{email:[correo]});
  const now=Date.now();
  const {result}=await db.change(state=>directSale(state,input,uid,key,now,customer));
  return {solicitud:result,estado:'confirmada'};
}

function withCompleteProfile(db,uid) {
  return {
    async get() {
      const state=await db.get();
      requireCompleteProfile(state,uid);
      return state;
    },
    change(update) {
      return db.change(state=>{
        requireCompleteProfile(state,uid);
        return update(state);
      });
    }
  };
}

export default {
  async fetch(request,env) {
    const {pathname}=new URL(request.url);
    const origin=request.headers.get('Origin');
    const headers=new Headers({'Cache-Control':'no-store','Vary':'Origin'});
    if(origin===env.WEB_ORIGIN) {
      headers.set('Access-Control-Allow-Origin',origin);
      headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers','Authorization, Content-Type');
      headers.set('Access-Control-Max-Age','600');
    }
    const json=(value,status=200)=>Response.json(value,{headers,status});
    try {
      if(origin && origin!==env.WEB_ORIGIN) throw new TripError(403,'origen_invalido','Origen no autorizado.');
      if(pathname==='/salud' && request.method==='GET') {
        getKey(env);
        if(!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT');
        return json({ok:true,servicio:'tripz-qr'});
      }
      const handler={'/tripReservas':reservations,'/tripCanjes':claims,'/tripPerfiles':personalProfiles,'/tripVentas':sales}[pathname];
      if(!handler) throw new TripError(404,'ruta_invalida','Ruta desconocida.');
      if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
      if(request.method!=='POST') throw new TripError(405,'metodo_invalido','Usa POST.');
      if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '') ||
        Number(request.headers.get('Content-Length'))>4096) {
        throw new TripError(400,'formato_invalido','Envía un objeto JSON de hasta 4096 bytes.');
      }
      const raw=await request.text();
      let input;
      try {if(Buffer.byteLength(raw)<=4096) input=JSON.parse(raw);}
      catch { /* El JSON incorrecto se rechaza abajo. */ }
      if(!input || typeof input!=='object' || Array.isArray(input)) {
        throw new TripError(400,'formato_invalido','Envía un objeto JSON de hasta 4096 bytes.');
      }
      const {uid,token}=await authenticate(request,env);
      const db=connectFirebase(env,token);
      const access=handler===personalProfiles?db:withCompleteProfile(db,uid);
      return json({ok:true,...await handler(access,input,uid,getKey(env),env,token)});
    } catch(error) {
      if(error instanceof TripError) return json({ok:false,code:error.code,message:error.message},error.status);
      console.error('Error del servicio QR',error?.message || 'Error');
      return json({ok:false,code:'servicio_no_disponible',message:'El servicio QR no pudo acceder a Firebase. Revisa la configuración del Worker.'},503);
    }
  }
};
