import { firebaseConfig } from './firebase-config.js';
import { events } from './public/catalog.js';
import { floorPlan } from './public/plan.js';

const base = 'https://www.gstatic.com/firebasejs/13.2.0/';
const readableError = error => {
  const code=error.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return 'El correo o la contraseña no coinciden.';
  if (code === 'auth/email-already-in-use') return 'Este correo ya tiene una cuenta.';
  if (code === 'auth/too-many-requests') return 'Hubo demasiados intentos. Vuelve a probar más tarde.';
  if (code === 'auth/unauthorized-domain') return 'Autoriza el dominio de TripZ en Firebase Authentication.';
  if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') return 'Habilita Correo electrónico/contraseña en Firebase Authentication.';
  if (code === 'auth/weak-password') return 'La contraseña no cumple la política de Firebase.';
  if (/permission.denied/i.test(code)) return 'Firebase denegó la operación. Revisa tu acceso y las reglas.';
  return 'La operación no se pudo completar. Verifica la conexión e intenta de nuevo.';
};

export function mountTripFirebase(changed) {
  const dialog=document.querySelector('#trip-access');
  const form=document.querySelector('#trip-auth');
  const details=document.querySelector('#trip-session');
  const status=document.querySelector('#trip-access-status');
  const requests=document.querySelector('#trip-requests');
  const verify=document.querySelector('#trip-verify');
  const reload=document.querySelector('#trip-reload-user');
  let authModule,dbModule,auth,db,user;
  let role=false,connected=false,occupancyReady=false,requestsReady=false,occupied={},rows={};
  let generation=0;
  let stopRole,stopRequests;

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
      catch(error){status.textContent=readableError(error);}
      finally{button.disabled=false;}
    });
    return button;
  }

  function seatPath(night,seat) { return 'trip/mesas/'+night+'/'+seat; }
  function confirmed(night,seat) { return Boolean(occupied[night]?.[seat]); }
  function requested(night,seat) {
    return !role && Object.values(rows).some(row=>row.evento===night && row.mesa===String(seat));
  }
  function ready() {return Boolean(connected && occupancyReady && requestsReady && user?.emailVerified && !role);}

  function showRequests() {
    requests.replaceChildren();
    if(!user?.emailVerified || !requestsReady) return;
    requests.append(node('h3',role?'SOLICITUDES DE TRIP':'MIS SOLICITUDES'));
    const list=Object.entries(rows).sort((a,b)=>b[1].creada-a[1].creada);
    if(!list.length) requests.append(node('p','Todavía no hay solicitudes.'));
    for(const [id,row] of list) {
      const active=occupied[row.evento]?.[row.mesa];
      const card=node('article','','my-order');
      const zone=floorPlan(row.evento).find(item=>String(item.number)===row.mesa)?.zone;
      const price=events[row.evento].zones.find(item=>item[0]===zone)?.[2];
      card.append(node('p',events[row.evento].title+' · Mesa '+row.mesa+(price?' · '+price+' Bs':'')));
      card.append(node('p',active===id?'Reserva confirmada':active?'Mesa confirmada para otra solicitud':'Solicitud registrada'));
      if(role) {
        card.append(node('p',row.correo));
        if(!active) card.append(task('Confirmar pago verificado',async()=>{
          if(!confirm('¿Verificaste el pago de la mesa '+row.mesa+'?')) return;
          const {committed}=await dbModule.runTransaction(dbModule.ref(db,seatPath(row.evento,row.mesa)),value=>value===null?id:undefined,{applyLocally:false});
          if(!committed) status.textContent='Esta mesa ya tiene una reserva confirmada.';
        }));
        if(active===id) card.append(task('Liberar mesa',async()=>{
          if(!confirm('¿Liberar esta mesa confirmada?')) return;
          const {committed}=await dbModule.runTransaction(dbModule.ref(db,seatPath(row.evento,row.mesa)),value=>value===id?null:undefined,{applyLocally:false});
          if(!committed) status.textContent='La reserva cambió. Actualiza la lista.';
        }));
      } else if(active!==id) card.append(task('Retirar solicitud',async()=>{
        if(confirm('¿Retirar tu solicitud?')) await dbModule.remove(dbModule.ref(db,'trip/solicitudes/'+id));
      }));
      requests.append(card);
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

  function subscribeRequests() {
    stopRequests?.();
    requestsReady=false;
    rows={};
    showRequests();
    if(!user?.emailVerified) return;
    const all=dbModule.ref(db,'trip/solicitudes');
    const selected=role?all:dbModule.query(all,dbModule.orderByChild('uid'),dbModule.equalTo(user.uid));
    stopRequests=dbModule.onValue(selected,snapshot=>{
      rows=snapshot.val() || {};
      requestsReady=true;
      showRequests();
      changed();
    },error=>{requestsReady=false;status.textContent=readableError(error);changed();});
  }

  function showSession(account) {
    user=account;
    const version=++generation;
    stopRole?.();
    stopRequests?.();
    role=false;requestsReady=false;rows={};
    form.hidden=Boolean(user);
    details.hidden=!user;
    verify.hidden=reload.hidden=!user || user.emailVerified;
    status.textContent=!user?'Inicia sesión o crea tu cuenta con correo electrónico.':user.emailVerified?'Cuenta de '+user.email:'Verifica tu correo antes de solicitar una mesa.';
    showRequests();
    changed();
    if(!user?.emailVerified) return;
    stopRole=dbModule.onValue(dbModule.ref(db,'trip/admins/'+user.uid),snapshot=>{
      if(version!==generation) return;
      role=snapshot.val()===true;
      status.textContent=role?'Panel de TRIP · '+user.email:'Cuenta de '+user.email;
      subscribeRequests();
      changed();
    },error=>{if(version===generation)status.textContent=readableError(error);});
  }

  document.querySelector('#trip-account').addEventListener('click',()=>dialog.showModal());
  dialog.querySelector('.close').addEventListener('click',()=>dialog.close());
  form.addEventListener('submit',submit);
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
          if (/permission.denied/i.test(error.code || error.message)) return true;
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
        changed();
      });
      dbModule.onValue(publicMap,snapshot=>{
        occupancyReady=true;
        occupied=snapshot.val() || {};
        document.querySelector('#map-notice').textContent='El mapa muestra las mesas que TRIP ya confirmó.';
        showRequests();
        changed();
      },()=>{
        occupancyReady=false;
        document.querySelector('#map-notice').textContent='No se pudo verificar la disponibilidad. Puedes consultar a TRIP directamente.';
        changed();
      });
      authModule.onAuthStateChanged(auth,showSession,error=>{status.textContent=readableError(error);});
    }catch(error){status.textContent=readableError(error);}
  }

  initialize();
  return {
    confirmed,requested,ready,
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
