import { randomUUID, createHash } from 'node:crypto';
export const uid=()=>randomUUID();
export const now=()=>new Date().toISOString();
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const hash=x=>createHash('sha256').update(x).digest('hex');
export class BusinessError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const check=(condition,message,status=400)=>{if(!condition)throw new BusinessError(message,status);};
const qty=q=>check(Number.isSafeInteger(q)&&q>0&&q<=100000,'数量须为 1 至 100000 的整数');
const text=(v,max=128)=>check(typeof v==='string'&&v.trim().length>0&&v.length<=max,'文字内容为空或超出长度限制');
export const eventHash=e=>hash([e.seq,e.type,e.aggregate_id,e.payload,e.created_at,e.previous_hash].join('|'));
export async function emit(tx,type,aggregate,payload){
  const last=await tx.get('SELECT seq,hash FROM outbox ORDER BY seq DESC LIMIT 1');
  const e={id:uid(),seq:(last?.seq||0)+1,type,aggregate_id:aggregate,payload:JSON.stringify(payload),created_at:now(),previous_hash:last?.hash||'GENESIS'};
  e.hash=eventHash(e);
  await tx.run('INSERT INTO outbox (id,seq,type,aggregate_id,payload,created_at,previous_hash,hash,status,attempts,available_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[e.id,e.seq,e.type,e.aggregate_id,e.payload,e.created_at,e.previous_hash,e.hash,'PENDING',0,e.created_at]);
  return e.id;
}
async function move(tx,lot,order,kind,dh,dr,reason){
  await tx.run('UPDATE lots SET on_hand=on_hand+?,reserved=reserved+?,version=version+1 WHERE id=?',[dh,dr,lot]);
  await tx.run('INSERT INTO stock_moves VALUES (?,?,?,?,?,?,?,?)',[uid(),lot,order,kind,dh,dr,reason,now()]);
}
// 所有写入、流水、领域事件、幂等响应在同一事务提交。
export async function command(db,key,scope,input,fn){
  check(typeof key==='string'&&key.length>=8&&key.length<=64,'需要 8 至 64 字符的 Idempotency-Key');
  const fingerprint=hash(JSON.stringify([scope,input]));
  return db.tx(async tx=>{
    const old=await tx.get('SELECT * FROM idempotency WHERE id=?',[key]);
    if(old){check(old.fingerprint===fingerprint,'幂等键已用于其他请求',409);return JSON.parse(old.response);}
    const result=await fn(tx);
    await tx.run('INSERT INTO idempotency VALUES (?,?,?,?)',[key,fingerprint,JSON.stringify(result),now()]);
    return result;
  });
}
export async function receive(tx,input){
  const {product_id,location_id,batch,expiry,quantity,supplier}=input;
  qty(quantity);text(batch,64);text(supplier);
  check(/^\d{4}-\d{2}-\d{2}$/.test(expiry)&&!Number.isNaN(Date.parse(expiry))&&new Date(expiry).toISOString().slice(0,10)===expiry&&expiry>today(),'效期须为未来的有效日期');
  const p=await tx.get('SELECT * FROM products WHERE id=?',[product_id]);
  const loc=await tx.get('SELECT * FROM locations WHERE id=?',[location_id]);
  check(p&&loc,'商品或货位不存在',404);check(!p.cold||loc.cold,'冷链商品必须放入冷链货位',409);
  const used=await tx.get('SELECT COALESCE(SUM(on_hand),0) AS n FROM lots WHERE location_id=?',[location_id]);
  check(Number(used.n)+quantity<=loc.capacity,'货位容量不足',409);
  let lot=await tx.get('SELECT * FROM lots WHERE product_id=? AND location_id=? AND batch=?',[product_id,location_id,batch]);
  if(lot)check(lot.expiry===expiry,'同批次效期不一致',409);
  else{lot={id:uid()};await tx.run('INSERT INTO lots (id,product_id,location_id,batch,expiry) VALUES (?,?,?,?,?)',[lot.id,product_id,location_id,batch,expiry]);}
  await move(tx,lot.id,null,'RECEIVE',quantity,0,'供应商 '+supplier);
  const id='IN-'+uid().slice(0,8).toUpperCase();
  await tx.run('INSERT INTO receipts VALUES (?,?,?,?,?)',[id,lot.id,quantity,supplier,now()]);
  await emit(tx,'StockReceived',lot.id,{receipt_id:id,quantity,product_id,location_id});
  return {id,lot_id:lot.id,quantity};
}
export async function createOrder(tx,{customer,destination,priority='NORMAL',lines}){
  text(customer);text(destination);check(['NORMAL','HIGH'].includes(priority),'优先级无效');
  check(Array.isArray(lines)&&lines.length>0&&lines.length<=20,'订单需要 1 至 20 行商品');
  check(new Set(lines.map(l=>l.product_id)).size===lines.length,'同一商品请合并数量');
  for(const line of lines){qty(line.qty);check(await tx.get('SELECT id FROM products WHERE id=?',[line.product_id]),'商品不存在',404);}
  const id='SO-'+uid().slice(0,8).toUpperCase();
  await tx.run('INSERT INTO orders VALUES (?,?,?,?,?,?)',[id,customer,destination,priority,'CREATED',now()]);
  for(const l of lines)await tx.run('INSERT INTO order_lines VALUES (?,?,?,?)',[uid(),id,l.product_id,l.qty]);
  await emit(tx,'OrderCreated',id,{customer,lines});return {id,status:'CREATED'};
}
export async function orderAction(tx,id,action){
  const order=await tx.get('SELECT * FROM orders WHERE id=?',[id]);check(order,'订单不存在',404);
  const allowed={reserve:['CREATED'],pick:['RESERVED'],ship:['PICKED'],cancel:['CREATED','RESERVED','PICKED']};
  check(allowed[action]?.includes(order.status),'当前状态不允许此操作',409);
  let status;
  if(action==='reserve'){
    const lines=await tx.all('SELECT * FROM order_lines WHERE order_id=? ORDER BY product_id',[id]);
    for(const line of lines){
      const lots=await tx.all('SELECT * FROM lots WHERE product_id=? AND expiry>? AND on_hand>reserved ORDER BY expiry,batch,location_id,id',[line.product_id,today()]);
      let remaining=line.qty;
      for(const lot of lots){const take=Math.min(remaining,lot.on_hand-lot.reserved);if(!take)continue;
        const result=await tx.run('UPDATE lots SET reserved=reserved+?,version=version+1 WHERE id=? AND on_hand-reserved>=?',[take,lot.id,take]);
        check(result.changes===1,'并发库存冲突，请重试',409);
        await tx.run('INSERT INTO stock_moves VALUES (?,?,?,?,?,?,?,?)',[uid(),lot.id,id,'RESERVE',0,take,'FEFO 批次分配',now()]);
        await tx.run('INSERT INTO allocations VALUES (?,?,?,?)',[uid(),id,lot.id,take]);remaining-=take;if(!remaining)break;
      }
      check(remaining===0,`商品 ${line.product_id} 可用库存不足，整单已回滚`,409);
    } status='RESERVED';
  }else if(action==='pick'){status='PICKED';}
  else{
    const allocations=await tx.all('SELECT * FROM allocations WHERE order_id=?',[id]);
    for(const a of allocations)await move(tx,a.lot_id,id,action==='ship'?'SHIP':'RELEASE',action==='ship'?-a.qty:0,-a.qty,action==='ship'?'复核出库':'取消释放');
    status=action==='ship'?'SHIPPED':'CANCELLED';
  }
  await tx.run('UPDATE orders SET status=? WHERE id=?',[status,id]);
  await emit(tx,{reserve:'InventoryReserved',pick:'OrderPicked',ship:'OrderShipped',cancel:'OrderCancelled'}[action],id,{order_id:id,status});
  return {id,status};
}
export async function countStock(tx,{lot_id,counted,version,reason}){
  check(Number.isSafeInteger(counted)&&counted>=0&&counted<=100000,'实盘数量须为 0 至 100000 的整数');text(reason,256);
  const lot=await tx.get('SELECT * FROM lots WHERE id=?',[lot_id]);check(lot,'批次不存在',404);
  check(lot.version===version,'库存已经变化，请刷新后重新盘点',409);check(counted>=lot.reserved,'盘点结果不能少于已预留数量',409);
  const loc=await tx.get('SELECT * FROM locations WHERE id=?',[lot.location_id]);
  const used=await tx.get('SELECT COALESCE(SUM(on_hand),0) AS n FROM lots WHERE location_id=?',[loc.id]);
  check(Number(used.n)-lot.on_hand+counted<=loc.capacity,'盘点结果超出货位容量',409);
  const delta=counted-lot.on_hand;await move(tx,lot.id,null,'COUNT',delta,0,reason);
  await emit(tx,'StockCounted',lot.id,{before:lot.on_hand,counted,delta,reason});return {lot_id,delta,counted};
}
export async function recordTemperature(tx,{device_id='COLD-01',temperature}){
  check(device_id==='COLD-01','设备不存在',404);check(typeof temperature==='number'&&Number.isFinite(temperature)&&temperature>=-50&&temperature<=80,'温度须在 -50 至 80 摄氏度');
  await tx.run('INSERT INTO readings VALUES (?,?,?,?)',[uid(),device_id,temperature,now()]);
  let alert_id=null;
  if(temperature<2||temperature>8){
    const existing=await tx.get("SELECT id FROM alerts WHERE kind='TEMPERATURE' AND status='OPEN'");
    if(!existing){alert_id=uid();await tx.run('INSERT INTO alerts VALUES (?,?,?,?,?,?)',[alert_id,'TEMPERATURE',`冷链区温度 ${temperature}°C 超出 2~8°C 阈值`,'OPEN',now(),null]);}
    else alert_id=existing.id;
  }
  await emit(tx,'TemperatureRecorded',device_id,{temperature,alert_id});return {temperature,alert_id};
}
export async function resolveAlert(tx,id){const a=await tx.get('SELECT * FROM alerts WHERE id=?',[id]);check(a&&a.status==='OPEN','告警不存在或已处理',409);await tx.run("UPDATE alerts SET status='RESOLVED',resolved_at=? WHERE id=?",[now(),id]);await emit(tx,'AlertResolved',id,{});return {id,status:'RESOLVED'};}
export async function trackingUpdate(tx,id,{status,message}){
  text(message,256);const s=await tx.get('SELECT * FROM shipments WHERE id=?',[id]);check(s,'运单不存在',404);
  const next={CREATED:'IN_TRANSIT',IN_TRANSIT:'DELIVERED'};
  check(next[s.status]===status,'物流状态乱序或重复',409);
  await tx.run('UPDATE shipments SET status=? WHERE id=?',[status,id]);
  await tx.run('INSERT INTO tracking VALUES (?,?,?,?,?)',[uid(),id,status,message,now()]);
  if(status==='DELIVERED')await tx.run("UPDATE orders SET status='DELIVERED' WHERE id=?",[s.order_id]);
  await emit(tx,'ShipmentUpdated',s.order_id,{shipment_id:id,status,message});return {id,status};
}
// 事务内消费：运单投影与消费确认一起提交；崩溃重启后可继续处理。
export async function dispatch(db,{fail=false,limit=30,force=false}={}){
  const safeLimit=Number.isInteger(limit)?Math.min(1000,Math.max(1,limit)):30;
  const due=force?'9999-12-31T00:00:00.000Z':now();
  const events=await db.tx(tx=>tx.all(`SELECT id FROM outbox WHERE status IN ('PENDING','RETRY') AND available_at<=? ORDER BY seq LIMIT ${safeLimit}`,[due]));
  let consumed=0,failed=0;
  for(const selected of events){
    try {const changed=await db.tx(async tx=>{
      const e=await tx.get('SELECT * FROM outbox WHERE id=?',[selected.id]);
      if(!e||!['PENDING','RETRY'].includes(e.status)||e.available_at>due)return false;
      if(fail)throw Error('演示故障：模拟物流消费不可用');
      if(e.type==='OrderShipped'){
        const old=await tx.get('SELECT id FROM shipments WHERE order_id=?',[e.aggregate_id]);
        if(!old){const id='WF-'+e.aggregate_id.slice(3);await tx.run('INSERT INTO shipments VALUES (?,?,?,?,?)',[id,e.aggregate_id,'WareFlow 模拟物流','CREATED',now()]);await tx.run('INSERT INTO tracking VALUES (?,?,?,?,?)',[uid(),id,'CREATED','仓库出库复核完成，电子运单已创建',now()]);}
      }
      await tx.run("UPDATE outbox SET status='DONE',attempts=attempts+1,error=NULL,consumed_at=? WHERE id=?",[now(),e.id]);return true;
    });if(changed)consumed++;
    }catch(error){
      // 副作用事务已回滚；独立事务保存失败次数，重启后仍可恢复。
      await db.tx(async tx=>{const e=await tx.get('SELECT * FROM outbox WHERE id=?',[selected.id]);if(!e||!['PENDING','RETRY'].includes(e.status))return;const attempts=e.attempts+1;await tx.run('UPDATE outbox SET attempts=?,status=?,error=?,available_at=? WHERE id=?',[attempts,attempts>=5?'DEAD':'RETRY',String(error.message).slice(0,256),new Date(Date.now()+Math.min(60000,1000*2**attempts)).toISOString(),e.id]);});failed++;
    }
  }return {consumed,failed};
}
export async function reconcile(db){
  return db.tx(async tx=>{
    const lots=await tx.all('SELECT * FROM lots');let differences=[];
    for(const l of lots){
      const sums=await tx.get('SELECT COALESCE(SUM(delta_hand),0) AS h,COALESCE(SUM(delta_reserved),0) AS r FROM stock_moves WHERE lot_id=?',[l.id]);
      const active=await tx.get("SELECT COALESCE(SUM(a.qty),0) AS n FROM allocations a JOIN orders o ON o.id=a.order_id WHERE a.lot_id=? AND o.status IN ('RESERVED','PICKED')",[l.id]);
      if(l.on_hand!==Number(sums.h)||l.reserved!==Number(sums.r)||l.reserved!==Number(active.n)||l.on_hand<l.reserved)differences.push({lot_id:l.id,on_hand:l.on_hand,ledger_hand:Number(sums.h),reserved:l.reserved,ledger_reserved:Number(sums.r),active_reserved:Number(active.n)});
    }
    const events=await tx.all('SELECT * FROM outbox ORDER BY seq');let previous='GENESIS',broken=[];
    for(let i=0;i<events.length;i++){const e=events[i];if(e.seq!==i+1||e.previous_hash!==previous||e.hash!==eventHash(e))broken.push(e.seq);previous=e.hash;}
    return {ok:differences.length===0&&broken.length===0,lots_checked:lots.length,events_checked:events.length,differences,broken_events:broken,checked_at:now()};
  });
}
export function planRoute(locations){
  const points=[...new Map(locations.map(l=>[l.id,l])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const start={id:'复核台',x:0,y:0};const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const length=route=>[start,...route,start].slice(1).reduce((s,p,i)=>s+dist([start,...route][i],p),0);
  const baseline=length(points);let left=[...points],route=[],current=start;
  while(left.length){left.sort((a,b)=>dist(current,a)-dist(current,b)||a.id.localeCompare(b.id));current=left.shift();route.push(current);}
  let improved=true;
  while(improved){improved=false;for(let i=0;i<route.length-1;i++)for(let j=i+1;j<route.length;j++){const alt=[...route.slice(0,i),...route.slice(i,j+1).reverse(),...route.slice(j+1)];if(length(alt)<length(route)){route=alt;improved=true;}}}
  if(length(route)>baseline)route=points;
  return {points:[start,...route,start],distance:length(route),baseline,saved:baseline-length(route),method:'最近邻 + 2-opt；曼哈顿距离，单位为网格步长'};
}
