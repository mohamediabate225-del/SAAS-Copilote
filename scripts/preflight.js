import 'dotenv/config';
import { isAbsolute } from 'node:path';
const failures=[];
const requireValue=(name,test=value=>Boolean(value))=>{if(!test(process.env[name]||''))failures.push(name);};
if(Number(process.versions.node.split('.')[0])<24)failures.push('Node.js 24+');
requireValue('APP_BASE_URL',value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password&&!['localhost','127.0.0.1'].includes(u.hostname);}catch{return false;}});
requireValue('COPILOTE_DB_PATH',isAbsolute);requireValue('OPENAI_API_KEY');
requireValue('TRIAL_IDENTITY_SECRET',x=>x.length>=32);requireValue('EXTENSION_ID',x=>/^[a-p]{32}$/.test(x));
for(const name of ['SMTP_HOST','SMTP_PORT','SMTP_FROM'])requireValue(name);
requireValue('LEGAL_REVIEWED',x=>x==='true');
requireValue('DNS_MAIL_VERIFIED',x=>x==='true');
requireValue('BACKUP_RESTORE_VERIFIED',x=>x==='true');
if(process.env.BILLING_ENABLED==='true'){
  requireValue('STRIPE_SECRET_KEY',x=>x.startsWith('sk_test_')||process.env.STRIPE_LIVE_ENABLED==='true'&&x.startsWith('sk_live_'));
  requireValue('STRIPE_WEBHOOK_SECRET',x=>x.startsWith('whsec_'));
  requireValue('STRIPE_CHECKOUT_VERIFIED',x=>x==='true');
}
console.log(failures.length?'Publication non prête. À configurer ou valider :\n- '+failures.join('\n- '):'Contrôles de configuration réussis. Demander encore l’accord du propriétaire avant publication.');
process.exitCode=failures.length?1:0;
