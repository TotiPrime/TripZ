import { request, orderLabels } from './booking-api.js';
const status = document.querySelector('#orders-status');
const list = document.querySelector('#orders');
const el = (tag,text,cls) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
};

async function render() {
  try {
    const {orders} = await request('/api/mis-reservas');
    status.textContent = orders.length ? '' : 'Todavía no tienes reservas.';
    list.replaceChildren(...orders.map(order => {
      const article = el('article','','my-order');
      const open = el('a',['confirmed','paid'].includes(order.state)?'Ver recibo':'Ver estado','button solid');
      open.href = '/pago.html#'+order.id;
      const controls = el('div','','actions');
      controls.append(open);
      if (order.state === 'offered') {
        const cancel = el('button','Cancelar solicitud','button ghost');
        cancel.type = 'button';
        cancel.addEventListener('click',async () => {
          if (!confirm('¿Cancelar tu solicitud?')) return;
          cancel.disabled = true;
          try { await request('/api/mis-reservas/cancelar',{id:order.id}); await render(); }
          catch(error) { status.textContent = error.message; cancel.disabled = false; }
        });
        controls.append(cancel);
      }
      article.append(el('p',orderLabels[order.state]+' · '+order.reference,'eyebrow'),el('h2','Mesa '+order.lounge),el('p',order.event + ' · ' + order.zone + ' · ' + order.amount + ' Bs'),controls);
      return article;
    }));
  } catch(error) {
    status.textContent = error.message;
    const signIn = el('a','Ir a mi cuenta','button solid');
    signIn.href = '/login.html?volver=reservas';
    list.replaceChildren(signIn);
  }
}
render();
