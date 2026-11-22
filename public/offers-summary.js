fetch('/api/billing/plans').then(r=>r.json()).then(({plans})=>{
 const free=plans.find(p=>p.id==='free'),p=document.getElementById('free-offer-summary');
 if(free&&p)p.textContent=`L’essai inclut ${free.minutes} minutes valables ${free.valid_days} jours après vérification de l’e-mail et ${free.live_questions} questions d’aide à la réponse. Un seul essai par adresse, sans carte bancaire.`;
}).catch(()=>{});
