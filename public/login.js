import { request } from './booking-api.js';

const status=document.querySelector('#login-status');
const panel=document.querySelector('#profile-panel');
const form=document.querySelector('#profile-form');
const auth=document.querySelector('#customer-auth');
const signup=document.querySelector('#register-confirm');
const enter=document.querySelector('#customer-submit');
const loginMode=document.querySelector('#show-signin');
const registerMode=document.querySelector('#show-register');
let registering=false;
const actions=document.querySelector('#login-actions');
const query=new URLSearchParams(location.search);
const after=query.get('volver');
const event=query.get('evento');
const seat=Number(query.get('mesa'));
const selection=after==='mapa' && ['viernes','sabado'].includes(event) && Number.isInteger(seat) && seat>=1 && seat<=84;
const next=document.querySelector('#account-next');
next.href=after==='reservas'?'/mis-reservas.html':selection?'/?'+new URLSearchParams({evento:event,mesa:seat})+'#mapa':'/#mapa';
next.textContent=after==='reservas'?'Volver a Mis reservas':selection?'Volver a la mesa '+seat:'Ir al mapa';
form.elements.birth.max=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/La_Paz',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

function show(profile,email,blocked){
  actions.hidden=true;
  panel.hidden=false;
  for(const key of ['name','surname','ci','birth']) form.elements[key].value=profile?.[key] || '';
  form.elements.email.value=profile?.email || email;
  document.querySelector('#profile-id').textContent=profile?'ID de cliente: '+profile.id:'Tu ID se asigna al guardar el perfil.';
  form.querySelector('button').disabled=blocked;
  status.textContent=blocked?'Tu cuenta está bloqueada para nuevas reservas.':profile?'Tu perfil está listo para reservar.':'Completa tus datos para solicitar una mesa.';
}

async function open(){
  try {
    const {role}=await request('/api/sesion');
    if(role==='admin'){
      status.textContent='Esta sesión corresponde al equipo de TRIP.';
      actions.hidden=false;
      auth.hidden=true;
      loginMode.hidden=true;
      registerMode.hidden=true;
    } else if(role==='anonymous'){
      status.textContent='Inicia sesión o crea una cuenta para reservar un lounge.';
      actions.hidden=false;
    } else {
      const {profile,email,blocked}=await request('/api/perfil');
      show(profile,email,blocked);
    }
  } catch(err) {status.textContent=err.message;}
}

function mode(value) {
  registering=value;
  signup.hidden=!value;
  auth.elements.confirmation.required=value;
  auth.elements.password.minLength=value?14:0;
  auth.elements.password.autocomplete=value?'new-password':'current-password';
  enter.textContent=value?'Crear cuenta':'Iniciar sesión';
  status.textContent=value?'Crea tu cuenta con un correo y una contraseña de al menos 14 caracteres.':'Ingresa tu correo y contraseña.';
}

loginMode.addEventListener('click',()=>mode(false));
registerMode.addEventListener('click',()=>mode(true));
auth.addEventListener('submit',async event=>{
  event.preventDefault();
  const {login,password,confirmation}=Object.fromEntries(new FormData(auth));
  if (registering && password!==confirmation) {status.textContent='Las contraseñas deben coincidir.';return;}
  enter.disabled=true;
  try {
    await request('/api/auth/'+(registering?'registro':'entrar'),{login,password});
    auth.reset();
    await open();
  } catch(error) {status.textContent=error.message;}
  finally {enter.disabled=false;}
});
document.querySelector('#customer-logout').addEventListener('click',async()=>{
  try {await request('/api/auth/salir',{});location.reload();}
  catch(error){status.textContent=error.message;}
});

form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=event.submitter;
  button.disabled=true;
  const {name,surname,ci,birth}=Object.fromEntries(new FormData(form));
  try {
    const {profile}=await request('/api/perfil',{name,surname,ci,birth});
    show(profile,profile.email,false);
    status.textContent='Perfil guardado. Ya puedes elegir una mesa en el mapa.';
    next.focus();
  } catch(err){status.textContent=err.message;}
  finally{button.disabled=false;}
});
open();
