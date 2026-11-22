import {api,json,showMessage} from './app.js';
const status=document.getElementById('billing-status'),container=document.getElementById('plans');
function node(tag,text){const el=document.createElement(tag);el.textContent=text;return el;}
try {
 const result=await api('/api/billing/plans');
 status.textContent=result.test_mode?'Préparation du lancement : paiements de test uniquement.':result.enabled?'Choisissez une offre adaptée à votre préparation.':'Les paiements ne sont pas encore ouverts.';
 for(const plan of result.plans){
  const card=node('article','');card.className='surface';
  const price=new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(plan.amount/100);
  card.append(node('h2',plan.label),node('p',price+' TTC'+(plan.mode==='subscription'?' / mois':plan.mode==='payment'?' · paiement unique':'')));
  card.append(node('p',`${plan.minutes} minutes${plan.mode==='subscription'?' par mois':` · valables ${plan.valid_days} jours`}`));
  if(plan.mode==='free')card.append(node('p',`${plan.live_questions} questions d’aide à la réponse. Essai sans carte, après vérification de l’e-mail, une seule fois par adresse.`));
  card.append(node('p',`${plan.daily_audio_minutes} minutes d’audio maximum par jour.`));
  if(plan.mode==='free'){
   const link=node('a','Créer mon compte');link.className='action';link.href='/connexion.html#inscription';card.append(link);
  }else{
   const button=node('button',plan.available?'Choisir '+plan.label:'Paiement bientôt disponible');button.className='action';button.disabled=!plan.available;
   button.onclick=async()=>{
    const consent=document.getElementById('accept-cgv');
    if(!consent.checked){showMessage(status,'Lisez et acceptez les CGV pour continuer.',true);consent.focus();return;}
    button.disabled=true;
    try{const {url}=await api('/api/billing/checkout',json('POST',{plan:plan.id,accept_cgv:true}));location.assign(url);}
    catch(error){if(error.status===401)location.assign('/connexion.html');else showMessage(status,error.message,true);}
    finally{button.disabled=false;}
   };card.append(button);
  }container.append(card);
 }
}catch(error){showMessage(status,error.message,true);}
