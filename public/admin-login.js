import { request } from './booking-api.js';
const login=document.querySelector('#staff-login');
const change=document.querySelector('#staff-change');
const status=document.querySelector('#admin-access-status');

function advance(session) {
  if (session.role!=='admin') return;
  if (!session.mustChange) {location.replace('/admin');return;}
  login.hidden=true;
  change.hidden=false;
  status.textContent='Crea una contraseña de al menos 14 caracteres antes de entrar al panel.';
  change.elements.password.focus();
}

async function submit(form,path,payload,button) {
  button.disabled=true;
  try {
    const result=await request(path,payload);
    form.reset();
    advance(result);
  } catch (error) {status.textContent=error.message;}
  finally {button.disabled=false;}
}

login.addEventListener('submit',event=>{
  event.preventDefault();
  submit(login,'/api/auth/entrar-admin',Object.fromEntries(new FormData(login)),event.submitter);
});
change.addEventListener('submit',event=>{
  event.preventDefault();
  const {password,confirmation}=Object.fromEntries(new FormData(change));
  if (password!==confirmation) {status.textContent='Las contraseñas deben coincidir.';return;}
  submit(change,'/api/auth/cambiar-inicial',{password},event.submitter);
});
request('/api/sesion').then(advance).catch(error=>{status.textContent=error.message;});
