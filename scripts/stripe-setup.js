import 'dotenv/config';
import { db } from '../accounts.js';
import { catalog } from '../quotas.js';
import { stripe } from '../payments.js';
if(!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))throw new Error('Une STRIPE_SECRET_KEY sk_test_ est requise. Aucun produit réel ne sera créé.');
for(const plan of catalog().filter(x=>x.mode!=='free')){
  const productId='copilote_'+plan.id;
  let product;
  try{product=await stripe('products/'+productId);}catch(error){if(!error.message.endsWith('404'))throw error;}
  if(!product)product=await stripe('products',{id:productId,name:plan.label,'metadata[copilote_plan]':plan.id},'copilote-product-'+plan.id);
  let price;
  if(plan.stripe_price_id)price=await stripe('prices/'+plan.stripe_price_id);
  if(!price||price.unit_amount!==plan.amount_cents||price.currency!=='eur'||price.tax_behavior!=='inclusive'){
    price=await stripe('prices',{product:product.id,currency:'eur',unit_amount:String(plan.amount_cents),tax_behavior:'inclusive',...(plan.mode==='subscription'?{'recurring[interval]':'month'}:{})},`copilote-price-${plan.id}-${plan.amount_cents}-${plan.mode}`);
    db.prepare('UPDATE plans SET stripe_price_id=? WHERE id=?').run(price.id,plan.id);
  }
  db.prepare('INSERT OR IGNORE INTO stripe_prices VALUES(?,?)').run(price.id,plan.id);
  console.log(plan.label+' : prix de test prêt.');
}
const portal=await stripe('billing_portal/configurations',{'business_profile[headline]':'Gérer votre accès COPILOTE.IA','features[subscription_cancel][enabled]':'true','features[subscription_cancel][mode]':'at_period_end','features[payment_method_update][enabled]':'true','features[invoice_history][enabled]':'true'},'copilote-portal-v1');
db.prepare('INSERT INTO payment_settings VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run('portal_configuration',portal.id);
console.log('Portail de test configuré. Configurez ensuite le webhook et vérifiez un paiement avec une carte de test Stripe.');
db.close();
