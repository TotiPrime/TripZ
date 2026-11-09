import { events } from './catalog.js';
import { setMapNight } from './mapa.js';
import { request, orderLabels } from './booking-api.js';

const night = document.querySelector('#admin-night');
const filterNight = document.querySelector('#admin-booking-night');
const orders = document.querySelector('#admin-bookings');
const users = document.querySelector('#admin-users');
const orderStatus = document.querySelector('#admin-bookings-status');
const userStatus = document.querySelector('#admin-users-status');
const clear = document.querySelector('#admin-clear-customer');
const search = document.querySelector('#admin-user-search');
const flyer = document.querySelector('#admin-flyer');
const receiptLabels = {sent:'Correo enviado',unavailable:'Correo por configurar',pending:'Correo pendiente',failed:'Error de envío'};
let customer;
let lounge;
let refresh = 0;

function el(tag,text,cls){
  const item=document.createElement(tag);
  item.textContent=text;
  if(cls) item.className=cls;
  return item;
}
function action(label,run){
  const item=el('button',label,'button ghost');
  item.type='button';
  item.addEventListener('click',()=>run(item));
  return item;
}
function link(label,path){
  const item=el('a',label,'button ghost');
  item.href=path;
  return item;
}

async function loadOrders(){
  const sequence=++refresh;
  const params=new URLSearchParams({evento:filterNight.value,cliente:customer?.id || '',mesa:lounge || ''});
  try {
    const data=await request('/api/admin/reservas?'+params);
    if(sequence!==refresh) return;
    orderStatus.textContent=(customer ? customer.name+' · ' : '')+(lounge ? 'Mesa '+lounge+' · ' : '')+(data.orders.length ? data.orders.length+' resultados.' : 'Sin reservas para esta selección.');
    clear.hidden=!customer && !lounge;
    orders.replaceChildren(...data.orders.map(order=>{
      const card=el('article','','my-order');
      const subtitle=el('p',order.event+' · '+order.zone+' · '+order.amount+' Bs');
      card.append(el('p',orderLabels[order.state]+' · '+order.reference,'eyebrow'),el('h3','Mesa '+order.lounge),subtitle,el('p',[order.customer,order.email].filter(Boolean).join(' · ')));
      if(order.state==='offered'){
        const controls=el('div','','actions');
        if(order.channel==='manual') controls.append(action('Confirmar pago verificado',async button=>{
          if(!confirm('¿Ya verificaste el pago de esta solicitud? La mesa quedará reservada.')) return;
          await updateOrder(order.id,'confirm',button);
        }));
        controls.append(action('Cancelar solicitud',async button=>{
          if(confirm('¿Cancelar esta solicitud?')) await updateOrder(order.id,'cancel',button);
        }));
        card.append(controls);
      }
      if(receiptLabels[order.receipt]){
        const controls=el('div','','actions');
        controls.append(link('Ver plano del recibo','/api/recibo/imagen?id='+encodeURIComponent(order.id)));
        if(['failed','pending'].includes(order.receipt)) controls.append(action('Enviar recibo',async button=>{
          button.disabled=true;
          try {
            await request('/api/admin/recibo',{id:order.id});
            await loadOrders();
          } catch(err) {orderStatus.textContent=err.message;button.disabled=false;}
        }));
        card.append(el('p',receiptLabels[order.receipt]),controls);
      }
      return card;
    }));
  } catch(err) {if(sequence===refresh) orderStatus.textContent=err.message;}
}

async function updateOrder(id,actionName,button){
  button.disabled=true;
  try {
    await request('/api/admin/reserva',{id,action:actionName});
    window.dispatchEvent(new Event('trip:admin-change'));
    document.querySelector('#map-reload').click();
  } catch(err){
    orderStatus.textContent=err.message;
    button.disabled=false;
  }
}

async function loadUsers(){
  try {
    const query=new URLSearchParams({q:search.elements.q.value});
    const data=await request('/api/admin/usuarios?'+query);
    userStatus.textContent=data.users.length ? data.users.length+' resultados.' : 'No hay usuarios para esta búsqueda.';
    users.replaceChildren(...data.users.map(user=>{
      const name=user.name+' '+user.surname;
      const card=el('article','','my-order');
      const controls=el('div','','actions');
      controls.append(action('Ver sus reservas',()=>{
        customer={id:user.id,name};
        lounge=undefined;
        filterNight.value='';
        loadOrders();
        document.querySelector('#reservas').scrollIntoView();
      }),action(user.blocked?'Reactivar usuario':'Bloquear nuevas reservas',async button=>{
        if(!user.blocked && !confirm('¿Bloquear nuevas reservas para '+name+'?')) return;
        button.disabled=true;
        try {await request('/api/admin/usuarios',{id:user.id,blocked:!user.blocked});await loadUsers();}
        catch(err){userStatus.textContent=err.message;button.disabled=false;}
      }));
      card.append(el('p',user.blocked?'BLOQUEADO':'ACTIVO','eyebrow'),el('h3',name),el('p',user.email),el('p','ID '+user.id+' · CI terminado en '+user.ciHint),controls);
      return card;
    }));
  } catch(err) {userStatus.textContent=err.message;}
}
night.addEventListener('change',()=>setMapNight(night.value));
filterNight.addEventListener('change',loadOrders);
clear.addEventListener('click',()=>{customer=undefined;lounge=undefined;loadOrders();});
window.addEventListener('trip:table-requests',event=>{
  customer=undefined;
  lounge=event.detail.table;
  filterNight.value=event.detail.night;
  loadOrders();
  document.querySelector('#reservas').scrollIntoView();
});
document.querySelector('#admin-refresh').addEventListener('click',loadOrders);
search.addEventListener('submit',event=>{event.preventDefault();loadUsers();});
document.querySelector('#map-button').addEventListener('click',()=>{
  flyer.querySelector('img').src='/assets/'+events[night.value].map+'.webp';
  flyer.showModal();
});
flyer.querySelector('button').addEventListener('click',()=>flyer.close());
window.addEventListener('trip:admin-change',loadOrders);
setMapNight(night.value);
loadOrders();
loadUsers();

document.querySelector('#admin-logout').addEventListener('click',async()=>{
  try {await request('/api/auth/salir',{});location.replace('/admin-login.html');}
  catch(error){orderStatus.textContent=error.message;}
});
