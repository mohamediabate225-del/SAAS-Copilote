// Aggregate page counts only: no identifier, cookie, referrer, query string or session replay.
fetch('/api/analytics/config',{credentials:'omit'}).then(res=>res.json()).then(config=>{
  if(config.enabled)fetch('/api/analytics/view',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:location.pathname}),keepalive:true}).catch(()=>{});
}).catch(()=>{});
