import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import { hashPassword,verifyPassword } from '../worker/passwords.js';
import { localDatabase } from './local-db.js';

const DB=localDatabase();
const temporary='Fake testing passphrase #1';
const permanent='Different testing passphrase #2';
const customerPassword='Customer testing passphrase #3';
const env={DB,TRIP_ADMIN_PASSWORD_HASH:await hashPassword(temporary)};
const origin='https://trip.example';
const adminData={login:'admin',password:temporary};
const customerData={login:'client@example.test',password:customerPassword};
const cookie=response=>response.headers.get('Set-Cookie')?.split(';')[0];
const route=(path,data,session,more={})=>worker.fetch(new Request(origin+path,{
  method:data?'POST':'GET',
  headers:{...(data?{'Content-Type':'application/json',Origin:origin}:{}),...(session?{Cookie:session}:{}),...more},
  body:data?JSON.stringify(data):undefined
}),env);
const guest=await route('/admin',null,null,{'oai-authenticated-user-id':'fake','oai-authenticated-user-email':'admin@example.test'});
assert.equal(guest.status,302);
assert.equal(guest.headers.get('Location'),origin+'/admin-login.html');
assert.equal((await route('/api/auth/registro',customerData,null,{Origin:'https://another.example'})).status,403);
assert.equal((await route('/api/auth/registro',{...customerData,password:'weak'})).status,400);
const signup=await route('/api/auth/registro',customerData);
assert.equal(signup.status,200);
assert.match(signup.headers.get('Set-Cookie'),/HttpOnly; SameSite=Lax; Secure/);
const customer=cookie(signup);
assert.equal((await route('/admin',null,customer)).status,403);
assert.equal((await route('/api/admin/usuarios',null,customer)).status,403);
assert.equal((await route('/api/auth/entrar-admin',customerData)).status,401);
assert.equal((await route('/api/auth/entrar',adminData)).status,401);
const login=await route('/api/auth/entrar-admin',adminData);
assert.equal(login.status,200);
assert.equal((await login.json()).mustChange,true);
const temporarySession=cookie(login);
assert.equal((await route('/admin',null,temporarySession)).status,302);
assert.equal((await route('/api/admin/usuarios',null,temporarySession)).status,403);
assert.equal((await route('/api/auth/cambiar-inicial',{password:temporary},temporarySession)).status,400);
const change=await route('/api/auth/cambiar-inicial',{password:permanent},temporarySession);
assert.equal(change.status,200);
assert.equal((await route('/admin',null,cookie(change))).status,200);
assert.equal((await route('/api/sesion',null,temporarySession).then(r=>r.json())).role,'anonymous');
assert.equal((await route('/api/auth/entrar-admin',adminData)).status,401);
const stored=await DB.prepare("SELECT password_hash FROM trip_accounts WHERE login='admin'").bind().first();
assert.notEqual(stored.password_hash,permanent);
assert.equal(await verifyPassword(permanent,stored.password_hash),true);
assert.equal((await route('/api/auth/salir',{},customer)).status,200);
assert.equal((await route('/api/sesion',null,customer).then(r=>r.json())).role,'anonymous');
const customerLogin=await route('/api/auth/entrar',customerData);
assert.equal(customerLogin.status,200);
for(let n=0;n<8;n++) assert.equal((await route('/api/auth/entrar',{login:'guess@example.test',password:'invalid'})).status,401);
assert.equal((await route('/api/auth/entrar',{login:'guess@example.test',password:'invalid'})).status,429);
console.log('Registro, login separado, rotación de contraseña, cierre de sesión, cookies y límite de intentos verificados.');
