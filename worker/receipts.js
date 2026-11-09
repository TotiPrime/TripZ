import { events } from './catalog.js';
import { json,error } from './http.js';
import { seatImage } from './seat-image.js';

export const reference = order => order.id.slice(0,8).toUpperCase();
export const isConfirmed = order => order.state === 'paid' || (order.state === 'offered' && Boolean(order.confirmed_at));
const emailEnabled = env => Boolean(env.RESEND_API_KEY && env.TRIP_RECEIPT_FROM);
export function receiptStatus(env,order) {
  if (!isConfirmed(order)) return 'waiting';
  if (order.receipt_sent_at) return 'sent';
  if (!emailEnabled(env) || !order.customer_email) return 'unavailable';
  return order.receipt_error ? 'failed' : 'pending';
}

export async function sendReceipt(env,order) {
  if (!isConfirmed(order) || order.receipt_sent_at || !emailEnabled(env) || !order.customer_email) return;
  const event = events[order.event];
  const zone = [...event.zones,event.birthday].find(item=>item[0]===order.zone)[1];
  const code = reference(order);
  try {
    const image = await seatImage(order.event,order.lounge);
    const response = await fetch('https://api.resend.com/emails',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'trip/receipt/'+order.id},
      body:JSON.stringify({
        from:env.TRIP_RECEIPT_FROM,to:[order.customer_email],subject:'TRIP | Reserva confirmada '+code,
        text:[
          'Tu reserva en TRIP Cochabamba está confirmada.',
          event.title+' · '+event.date+' de '+event.dateISO.slice(0,4),
          'Mesa '+order.lounge+' · '+zone,'Importe de la reserva: '+order.amount+' Bs',
          order.state==='paid'?'Pago en línea confirmado.':'Reserva confirmada por el equipo de TRIP.',
          'Referencia: '+code,'Adjuntamos el plano con tu mesa destacada.',
          'Avenida Portales, entre av. Pando y av. Melchor Urquidi. WhatsApp: +591 70785815.'
        ].join('\n'),
        attachments:[{filename:'TRIP-Mesa-'+order.lounge+'.png',content:btoa(String.fromCharCode(...image))}]
      })
    });
    if (!response.ok) throw new Error('Receipt delivery failed.');
    await env.DB.prepare('UPDATE trip_reservations SET receipt_sent_at = ?, receipt_error = 0 WHERE id = ?').bind(Date.now(),order.id).run();
  } catch {
    await env.DB.prepare('UPDATE trip_reservations SET receipt_error = 1 WHERE id = ? AND receipt_sent_at IS NULL').bind(order.id).run();
  }
}

export async function receiptImage(env,order) {
  if (!isConfirmed(order)) return error('El recibo se habilita al confirmar la reserva.',409);
  const image = await seatImage(order.event,order.lounge);
  return new Response(image,{headers:{
    'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
    'Content-Disposition':'inline; filename="TRIP-Mesa-'+order.lounge+'.png"'
  }});
}
