import { createHmac } from 'node:crypto';
import { TripError, digest, encrypt, decrypt, owns } from './tickets.js';

const personalKey=key=>createHmac('sha256',key).update('TRIPZ/PerfilPersonal/v1').digest();
const accountContext=uid=>digest('TRIPZ/PerfilPersonal/v1:'+uid);

export function hasCompleteProfile(state,uid) {
  return owns(state?.fichasCompletas,uid) && state.fichasCompletas[uid]===true;
}

export function requireCompleteProfile(state,uid) {
  if(!hasCompleteProfile(state,uid)) {
    throw new TripError(409,'perfil_requerido','Completa nombre, apellido y carnet en Mi perfil.');
  }
}

export function privateProfile(state,uid,key) {
  const entry=state?.datosPersonales?.[uid];
  return entry?decrypt(entry,personalKey(key),accountContext(uid)):null;
}

function publicFields(profile) {
  if(!profile) return null;
  return {nombre:profile.nombre,apellido:profile.apellido,carnetFinal:profile.carnet.slice(-4)};
}

function validateName(value,label) {
  const normalized=typeof value==='string'?value.normalize('NFC').trim().replace(/\s+/g,' '):'';
  if(normalized.length<2 || normalized.length>60 || !/^\p{L}[\p{L}\p{M} .’'-]*$/u.test(normalized)) {
    throw new TripError(400,'perfil_invalido','Revisa el campo '+label+'.');
  }
  return normalized;
}

export async function personalProfiles(db,input,uid,key) {
  if(input.accion==='consultar') return {perfil:publicFields(privateProfile(await db.get(),uid,key))};
  if(input.accion!=='guardar') throw new TripError(400,'accion_invalida','Acción de perfil inválida.');
  const nombre=validateName(input.nombre,'nombre');
  const apellido=validateName(input.apellido,'apellido');
  const supplied=typeof input.carnet==='string'?input.carnet.trim().toUpperCase():'';
  if(supplied && (supplied.length<4 || supplied.length>24 || !/^[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/.test(supplied) || !/\d/.test(supplied))) {
    throw new TripError(400,'carnet_invalido','Revisa el número de carnet y su complemento.');
  }
  const now=Date.now();
  const {result}=await db.change(state=>{
    state??={};
    const carnet=supplied || privateProfile(state,uid,key)?.carnet;
    if(!carnet) throw new TripError(400,'carnet_requerido','Ingresa tu carnet.');
    const profile={nombre,apellido,carnet};
    (state.datosPersonales??={})[uid]={cifrado:encrypt(profile,personalKey(key),accountContext(uid)),actualizadoEn:now};
    (state.fichasCompletas??={})[uid]=true;
    return publicFields(profile);
  });
  return {perfil:result};
}
