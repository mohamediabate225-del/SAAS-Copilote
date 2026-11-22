import { db } from './storage.js';
import { equalSecret, limitRequests } from './security.js';
db.exec(`CREATE TABLE IF NOT EXISTS operational_metrics(day TEXT NOT NULL,kind TEXT NOT NULL,route TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,total_ms INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,kind,route));`);
function count(kind,route,ms=0){db.prepare('INSERT INTO operational_metrics VALUES(?,?,?,1,?) ON CONFLICT(day,kind,route) DO UPDATE SET count=count+1,total_ms=total_ms+excluded.total_ms').run(new Date().toISOString().slice(0,10),kind,route,ms);}
export function monitorRequests(req,res,next){
  const started=performance.now();
  res.on('finish',()=>{
    const route=typeof req.route?.path==='string'?req.route.path:'other';
    if(route.startsWith('/api/'))count(res.statusCode>=500?'server_error':res.statusCode===429||res.statusCode===402?'limit':'api',route,Math.round(performance.now()-started));
  });next();
}
export function registerMonitoring(app){
  const pages=new Set(['/','/landing.html','/tarifs.html','/connexion.html','/demo.html','/entrainement.html','/dashboard.html','/compte.html']);
  app.get('/api/analytics/config',(_req,res)=>res.json({enabled:process.env.ANALYTICS_ENABLED==='true'}));
  app.post('/api/analytics/view',limitRequests({limit:30,windowMs:60000}),(req,res)=>{
    if(process.env.ANALYTICS_ENABLED==='true'&&pages.has(req.body?.page))count('page_view',req.body.page);
    res.sendStatus(204);
  });
  app.get('/api/operations',(req,res)=>{
    const expected=process.env.MONITORING_KEY;
    if(!expected||!equalSecret(req.get('x-monitoring-key')||'',expected))return res.sendStatus(403);
    res.json(db.prepare("SELECT * FROM operational_metrics WHERE day>=date('now','-30 days') ORDER BY day DESC").all());
  });
}
