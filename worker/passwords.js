import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

const cost = {N:32768,r:8,p:3,maxmem:64*1024*1024};
const pattern = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
export const dummyPasswordHash = 'scrypt$'+'0'.repeat(32)+'$'+'0'.repeat(128);
export const validPasswordHash = value => pattern.test(value || '');
export const validPassword = value => typeof value === 'string' && value.length>=14 && value.length<=128;

function derive(password,salt) {
  return new Promise((resolve,reject)=>{
    scrypt(password,salt,64,cost,(error,key)=>error?reject(error):resolve(key));
  });
}
export async function hashPassword(password) {
  const salt=randomBytes(16);
  const key=await derive(password,salt);
  return 'scrypt$'+salt.toString('hex')+'$'+key.toString('hex');
}
export async function verifyPassword(password,stored) {
  const [,salt,key]=pattern.exec(stored || dummyPasswordHash);
  return timingSafeEqual(await derive(password,Buffer.from(salt,'hex')),Buffer.from(key,'hex'));
}
