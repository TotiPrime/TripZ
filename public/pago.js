import { orderLabels } from './booking-api.js';

const id = location.hash.slice(1);
const status = document.querySelector('#payment-status');
const form = document.querySelector('#checkout');
const check = document.querySelector('#check');
const resume = document.querySelector('#resume');
const order = document.querySelector('#order');
const steps = document.querySelector('#booking-steps');
const receiptPanel = document.querySelector('#receipt-panel');
const refresh = document.querySelector('#refresh-order');
const receiptLabels = {
  sent:'El recibo se envió al correo registrado para esta reserva.',
  pending:'El correo está pendiente. El recibo ya está disponible aquí.',
  failed:'El correo no se pudo enviar. Puedes guardar el recibo desde aquí.',
  unavailable:'El envío por correo está pendiente de configuración. Puedes guardar el recibo desde aquí.'
};
const states = {
  confirmed:'Reserva confirmada por TRIP. Tu mesa aparece reservada en el mapa.',
  offered:'Solicitud registrada. Completa el pago para confirmar tu mesa.',
  awaiting:'El pago está pendiente de confirmación.',
  paid:'Pago confirmado. Tu mesa está reservada.',
  creating:'Tu enlace de pago está en preparación. Actualiza la página en unos segundos.',
  review:'El enlace de pago requiere revisión. Comunícate con TRIP.',
  expired:'El plazo de la solicitud venció. Puedes elegir una mesa disponible en el mapa.',
  void:'Este enlace se anuló. Consulta una nueva reserva con TRIP.',
  superseded:'Esta mesa se confirmó para otra reserva. Puedes elegir una mesa disponible en el mapa.'
};

async function api(action, data) {
  const url = '/api/pagos/' + action + '?id=' + encodeURIComponent(id);
  const options = data ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)} : {};
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message);
  return result;
}

function render(result) {
  document.querySelector('#order-title').textContent = result.event;
  document.querySelector('#order-details').textContent = result.date + ' · ' + result.zone + ' · Mesa ' + result.lounge + ' · ' + result.amount + ' Bs';
  order.hidden = false;
  document.querySelector('#order-chip').textContent = orderLabels[result.state] || result.state;
  document.querySelector('#order-reference').textContent = 'Referencia de reserva: '+result.reference;
  const confirmed = ['confirmed','paid'].includes(result.state);
  const terminal = ['expired','void','superseded'].includes(result.state);
  steps.hidden = terminal;
  Array.from(steps.children).forEach((step,i)=>{
    if(i === (confirmed ? 2 : result.state === 'awaiting' ? 1 : 0)) step.setAttribute('aria-current','step');
    else step.removeAttribute('aria-current');
  });
  receiptPanel.hidden = !confirmed;
  refresh.hidden = terminal || confirmed;
  if (confirmed) {
    const image = '/api/recibo/imagen?id='+encodeURIComponent(result.id);
    const target = document.querySelector('#receipt-image');
    if(target.getAttribute('src') !== image) target.src=image;
    const download = document.querySelector('#download-image');
    download.href=image;
    download.download='TRIP-Mesa-'+result.lounge+'.png';
    document.querySelector('#receipt-status').textContent=receiptLabels[result.receipt] || '';
  }
  const fields = document.querySelector('#legacy-checkout-fields');
  fields.hidden = !result.legacyCheckout;
  for(const input of fields.querySelectorAll('input')) {input.required = Boolean(result.legacyCheckout);input.disabled = !result.legacyCheckout;}
  form.hidden = result.state !== 'offered' || result.channel === 'manual';
  check.hidden = result.state !== 'awaiting';
  resume.hidden = result.state !== 'awaiting';
  status.textContent = result.state === 'offered' && result.channel === 'manual'
    ? 'Solicitud registrada. La mesa sigue disponible hasta que TRIP verifique el pago. El recibo aparecerá aquí cuando se confirme la reserva.'
    : states[result.state] || 'Consulta con TRIP para verificar tu reserva.';
  if (result.state === 'offered') {
    const expiry = new Intl.DateTimeFormat('es-BO',{timeZone:'America/La_Paz',hour:'2-digit',minute:'2-digit',hour12:false}).format(result.expiresAt);
    status.textContent += ' Plazo hasta las ' + expiry + ' h.';
  }
}

async function startCheckout(data, button) {
  button.disabled = true;
  status.textContent = 'Abriendo la pasarela de pago…';
  try {
    const result = await api('iniciar', data);
    location.assign(result.url);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  startCheckout(Object.fromEntries(new FormData(form)), event.submitter);
});
resume.addEventListener('click', () => startCheckout({}, resume));
check.addEventListener('click', async () => {
  check.disabled = true;
  status.textContent = 'Consultando el estado del pago…';
  try { render(await api('verificar', {})); }
  catch (error) { status.textContent = error.message; }
  finally { check.disabled = false; }
});

document.querySelector('#print-receipt').addEventListener('click',()=>window.print());
refresh.addEventListener('click',async()=>{
  refresh.disabled=true;
  try {render(await api('reserva'));}
  catch(error){status.textContent=error.message;}
  finally{refresh.disabled=false;}
});

if (id) api('reserva').then(async result => {
  render(result);
  if (result.state === 'awaiting') {
    try { render(await api('verificar',{})); } catch { /* Keep the manual refresh available. */ }
  }
}).catch(error => { status.textContent = error.message; });
else status.textContent = 'Abre el enlace de reserva que te envió el equipo de TRIP.';
