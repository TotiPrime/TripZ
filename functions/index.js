import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import QRCode from 'qrcode';
import {
  TripError, decrypt, requestFor, requireOwnerOrAdmin, issued, ensureTickets,
  confirmReservation, releaseReservation, checkTicket
} from './tickets.js';

initializeApp();
const secret=defineSecret('TRIP_QR_KEY');
const trip=()=>getDatabase().ref('trip');
const requestActions=new Set(['confirmar','liberar','comprobantes']);
const scannerActions=new Set(['validar','canjear']);
const baseOptions={region:'us-central1',secrets:[secret],maxInstances:5,timeoutSeconds:30};
const publicOrigin='https://totiprime.github.io';

async function actor(req) {
  const match=req.get('authorization')?.match(/^Bearer ([\w.-]+)$/i);
  if(!match) throw new TripError(401,'sesion_requerida','Inicia sesión con Firebase.');
  let token;
  try {token=await getAuth().verifyIdToken(match[1],true);}
  catch {throw new TripError(401,'sesion_invalida','La sesión venció o no es válida. Vuelve a iniciar sesión.');}
  if(token.email_verified!==true) throw new TripError(403,'correo_sin_verificar','Verifica el correo de la cuenta.');
  return token.uid;
}

function getKey() {
  const value=secret.value().trim();
  if(!/^[0-9a-f]{64}$/i.test(value)) throw new Error('TRIP_QR_KEY debe contener 32 bytes en hexadecimal.');
  return Buffer.from(value,'hex');
}

function endpoint(options,handler) {
  return onRequest(options,async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(req.method!=='POST') return res.status(405).json({ok:false,code:'metodo_invalido',message:'Usa POST.'});
    try {
      if(!req.is('application/json') || !req.body || Array.isArray(req.body) || typeof req.body!=='object') {
        throw new TripError(400,'formato_invalido','Envía un objeto JSON.');
      }
      if(req.rawBody?.length>4096) throw new TripError(400,'formato_invalido','Solicitud demasiado grande.');
      const result=await handler(req.body,await actor(req),getKey());
      return res.json({ok:true,...result});
    } catch(error) {
      if(error instanceof TripError) return res.status(error.status).json({ok:false,code:error.code,message:error.message});
      console.error('Error interno en TripZ QR',error?.code || error?.name || 'Error');
      return res.status(500).json({ok:false,code:'error_interno',message:'No se pudo procesar el QR. Intenta nuevamente.'});
    }
  });
}

async function change(update) {
  let failure,result;
  const tx=await trip().transaction(state=>{
    failure=result=undefined;
    if(state===null) return null; // Un caché vacío fuerza la comprobación del estado actual en Firebase.
    try {result=update(state);return state;}
    catch(error) {failure=error;return undefined;}
  },undefined,false);
  if(failure) throw failure;
  if(!tx.committed || !tx.snapshot.exists()) throw new TripError(409,'cambio_concurrente','La reserva cambió. Actualiza e intenta otra vez.');
  return {state:tx.snapshot.val(),result};
}

async function present(state,id,key) {
  const row=requestFor(state,id);
  const active=issued(state,id,row);
  return Promise.all(Object.entries(active).map(async([tipo,hash])=>{
    const entry=state.qrHistorial[hash];
    const {codigo,evento,titulo,fecha,mesa,zona,beneficio}=decrypt(entry,key,hash);
    const qr=entry.estado==='disponible'
      ? await QRCode.toDataURL(codigo,{width:288,margin:3,errorCorrectionLevel:'M'})
      : null;
    return {tipo,evento,titulo,fecha,mesa,zona,beneficio,estado:entry.estado,qr,reclamadoEn:entry.reclamadoEn??null};
  }));
}

export const tripReservas=endpoint({...baseOptions,cors:[publicOrigin]},async(input,uid,key)=>{
  if(!requestActions.has(input.accion) || typeof input.solicitud!=='string' || !/^[A-Za-z0-9_-]{20}$/.test(input.solicitud)) {
    throw new TripError(400,'solicitud_invalida','Indica una acción y una referencia válidas.');
  }
  const now=Date.now();
  if(input.accion==='confirmar') {
    await change(state=>confirmReservation(state,input,uid,key,now));
    return {estado:'confirmada'};
  }
  if(input.accion==='liberar') {
    await change(state=>releaseReservation(state,input,uid,now));
    return {estado:'liberada'};
  }
  let state=(await trip().get()).val();
  const row=requestFor(state,input.solicitud);
  requireOwnerOrAdmin(state,uid,row);
  if(!issued(state,input.solicitud,row)) {
    ({state}=await change(latest=>{
      const current=requestFor(latest,input.solicitud);
      requireOwnerOrAdmin(latest,uid,current);
      ensureTickets(latest,input.solicitud,current,key,now);
    }));
  }
  return {comprobantes:await present(state,input.solicitud,key)};
});

export const tripCanjes=endpoint(baseOptions,async(input,uid,key)=>{
  if(!scannerActions.has(input.accion) || !['consumo','manillas'].includes(input.tipo) ||
    typeof input.codigo!=='string' || !/^TRIP1\.[A-Za-z0-9_-]{43}$/.test(input.codigo)) {
    throw new TripError(400,'qr_invalido','Formato de QR o tipo de canje inválido.');
  }
  if(input.accion==='validar') {
    const {details}=checkTicket((await trip().get()).val()??{},input,uid,key);
    return {estado:'disponible',...details};
  }
  const now=Date.now();
  const {result}=await change(state=>{
    const {entry,details}=checkTicket(state,input,uid,key);
    Object.assign(entry,{estado:'reclamado',reclamadoEn:now,reclamadoPor:uid});
    return details;
  });
  return {estado:'reclamado',reclamadoEn:now,...result};
});
