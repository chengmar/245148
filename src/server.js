import express from 'express';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDB } from './db.js';
import { seed } from './seed.js';
import { verifyPassword } from './auth.js';
import { BusinessError,command,receive,createOrder,orderAction,countStock,recordTemperature,resolveAlert,trackingUpdate,dispatch,reconcile,planRoute,now } from './domain.js';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function createApp({db,worker=true}={}){
  db ||= await openDB();await seed(db);
  const app=express();app.disable('x-powered-by');let workerPaused=false;
  app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"});next();});
  app.use(express.json({limit:'100kb'}));
  app.use('/vendor/bootstrap',express.static(resolve(root,'node_modules/bootstrap/dist/css')));
  app.use(express.static(resolve(root,'public')));
  app.get('/api/health',async(req,res)=>{await db.get('SELECT id FROM system_lock');res.json({status:'ok',driver:db.driver,version:'1.0.0'});});
  const attempts=new Map();
  app.post('/api/login',async(req,res)=>{
    const {username,password}=req.body;
    if(typeof username!=='string'||typeof password!=='string'||username.length>64||password.length>128)throw new BusinessError('请输入有效账号和密码');
    const ip=req.ip;const limit=attempts.get(ip);
    if(limit&&limit.until>Date.now()&&limit.count>=10)throw new BusinessError('尝试次数过多，请 5 分钟后再试',429);
    const user=await db.get('SELECT * FROM users WHERE username=?',[username]);
    if(!user||!verifyPassword(password,user.password_hash)){const r=limit&&limit.until>Date.now()?limit:{count:0,until:Date.now()+300000};r.count++;attempts.set(ip,r);throw new BusinessError('账号或密码错误',401);}
    attempts.delete(ip);
    const token=randomBytes(32).toString('hex');
    await db.tx(tx=>tx.run('INSERT INTO sessions VALUES (?,?,?)',[token,user.id,new Date(Date.now()+8*3600000).toISOString()]));
    res.cookie('wf_session',token,{httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='1',maxAge:8*3600000,path:'/'});res.json({name:user.name,role:user.role,username:user.username});
  });
  app.use('/api',async(req,res,next)=>{
    // 同源写入约束：跨站浏览器请求不能带着 cookie 发起操作。
    if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==`${req.protocol}://${req.get('host')}`)throw new BusinessError('拒绝跨站写入',403);
    const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('wf_session='))?.slice(11);
    const user=token&&await db.get('SELECT u.id,u.username,u.role,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?',[token,now()]);
    if(!user)throw new BusinessError('请先登录',401);req.user=user;next();
  });
  const allow=(...roles)=>(req,res,next)=>{if(!roles.includes(req.user.role))throw new BusinessError('此账号无操作权限',403);next();};
  const write=(scope,fn)=>async(req,res)=>res.json(await command(db,req.get('Idempotency-Key'),`${req.user.id}:${scope}:${req.params.id||''}`,req.body,tx=>fn(tx,req)));
  app.get('/api/me',(req,res)=>res.json(req.user));
  app.post('/api/logout',async(req,res)=>{const token=req.headers.cookie?.match(/wf_session=([^;]+)/)?.[1];await db.tx(tx=>tx.run('DELETE FROM sessions WHERE id=?',[token]));res.clearCookie('wf_session');res.json({ok:true});});
  app.get('/api/state',async(req,res)=>{
    // 快照读事务避免读到一次写事务的中间状态。
    const state=await db.tx(async tx=>({
      products:await tx.all('SELECT * FROM products ORDER BY id'),locations:await tx.all('SELECT * FROM locations ORDER BY id'),
      lots:await tx.all('SELECT * FROM lots ORDER BY expiry,product_id'),orders:await tx.all('SELECT * FROM orders ORDER BY created_at DESC'),
      lines:await tx.all('SELECT * FROM order_lines'),allocations:await tx.all('SELECT * FROM allocations'),
      receipts:await tx.all('SELECT * FROM receipts ORDER BY created_at DESC LIMIT 60'),
      moves:await tx.all('SELECT * FROM stock_moves ORDER BY created_at DESC LIMIT 120'),
      events:await tx.all('SELECT * FROM outbox ORDER BY seq DESC LIMIT 200'),
      shipments:await tx.all('SELECT * FROM shipments ORDER BY created_at DESC'),tracking:await tx.all('SELECT * FROM tracking ORDER BY created_at'),
      readings:await tx.all('SELECT * FROM readings ORDER BY created_at DESC LIMIT 20'),alerts:await tx.all('SELECT * FROM alerts ORDER BY created_at DESC'),
      event_counts:await tx.all('SELECT status,COUNT(*) AS n FROM outbox GROUP BY status'),driver:db.driver,generated_at:now(),worker_paused:workerPaused
    }));res.json(state);
  });
  app.get('/api/orders/:id/route',async(req,res)=>{const locs=await db.all('SELECT DISTINCT l.id,l.x,l.y FROM allocations a JOIN lots b ON b.id=a.lot_id JOIN locations l ON l.id=b.location_id WHERE a.order_id=?',[req.params.id]);res.json(planRoute(locs));});
  app.get('/api/reconcile',async(req,res)=>res.json(await reconcile(db)));
  app.post('/api/receipts',allow('ADMIN','OPERATOR'),write('receive',(tx,req)=>receive(tx,req.body)));
  app.post('/api/orders',allow('ADMIN','OPERATOR'),write('create-order',(tx,req)=>createOrder(tx,req.body)));
  for(const action of ['reserve','pick','ship','cancel'])app.post(`/api/orders/:id/${action}`,allow('ADMIN','OPERATOR'),write(action,(tx,req)=>orderAction(tx,req.params.id,action)));
  app.post('/api/counts',allow('ADMIN'),write('count',(tx,req)=>countStock(tx,req.body)));
  app.post('/api/readings',allow('ADMIN','OPERATOR'),write('reading',(tx,req)=>recordTemperature(tx,req.body)));
  app.post('/api/alerts/:id/resolve',allow('ADMIN'),write('alert',(tx,req)=>resolveAlert(tx,req.params.id)));
  app.post('/api/shipments/:id/tracking',allow('ADMIN','OPERATOR'),write('tracking',(tx,req)=>trackingUpdate(tx,req.params.id,req.body)));
  // 故障注入只影响本次手动消费，不影响自动 worker 配置。
  app.post('/api/events/dispatch',allow('ADMIN'),async(req,res)=>{if(typeof req.body.fail!=='boolean')throw new BusinessError('fail 须为布尔值');res.json(await dispatch(db,{fail:req.body.fail,force:true,limit:200}));});
  app.post('/api/events/worker',allow('ADMIN'),(req,res)=>{if(typeof req.body.paused!=='boolean')throw new BusinessError('paused 须为布尔值');workerPaused=req.body.paused;res.json({paused:workerPaused});});
  app.post('/api/events/:id/retry',allow('ADMIN'),write('retry',async(tx,req)=>{const e=await tx.get('SELECT * FROM outbox WHERE id=?',[req.params.id]);if(!e||e.status!=='DEAD')throw new BusinessError('只能重放死信事件',409);await tx.run("UPDATE outbox SET status='RETRY',attempts=0,available_at=? WHERE id=?",[now(),e.id]);return {id:e.id,status:'RETRY'};}));
  app.use((req,res)=>res.status(404).json({error:'接口或资源不存在'}));
  app.use((error,req,res,next)=>{const status=error.status||500;if(status>=500)console.error(error);res.status(status).json({error:status>=500?'服务内部错误，请查看服务日志':error.message});});
  let ticking=false;const timer=worker?setInterval(async()=>{if(ticking||workerPaused)return;ticking=true;try{await dispatch(db);}catch(error){console.error('worker',error.message);}finally{ticking=false;}},1500):null;
  timer?.unref();return {app,db,stop:()=>clearInterval(timer)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const runtime=await createApp({worker:process.env.WORKER_DISABLED!=='1'});const port=Number(process.env.PORT||3210);
  const server=runtime.app.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`WareFlow http://localhost:${port} (${runtime.db.driver})`));
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{runtime.stop();server.close(async()=>{await runtime.db.close();process.exit(0);});});
}
