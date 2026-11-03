import { performance } from 'node:perf_hooks';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { openDB } from '../src/db.js';
import { createApp } from '../src/server.js';
import { planRoute } from '../src/domain.js';
const db=await openDB({driver:'sqlite',filename:':memory:'});const runtime=await createApp({db,worker:false});
const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
const login=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'WareFlow2026!'})});const Cookie=login.headers.get('set-cookie');
for(let i=0;i<10;i++)await fetch(url+'/api/state',{headers:{Cookie}});
const durations=[];let errors=0;const started=performance.now();
await Promise.all(Array.from({length:10},async()=>{for(let i=0;i<10;i++){const t=performance.now();const r=await fetch(url+'/api/state',{headers:{Cookie}});await r.json();if(r.status!==200)errors++;durations.push(performance.now()-t);}}));
const elapsed=performance.now()-started;durations.sort((a,b)=>a-b);
let seed=20261103;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};const locations=await db.all('SELECT * FROM locations');
let baseline=0,optimized=0,improved=0;const routeCases=[];
for(let i=0;i<1000;i++){const chosen=[...locations].sort(()=>0);for(let j=chosen.length-1;j>0;j--){const k=Math.floor(random()*(j+1));[chosen[j],chosen[k]]=[chosen[k],chosen[j]];}const points=chosen.slice(0,3+Math.floor(random()*8));const r=planRoute(points);baseline+=r.baseline;optimized+=r.distance;if(r.saved>0)improved++;if(i<5)routeCases.push({locations:points.map(p=>p.id),...r});}
const result={executed_at:new Date().toISOString(),environment:{os:process.platform,node:process.version,driver:'sqlite',data:'seed.js initialized 8 SKUs / 18 locations / 5 orders'},http:{requests:100,concurrency:10,warmup:10,errors,elapsed_ms:elapsed,mean_ms:durations.reduce((s,n)=>s+n,0)/100,p95_ms:durations[94],max_ms:durations[99],requests_per_second:100/(elapsed/1000)},route:{seed:20261103,cases:1000,points_per_case:'3~10 unique seeded warehouse locations',baseline_total:baseline,optimized_total:optimized,saved_total:baseline-optimized,saving_percent:(baseline-optimized)/baseline*100,improved_cases:improved,samples:routeCases},limitations:'同机小数据基准，不代表真实生产吞吐；路线为无障碍双向网格步长，不代表实际仓库行走米数。'};
writeFileSync('docs/benchmark-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify({http:result.http,route:{...result.route,samples:undefined}},null,2));server.close();runtime.stop();await db.close();
