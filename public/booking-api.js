export async function request(path, body) {
  const response = await fetch(path, body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'No pudimos completar la solicitud.');
  return result;
}

export const orderLabels = {
  offered:'Solicitud registrada', creating:'Preparando pago', awaiting:'Pago pendiente', paid:'Pagada y confirmada',
  confirmed:'Confirmada por TRIP', void:'Cancelada', review:'En revisión', expired:'Vencida', superseded:'Mesa asignada a otra reserva'
};
