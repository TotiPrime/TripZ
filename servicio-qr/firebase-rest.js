import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { TripError } from './tickets.js';

const tokenURL='https://oauth2.googleapis.com/token';
const signingKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),{timeoutDuration:5000});
const scopes=['firebase.database','userinfo.email','identitytoolkit'].map(scope=>'https://www.googleapis.com/auth/'+scope).join(' ');
let oauthCache;

async function googleToken(env) {
  const credential=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  if(credential.type!=='service_account' || credential.project_id!==env.FIREBASE_PROJECT_ID ||
    typeof credential.client_email!=='string' || typeof credential.private_key!=='string') {
    throw new Error('Credencial de servicio inválida');
  }
  const identity=credential.client_email+':'+credential.private_key_id;
  if(oauthCache?.identity===identity && oauthCache.expires>Date.now()) return oauthCache.token;
  const key=await importPKCS8(credential.private_key,'RS256');
  const jwt=await new SignJWT({scope:scopes})
    .setProtectedHeader({alg:'RS256',kid:credential.private_key_id})
    .setIssuer(credential.client_email)
    .setAudience(tokenURL)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
  const result=await fetch(tokenURL,{method:'POST',redirect:'error',
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})});
  if(!result.ok) throw new Error('Google rechazó la credencial de servicio (OAuth '+result.status+')');
  const {access_token,expires_in}=await result.json();
  if(typeof access_token!=='string' || !Number.isFinite(expires_in)) throw new Error('Respuesta OAuth inválida');
  oauthCache={identity,token:access_token,expires:Date.now()+(expires_in-90)*1000};
  return access_token;
}

export async function authenticate(request,env) {
  const bearer=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_.-]{1,8192})$/i);
  if(!bearer) throw new TripError(401,'sesion_requerida','Inicia sesión con Firebase.');
  let claims;
  try {
    ({payload:claims}=await jwtVerify(bearer[1],signingKeys,{
      algorithms:['RS256'],
      issuer:'https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID,
      audience:env.FIREBASE_PROJECT_ID,
      requiredClaims:['sub','iat','exp','auth_time']
    }));
  } catch(error) {
    if(error.code==='ERR_JWKS_TIMEOUT' || error instanceof TypeError) throw error;
    throw new TripError(401,'sesion_invalida','La sesión venció o no es válida. Vuelve a iniciar sesión.');
  }
  const now=Math.floor(Date.now()/1000);
  if(!claims.sub || claims.sub.length>128 || /[.#$\[\]/\x00-\x1f\x7f]/.test(claims.sub) ||
    claims.aud!==env.FIREBASE_PROJECT_ID || typeof claims.iat!=='number' || typeof claims.auth_time!=='number' ||
    claims.iat>now || claims.auth_time>now) {
    throw new TripError(401,'sesion_invalida','La sesión de Firebase no es válida.');
  }
  if(claims.email_verified!==true) throw new TripError(403,'correo_sin_verificar','Verifica tu correo.');
  const token=await googleToken(env);
  const response=await fetch('https://identitytoolkit.googleapis.com/v1/projects/'+encodeURIComponent(env.FIREBASE_PROJECT_ID)+'/accounts:lookup',{
    method:'POST',redirect:'error',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({localId:[claims.sub]})
  });
  if(!response.ok) throw new Error('No se pudo verificar la cuenta de Firebase ('+response.status+')');
  const user=(await response.json()).users?.[0];
  if(!user || user.localId!==claims.sub || user.disabled || claims.auth_time<Number(user.validSince || 0)) {
    throw new TripError(401,'sesion_invalida','La cuenta está deshabilitada o la sesión fue revocada.');
  }
  if(user.emailVerified!==true) throw new TripError(403,'correo_sin_verificar','Verifica tu correo.');
  return {uid:claims.sub,token};
}

export function connectFirebase(env,token) {
  const endpoint=new URL('/trip.json',env.FIREBASE_DATABASE_URL);
  const headers={Authorization:'Bearer '+token};
  async function read(withETag) {
    const response=await fetch(endpoint,{redirect:'error',cache:'no-store',
      headers:withETag?{...headers,'X-Firebase-ETag':'true'}:headers});
    if(!response.ok) throw new Error('Firebase rechazó la lectura ('+response.status+')');
    return {state:await response.json(),etag:response.headers.get('etag')};
  }
  return {
    async get() {return (await read(false)).state;},
    async change(update) {
      for(let attempt=0;attempt<6;attempt++) {
        const {state,etag}=await read(true);
        if(!etag) throw new Error('Firebase omitió la etiqueta de transacción');
        const result=update(state);
        const response=await fetch(endpoint,{
          method:'PUT',redirect:'error',
          headers:{...headers,'Content-Type':'application/json','If-Match':etag},
          body:JSON.stringify(state)
        });
        await response.body?.cancel();
        if(response.ok) return {state,result};
        if(response.status!==412) throw new Error('Firebase rechazó la escritura ('+response.status+')');
      }
      throw new TripError(409,'cambio_concurrente','La reserva cambió. Actualiza e intenta otra vez.');
    }
  };
}
