import 'dotenv/config';
import { randomBytes, createHash } from 'node:crypto';
import { db } from '../accounts.js';
const code=randomBytes(24).toString('base64url');
const uses=Number(process.argv[2]||1),days=Number(process.argv[3]||14);
if(!Number.isInteger(uses)||uses<1||uses>100||!Number.isInteger(days)||days<1||days>90)throw new Error('Usage : npm run invite -- [utilisations 1..100] [jours 1..90]');
db.prepare('INSERT INTO invitations VALUES(?,?,?)').run(createHash('sha256').update(code).digest('hex'),uses,Date.now()+days*86400000);
console.log('Code privé, à transmettre uniquement aux personnes invitées : '+code);
db.close();
