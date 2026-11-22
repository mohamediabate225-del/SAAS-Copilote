import { api, json } from './app.js';

const $=id=>document.getElementById(id);
const status=$('billing-status'),container=$('plans'),checkout=$('checkout'),consent=$('accept-cgv');
const money=new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:2,minimumFractionDigits:0});
let catalog,selected,paying=false;
const descriptions={free:'Pour découvrir votre façon de progresser.',sprint:'Un objectif précis, un achat unique.',essentiel:'Pour installer une routine de préparation.',pro:'Pour préparer plusieurs opportunités.'};
function node(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function price(plan){return money.format(plan.amount/100);}
function period(plan){return plan.mode==='subscription'?'par mois':plan.mode==='free'?`pendant ${plan.valid_days} jours après vérification`:`pendant ${plan.valid_days} jours après paiement`;}
function daily(plan){return `${plan.daily_audio_minutes} min d’audio maximum par jour, heure de Paris.`;}
function select(plan){
  selected=plan;
  for(const radio of container.querySelectorAll('input'))radio.checked=radio.value===plan.id;
  for(const label of container.querySelectorAll('.pricing-option'))label.classList.toggle('is-selected',label.querySelector('input').checked);
  const free=plan.mode==='free';
  $('selected-offer').hidden=false;$('offer-preview').hidden=false;
  $('selection-title').textContent=`${plan.label} · ${plan.minutes} minutes ${period(plan)}`;
  $('selection-detail').textContent=free?`${plan.live_questions} questions d’aide à la réponse. Sans carte bancaire.`:plan.mode==='subscription'?'Renouvellement mensuel. Résiliation depuis Mon compte.':'Paiement unique. Aucun renouvellement automatique.';
  $('preview-name').textContent=`Votre rythme avec ${plan.label}`;$('preview-minutes').textContent=plan.minutes;
  $('preview-period').textContent=plan.mode==='subscription'?'Chaque mois':`${plan.valid_days} jours pour vous préparer`;
  $('preview-daily').textContent=daily(plan);$('daily-terms').textContent=daily(plan)+' Ce plafond est partagé entre les offres actives du même compte.';
  $('terms-row').hidden=free||!plan.available;$('start-free').hidden=!free;checkout.hidden=free;
  checkout.disabled=!plan.available||paying;
  checkout.textContent=plan.available?`Choisir ${plan.label} · ${price(plan)}${plan.mode==='subscription'?' / mois':''}`:'Les paiements ouvrent bientôt';
  $('payment-note').textContent=free?'Un seul essai par adresse e-mail.':!plan.available?'Vous pouvez déjà découvrir l’outil avec l’offre gratuite.':catalog.test_mode?'Mode test : aucun paiement réel.':`${price(plan)} TTC ${plan.mode==='subscription'?'facturés chaque mois.':'en une seule fois.'} Paiement sécurisé par Stripe.`;
  $('checkout-error').textContent='';consent.removeAttribute('aria-invalid');
  const url=new URL(location.href);url.searchParams.set('offre',plan.id);history.replaceState(null,'',url);
}
function render(plan){
  const label=node('label','', 'pricing-option'),radio=document.createElement('input');radio.type='radio';radio.name='plan';radio.value=plan.id;
  const copy=node('span','', 'pricing-option-copy'),heading=node('span','', 'pricing-option-heading');heading.append(node('strong',plan.label));
  if(plan.id==='essentiel')heading.append(node('span','Pour commencer','pricing-plan-badge'));
  copy.append(heading,node('span',`${plan.minutes} min ${plan.mode==='subscription'?'par mois':`· ${plan.valid_days} jours`}`,'pricing-option-quota'),node('small',descriptions[plan.id]||'Préparez vos entretiens à votre rythme.'));
  const amount=node('span','', 'pricing-option-amount');amount.append(node('strong',price(plan)),node('small',plan.mode==='subscription'?'/ mois':plan.mode==='free'?'sans carte':'une fois'));
  label.append(radio,copy,amount);radio.addEventListener('change',()=>select(plan));return label;
}
async function load(){
  $('retry-plans').hidden=true;status.textContent='Chargement des offres…';status.classList.remove('error');container.setAttribute('aria-busy','true');
  try{
    catalog=await api('/api/billing/plans');
    if(!Array.isArray(catalog.plans)||!catalog.plans.length)throw new Error('Les offres ne sont pas disponibles pour le moment.');
    container.replaceChildren(node('legend','Votre offre','pricing-sr-only'),...catalog.plans.map(render));
    status.textContent=!catalog.enabled?'Les paiements ouvrent bientôt. L’essai gratuit reste accessible.':catalog.test_mode?'Mode test : les paiements réels sont désactivés.':'Choisissez votre offre. Les prix et les limites sont affichés ci-dessous.';
    const free=catalog.plans.find(p=>p.mode==='free');
    $('free-terms').textContent=free?`${free.minutes} minutes et ${free.live_questions} questions d’aide à la réponse, valables ${free.valid_days} jours après vérification de votre adresse e-mail. Un seul essai par adresse, sans carte bancaire.`:'L’essai gratuit n’est pas disponible actuellement.';
    const requested=new URL(location.href).searchParams.get('offre');select(catalog.plans.find(p=>p.id===requested)||catalog.plans.find(p=>p.id==='essentiel')||catalog.plans[0]);
  }catch(error){status.textContent=error.message||'Impossible de charger les offres. Réessayez.';status.classList.add('error');$('retry-plans').hidden=false;}
  finally{container.setAttribute('aria-busy','false');}
}
checkout.addEventListener('click',async()=>{
  if(paying||!selected?.available||selected.mode==='free')return;
  if(!consent.checked){$('checkout-error').textContent='Acceptez les conditions de vente pour continuer.';consent.setAttribute('aria-invalid','true');consent.focus();return;}
  const plan=selected;paying=true;checkout.disabled=true;container.disabled=true;checkout.setAttribute('aria-busy','true');checkout.textContent='Ouverture du paiement…';$('checkout-error').textContent='';
  try{const {url}=await api('/api/billing/checkout',json('POST',{plan:plan.id,accept_cgv:true}));location.assign(url);}
  catch(error){if(error.status===401)location.assign('/connexion.html');else $('checkout-error').textContent=error.message;}
  finally{paying=false;container.disabled=false;checkout.removeAttribute('aria-busy');checkout.disabled=!selected.available;checkout.textContent=`Choisir ${selected.label} · ${price(selected)}${selected.mode==='subscription'?' / mois':''}`;}
});
consent.addEventListener('change',()=>{if(consent.checked){$('checkout-error').textContent='';consent.removeAttribute('aria-invalid');}});
$('retry-plans').addEventListener('click',load);load();
