import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import { floorPlan } from '../public/plan.js';
import { localDatabase } from './local-db.js';

const DB = localDatabase();
const env = {DB,TRIP_ADMIN_EMAIL:'admin@example.test',TRIP_PROFILE_KEY:'ab'.repeat(32)};
const admin = ['admin','admin@example.test'];
const first = ['customer-a','a@example.test'];
const second = ['customer-b','b@example.test'];
const origin = 'https://trip.example';
let now = Date.parse('2026-11-09T20:00:00Z');
Date.now = () => now;

const testSessions = new Map();
for (const [id,login] of [admin,first,second]) {
  const token=crypto.randomUUID().replaceAll('-','').repeat(2);
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
  await DB.prepare('INSERT INTO trip_accounts(id,login,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .bind(id,login,'test-fixture',id===admin[0]?'admin':'customer',now).run();
  await DB.prepare('INSERT INTO trip_sessions(token_hash,account_id,expires_at) VALUES (?,?,?)').bind(hash,id,now+86400000).run();
  testSessions.set(id,token);
}

async function hit(path,user,data) {
  const headers = new Headers();
  if (user) {
    headers.set('Cookie','trip_session='+testSessions.get(user[0]));
  }
  if (data) {
    headers.set('Content-Type','application/json');
    headers.set('Origin',origin);
  }
  const response = await worker.fetch(new Request(origin+path,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined}),env);
  const type=response.headers.get('Content-Type') || '';
  const dataOut=type.includes('application/json') ? await response.json() : type==='image/png' ? new Uint8Array(await response.arrayBuffer()) : await response.text();
  return {status:response.status,data:dataOut};
}
const book = (user,mesa,zone,evento='viernes') => hit('/api/mapa/reservar',user,{evento,mesa,zone,amount:1});
const map = (user,night='viernes',mode='') => hit((mode ? '/api/admin/mapa' : '/api/mapa')+'?evento='+night,user);
const seat = (result,number) => result.data.tables.find(table => table.number === number);
for (const night of ['viernes','sabado']) {
  const tables = floorPlan(night);
  assert.equal(tables.length,84);
  assert.equal(new Set(tables.map(t => t.number)).size,84);
  assert.equal(new Set(tables.map(t => t.x+','+t.y)).size,84);
}
assert.equal(seat(await map(null),2).status,'reserved');
assert.equal(seat(await map(null,'sabado'),49).status,'reserved');
assert.equal((await book(null,1,'primeras-filas')).status,401);
assert.equal((await book(first,1,'primeras-filas')).status,409);
assert.equal((await book(admin,1,'primeras-filas')).status,403);
assert.equal((await hit('/admin',first)).status,403);
assert.equal((await hit('/admin',admin)).status,200);
assert.equal((await hit('/api/perfil',admin)).status,403);
assert.equal((await hit('/api/admin/usuarios',first)).status,403);
assert.equal((await hit('/api/mis-reservas',admin)).status,403);
const fields={name:'Ada',surname:'Ejemplo',ci:'7654321-1A',birth:'1990-02-28'};
assert.equal((await hit('/api/perfil',first,{...fields,birth:'2001-02-29'})).status,400);
const profileA=(await hit('/api/perfil',first,fields)).data.profile;
assert.equal(profileA.email,first[1]);
assert.equal((await hit('/api/perfil',first,fields)).data.profile.id,profileA.id);
assert.equal((await hit('/api/perfil',second,{...fields,name:'Rita',ci:'8765432'})).status,200);
const stored=await DB.prepare('SELECT * FROM trip_profiles WHERE user_id = ?').bind(first[0]).first();
assert.ok(!stored.private_data.includes(fields.ci) && !stored.private_data.includes(fields.birth));
const listed=(await hit('/api/admin/usuarios',admin)).data.users.find(user=>user.id===profileA.id);
assert.equal(listed.ci,undefined);
assert.equal(listed.birth,undefined);
assert.equal((await hit('/api/admin/usuarios',admin,{id:profileA.id,blocked:true})).status,200);
assert.equal((await book(first,1,'primeras-filas')).status,403);
assert.equal((await hit('/api/admin/usuarios',admin,{id:profileA.id,blocked:false})).status,200);
assert.equal((await book(first,2,'primeras-filas')).status,409);
assert.equal((await book(first,1,'vip')).status,409);
assert.equal((await map(first,'viernes','&modo=admin')).status,403);
assert.equal((await hit('/api/admin/mesa',first,{evento:'viernes',mesa:1,zone:'vip',status:'blocked'})).status,403);

