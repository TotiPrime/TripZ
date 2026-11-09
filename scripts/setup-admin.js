import { existsSync,writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../worker/passwords.js';

const config='.env.local';
if (existsSync(config)) {
  console.error('Ya existe .env.local. Conserva ese archivo y la clave que protege los perfiles.');
  process.exitCode=1;
} else {
  const password=randomBytes(24).toString('base64url');
  const hash=await hashPassword(password);
  writeFileSync(config,'TRIP_ADMIN_PASSWORD_HASH='+hash+'\nTRIP_PROFILE_KEY='+randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});
  console.log('Usuario temporal: admin');
  console.log('Contraseña temporal: '+password);
  console.log('Abre http://127.0.0.1:3000/admin para cambiarla en el primer acceso.');
}
