import { uid,receive,createOrder,orderAction,recordTemperature,dispatch } from './domain.js';
import { passwordHash } from './auth.js';
export async function seed(db){
  if(await db.get('SELECT id FROM products LIMIT 1'))return;
  const date=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
  await db.tx(async tx=>{
    for(const [username,role,name] of [['admin','ADMIN','仓储主管'],['operator','OPERATOR','仓库作业员'],['viewer','VIEWER','业务观察员']])await tx.run('INSERT INTO users VALUES (?,?,?,?,?)',[uid(),username,passwordHash('WareFlow2026!'),role,name]);
    const products=[['SKU-001','有机燕麦奶','食品饮料','箱',40,0],['SKU-002','冷萃咖啡原液','冷链饮品','箱',30,1],['SKU-003','全麦能量棒','食品饮料','盒',60,0],['SKU-004','便携保温杯','生活器具','个',25,0],['SKU-005','益生菌酸奶','冷链食品','箱',50,1],['SKU-006','可降解包装袋','包装耗材','包',80,0],['SKU-007','无糖气泡水','食品饮料','箱',40,0],['SKU-008','智能温湿度计','电子设备','台',15,0]];
    for(const p of products)await tx.run('INSERT INTO products VALUES (?,?,?,?,?,?)',p);
    for(const [z,x,cold] of [['A',3,0],['B',7,0],['C',11,1]])for(let y=1;y<=6;y++)await tx.run('INSERT INTO locations VALUES (?,?,?,?,?,?)',[`${z}-${String(y).padStart(2,'0')}`,z,x,y*2,500,cold]);
    const stocks=[['SKU-001','A-01',180,100],['SKU-001','B-04',90,35],['SKU-002','C-01',110,45],['SKU-003','A-03',230,140],['SKU-003','B-01',100,28],['SKU-004','B-03',68,365],['SKU-005','C-04',130,18],['SKU-005','C-06',80,30],['SKU-006','B-06',42,700],['SKU-007','A-06',160,160],['SKU-008','B-02',36,700]];
    for(const [p,l,n,d] of stocks)await receive(tx,{product_id:p,location_id:l,batch:'DEMO-'+l,expiry:date(d),quantity:n,supplier:'演示供应商'});
    const sample=[['天津滨海前置仓','天津市滨海新区','HIGH',[['SKU-001',24],['SKU-003',32],['SKU-005',12]],'reserve'],['北京朝阳门店','北京市朝阳区','NORMAL',[['SKU-002',18],['SKU-004',8]],'pick'],['石家庄裕华站','河北省石家庄市','NORMAL',[['SKU-001',16],['SKU-007',20]],'ship'],['雄安新区服务点','河北省雄安新区','HIGH',[['SKU-005',18],['SKU-008',4]],null],['廊坊广阳门店','河北省廊坊市','NORMAL',[['SKU-003',24],['SKU-006',10]],null]];
    for(const [customer,destination,priority,lines,action] of sample){const order=await createOrder(tx,{customer,destination,priority,lines:lines.map(([product_id,qty])=>({product_id,qty}))});if(action){await orderAction(tx,order.id,'reserve');if(['pick','ship'].includes(action))await orderAction(tx,order.id,'pick');if(action==='ship')await orderAction(tx,order.id,'ship');}}
    for(const temperature of [4.2,4.5,4.1,5.0,4.7,4.4,4.6,4.3])await recordTemperature(tx,{temperature});
  });
  await dispatch(db,{limit:100});
}