const results = await Promise.all([book(first,1,'primeras-filas'),book(second,1,'primeras-filas')]);
assert.deepEqual(results.map(r => r.status),[201,201]);
const winner = first;
const loser = second;
const [{data:{order}},{data:{order:otherRequest}}] = results;
assert.equal(order.amount,800);
assert.equal(order.channel,'manual');
assert.equal(seat(await map(loser),1).status,'available');
assert.equal(seat(await map(loser),1).order.id,otherRequest.id);
assert.equal(seat(await map(null),1).order,undefined);
assert.equal(seat(await map(admin,'viernes','&modo=admin'),1).requests,2);
assert.equal((await hit('/api/admin/reservas?evento=viernes&mesa=1',admin)).data.orders.length,2);
assert.equal((await hit('/api/admin/reservas?evento=viernes&mesa=5',admin)).data.orders.length,0);
assert.equal((await hit('/api/pagos/reserva?id='+order.id,loser)).status,404);
assert.equal((await hit('/api/mis-reservas',winner)).data.orders[0].id,order.id);
assert.equal((await hit('/api/admin/mesa',admin,{evento:'viernes',mesa:1,zone:'primeras-filas',status:'blocked'})).status,200);
assert.equal((await hit('/api/admin/reserva',admin,{id:order.id,action:'confirm'})).status,409);
assert.equal((await hit('/api/admin/mesa',admin,{evento:'viernes',mesa:1,zone:'primeras-filas',status:'available'})).status,200);
assert.equal((await hit('/api/admin/reserva',winner,{id:order.id,action:'confirm'})).status,403);
assert.equal((await hit('/api/recibo/imagen?id='+order.id,winner)).status,409);
env.RESEND_API_KEY='fixture-key';
env.TRIP_RECEIPT_FROM='TRIP <reservas@example.test>';
let delivery;
globalThis.fetch=async (url,request)=>{
  assert.equal(url,'https://api.resend.com/emails');
  const message=JSON.parse(request.body);
  assert.equal(message.to[0],winner[1]);
  assert.equal(message.attachments[0].filename,'TRIP-Mesa-1.png');
  assert.ok(message.text.includes(order.reference));
  assert.ok(!message.text.includes(fields.ci));
  assert.equal(request.headers['Idempotency-Key'],'trip/receipt/'+order.id);
  delivery=Buffer.from(message.attachments[0].content,'base64');
  return Response.json({id:'mail-fixture'});
};
const [accepted,rejected] = await Promise.all([
  hit('/api/admin/reserva',admin,{id:order.id,action:'confirm'}),
  hit('/api/admin/reserva',admin,{id:otherRequest.id,action:'confirm'})
]);
assert.equal(accepted.status,200);
assert.equal(rejected.status,409);
assert.equal((await hit('/api/pagos/reserva?id='+otherRequest.id,loser)).data.state,'superseded');
const confirmation=accepted.data.order;
assert.equal(confirmation.state,'confirmed');
assert.equal(confirmation.receipt,'sent');
const png=await hit('/api/recibo/imagen?id='+order.id,winner);
assert.equal(png.status,200);
assert.deepEqual(Array.from(png.data.slice(0,8)),[137,80,78,71,13,10,26,10]);
assert.deepEqual(png.data,new Uint8Array(delivery));
assert.equal((await hit('/api/recibo/imagen?id='+order.id,loser)).status,404);
assert.equal((await hit('/api/admin/reservas',admin)).data.orders.find(item=>item.id===order.id).email,winner[1]);
delete env.RESEND_API_KEY;
assert.equal(seat(await map(loser),1).status,'reserved');
assert.equal((await hit('/api/mis-reservas/cancelar',winner,{id:order.id})).status,409);
assert.equal((await hit('/api/admin/reserva',admin,{id:order.id,action:'cancel'})).data.order.state,'void');
assert.equal(seat(await map(loser),1).status,'available');
assert.equal((await hit('/api/admin/mesa',admin,{evento:'viernes',mesa:1,zone:'vip',status:'blocked'})).status,200);
assert.equal(seat(await map(loser),1).status,'blocked');
assert.equal((await book(loser,1,'vip')).status,409);
assert.equal((await hit('/api/admin/mesa',admin,{evento:'viernes',mesa:1,zone:'vip',status:'available'})).status,200);
assert.equal((await book(loser,1,'vip')).data.order.amount,500);
now += 46 * 60000;
assert.equal(seat(await map(loser),1).status,'available');

env.TRIP_PAYMENTS_ENABLED='true';
env.LIBELULA_APPKEY='local-mock';
const online = (await book(first,3,'primeras-filas','sabado')).data.order;
assert.equal(online.channel,'online');
const competing = (await book(second,3,'primeras-filas','sabado')).data.order;
assert.equal(seat(await map(null,'sabado'),3).status,'available');
let providerPayments = [];
let registered = 0;
globalThis.fetch = async (url,request) => {
  if (url.endsWith('/registrar')) {
    registered++;
    const body = JSON.parse(request.body);
    assert.equal(body.lineas_detalle_deuda[0].costo_unitario,900);
    return Response.json({error:0,id_transaccion:'trip-payment-test',url_pasarela_pagos:'https://pagos.libelula.bo/?id=trip-payment-test'});
  }
  return Response.json({error:0,datos:providerPayments});
};
const paymentStarts = await Promise.all([
  hit('/api/pagos/iniciar?id='+online.id,first,{}),
  hit('/api/pagos/iniciar?id='+competing.id,second,{})
]);
assert.deepEqual(paymentStarts.map(item=>item.status),[200,409]);
assert.equal((await hit('/api/pagos/iniciar?id='+online.id,first,{})).status,200);
assert.equal(registered,1);
assert.equal((await book(first,4,'primeras-filas','sabado')).status,409);
assert.equal(seat(await map(second,'sabado'),3).status,'available');
providerPayments = [{id_transaccion:'trip-payment-test',identificador:online.id,moneda:'BOB',monto_pagado:1,fecha_pago:'2026-11-09'}];
assert.equal((await hit('/api/pagos/verificar?id='+online.id,first,{})).data.state,'awaiting');
providerPayments[0].monto_pagado=900;
assert.equal((await hit('/api/pagos/notificar?id='+online.id+'&transaction_id=incorrect',null)).status,400);
assert.equal((await hit('/api/pagos/notificar?id='+online.id+'&transaction_id=trip-payment-test',null)).status,200);
assert.equal(seat(await map(second,'sabado'),3).status,'reserved');
assert.equal((await hit('/api/pagos/reserva?id='+competing.id,second)).data.state,'superseded');
assert.equal((await hit('/api/admin/reserva',admin,{id:online.id,action:'cancel'})).status,409);
console.log('Solicitudes sin bloqueo, confirmación única, cobro único, roles, recibos y conciliación comprobados.');
