import { firebaseConfig } from './firebase-config.js';
import { qrApiBase } from './qr-config.js';
import { mountClaims } from './public/reclamos.js?v=ventas-2';
import { mountSales, paymentFields } from './public/ventas-ui.js?v=ventas-2';
import { events } from './public/catalog.js';
import { floorPlan } from './public/plan.js';

const base = 'https://www.gstatic.com/firebasejs/13.2.0/';
const isPermissionDenied = error => /permission.denied/i.test(error.code || error.message || '');
const orderDate = new Intl.DateTimeFormat('es-BO',{dateStyle:'medium',timeStyle:'short',timeZone:'America/La_Paz'});
const readableError = error => {
  const code=error.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return 'El correo o la contraseña no coinciden.';
  if (code === 'auth/email-already-in-use') return 'Este correo ya tiene una cuenta.';
  if (code === 'auth/too-many-requests') return 'Hubo demasiados intentos. Vuelve a probar más tarde.';
  if (code === 'auth/unauthorized-domain') return 'Autoriza el dominio de TripZ en Firebase Authentication.';
  if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') return 'Habilita Correo electrónico/contraseña en Firebase Authentication.';
  if (code === 'auth/weak-password') return 'La contraseña no cumple la política de Firebase.';
  if (isPermissionDenied(error)) return 'Firebase denegó la operación. Revisa tu acceso y las reglas.';
  return 'La operación no se pudo completar. Verifica la conexión e intenta de nuevo.';
};

