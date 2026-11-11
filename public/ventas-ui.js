import { events } from './catalog.js';
import { floorPlan } from './plan.js';

const methods={efectivo:'Efectivo',qr:'QR bancario',transferencia:'Transferencia',tarjeta:'Tarjeta',otro:'Otro'};

function element(tag,text) {
  const item=document.createElement(tag);
  if(text) item.textContent=text;
  return item;
}

export function paymentFields() {
  const method=element('select');
  method.name='metodoPago';
  method.required=true;
  method.append(new Option('Selecciona el método de pago',''));
  for(const [key,label] of Object.entries(methods)) method.append(new Option(label,key));
  const reference=element('input');
  reference.name='referenciaPago';
  reference.maxLength=40;
  reference.pattern='[A-Za-z0-9\\-]{1,40}';
  reference.autocomplete='off';
  const methodLabel=element('label','Método de pago');
  const referenceLabel=element('label','Referencia de operación (opcional)');
  methodLabel.append(method);
  referenceLabel.append(reference);
  return [methodLabel,referenceLabel];
}

export function mountSales(section,request,{isAdmin,occupied,onRegistered,formatDate}) {
  const scope=section.querySelector('#trip-sale-scope');
  const scopeLabel=section.querySelector('#trip-sale-scope-label');
  const search=section.querySelector('#trip-sale-search');
  const feedback=section.querySelector('#trip-sales-status');
  const list=section.querySelector('#trip-sales-list');
  const refresh=section.querySelector('#trip-sales-refresh');
  const form=section.querySelector('#trip-direct-sale');
  const event=form.elements.namedItem('evento');
  const table=form.elements.namedItem('mesa');
  const submit=form.querySelector('button[type=submit]');
  const currency=new Intl.NumberFormat('es-BO');
  let sales=[],sequence=0,operation;
  section.querySelector('#trip-sale-payment').append(...paymentFields());
  for(const [key,value] of Object.entries(events)) event.append(new Option(value.title,key));

  function tables() {
    const previous=table.value;
    const current=events[event.value];
    if(!current) return;
    table.replaceChildren(new Option('Selecciona una mesa disponible',''));
    for(const seat of floorPlan(event.value).sort((a,b)=>a.number-b.number)) {
      if(occupied(event.value,seat.number)) continue;
      const [,zone,price]=current.zones.find(item=>item[0]===seat.zone);
      table.append(new Option('Mesa '+seat.number+' · '+zone+' · '+price+' Bs',String(seat.number)));
    }
    if([...table.options].some(option=>option.value===previous)) table.value=previous;
  }

  function render() {
    const query=search.value.trim().toLowerCase();
    const matching=sales.filter(sale=>[sale.vendedorNombre,sale.clienteNombre,sale.clienteCorreo,sale.titulo,'mesa '+sale.mesa,methods[sale.metodoPago]]
      .some(value=>String(value||'').toLowerCase().includes(query)));
    const current=matching.filter(sale=>sale.estado==='confirmada');
    list.replaceChildren(element('p',current.length+' ventas activas · '+currency.format(current.reduce((sum,sale)=>sum+sale.montoBs,0))+' Bs'));
    if(!matching.length) list.append(element('p','No hay ventas registradas en esta vista.'));
    for(const sale of matching) {
      const card=element('article');
      card.className='my-order';
      card.append(
        element('h3','Mesa '+sale.mesa+' · '+sale.zona),
        element('p',sale.titulo+' · '+sale.estado+' · '+sale.montoBs+' Bs'),
        element('p','Pago · '+methods[sale.metodoPago]+(sale.referenciaPago?' · Ref. '+sale.referenciaPago:'')),
        element('p','Vendedor · '+sale.vendedorNombre+' · '+sale.rolVendedor),
        element('p','Cliente · '+[sale.clienteNombre,sale.clienteCorreo].filter(Boolean).join(' · ')),
        element('p','Registro · '+formatDate(sale.vendidaEn)+' · '+sale.origen+' · '+sale.solicitud)
      );
      if(sale.mesaOriginal!==sale.mesa) card.append(element('p','Mesa original · '+sale.mesaOriginal));
      if(sale.anuladaEn) card.append(element('p','Anulada · '+formatDate(sale.anuladaEn)));
      list.append(card);
    }
  }

  async function open() {
    const version=++sequence;
    scopeLabel.hidden=!isAdmin();
    if(!isAdmin()) scope.value='mias';
    feedback.textContent='Consultando ventas…';
    tables();
    try {
      const response=await request({accion:'listar',alcance:scope.value});
      if(version!==sequence) return;
      sales=response.ventas;
      feedback.textContent='';
      render();
    } catch(error) {
      if(version===sequence) feedback.textContent=error.message;
    }
  }

  form.addEventListener('input',()=>{operation=undefined;});
  event.addEventListener('change',tables);
  scope.addEventListener('change',open);
  search.addEventListener('input',render);
  refresh.addEventListener('click',open);
  form.addEventListener('submit',async submitEvent=>{
    submitEvent.preventDefault();
    const version=sequence;
    const values=Object.fromEntries(new FormData(form));
    operation??=crypto.randomUUID();
    submit.disabled=true;
    feedback.textContent='Registrando venta…';
    try {
      const response=await request({accion:'registrar',...values,operacion:operation});
      if(version!==sequence) return;
      form.reset();
      operation=undefined;
      onRegistered();
      const refresh=open();
      const refreshed=sequence;
      await refresh;
      if(refreshed===sequence) feedback.textContent='Venta confirmada · Referencia '+response.solicitud+'.';
    } catch(error) {
      if(version===sequence) feedback.textContent=error.message;
    } finally {
      submit.disabled=false;
    }
  });

  return {open,tables,reset(){
    sequence++;
    sales=[];
    operation=undefined;
    scope.value='mias';
    search.value='';
    feedback.textContent='';
    form.reset();
    list.replaceChildren();
  }};
}
