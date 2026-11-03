import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export function passwordHash(password,salt=randomBytes(16).toString('hex')){return salt+':'+scryptSync(password,salt,32).toString('hex');}
export function verifyPassword(password,stored){const [salt,expected]=stored.split(':');return timingSafeEqual(Buffer.from(expected,'hex'),scryptSync(password,salt,32));}