export function mountTripFirebase(changed=()=>{}) {
  const panel=document.body.dataset.tripPanel;
  const adminPage=panel==='admin';
  const form=document.querySelector('#trip-auth');
  const details=document.querySelector('#trip-session');
  const status=document.querySelector('#trip-access-status') || document.createElement('p');
  const requests=document.querySelector('#trip-requests');
  const adminSection=document.querySelector('#trip-admin');
  const adminOpen=document.querySelector('#trip-admin-open');
  const adminOrders=document.querySelector('#trip-admin-orders');
  const directory=document.querySelector('#trip-admin-directory');
  const adminFeedback=document.querySelector('#trip-admin-feedback');
  const accountFeedback=document.querySelector('#trip-account-feedback');
  const editor=document.querySelector('#trip-editor');
  const editorForm=editor?.querySelector('form');
  const searchRequest=document.querySelector('#trip-search-request');
  const filterState=document.querySelector('#trip-request-state');
  const searchUser=document.querySelector('#trip-search-user');
  const verify=document.querySelector('#trip-verify');
  const reload=document.querySelector('#trip-reload-user');
  const retryAccess=document.querySelector('#trip-retry-access');
  const personalSection=document.querySelector('#trip-personal-profile');
  const personalForm=document.querySelector('#trip-profile-form');
  const personalStatus=document.querySelector('#trip-profile-status');
  const carnetHint=document.querySelector('#trip-profile-carnet');
  const pendingRefresh=document.querySelector('#trip-refresh-pending');
  let authModule,dbModule,auth,db,user;
  let role=false,connected=false,occupancyReady=false,requestsReady=false,occupied={},rows={};
  let seller=false,profileComplete=false;
  let roleResolved=false,blocksReady=false,profilesReady=false,blocks={},profiles={};
  let generation=0;
  let stopRole,stopSeller,stopRequests,stopBlocks,stopProfiles,stopPersonalFlag;
  const claimsSection=adminPage && document.querySelector('#trip-admin-claims');
  const scanner=claimsSection?mountClaims(claimsSection,(accion,codigo)=>{
    if(!staff() || !user?.emailVerified) throw new Error('El canje requiere una cuenta del equipo verificada.');
    return qrRequest('tripCanjes',{accion,codigo});
  }):null;

  const salesSection=adminPage && document.querySelector('#trip-admin-sales');
  const salesUI=salesSection?mountSales(salesSection,input=>qrRequest('tripVentas',input),{
    isAdmin:()=>role,occupied:confirmed,onRegistered:()=>{if(seller) void loadPending();},formatDate:value=>orderDate.format(value)
  }):null;

  function staff() {return role || seller;}

  function node(tag,text,css) {
    const element=document.createElement(tag);
    if(text) element.textContent=text;
    if(css) element.className=css;
    return element;
  }

  function task(label,action) {
    const button=node('button',label,'button ghost');
    button.type='button';
    button.addEventListener('click',async()=>{
      button.disabled=true;
      try {await action();}
      catch(error){notify(error.code ? readableError(error) : error.message);}
      finally{button.disabled=false;}
    });
    return button;
  }

  function confirmed(night,seat) { return Boolean(occupied[night]?.[seat]); }
  function requested(night,seat) {
    return !staff() && Object.values(rows).some(row=>row.evento===night && row.mesa===String(seat));
  }
  function ready() {return Boolean(connected && occupancyReady && requestsReady && blocksReady && user?.emailVerified && !staff() && profileComplete && blocks[user.uid]!==true);}

  function notify(message) {
    (adminPage && staff() ? adminFeedback : accountFeedback || status).textContent=message;
  }

  function summary(row) {
    const event=events[row.evento];
    const table=floorPlan(row.evento).find(item=>String(item.number)===row.mesa);
    return {event, zone:event.zones.find(item=>item[0]===table?.zone)};
  }

  function requestState(id,row) {
    if(!occupancyReady) return ['unknown','Disponibilidad sin verificar','Vuelve a conectarte para consultar el estado de la mesa.'];
    const active=occupied[row.evento]?.[row.mesa];
    if(active===id) return ['confirmed','Reserva confirmada','TRIP confirmó el pago y asignó esta mesa a tu solicitud.'];
    if(active) return ['unavailable','Mesa ocupada','TRIP asignó esta mesa a otra solicitud. Puedes elegir otra mesa disponible.'];
    return ['sent','Solicitud enviada','La mesa sigue disponible hasta que TRIP confirme el pago.'];
  }

  function mapLink(row) {
    const link=node('a','Ver mesa en el mapa','button ghost');
    link.href='./index.html?'+new URLSearchParams({evento:row.evento,mesa:row.mesa})+'#mapa';
    return link;
  }

  function requestRef(id) {
    return dbModule.ref(db,'trip/solicitudes/'+id);
  }

  function sameVersion(current,original) {
    return current && current.evento===original.evento && current.mesa===original.mesa &&
      current.uid===original.uid && current.creada===original.creada && current.revision===original.revision;
  }

  async function changeRequest(id,row,changes) {
    const result=await dbModule.runTransaction(requestRef(id),current=>{
      if(current===null) return null;
      if(sameVersion(current,row)) return changes ? {...current,...changes,revision:(current.revision || 0)+1} : null;
    },{applyLocally:false});
    if(!result.committed || (changes && result.snapshot.val()===null)) {
      throw new Error('La solicitud cambió o ya fue eliminada. Abre la versión actual.');
    }
  }

  function edit(title,fields,save) {
    editor.querySelector('h2').textContent=title;
    const submitButton=node('button','Guardar cambios','button solid');
    submitButton.type='submit';
    const message=node('p','','trip-feedback');
    message.setAttribute('role','status');
    const cancel=node('button','Cancelar','button ghost');
    cancel.type='button';
    cancel.addEventListener('click',()=>{editor.hidden=true;});
    editorForm.replaceChildren(...fields,message,submitButton,cancel);
    editorForm.onsubmit=async event=>{
      event.preventDefault();
      submitButton.disabled=true;
      try {
        await save();
        editor.hidden=true;
      } catch(error) {
        message.textContent=error.code ? readableError(error) : error.message;
      } finally {
        submitButton.disabled=false;
      }
    };
    editor.hidden=false;
    editor.querySelector('h2').focus();
    editor.scrollIntoView({block:'nearest'});
  }

  function field(label,control) {
    const element=node('label',label);
    element.append(control);
    return element;
  }

  function editRequest(id,row) {
    const eventSelect=node('select');
    const tableSelect=node('select');
    tableSelect.required=true;
    for(const [key,event] of Object.entries(events)) eventSelect.add(new Option(event.title,key));
    eventSelect.value=row.evento;
    const fillTables=()=>{
      const night=eventSelect.value;
      tableSelect.replaceChildren(new Option('Selecciona una mesa disponible',''));
      for(const {number,zone} of floorPlan(night).sort((a,b)=>a.number-b.number)) {
        const mesa=String(number);
        if(confirmed(night,mesa) || Object.entries(rows).some(([key,item])=>key!==id && item.uid===row.uid && item.evento===night && item.mesa===mesa)) continue;
        const [,name,price]=events[night].zones.find(item=>item[0]===zone);
        tableSelect.add(new Option('Mesa '+mesa+' · '+name+' · '+price+' Bs',mesa));
      }
      if(night===row.evento && [...tableSelect.options].some(option=>option.value===row.mesa)) tableSelect.value=row.mesa;
    };
    fillTables();
    eventSelect.addEventListener('change',fillTables);
    edit('Cambiar mesa solicitada',[field('Evento',eventSelect),field('Mesa y tarifa',tableSelect)],async()=>{
      const evento=eventSelect.value;
      const mesa=tableSelect.value;
      if(!connected || !occupancyReady) throw new Error('Conéctate para comprobar si la mesa sigue disponible.');
      if(confirmed(evento,mesa)) throw new Error('Esa mesa ya está ocupada. Elige otra.');
      if(evento===row.evento && mesa===row.mesa) throw new Error('Selecciona una mesa o evento diferente.');
      await changeRequest(id,row,{evento,mesa});
      notify('Cambios guardados. La solicitud ahora corresponde a la mesa '+mesa+' de '+events[evento].title+'.');
    });
  }

  async function qrRequest(endpoint,payload) {
    if(endpoint!=='tripPerfiles' && !profileComplete) {
      throw new Error('Completa nombre, apellido y carnet en Mi perfil.');
    }
    const account=user;
    const token=await account.getIdToken();
    if(user!==account) throw new Error('La sesión cambió. Vuelve a abrir tu cuenta.');
    if(!qrApiBase.startsWith('https://')) throw new Error('Falta configurar el servicio QR gratuito de TRIP.');
    let response;
    try {
      response=await fetch(qrApiBase.replace(/\/+$/,'')+'/'+endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
        body:JSON.stringify(payload),
        signal:AbortSignal.timeout(35000)
      });
    } catch {
      throw new Error('No se pudo conectar al servicio de QR de TRIP.');
    }
    const result=await response.json().catch(()=>null);
    if(!response.ok || !result?.ok) {
      const error=new Error(result?.message || 'El servicio de QR de TRIP no está disponible.');
      error.qrCode=result?.code;
      throw error;
    }
    if(user!==account) throw new Error('La sesión cambió. Vuelve a abrir tu cuenta.');
    return result;
  }

  function reservationAPI(accion,solicitud,row,extra={}) {
    return qrRequest('tripReservas',{...extra,accion,solicitud,evento:row.evento,mesa:row.mesa,revision:row.revision??0});
  }

  function recordPayment(id,row) {
    edit('Registrar pago de la mesa '+row.mesa,paymentFields(),async()=>{
      const payment=Object.fromEntries(new FormData(editorForm));
      await reservationAPI('confirmar',id,row,payment);
      if(seller) void loadPending();
      notify('Venta confirmada. El cliente puede ver sus QR.');
    });
  }

  function moveConfirmed(id,row) {
    const target=node('select');
    target.required=true;
    target.append(new Option('Selecciona una mesa disponible',''));
    const {zone,event}=summary(row);
    for(const seat of floorPlan(row.evento).sort((a,b)=>a.number-b.number)) {
      const available=event.zones.find(item=>item[0]===seat.zone);
      if(available[2]!==zone[2] || confirmed(row.evento,seat.number)) continue;
      target.append(new Option('Mesa '+seat.number+' · '+available[1],String(seat.number)));
    }
    edit('Cambiar mesa confirmada',[field('Otra mesa de la misma tarifa',target)],async()=>{
      await reservationAPI('mover',id,row,{nuevaMesa:target.value});
      notify('Mesa cambiada. El cliente puede abrir los QR de la nueva mesa.');
    });
  }

  async function showTicket(ticket) {
    const item=node('section','','ticket');
    const title=ticket.tipo==='manillas'?'Manillas de ingreso':ticket.beneficio.modalidad==='combo'?'Combo':'Consumo';
    const benefit=ticket.beneficio;
    const detail=ticket.tipo==='manillas'?benefit.cantidad+' manillas':
      benefit.modalidad==='saldo'?benefit.montoBs+' Bs en consumo':benefit.cantidad+' combo · '+benefit.detalle;
    item.append(node('h5',title+' · Mesa '+ticket.mesa),node('p',detail));
    if(ticket.estado==='disponible' && /^TRIP1\.[A-Za-z0-9_-]{43}$/.test(ticket.codigo)) {
      const {renderQr}=await import('./public/qr-browser.js');
      const img=node('img');
      img.src=await renderQr(ticket.codigo);
      img.alt='QR de '+title.toLowerCase()+' de la mesa '+ticket.mesa;
      img.width=img.height=288;
      item.append(img,node('p','Disponible para un solo canje.'));
    } else if(ticket.estado==='reclamado') {
      item.append(node('p','Canjeado · '+orderDate.format(ticket.reclamadoEn)));
    }
    return item;
  }

  function showRequests() {
    if(!panel) return;
    requests.replaceChildren();
    adminOrders.replaceChildren();
    if(!user?.emailVerified || !roleResolved || !profileComplete) return;
    if(staff() && !adminPage) {
      const link=node('a','Abrir panel de TRIP','button solid');
      link.href='./administracion.html';
      requests.append(link);
      return;
    }
    if(!staff() && adminPage) return;
    const listElement=adminPage?adminOrders:requests;
    if(!adminPage) listElement.append(node('h2','Mis solicitudes y reservas'));
    if(!requestsReady) {
      listElement.append(node('p','Consultando solicitudes…'));
      return;
    }
    if(!staff() && blocks[user.uid]===true) listElement.append(node('p','TRIP desactivó las nuevas solicitudes para esta cuenta. Puedes consultar tus reservas y retirar solicitudes sin confirmar.'));
    const query=searchRequest.value.trim().toLowerCase();
    const list=Object.entries(rows).sort((a,b)=>b[1].creada-a[1].creada)
      .filter(([id,row])=>!staff() || ((!filterState.value || filterState.value===requestState(id,row)[0]) &&
        [row.correo,row.uid,id,row.mesa,'mesa '+row.mesa,events[row.evento].title].some(text=>text.toLowerCase().includes(query))));
    if(!list.length) listElement.append(node('p',Object.keys(rows).length?'No hay solicitudes que coincidan con el filtro.':'Todavía no hay solicitudes.'));
    for(const [id,row] of list) {
      const [state,label,description]=requestState(id,row);
      const {event,zone}=summary(row);
      const card=node('article','','my-order');
      const header=node('div','','order-top');
      const name=node('div');
      const badge=node('span',label,'order-state');
      badge.dataset.state=state;
      name.append(node('p',event.title+' · '+event.date,'order-meta'),node('h4','Mesa '+row.mesa+' · '+zone[1]));
      header.append(name,badge);
      const date=orderDate.format(row.creada);
      card.append(header,node('p','Tarifa de la mesa · '+zone[2]+' Bs'),node('p',zone[3],'order-meta'),
        node('p',description),node('p','Enviada el '+date+' · Referencia '+id,'order-meta'));
      if(staff()) card.append(node('p','Cliente · '+row.correo,'order-meta'));
      const actions=node('div','','actions');
      actions.append(mapLink(row));
      if(connected && occupancyReady) {
        if(staff() && state==='sent' && (seller || blocksReady) && blocks[row.uid]!==true) {
          actions.append(task('Registrar pago y confirmar',()=>recordPayment(id,row)));
        }
        if(role && state==='confirmed') actions.append(task('Cambiar mesa',()=>moveConfirmed(id,row)));
        if(role && state==='confirmed') actions.append(task('Liberar mesa',async()=>{
          if(!confirm('¿Liberar la mesa? La solicitud quedará sin reserva confirmada.')) return;
          await reservationAPI('liberar',id,row);
          notify('Mesa liberada. Los QR anteriores quedaron anulados.');
        }));
        if(state!=='confirmed' && (role || (!staff() && blocksReady))) {
          if(role) actions.append(task('Cambiar mesa',()=>editRequest(id,row)));
          actions.append(task(role?'Eliminar solicitud':'Retirar solicitud',async()=>{
            if(!confirm('¿Eliminar la solicitud de la mesa '+row.mesa+'?')) return;
            await changeRequest(id,row,null);
            notify(role?'Solicitud eliminada.':'Retiraste tu solicitud.');
          }));
        }
      }
      card.append(actions);
      if(state==='confirmed') {
        const tickets=node('div','','ticket-grid');
        tickets.hidden=true;
        actions.append(task('Ver o actualizar QR',async()=>{
          const {comprobantes}=await reservationAPI('comprobantes',id,row);
          tickets.replaceChildren(...await Promise.all(comprobantes.map(showTicket)));
          tickets.hidden=false;
        }));
        if(adminPage && staff() && claimsSection) actions.append(task('Escanear QR',()=>{
          setAdminView('claims');
          claimsSection.querySelector('#trip-claims-title').focus();
        }));
        card.append(tickets);
      }
      listElement.append(card);
    }
  }

  function showUsers() {
    if(!adminPage) return;
    directory.replaceChildren();
    if(!role || !profileComplete) return;
    const people=new Map();
    const counts=new Map();
    for(const [id,row] of Object.entries(rows)) {
      counts.set(row.uid,(counts.get(row.uid) || 0)+1);
      if(!people.has(row.uid)) people.set(row.uid,{correo:row.correo,solicitud:id});
    }
    for(const [uid,profile] of Object.entries(profiles)) people.set(uid,profile);
    const query=searchUser.value.trim().toLowerCase();
    const list=[...people].filter(([uid,profile])=>[uid,profile.correo,profile.nombre || ''].some(text=>text.toLowerCase().includes(query)))
      .sort((a,b)=>a[1].correo.localeCompare(b[1].correo));
    if(!list.length) directory.append(node('p','No hay usuarios que coincidan con la búsqueda.'));
    for(const [uid,profile] of list) {
      const blocked=blocks[uid]===true;
      const card=node('article','','my-order');
      const count=counts.get(uid) || 0;
      card.append(node('h4',profile.nombre || profile.correo),node('p',profile.nombre?profile.correo:'','order-meta'),
        node('p','UID · '+uid,'order-meta'),node('p',(blocked?'Reservas bloqueadas':'Reservas habilitadas')+' · '+count+' solicitudes'));
      const actions=node('div','','actions');
      const view=task('Ver solicitudes',()=>{
        searchRequest.value=uid;
        filterState.value='';
        setAdminView('requests');
      });
      actions.append(view);
      if(connected && blocksReady && profilesReady) {
        actions.append(task('Editar nombre',()=>{
          const input=node('input');
          input.maxLength=80;
          input.value=profile.nombre || '';
          edit('Editar usuario',[field('Nombre para identificar la cuenta',input)],async()=>{
            const ref=dbModule.ref(db,'trip/usuarios/'+uid);
            const nombre=input.value.trim();
            const {committed}=await dbModule.runTransaction(ref,current=>{
              const updated={...(current || profile)};
              if(nombre) updated.nombre=nombre;
              else delete updated.nombre;
              return updated;
            },{applyLocally:false});
            if(!committed) throw new Error('El usuario cambió. Vuelve a abrir la ficha.');
            notify('Nombre guardado en el directorio de TRIP.');
          });
        }));
        actions.append(task(blocked?'Reactivar reservas':'Bloquear reservas',async()=>{
          if(!confirm((blocked?'¿Reactivar':'¿Bloquear')+' las nuevas reservas de '+profile.correo+'?')) return;
          const ref=dbModule.ref(db,'trip/bloqueados/'+uid);
          await dbModule.set(ref,blocked?null:true);
          notify(blocked?'La cuenta puede volver a solicitar mesas.':'La cuenta ya no puede solicitar mesas ni recibir confirmaciones nuevas.');
        }));
      }
      card.append(actions);
      directory.append(card);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const button=event.submitter;
    const {email,password}=Object.fromEntries(new FormData(form));
    const action=button.value;
    const address=email.trim();
    if(!address || !form.elements.email.checkValidity()) {form.elements.email.reportValidity();return;}
    if(action==='register' && password.length<12) {status.textContent='Usa una contraseña de al menos 12 caracteres.';return;}
    button.disabled=true;
    try {
      if(action==='register') {
        const result=await authModule.createUserWithEmailAndPassword(auth,address,password);
        await authModule.sendEmailVerification(result.user);
        status.textContent='Revisa tu correo para verificar tu cuenta.';
      } else if(action==='reset') {
        await authModule.sendPasswordResetEmail(auth,address);
        status.textContent='Si existe una cuenta con ese correo, recibirás un enlace de recuperación.';
      } else {
        await authModule.signInWithEmailAndPassword(auth,address,password);
      }
      form.reset();
    } catch(error) {status.textContent=readableError(error);}
    finally {button.disabled=false;}
  }

  function accessError(message,error,target=status) {
    target.textContent=isPermissionDenied(error)?message:readableError(error);
    if(retryAccess) retryAccess.hidden=false;
  }

  async function loadPending() {
    const version=generation;
    if(!adminPage || !seller || !profileComplete) return;
    try {
      const response=await qrRequest('tripVentas',{accion:'solicitudes'});
      if(version!==generation || !seller || !profileComplete) return;
      rows=response.solicitudes;
      requestsReady=true;
      showRequests();
    } catch(error) {
      if(version===generation) adminFeedback.textContent=error.message;
    }
  }

  function fillProfile(profile) {
    if(!personalForm) return;
    personalForm.elements.nombre.value=profile?.nombre || '';
    personalForm.elements.apellido.value=profile?.apellido || '';
    personalForm.elements.carnet.value='';
    personalForm.elements.carnet.required=!profile;
    carnetHint.textContent=profile?'Carnet guardado · termina en '+profile.carnetFinal+'. Deja este campo vacío para conservarlo.':'Ingresa el número de carnet y su complemento si corresponde.';
  }

  function loadPersonal(account,version) {
    stopPersonalFlag?.();
    stopPersonalFlag=dbModule.onValue(dbModule.ref(db,'trip/fichasCompletas/'+account.uid),snapshot=>{
      if(version!==generation) return;
      profileComplete=snapshot.val()===true;
      applyProfileAccess(account,version);
    },error=>{
      if(version!==generation) return;
      profileComplete=false;
      applyProfileAccess(account,version);
      accessError('Firebase rechazó la consulta de tu perfil. TRIP debe publicar las reglas de trip/fichasCompletas.',error);
    });
    if(!personalSection) return;
    personalSection.hidden=false;
    personalForm.hidden=true;
    personalStatus.textContent='Consultando tu perfil…';
    qrRequest('tripPerfiles',{accion:'consultar'}).then(({perfil})=>{
      if(version!==generation) return;
      fillProfile(perfil);
      personalForm.hidden=false;
      personalStatus.textContent=perfil?'Tu carnet se guarda cifrado.':'Completa nombre, apellido y carnet para acceder a las funciones de tu cuenta.';
    }).catch(error=>{if(version===generation) personalStatus.textContent=error.message;});
  }

  function subscribeRequests() {
    stopRequests?.();
    requestsReady=false;
    rows={};
    showRequests();
    if(!profileComplete || !user?.emailVerified || (staff() && !adminPage) || (!staff() && adminPage)) return;
    if(seller) {
      void loadPending();
      return;
    }
    const all=dbModule.ref(db,'trip/solicitudes');
    const selected=role?all:dbModule.query(all,dbModule.orderByChild('uid'),dbModule.equalTo(user.uid));
    stopRequests=dbModule.onValue(selected,snapshot=>{
      rows=snapshot.val() || {};
      requestsReady=true;
      showRequests();
      showUsers();
      changed();
    },error=>{
      requestsReady=false;
      const message='Firebase rechazó la lectura de las solicitudes. TRIP debe revisar las reglas de trip/solicitudes.';
      accessError(message,error);
      if(adminPage && role) adminFeedback.textContent=status.textContent;
      changed();
    });
  }

  function subscribeProfiles(account,version) {
    stopBlocks?.();
    stopProfiles?.();
    blocksReady=profilesReady=false;
    blocks={};
    profiles={};
    if(!profileComplete || seller || (role && !adminPage) || (!role && adminPage)) return;
    const blockPath=role?'trip/bloqueados':'trip/bloqueados/'+account.uid;
    stopBlocks=dbModule.onValue(dbModule.ref(db,blockPath),snapshot=>{
      if(version!==generation) return;
      blocks=role?(snapshot.val() || {}):{[account.uid]:snapshot.val()};
      blocksReady=true;
      showRequests();
      showUsers();
      changed();
    },error=>{
      if(panel && version===generation) accessError('Firebase rechazó la consulta de bloqueos. TRIP debe publicar las reglas de trip/bloqueados.',error,adminPage && role?adminFeedback:accountFeedback);
    });
    if(adminPage && role) {
      stopProfiles=dbModule.onValue(dbModule.ref(db,'trip/usuarios'),snapshot=>{
        if(version!==generation) return;
        profiles=snapshot.val() || {};
        profilesReady=true;
        showUsers();
      },error=>{
        if(version===generation) accessError('Firebase rechazó la lectura del directorio. TRIP debe publicar las reglas de trip/usuarios.',error,adminFeedback);
      });
    } else if(panel==='cuenta' && !role) {
      const ref=dbModule.ref(db,'trip/usuarios/'+account.uid);
      stopProfiles=dbModule.onValue(ref,async snapshot=>{
        if(version!==generation || staff() || snapshot.exists()) return;
        try {
          await dbModule.runTransaction(ref,current=>current===null?{correo:account.email}:undefined,{applyLocally:false});
        } catch(error) {
          if(version===generation) accessError('Firebase no pudo crear tu ficha en trip/usuarios. Tus solicitudes siguen disponibles.',error,accountFeedback);
        }
      },error=>{
        if(version===generation) accessError('Firebase rechazó la lectura de tu ficha en trip/usuarios. Tus solicitudes siguen disponibles.',error,accountFeedback);
      },{onlyOnce:true});
    }
  }

  function setAdminView(view) {
    if(view!=='claims') scanner?.reset();
    if(view==='sales') void salesUI?.open();
    for(const button of adminSection.querySelectorAll('[data-admin-view]')) {
      const selected=button.dataset.adminView===view;
      button.setAttribute('aria-pressed',String(selected));
      button.classList.toggle('solid',selected);
      button.classList.toggle('ghost',!selected);
      document.querySelector('#trip-admin-'+button.dataset.adminView).hidden=!selected;
    }
    showRequests();
    showUsers();
  }

  function applyProfileAccess(account,version) {
    const unlocked=roleResolved && profileComplete;
    adminOpen.hidden=!unlocked || !staff() || adminPage;
    if(panel) {
      adminSection.hidden=!unlocked || !adminPage || !staff();
      if(adminPage) {
        editor.hidden=true;
        salesUI?.reset();
        setAdminView('requests');
      }
    }
    if(unlocked) {
      subscribeRequests();
      subscribeProfiles(account,version);
    } else {
      stopRequests?.();
      stopBlocks?.();
      stopProfiles?.();
      blocksReady=profilesReady=requestsReady=false;
      rows={};
      blocks={};
      profiles={};
      showRequests();
      showUsers();
    }
    changed();
  }

  function showSession(account,forceToken=false) {
    scanner?.reset();
    salesUI?.reset();
    user=account;
    const version=++generation;
    stopRole?.();
    stopSeller?.();
    stopPersonalFlag?.();
    stopRequests?.();
    stopBlocks?.();
    stopProfiles?.();
    role=seller=roleResolved=blocksReady=profilesReady=requestsReady=profileComplete=false;
    rows={};
    blocks={};
    profiles={};
    adminOpen.hidden=true;
    if(panel) {
      adminSection.hidden=editor.hidden=true;
      if(personalSection) {personalSection.hidden=true;personalForm.reset();}
      if(pendingRefresh) pendingRefresh.hidden=true;
      adminFeedback.textContent=accountFeedback.textContent='';
      searchRequest.value=searchUser.value=filterState.value='';
      showUsers();
      form.hidden=Boolean(user);
      details.hidden=!user;
      verify.hidden=reload.hidden=!user || user.emailVerified;
      retryAccess.hidden=true;
    }
    status.textContent=!user?'Inicia sesión o crea tu cuenta con correo electrónico.':user.emailVerified?'Cuenta de '+user.email:'Verifica tu correo antes de solicitar una mesa.';
    showRequests();
    changed();
    if(!user?.emailVerified) return;
    status.textContent='Comprobando el acceso de '+account.email+'…';
    watchRole(account,version,forceToken);
  }

  async function watchRole(account,version,forceToken) {
    try {
      await account.getIdToken(forceToken);
    } catch(error) {
      if(version===generation) accessError('Firebase rechazó el acceso de esta sesión.',error);
      return;
    }
    if(version!==generation) return;
    let adminValue,sellerValue;
    function applyRoles() {
      if(version!==generation || adminValue===undefined || sellerValue===undefined) return;
      const initial=!roleResolved;
      const changedRole=role!==adminValue || seller!==(!adminValue && sellerValue);
      if(!initial && !changedRole) return;
      role=adminValue;
      seller=!role && sellerValue;
      roleResolved=true;
      if(panel) {
        for(const button of adminSection.querySelectorAll('[data-admin-only]')) button.hidden=!role;
        if(pendingRefresh) pendingRefresh.hidden=!seller;
      }
      status.textContent=role?'Sesión de administración · '+user.email:
        seller?'Sesión de relacionador · '+user.email:
        adminPage?'Esta cuenta no tiene permisos para el panel de TRIP.':'Cuenta de '+user.email;
      if(initial) loadPersonal(account,version);
      else applyProfileAccess(account,version);
    }
    function onRoleError(error) {
      if(version!==generation) return;
      if(!forceToken && isPermissionDenied(error)) {
        stopRole?.();
        stopSeller?.();
        watchRole(account,version,true);
        return;
      }
      role=seller=roleResolved=false;
      applyProfileAccess(account,version);
      accessError('Firebase rechazó la consulta de permisos de la cuenta.',error);
    }
    stopRole=dbModule.onValue(dbModule.ref(db,'trip/admins/'+account.uid),snapshot=>{
      adminValue=snapshot.val()===true;
      applyRoles();
    },onRoleError);
    stopSeller=dbModule.onValue(dbModule.ref(db,'trip/relacionadores/'+account.uid),snapshot=>{
      sellerValue=snapshot.val()===true;
      applyRoles();
    },onRoleError);
  }

  if(panel) {
    retryAccess.addEventListener('click',()=>{
      if(auth.currentUser) showSession(auth.currentUser,true);
    });
    for(const button of adminSection.querySelectorAll('[data-admin-view]')) button.addEventListener('click',()=>setAdminView(button.dataset.adminView));
    searchRequest.addEventListener('input',showRequests);
    filterState.addEventListener('change',showRequests);
    searchUser.addEventListener('input',showUsers);
    form.addEventListener('submit',submit);
    pendingRefresh?.addEventListener('click',loadPending);
    personalForm?.addEventListener('submit',async event=>{
      event.preventDefault();
      const version=generation;
      const button=event.submitter;
      button.disabled=true;
      try {
        const fields=Object.fromEntries(new FormData(personalForm));
        const {perfil}=await qrRequest('tripPerfiles',{accion:'guardar',...fields});
        if(version!==generation) return;
        fillProfile(perfil);
        personalStatus.textContent='Perfil guardado.';
      } catch(error) {
        if(version===generation) personalStatus.textContent=error.message;
      } finally {
        button.disabled=false;
      }
    });
    if(adminPage) form.querySelector('[value=register]').hidden=true;
    const target=new URLSearchParams(location.search);
    if(Object.hasOwn(events,target.get('evento')) && /^([1-9]|[1-7][0-9]|8[0-4])$/.test(target.get('mesa') || '')) {
      document.querySelector('#trip-back-map').href='./index.html?'+new URLSearchParams({evento:target.get('evento'),mesa:target.get('mesa')})+'#mapa';
    }
    document.querySelector('#trip-signout').addEventListener('click',async()=>{
      try{await authModule.signOut(auth);}catch(error){status.textContent=readableError(error);}
    });
    verify.addEventListener('click',async()=>{
      try{await authModule.sendEmailVerification(user);status.textContent='Correo de verificación enviado.';}
      catch(error){status.textContent=readableError(error);}
    });
    reload.addEventListener('click',async()=>{
      try{
        const account=user;
        await account.reload();
        await account.getIdToken(true);
        if(auth.currentUser?.uid===account.uid) showSession(auth.currentUser);
      }catch(error){status.textContent=readableError(error);}
    });
  }

  async function initialize() {
    status.textContent='Comprobando la conexión de reservas…';
    try{
      const [appModule,authSdk,dbSdk]=await Promise.all([
        import(base+'firebase-app.js'),import(base+'firebase-auth.js'),import(base+'firebase-database.js')
      ]);
      authModule=authSdk;
      dbModule=dbSdk;
      const app=appModule.initializeApp(firebaseConfig);
      db=dbModule.getDatabase(app);
      const randomPath='trip/solicitudes/'+crypto.randomUUID().replaceAll('-','').slice(0,20);
      const publicMap=dbModule.ref(db,'trip/mesas');
      const privateProbe=dbModule.get(dbModule.ref(db,randomPath)).then(
        () => false,
        error => {
          if (isPermissionDenied(error)) return true;
          throw error;
        }
      );
      let timeout;
      try {
        const [privateDenied,mapReadable]=await Promise.race([
          Promise.all([privateProbe,dbModule.get(publicMap).then(()=>true,()=>false)]),
          new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Tiempo de conexión agotado')),10000);})
        ]);
        if(!privateDenied || !mapReadable) {
          status.textContent='Las cuentas estarán disponibles cuando TRIP publique las reglas de reservas en Firebase.';
          return;
        }
      } finally {
        clearTimeout(timeout);
      }
      auth=authModule.getAuth(app);
      dbModule.onValue(dbModule.ref(db,'.info/connected'),snapshot=>{
        connected=snapshot.val()===true;
        showRequests();
        showUsers();
        changed();
      });
      dbModule.onValue(publicMap,snapshot=>{
        occupancyReady=true;
        occupied=snapshot.val() || {};
        salesUI?.tables();
        const mapNotice=document.querySelector('#map-notice');
        if(mapNotice) mapNotice.textContent='El mapa muestra las mesas que TRIP ya confirmó.';
        showRequests();
        changed();
      },()=>{
        occupancyReady=false;
        showRequests();
        const mapNotice=document.querySelector('#map-notice');
        if(mapNotice) mapNotice.textContent='No se pudo verificar la disponibilidad. Puedes consultar a TRIP directamente.';
        changed();
      });
      authModule.onAuthStateChanged(auth,account=>showSession(account),error=>{status.textContent=readableError(error);});
    }catch(error){status.textContent=readableError(error);}
  }

  initialize();
  return {
    confirmed,requested,ready,
    needsProfile:()=>Boolean(user?.emailVerified && roleResolved && !profileComplete),
    blocked:()=>Boolean(user && blocks[user.uid]===true),
    async request(night,seat) {
      if(!ready()) throw new Error('Inicia sesión con tu correo verificado y revisa tu conexión.');
      const mesa=String(seat);
      if(confirmed(night,mesa)) throw new Error('La mesa ya está reservada.');
      if(requested(night,mesa)) {
        throw new Error('Ya solicitaste esta mesa. Revisa Mis solicitudes.');
      }
      try {
        await dbModule.set(dbModule.push(dbModule.ref(db,'trip/solicitudes')),{
          uid:user.uid,correo:user.email,evento:night,mesa,creada:dbModule.serverTimestamp()
        });
        return true;
      } catch(error) {throw new Error(readableError(error));}
    }
  };
}
