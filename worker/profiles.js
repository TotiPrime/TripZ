import { json, error } from './http.js';

const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g,' ') : '';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hex = bytes => Array.from(bytes,byte => byte.toString(16).padStart(2,'0')).join('');
const bytes = value => Uint8Array.from(value.match(/../g),part => parseInt(part,16));
export const getProfile = (env, id) => env.DB.prepare('SELECT * FROM trip_profiles WHERE user_id = ?').bind(id).first();

async function keyFor(env) {
  if (!/^[a-f0-9]{64}$/i.test(env.TRIP_PROFILE_KEY || '')) throw new Error('Profile encryption is unavailable.');
  return crypto.subtle.importKey('raw',bytes(env.TRIP_PROFILE_KEY),'AES-GCM',false,['encrypt','decrypt']);
}

function parameters(id, iv) {
  return {name:'AES-GCM',iv,additionalData:encoder.encode(id)};
}

async function ownProfile(env,row) {
  if (!row) return null;
  const [iv,content] = row.private_data.split('.');
  const data = await crypto.subtle.decrypt(parameters(row.user_id,bytes(iv)),await keyFor(env),bytes(content));
  return {...JSON.parse(decoder.decode(data)),id:row.public_id,name:row.first_name,surname:row.last_name,email:row.email};
}

function validBirth(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
  const time = new Date(value+'T00:00:00Z');
  const today = new Date(Date.now()-4*3600000).toISOString().slice(0,10);
  return !Number.isNaN(time.getTime()) && time.toISOString().slice(0,10) === value && value <= today;
}

export async function profileApi(env, method, viewer, data) {
  if (!viewer) return error('Inicia sesión para acceder a tu cuenta.',401);
  if (viewer.admin) return error('Esta cuenta corresponde al panel administrativo.',403);
  const row = await getProfile(env,viewer.id);
  if (method === 'GET') return json({email:viewer.email,blocked:Boolean(row?.blocked),profile:await ownProfile(env,row)});
  if (method !== 'POST') return error('Ruta no encontrada.',404);
  if (row?.blocked) return error('Tu cuenta está bloqueada para cambios y nuevas reservas.',403);
  const name = clean(data.name);
  const surname = clean(data.surname);
  const ci = clean(data.ci).toUpperCase();
  const birth = clean(data.birth);
  if (![name,surname].every(value => /\p{L}/u.test(value) && value.length <= 70)) return error('Completa un nombre y un apellido válidos.',400);
  if (!/^\d{4}[\dA-Z .-]{0,20}$/.test(ci)) return error('Ingresa un número de CI válido.',400);
  if (!validBirth(birth)) return error('Ingresa una fecha de nacimiento válida.',400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(viewer.email)) return error('Tu cuenta debe tener un correo de inicio de sesión válido.',400);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(parameters(viewer.id,iv),await keyFor(env),encoder.encode(JSON.stringify({ci,birth})));
  const result = await env.DB.prepare(`INSERT INTO trip_profiles(user_id,public_id,email,first_name,last_name,private_data,ci_hint,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,first_name=excluded.first_name,
      last_name=excluded.last_name,private_data=excluded.private_data,ci_hint=excluded.ci_hint,updated_at=excluded.updated_at
    WHERE blocked = 0`)
    .bind(viewer.id,crypto.randomUUID(),viewer.email,name,surname,hex(iv)+'.'+hex(new Uint8Array(encrypted)),ci.replace(/[^A-Z0-9]/g,'').slice(-4),Date.now()).run();
  if (!result.meta.changes) return error('Tu cuenta está bloqueada para cambios y nuevas reservas.',403);
  return json({profile:await ownProfile(env,await getProfile(env,viewer.id))});
}

export async function manageProfiles(env, method, url, data) {
  if (method === 'GET') {
    const query = clean(url.searchParams.get('q')).slice(0,100).toLowerCase();
    const list = await env.DB.prepare(`SELECT public_id AS id,email,first_name AS name,last_name AS surname,ci_hint AS ciHint,blocked
      FROM trip_profiles WHERE ? = '' OR instr(lower(first_name || ' ' || last_name || ' ' || email || ' ' || public_id),?) > 0
      ORDER BY updated_at DESC LIMIT 100`).bind(query,query).all();
    return json({users:list.results});
  }
  if (method !== 'POST' || typeof data.id !== 'string' || typeof data.blocked !== 'boolean') return error('Solicitud no válida.',400);
  const result = await env.DB.prepare('UPDATE trip_profiles SET blocked = ?,updated_at = ? WHERE public_id = ?').bind(Number(data.blocked),Date.now(),data.id).run();
  return result.meta.changes ? json({ok:true}) : error('Usuario no encontrado.',404);
}
