import { json,error } from './http.js';
import { dummyPasswordHash,hashPassword,validPassword,validPasswordHash,verifyPassword } from './passwords.js';

const cookieName='trip_session';
const encoder=new TextEncoder();
const idPattern=/^[a-f0-9]{64}$/;
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const loginValue=value=>typeof value==='string' ? value.trim().toLowerCase() : '';
const hex=buffer=>Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');
const digest=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const tokenOf=request=>request.headers.get('Cookie')?.split(';').map(pair=>pair.trim()).find(pair=>pair.startsWith(cookieName+'='))?.slice(cookieName.length+1);
const cookie=(token,age,url)=>cookieName+'='+token+'; Path=/; Max-Age='+age+'; HttpOnly; SameSite=Lax'+(url.protocol==='https:'?'; Secure':'');
const account=(env,login)=>env.DB.prepare('SELECT * FROM trip_accounts WHERE login = ?').bind(login).first();
const cookieResult=(data,token,age,url)=>{
  const response=json(data);
  response.headers.set('Set-Cookie',cookie(token,age,url));
  return response;
};

export async function getViewer(request,env) {
  const token=tokenOf(request);
  if (!env.DB || !idPattern.test(token || '')) return null;
  const row=await env.DB.prepare(`SELECT a.id,a.login,a.role,a.must_change FROM trip_sessions s
    JOIN trip_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await digest(token),Date.now()).first();
  return row && {id:row.id,email:row.role==='customer'?row.login:'',admin:row.role==='admin',mustChange:Boolean(row.must_change)};
}

async function session(env,user,url,rotatePassword) {
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  const admin=user.role==='admin';
  const age=user.must_change?600:admin?7200:43200;
  const now=Date.now();
  const insert=env.DB.prepare(`INSERT INTO trip_sessions(token_hash,account_id,expires_at)
    SELECT ?,id,? FROM trip_accounts WHERE id=? AND password_hash=?`)
    .bind(await digest(token),now+age*1000,user.id,rotatePassword || user.password_hash);
  if (rotatePassword) {
    const update=await env.DB.prepare('UPDATE trip_accounts SET password_hash=?,must_change=0 WHERE id=? AND must_change=1').bind(rotatePassword,user.id).run();
    if (!update.meta.changes) return error('Vuelve a iniciar sesión con tu nueva contraseña.',409);
  }
  const [,created]=await env.DB.batch([env.DB.prepare('DELETE FROM trip_sessions WHERE expires_at<=?').bind(now),insert]);
  if (!created.meta.changes) return error('Vuelve a iniciar sesión.',409);
  return cookieResult({role:user.role,mustChange:Boolean(user.must_change)},token,age,url);
}

async function limited(env,request,action,login) {
  const now=Date.now();
  const ip=request.headers.get('CF-Connecting-IP') || 'unknown';
  const limits=action==='registro' ? [[ip,8]] : [[ip,35],[action+':'+login,8]];
  const rows=await Promise.all(limits.map(async ([key,max])=>{
    const bucket=await digest(action+':'+key);
    const state=await env.DB.prepare(`INSERT INTO trip_auth_limits(bucket,attempts,expires_at) VALUES (?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE min(attempts+1,1000) END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
      RETURNING attempts`).bind(bucket,now+900000,now,now).first();
    return state.attempts>max;
  }));
  await env.DB.prepare('DELETE FROM trip_auth_limits WHERE expires_at<=?').bind(now).run();
  return rows.some(Boolean);
}

async function provisionAdmin(env) {
  if (!validPasswordHash(env.TRIP_ADMIN_PASSWORD_HASH)) return;
  await env.DB.prepare(`INSERT INTO trip_accounts(id,login,password_hash,role,must_change,created_at)
    VALUES (?,'admin',?,'admin',1,?) ON CONFLICT(login) DO NOTHING`)
    .bind(crypto.randomUUID(),env.TRIP_ADMIN_PASSWORD_HASH,Date.now()).run();
}

export async function authApi(request,env,url,data,viewer) {
  if (request.method!=='POST') return error('Ruta no encontrada.',404);
  const action=url.pathname.slice('/api/auth/'.length);
  if (action==='salir') {
    const token=tokenOf(request);
    if (idPattern.test(token || '')) await env.DB.prepare('DELETE FROM trip_sessions WHERE token_hash=?').bind(await digest(token)).run();
    return cookieResult({ok:true},'',0,url);
  }
  if (action==='cambiar-inicial') {
    if (!viewer?.admin || !viewer.mustChange) return error('Inicia sesión con la cuenta administrativa inicial.',403);
    if (!validPassword(data.password)) return error('Usa entre 14 y 128 caracteres.',400);
    if (await limited(env,request,action,'admin')) return error('Demasiados intentos. Intenta de nuevo en 15 minutos.',429);
    const user=await account(env,'admin');
    if (await verifyPassword(data.password,user.password_hash)) return error('Elige una contraseña diferente a la temporal.',400);
    const newHash=await hashPassword(data.password);
    return session(env,{...user,must_change:0},url,newHash);
  }
  if (!['registro','entrar','entrar-admin'].includes(action)) return error('Ruta no encontrada.',404);
  const login=loginValue(data.login);
  if (!login || login.length>254) return error('Ingresa tus datos de acceso.',400);
  if (await limited(env,request,action,login)) return error('Demasiados intentos. Intenta de nuevo en 15 minutos.',429);
  if (action==='registro') {
    if (!emailPattern.test(login)) return error('Ingresa un correo electrónico válido.',400);
    if (!validPassword(data.password)) return error('Usa entre 14 y 128 caracteres.',400);
    const id=crypto.randomUUID();
    const passwordHash=await hashPassword(data.password);
    const result=await env.DB.prepare(`INSERT INTO trip_accounts(id,login,password_hash,role,created_at)
      VALUES (?,?,?,'customer',?) ON CONFLICT(login) DO NOTHING`).bind(id,login,passwordHash,Date.now()).run();
    if (!result.meta.changes) return error('Este correo no se pudo registrar. Si ya tienes cuenta, inicia sesión.',409);
    return session(env,{id,role:'customer',password_hash:passwordHash},url);
  }
  const admin=action==='entrar-admin';
  if (admin && login==='admin') await provisionAdmin(env);
  const row=await account(env,login);
  const password=typeof data.password==='string' && data.password.length<=128 ? data.password : '';
  const allowed=row?.role===(admin?'admin':'customer');
  const matches=await verifyPassword(password,allowed?row.password_hash:dummyPasswordHash);
  if (!allowed || !matches) return error('Credenciales incorrectas.',401);
  return session(env,row,url);
}
