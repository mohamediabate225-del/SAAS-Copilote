import {api,json} from './app.js';
const status=document.getElementById('verification-result');
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
if(!token)status.textContent='Ce lien ne contient pas de code. Demandez un nouveau lien depuis Mon compte.';
else {
  try{await api('/api/account/verification/confirm',json('POST',{token}));status.textContent='Adresse vérifiée. Votre essai est disponible si cette adresse n’en a pas déjà bénéficié.';}
  catch(error){status.textContent=error.message;}
}
