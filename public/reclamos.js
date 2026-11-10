const tripCode = /^TRIP1\.[A-Za-z0-9_-]{43}$/;
const initial = 'Selecciona el beneficio y activa la cámara.';
const labels = {saldo:'Consumo',combo:'Combo',manillas:'Manillas'};

function benefitLabel(kind,benefit) {
  if(kind==='manillas') return benefit.cantidad+' manillas de ingreso';
  if(kind==='combo') return benefit.cantidad+' combo · '+benefit.detalle;
  return benefit.montoBs+' Bs en consumo';
}

function cameraError(error) {
  if(error.name==='NotAllowedError' || error.name==='SecurityError') {
    return 'Permite el acceso a la cámara en el navegador y vuelve a intentarlo.';
  }
  if(error.name==='NotFoundError') return 'No se encontró una cámara disponible.';
  if(error.name==='NotReadableError') return 'La cámara no está disponible. Revisa si otra aplicación la está usando.';
  return 'No se pudo iniciar el lector de QR. Vuelve a intentar.';
}

export function mountClaims(section,request) {
  const kind=section.querySelector('#trip-claim-kind');
  const start=section.querySelector('#trip-claim-start');
  const stop=section.querySelector('#trip-claim-stop');
  const video=section.querySelector('#trip-claim-camera');
  const status=section.querySelector('#trip-claim-status');
  const result=section.querySelector('#trip-claim-result');
  const table=section.querySelector('#trip-claim-table');
  const event=section.querySelector('#trip-claim-event');
  const benefit=section.querySelector('#trip-claim-benefit');
  const redeem=section.querySelector('#trip-claim-redeem');
  const canvas=document.createElement('canvas');
  let phase='idle', generation=0, stream, timer, ticket;

  function paint() {
    const cameraPending=phase==='opening' || phase==='scanning';
    stop.hidden=!cameraPending;
    start.disabled=cameraPending || phase==='validating' || phase==='redeeming';
    start.textContent=ticket?'Escanear otro QR':'Activar cámara';
    kind.disabled=phase==='validating' || phase==='redeeming';
    result.hidden=!ticket;
    redeem.disabled=phase!=='ready';
  }

  function stopCamera() {
    clearInterval(timer);
    stream?.getTracks().forEach(track=>track.stop());
    stream=undefined;
    video.srcObject=null;
    video.hidden=true;
  }

  function reset(message=initial) {
    generation++;
    stopCamera();
    ticket=undefined;
    phase='idle';
    status.textContent=message;
    paint();
  }

  async function validate(code) {
    const current=generation;
    const selected=kind.value;
    const type=selected==='manillas'?'manillas':'consumo';
    stopCamera();
    phase='validating';
    status.textContent='Verificando el QR…';
    paint();
    try {
      const checked=await request('validar',type,code);
      if(current!==generation) return;
      const actual=checked.tipo==='manillas'?'manillas':checked.beneficio?.modalidad;
      if(checked.estado!=='disponible' || !Object.hasOwn(labels,actual)) {
        throw new Error('El QR no está disponible para canje.');
      }
      if(actual!==selected) {
        throw new Error('Este QR corresponde a '+labels[actual]+'. Selecciona ese tipo y vuelve a escanear.');
      }
      ticket={code,type};
      table.textContent='Mesa '+checked.mesa;
      event.textContent=checked.titulo+' · '+checked.zona;
      benefit.textContent=benefitLabel(actual,checked.beneficio);
      phase='ready';
      status.textContent='QR válido. Pulsa RECLAMADO para registrar la entrega.';
      paint();
    } catch(error) {
      if(current===generation) reset(error.message);
    }
  }

  start.addEventListener('click',async()=>{
    reset();
    if(!navigator.mediaDevices?.getUserMedia) {
      reset('Abre TripZ por HTTPS en un navegador que permita usar la cámara.');
      return;
    }
    const current=generation;
    phase='opening';
    status.textContent='Solicitando acceso a la cámara…';
    paint();
    try {
      const media=await navigator.mediaDevices.getUserMedia({
        audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:720}}
      });
      if(current!==generation) {
        media.getTracks().forEach(track=>track.stop());
        return;
      }
      stream=media;
      for(const track of media.getVideoTracks()) {
        track.addEventListener('ended',()=>{
          if(stream===media) reset('La cámara se desconectó. Vuelve a activarla.');
        },{once:true});
      }
      const {default:decode}=await import('./qr-decoder.js');
      if(current!==generation) return;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx) throw new Error('No hay un contexto de video');
      video.srcObject=stream;
      video.hidden=false;
      await video.play();
      if(current!==generation) return;
      phase='scanning';
      status.textContent='Enfoca el QR con la cámara.';
      paint();
      timer=setInterval(()=>{
        if(video.readyState<2 || !video.videoWidth || !video.videoHeight) return;
        const scale=Math.min(1,720/Math.max(video.videoWidth,video.videoHeight));
        const width=Math.max(1,Math.round(video.videoWidth*scale));
        const height=Math.max(1,Math.round(video.videoHeight*scale));
        if(canvas.width!==width || canvas.height!==height) {
          canvas.width=width;
          canvas.height=height;
        }
        ctx.drawImage(video,0,0,width,height);
        const pixels=ctx.getImageData(0,0,width,height);
        const code=decode(pixels.data,width,height,{inversionAttempts:'dontInvert'})?.data;
        if(!code) return;
        if(tripCode.test(code)) void validate(code);
        else status.textContent='Ese código no pertenece a TRIP. Enfoca un comprobante de TRIP.';
      },180);
    } catch(error) {
      if(current===generation) reset(cameraError(error));
    }
  });

  redeem.addEventListener('click',async()=>{
    if(phase!=='ready' || !ticket) return;
    const current=generation;
    phase='redeeming';
    status.textContent='Registrando el canje…';
    paint();
    try {
      const response=await request('canjear',ticket.type,ticket.code);
      if(current!==generation) return;
      if(response.estado!=='reclamado') throw new Error('No se confirmó el canje. Revisa el código antes de entregar.');
      phase='done';
      status.textContent='Canje registrado. Este QR quedó inutilizado.';
    } catch(error) {
      if(current!==generation) return;
      if(['qr_reclamado','qr_invalido','tipo_incorrecto','sin_permiso','sesion_invalida'].includes(error.qrCode)) {
        reset(error.message);
        return;
      }
      phase='ready';
      status.textContent=error.message;
    }
    paint();
  });

  stop.addEventListener('click',()=>reset('Cámara detenida. Puedes activarla nuevamente.'));
  kind.addEventListener('change',()=>reset());
  window.addEventListener('pagehide',()=>reset());
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden && (phase==='scanning' || phase==='opening')) reset('Cámara detenida al salir de esta pestaña.');
  });
  paint();
  return {reset};
}
