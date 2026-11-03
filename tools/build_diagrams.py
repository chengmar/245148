from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'uml'
OUT.mkdir(parents=True, exist_ok=True)
diagrams = {
'01-usecase-warehouse': r'''
left to right direction
actor 作业员 as Operator
actor 主管 as Admin
actor 观察员 as Viewer
rectangle 仓储业务边界 {
 usecase "UC01 登记批次入库" as In
 usecase "UC02 查询库存与效期" as Stock
 usecase "UC03 版本校验盘点" as Count
 usecase "UC04 创建出库订单" as Create
 usecase "UC05 FEFO库存预留" as Reserve
 usecase "UC06 路线查看与拣货确认" as Pick
 usecase "UC07 复核出库" as Ship
 usecase "UC08 取消订单释放库存" as Cancel
}
Admin --|> Operator
Operator --> In
Operator --> Stock
Operator --> Create
Operator --> Reserve
Operator --> Pick
Operator --> Ship
Operator --> Cancel
Admin --> Count
Viewer --> Stock
''',
'02-usecase-collaboration': r'''
left to right direction
actor 作业员 as Operator
actor 主管 as Admin
actor 观察员 as Viewer
actor "模拟温度设备\n通过本地作业页面上报" as Sensor
rectangle 协同与验证边界 {
 usecase "UC09 物流轨迹查询与模拟更新" as Trace
 usecase "UC10 温度采样与异常告警" as Temp
 usecase "UC11 告警处理" as Alert
 usecase "UC12 事件查询与故障演练" as Event
 usecase "UC13 库存与事件链校验" as Check
}
Operator --> Trace
Operator --> Temp
Sensor --> Temp
Admin --> Trace
Admin --> Alert
Admin --> Event
Admin --> Check
Viewer --> Trace
Viewer --> Event : 只读查询
Viewer --> Check
''',
'03-domain-model': r'''
hide methods
class Product { id: SKU\n name: string\n min_stock: int\n cold: bool }
class Location { id: string\n zone: string\n capacity: int\n x,y: int }
class Lot { id: UUID\n batch: string\n expiry: date\n on_hand: int\n reserved: int\n version: int }
class Receipt { id: string\n qty: int\n supplier: string }
class Order { id: string\n customer: string\n status: OrderStatus }
class OrderLine { qty: int }
class Allocation { qty: int }
class StockMove { kind: string\n delta_hand: int\n delta_reserved: int }
class OutboxEvent { seq: int\n type: string\n payload: JSON\n hash: SHA256\n status: string }
class Shipment { id: string\n status: string }
class Tracking { status: string\n message: string }
Product "1" -- "0..*" Lot
Location "1" -- "0..*" Lot
Lot "1" -- "0..*" Receipt
Order "1" *-- "1..*" OrderLine
Product "1" -- "0..*" OrderLine
Order "1" -- "0..*" Allocation
Lot "1" -- "0..*" Allocation
Lot "1" -- "0..*" StockMove
Order "0..1" -- "0..*" StockMove
Order "1" -- "0..1" Shipment
Shipment "1" *-- "1..*" Tracking
OutboxEvent ..> Order : aggregate_id
OutboxEvent ..> Lot : aggregate_id
note bottom of Lot
 0 <= reserved <= on_hand
 available = on_hand - reserved
end note
''',
'04-package-architecture': r'''
top to bottom direction
package "表现层 public" {
 [Bootstrap工作台与SVG货位视图] as UI
}
package "接口层 server.js" {
 [Express REST路由] as API
 [Cookie会话与角色授权] as Auth
}
package "应用与领域层 domain.js" {
 [幂等命令 command] as CMD
 [库存与订单领域操作] as Domain
 [Outbox事件消费者 dispatch] as Worker
 [一致性与摘要校验 reconcile] as Verify
}
package "基础设施 db.js" {
 [事务连接与写锁] as TX
 [SQLite适配器] as SQLite
 [MySQL适配器] as MySQL
}
UI --> API : 同源JSON API
API --> Auth
API --> CMD
CMD --> Domain
Domain --> TX : 库存+流水+事件
Worker --> TX : 轮询事件并生成运单
Verify --> TX : 一致快照
TX --> SQLite
TX --> MySQL
note right of Worker
 事件驱动的模块化单体
 通过持久化Outbox解耦
 不依赖外部消息中间件
end note
''',
'05-deployment': r'''
left to right direction
node "浏览器终端" as Client { artifact "public\nHTML JS Bootstrap" as Web }
node "Docker宿主机" as Host {
 node "app容器 Node.js 24" as App {
  artifact "Express API" as API
  artifact "Outbox轮询消费者" as Worker
  artifact "模拟物流适配逻辑" as Mock
 }
 database "mysql容器\nMySQL 8.4 InnoDB\n持久化卷" as DB
}
node "可能的边缘设备部署\n扩展设计 尚未接入" as Edge {
 node "扫码枪 RFID网关" as RFID
 node "冷链温度传感器" as Sensor
}
Web --> API : HTTP localhost:3210\n对外部署需HTTPS反向代理
API --> DB : mysql2 / 事务 / 参数化SQL
Worker --> DB : 读取Outbox 写运单
Worker --> Mock : OrderShipped
Sensor ..> API : 未来 网关认证后转HTTPS
RFID ..> API : 未来 入库扫描协议适配
note bottom of Host
 已实现：本机SQLite模式或MySQL容器模式
 本图虚线为扩展部署 不代表真实硬件已接入
end note
''',
'06-robustness': r'''
left to right direction
actor 作业员 as User
boundary "订单工作台\npublic/app.js" as UI
boundary "REST路由\nserver.js" as API
control "幂等命令\ncommand" as Command
control "库存分配\norderAction" as Reserve
entity Order
entity Lot
entity Allocation
entity StockMove
entity OutboxEvent
User --> UI
UI --> API
API --> Command
Command --> Reserve
Reserve --> Order
Reserve --> Lot
Reserve --> Allocation
Reserve --> StockMove
Reserve --> OutboxEvent
note bottom of Reserve
 同一数据库事务
 任一商品不足则全部回滚
end note
''',
'07-sequence-receive': r'''
actor 作业员 as User
boundary 工作台 as UI
control REST路由 as API
control command as CMD
control receive as Domain
database DB
User -> UI : 填写批次 数量 效期 货位
UI -> API : POST /api/receipts\nIdempotency-Key
API -> API : 会话与角色校验
API -> CMD : scope + 请求指纹
CMD -> DB : BEGIN + 锁行
CMD -> DB : 查询幂等记录
alt 已有同键同指纹
 DB --> CMD : 原响应
else 新命令
 CMD -> Domain : receive(tx,input)
 Domain -> DB : 检查商品 货位 冷链 库容
 Domain -> DB : 写批次 入库单 库存流水
 Domain -> DB : 写StockReceived与事件哈希
 Domain --> CMD : 入库结果
 CMD -> DB : 写幂等响应
end
CMD -> DB : COMMIT
CMD --> API : 首次结果或原响应
API --> UI : JSON
UI --> User : 更新库存快照
note over CMD,DB : 业务错误时ROLLBACK 无残留库存与事件
''',
'08-sequence-shipping': r'''
actor 作业员 as User
boundary 工作台 as UI
control "订单命令" as API
database DB
control "dispatch消费者" as Worker
User -> UI : 复核出库
UI -> API : POST /orders/{id}/ship
API -> DB : BEGIN + 锁行
API -> DB : 校验PICKED状态
API -> DB : on_hand -= qty\nreserved -= qty
API -> DB : 写SHIP流水 OrderShipped事件\n写幂等响应
API -> DB : COMMIT
API --> UI : SHIPPED
... 周期消费 1.5秒 ...
Worker -> DB : BEGIN + 锁行
Worker -> DB : 读取到期PENDING/RETRY
Worker -> DB : 根据order_id查询运单
alt 尚未创建
 Worker -> DB : 写Shipment与首次Tracking
else 已存在
 Worker -> Worker : 跳过重复副作用
end
Worker -> DB : 标记事件DONE并COMMIT
UI -> DB : 经API刷新快照
DB --> UI : 运单及物流时间线
note over Worker,DB
 运单唯一约束与消费确认同事务
 异常回滚后可重试
end note
''',
'09-activity-reserve': r'''
start
:进入command事务并获得写锁;
:校验订单为CREATED;
while (还有订单行?) is (是)
 :筛选有效批次并按FEFO排序;
 :逐批条件预留并写分配与流水;
 note right
  take = min(remaining, available)
  增加reserved 减少remaining
  记录Allocation和RESERVE流水
 end note
 if (remaining大于0?) then (是)
  :抛出库存不足错误;
  :ROLLBACK整单所有变更;
  stop
 endif
endwhile (否)
:改为RESERVED并写事件与幂等响应;
:COMMIT全部变更;
stop
''',
'10-state-order': r'''
hide empty description
[*] --> CREATED : 创建
CREATED --> RESERVED : reserve 全部商品可分配
CREATED --> CREATED : 库存不足 整单回滚
RESERVED --> PICKED : pick 拣货确认
PICKED --> SHIPPED : ship 实物扣减并发出事件
SHIPPED --> DELIVERED : 物流IN_TRANSIT后签收
CREATED --> CANCELLED : cancel
RESERVED --> CANCELLED : cancel 释放预留
PICKED --> CANCELLED : cancel 释放预留并人工归位
CANCELLED --> [*]
DELIVERED --> [*]
note right of SHIPPED
 不允许直接取消
 退货与逆向物流未纳入本次范围
end note
''',
'11-activity-outbox': r'''
start
:业务事务提交Outbox;
:worker读取到期事件;
if (模拟消费故障?) then (是)
 :attempts加1;
 if (attempts大于等于5?) then (是)
  :进入DEAD队列;
  :管理员重放后attempts归零;
 else (否)
  :RETRY 指数退避最长60秒;
 endif
else (否)
 if (OrderShipped?) then (是)
  :检查唯一order_id运单;
  :不存在则创建运单及轨迹;
 endif
 :标记DONE;
endif
:事务提交;
stop
'''
}
import re
for name, content in diagrams.items():
    content = re.sub(r'(class \w+) \{ (.*?) \}', lambda m: m.group(1)+' {\n'+m.group(2).replace(r'\n','\n')+'\n}', content)
    content = content.replace('as Client { artifact', 'as Client {\n artifact').replace('as Web }','as Web\n}')
    (OUT / (name+'.puml')).write_text('@startuml\n!pragma layout smetana\nskinparam dpi 170\nskinparam defaultFontName Microsoft YaHei\nskinparam defaultFontSize 13\nskinparam backgroundColor white\nskinparam shadowing false\nskinparam roundcorner 8\nskinparam ArrowColor #50665B\nskinparam classBackgroundColor #F0F4EE\nskinparam packageBackgroundColor #F8FAF6\nskinparam sequenceMessageAlign center\n'+content+'\n@enduml\n',encoding='utf-8')
print(f'{len(diagrams)} PlantUML sources created')
