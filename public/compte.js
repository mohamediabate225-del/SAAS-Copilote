const $=selector=>document.querySelector(selector);
const status=$("#status");
async function api(url,options={}){const response=await fetch(url,options);const data=await response.json();if(!response.ok)throw new Error(data.error||"Une erreur est survenue.");return data;}
function message(text,error=false){status.textContent=text;status.classList.toggle("error",error);}
async function refresh(){
  try{
    const user=await api("/api/account/me");$("#auth").hidden=true;$("#dashboard").hidden=false;$("#email").textContent=user.email;
    for(const field of ["goals","salary","notes"])$("#profile").elements[field].value=user[field]||"";
    const resumes=await api("/api/account/resumes");const select=$("#resumeSelect");select.replaceChildren(new Option("Choisir un CV",""));$("#resumes").replaceChildren();
    for(const cv of resumes){select.add(new Option(cv.name,cv.id));const li=document.createElement("li");li.textContent=cv.name;$("#resumes").append(li);}
    const preparation=await api("/api/account/preparation");for(const field of ["resume_id","role","company","offer","notes"])$("#preparation").elements[field].value=preparation[field]||"";
  }catch{$("#auth").hidden=false;$("#dashboard").hidden=true;}
}
for(const kind of ["register","login"])$("#"+kind).addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget;const data=Object.fromEntries(new FormData(form));if(kind==="register"&&data.password!==data.password_confirmation){message("Les mots de passe ne correspondent pas.",true);form.elements.password_confirmation.focus();return;}try{await api("/api/account/"+kind,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});form.reset();message("");await refresh();}catch(err){message(err.message,true);}});
$("#profile").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/account/profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});message("Vos informations sont enregistrées.");}catch(err){message(err.message,true);}});
$("#resume").addEventListener("submit",async e=>{e.preventDefault();const element=e.currentTarget;try{const form=new FormData(element);if(!form.get("pdf").size)form.delete("pdf");await api("/api/account/resumes",{method:"POST",body:form});element.reset();await refresh();message("CV ajouté.");}catch(err){message(err.message,true);}});
$("#preparation").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/account/preparation",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});message("Préparation enregistrée.");}catch(err){message(err.message,true);}});
$("#logout").addEventListener("click",async()=>{await api("/api/account/logout",{method:"POST"});message("");await refresh();});refresh();
