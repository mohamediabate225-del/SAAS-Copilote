const key='copilote:audio-consent:2026-11-21';
export function consentRemembered(){try{return localStorage.getItem(key)==='yes';}catch{return false;}}
export function rememberConsent(value){try{if(value)localStorage.setItem(key,'yes');else localStorage.removeItem(key);}catch{}}
export async function ensureAudioConsent(){
  if(consentRemembered())return true;
  const dialog=document.createElement('dialog');dialog.className='surface';
  const form=document.createElement('form');form.method='dialog';
  const heading=document.createElement('h2');heading.textContent='Avant de capter l’audio';
  const text=document.createElement('p');text.textContent='L’audio est transmis au service de transcription. Vérifiez les règles applicables à chaque appel.';
  const label=document.createElement('label');label.className='check-line';
  const check=document.createElement('input');check.type='checkbox';check.required=true;
  const span=document.createElement('span');span.textContent='J’ai l’accord des participants et le règlement de l’entretien l’autorise.';
  label.append(check,span);
  const cancel=document.createElement('button');cancel.type='button';cancel.className='action secondary';cancel.textContent='Annuler';
  const submit=document.createElement('button');submit.className='action';submit.textContent='Continuer';
  form.append(heading,text,label,cancel,submit);dialog.append(form);document.body.append(dialog);
  return new Promise(resolve=>{
    let accepted=false;cancel.onclick=()=>dialog.close();
    form.onsubmit=()=>{accepted=check.checked;rememberConsent(accepted);};
    dialog.onclose=()=>{dialog.remove();resolve(accepted);};dialog.showModal();
  });
}
