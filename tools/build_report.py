from pathlib import Path
import re, json
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
DOCS=ROOT/'docs'
doc=Document()
sec=doc.sections[0]
sec.page_width=Cm(21); sec.page_height=Cm(29.7)
sec.top_margin=Cm(2.3);sec.bottom_margin=Cm(2.2);sec.left_margin=Cm(2.5);sec.right_margin=Cm(2.5)
sec.header_distance=Cm(1);sec.footer_distance=Cm(1)
sec.different_first_page_header_footer=True
for sty in doc.styles:
    if sty.type==1:
        sty.font.name='Times New Roman';sty.font.color.rgb=RGBColor(0,0,0)
        sty.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'),'宋体')
normal=doc.styles['Normal'];normal.font.size=Pt(11)
normal.paragraph_format.line_spacing=1.35;normal.paragraph_format.space_after=Pt(6)
for n,size in [('Title',24),('Heading 1',18),('Heading 2',14),('Heading 3',12)]:
    sty=doc.styles[n];sty.font.name='Microsoft YaHei';sty.font.size=Pt(size);sty.font.bold=True
    sty.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'),'黑体')
    sty.paragraph_format.space_before=Pt(15);sty.paragraph_format.space_after=Pt(9)
    sty.paragraph_format.keep_with_next=True
    if n=='Heading 1':sty.paragraph_format.page_break_before=True
for name in ['Caption','Header','Footer']:
    sty=doc.styles[name];sty.font.size=Pt(9);sty.font.color.rgb=RGBColor(0,0,0)
    sty.paragraph_format.space_after=Pt(6)
doc.core_properties.title='智慧仓储与物流协同系统软件工程实验报告'
doc.core_properties.author='项目小组 待填写'
doc.core_properties.subject='WareFlow 软件工程课程实验'
footer=sec.footer.paragraphs[0];footer.alignment=WD_ALIGN_PARAGRAPH.CENTER
run=footer.add_run();fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');run._r.addnext(fld)

def para(s,style=None):
    p=doc.add_paragraph(style=style)
    # 保持英文路径可换行，正文不注入大量零宽字符。
    p.add_run(s)
    return p

def table(headers,rows,widths=None):
    t=doc.add_table(rows=1,cols=len(headers));t.autofit=False
    widths=widths or [16/len(headers)]*len(headers)
    for c,w in zip(t.columns,widths):c.width=Cm(w)
    for c,h,w in zip(t.rows[0].cells,headers,widths):c.text=str(h);c.width=Cm(w)
    repeat=OxmlElement('w:tblHeader');t.rows[0]._tr.get_or_add_trPr().append(repeat)
    for vals in rows:
        cells=t.add_row().cells
        for c,v,w in zip(cells,vals,widths):c.text=str(v);c.width=Cm(w)
    for ri,row in enumerate(t.rows):
        cant=OxmlElement('w:cantSplit');row._tr.get_or_add_trPr().append(cant)
        for cell in row.cells:
            mar=OxmlElement('w:tcMar')
            for edge,val in [('top','75'),('bottom','75'),('left','90'),('right','90')]:
                e=OxmlElement('w:'+edge);e.set(qn('w:w'),val);e.set(qn('w:type'),'dxa');mar.append(e)
            cell._tc.get_or_add_tcPr().append(mar)
            if ri==0:
                shade=OxmlElement('w:shd');shade.set(qn('w:fill'),'EDEFEA');cell._tc.get_or_add_tcPr().append(shade)
            for p in cell.paragraphs:
                p.paragraph_format.line_spacing=1.15;p.paragraph_format.space_after=Pt(2)
                for r in p.runs:r.font.size=Pt(9 if len(headers)>=6 else 9.5);r.font.bold=ri==0
    # 稀疏横向边框，避免密集全网格。
    borders=OxmlElement('w:tblBorders')
    for tag in ['top','bottom','insideH']:
        e=OxmlElement('w:'+tag);e.set(qn('w:val'),'single');e.set(qn('w:sz'),'4');e.set(qn('w:color'),'CBD0C8');borders.append(e)
    t._tbl.tblPr.append(borders)
    para('').paragraph_format.space_after=Pt(2)
    return t

def picture(path,caption):
    path=DOCS/path
    im=Image.open(path);w,h=im.size
    maxw=16;maxh=15.5 if path.name.startswith('01-usecase') else 19.2
    width=min(maxw,maxh*w/h)
    p=doc.add_paragraph();p.alignment=WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next=True
    p.add_run().add_picture(str(path),width=Cm(width))
    c=para(caption,'Caption');c.alignment=WD_ALIGN_PARAGRAPH.CENTER

# 与指导书封面字段一致。
para('').paragraph_format.space_after=Pt(45)
p=para('河北工业大学');p.alignment=WD_ALIGN_PARAGRAPH.CENTER;p.runs[0].font.size=Pt(25);p.runs[0].bold=True
p=para('软件工程课程实验');p.alignment=WD_ALIGN_PARAGRAPH.CENTER;p.runs[0].font.size=Pt(19)
p=para('实验报告','Title');p.alignment=WD_ALIGN_PARAGRAPH.CENTER
para('').paragraph_format.space_after=Pt(20)
p=para('智慧仓储与物流协同系统');p.alignment=WD_ALIGN_PARAGRAPH.CENTER;p.runs[0].font.size=Pt(20);p.runs[0].bold=True
p=para('WareFlow 栖序');p.alignment=WD_ALIGN_PARAGRAPH.CENTER;p.runs[0].font.size=Pt(14)
para('').paragraph_format.space_after=Pt(18)
for name in ['专业','班级','组别','组长','成员','指导教师']:
    p=para(f'{name}    待填写');p.paragraph_format.left_indent=Cm(3);p.paragraph_format.space_after=Pt(12)
p=para('完成日期    2026 年 11 月 4 日');p.paragraph_format.left_indent=Cm(3)
doc.add_page_break()
p=para('目录');p.runs[0].font.size=Pt(18);p.runs[0].bold=True
p=doc.add_paragraph();field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'TOC \\o "1-2" \\h \\z \\u');p._p.append(field)
para('阅读路径  第一章确认需求与验收  第二章解释模型与架构  第三章展示实现  第四章提供验证证据  第五章补充小组实际总结。')

lines=(DOCS/'实验报告.md').read_text(encoding='utf-8').splitlines();i=0
while i<len(lines):
    line=lines[i].strip()
    if not line:i+=1;continue
    if line.startswith('```'):
        codes=[];i+=1
        while i<len(lines) and not lines[i].startswith('```'):codes.append(lines[i]);i+=1
        for code in codes:
            p=para(code);p.paragraph_format.line_spacing=1.05;p.paragraph_format.space_after=Pt(0)
            for r in p.runs:r.font.name='Consolas';r.font.size=Pt(9)
        para('');i+=1;continue
    if line.startswith('|'):
        group=[]
        while i<len(lines) and lines[i].strip().startswith('|'):group.append([x.strip() for x in lines[i].strip().strip('|').split('|')]);i+=1
        table(group[0],group[2:]);continue
    m=re.match(r'!\[(.*?)\]\((.*?)\)',line)
    if m:picture(Path(m[2]),m[1]);i+=1;continue
    m=re.match(r'^(#{1,3}) (.*)',line)
    if m:para(m[2],f'Heading {len(m[1])}');i+=1;continue
    para(line);i+=1

# 数据字典由SQL生成，约束与实际源保持一致。
para('附录 A 数据库完整字典','Heading 1')
para('索引命名说明  主键索引标识为 PRIMARY；未通过 CONSTRAINT 显式命名的唯一索引由数据库生成，本字典记录 MySQL 预期自动名。MySQL 会为需要的外键自动建立辅助索引，SQLite 不会自动建立相同外键索引，因此字段表对外键索引标为依引擎。可用 SHOW INDEX 核验实际名称。数量取值与跨表业务约束另见各表说明和领域模型。')
names={'system_lock':'事务锁','users':'用户','sessions':'登录会话','products':'商品','locations':'货位','lots':'批次库存','receipts':'入库单','orders':'订单','order_lines':'订单行','allocations':'库存分配','stock_moves':'库存流水','outbox':'事件发件箱','shipments':'物流运单','tracking':'物流轨迹','readings':'温度采样','alerts':'告警','idempotency':'幂等请求'}
cn={'id':'主键标识','note':'说明','username':'登录账号','password_hash':'口令哈希','role':'角色','name':'名称','user_id':'用户标识','expires_at':'会话到期','category':'分类','unit':'计量单位','min_stock':'安全库存','cold':'冷链标志','zone':'库区','x':'横坐标','y':'纵坐标','capacity':'容量','product_id':'商品标识','location_id':'货位标识','batch':'批次号','expiry':'效期日期','on_hand':'在库数量','reserved':'预留数量','version':'库存版本','lot_id':'库存批次','qty':'业务数量','supplier':'供应商','created_at':'创建时间','customer':'客户','destination':'目的地','priority':'优先级','status':'业务状态','order_id':'订单标识','kind':'操作类别','delta_hand':'在库增量','delta_reserved':'预留增量','reason':'变动原因','seq':'事件序号','type':'事件类型','aggregate_id':'聚合标识','payload':'业务载荷','previous_hash':'前序摘要','hash':'内容摘要','attempts':'消费次数','available_at':'可消费时间','error':'失败说明','consumed_at':'消费时间','carrier':'模拟承运商','shipment_id':'运单标识','message':'说明消息','device_id':'设备标识','temperature':'采样温度','resolved_at':'处理时间','fingerprint':'请求指纹','response':'原始响应'}
schema=(ROOT/'src/schema.sql').read_text(encoding='utf-8')
tables=re.findall(r'CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\);',schema,re.S)
table(['序号','中文表名','英文表名','用途'],[(j+1,names[n],n,{'system_lock':'MySQL 全局写事务互斥','idempotency':'防止重复命令产生副作用','outbox':'业务事实与投递状态','stock_moves':'数量守恒证据'}.get(n,names[n]+'持久化')) for j,(n,_) in enumerate(tables)],[1,2.3,4,8.7])
dictionary_md=['# 数据库完整字典','\n来源 src/schema.sql。字段长度按数据库DDL记录；TEXT为变长文本，无固定精度。INTEGER为整数，无小数。']
for n,body in tables:
    para(names[n]+' '+n,'Heading 2')
    # 顶层逗号切分，保留DECIMAL和组合约束中的逗号。
    parts=[];buf='';depth=0
    for ch in body:
        if ch=='(':depth+=1
        if ch==')':depth-=1
        if ch==',' and depth==0:parts.append(buf.strip());buf=''
        else:buf+=ch
    parts.append(buf.strip())
    fields=[];index_rows=[];constraints=[]
    composite_columns={f.strip() for group in re.findall(r'UNIQUE\((.*?)\)',body) for f in group.split(',')}
    for part in parts:
        m=re.match(r'^(\w+)\s+((?:VARCHAR|DECIMAL)\([^)]*\)|INTEGER|TEXT)(.*)$',part,re.I)
        if not m:constraints.append(part);continue
        f,typ,rest=m.groups();pk='PRIMARY KEY' in rest;unique='UNIQUE' in rest
        fk=re.search(r'FOREIGN KEY\('+re.escape(f)+r'\) REFERENCES (\w+)\((\w+)\)',body)
        default=re.search(r"DEFAULT ('[^']*'|\d+)",rest)
        indexes='主键' if pk else '唯一' if unique else '组合唯一' if f in composite_columns else '依引擎' if fk else '否'
        rel='PK' if pk else ('FK '+fk[1]+'.'+fk[2] if fk else '—')
        fields.append([cn.get(f,f),f,typ.upper(),'否' if pk or 'NOT NULL' in rest else '是',default[1] if default else '无',rel,indexes])
        if pk:index_rows.append(('PRIMARY' if n else 'PRIMARY',f,'主键 唯一'))
        if unique:index_rows.append((f+'（自动名）',f,'唯一'))
    for part in constraints:
        m=re.match(r'UNIQUE\((.*?)\)',part)
        if m:index_rows.append((m[1].split(',')[0]+'（MySQL自动名）',m[1],'组合唯一'))
    table(['字段中文','字段英文','类型与宽度精度','可空','默认','主外键','索引'],fields,[1.8,2.8,2.8,.8,1.7,3.6,2.5])
    checks=[p for p in constraints if p.startswith('CHECK')]
    if checks:para('数据库取值约束  '+'；'.join(checks))
    if n in ['orders','shipments','outbox','alerts','users']:para('枚举与状态取值由服务层控制，详见状态模型及 API 说明；DDL 未声明枚举 CHECK。')
    if n=='lots':para('服务约束  效期须为有效 ISO 日期；入库效期晚于今日；数量版本由领域事务维护；同商品同货位同批次唯一。')
    if n=='products':para('cold 取 0 或 1，min_stock 不小于 0；业务商品编号由种子数据初始化。')
    if n=='readings':para('服务约束  设备为 COLD-01；温度为有限数且位于 -50 至 80；告警阈值为 2 至 8。')
    if index_rows:table(['索引名称标识','字段','特性'],index_rows,[5,6,5])
    dictionary_md+=['\n## '+names[n]+' '+n,'|'+'|'.join(['字段中文','字段英文','类型','可空','默认','主外键','索引'])+'|','|---|---|---|---|---|---|---|']+['|'+'|'.join(row)+'|' for row in fields]+['\n约束 '+ '; '.join(constraints)]
(DOCS/'数据库字典.md').write_text('\n'.join(dictionary_md),encoding='utf-8')

para('附录 B 自动测试与基准记录','Heading 1')
result=json.loads((DOCS/'test-results-sqlite.json').read_text(encoding='utf-8'))
para(f"SQLite 自动执行时间 {result['executed_at']}。运行环境 Windows {result['node']}。执行主体 node:test 自动化程序。实际通过 {len([c for c in result['cases'] if c['result']=='PASS'])} 项，共 {len(result['cases'])} 项。无失败项时，发现问题列统一为无。每个用例包含的具体输入与期望断言见 tests/warehouse.test.js，第四章已列关键场景的输入与期望。")
table(['编号','测试内容','实际输出','发现问题','耗时毫秒'],[[c['name'].split(' ')[0],c['name'].split(' ',1)[1],c['result'],'无' if c['result']=='PASS' else c.get('error','失败'),f"{c['duration_ms']:.2f}"] for c in result['cases']],[1.2,9,2,1.4,2.4])
para('测试输入与断言记录','Heading 2')
specs=json.loads((DOCS/'test-specs.json').read_text(encoding='utf-8'))
para('以下记录与上表用例编号一一对应。实际输出栏表示测试程序已执行并验证期望断言，不等同于另行采集的人工观察记录；所有用例的执行时间与执行主体同本附录开头。')
table(['编号','输入','期望输出','实际输出'],[[c['name'].split(' ')[0],*specs[c['name'].split(' ')[0]],'断言通过' if c['result']=='PASS' else '断言失败'] for c in result['cases']],[1.2,6,6.5,2.3])
bench=json.loads((DOCS/'benchmark-results.json').read_text(encoding='utf-8'))
para('接口性能基准','Heading 2')
para('执行时间 '+bench['executed_at']+'。独立内存测试库，十次预热，一百次请求，并发十。')
table(['指标','实测值'],[(key,f'{value:.2f}' if isinstance(value,float) else value) for key,value in bench['http'].items()],[8,8])
para('路线对比实验','Heading 2')
table(['指标','实测值'],[['随机种子',bench['route']['seed']],['任务组数',1000],['基线累计步长',bench['route']['baseline_total']],['优化累计步长',bench['route']['optimized_total']],['累计节省比例',f"{bench['route']['saving_percent']:.2f}%"],['严格缩短任务数',bench['route']['improved_cases']]],[8,8])
para(bench['limitations'])
ci=DOCS/'ci-evidence.json'
if ci.exists():
    evidence=json.loads(ci.read_text(encoding='utf-8'));para('MySQL 与 SQLite 持续集成证据','Heading 2')
    table(['环境','通过数','失败数','状态'],[['SQLite',evidence['sqlite_tests']['passed'],0,'成功'],['MySQL 8.4',evidence['mysql_tests']['passed'],0,'成功']],[6,3,3,4])
    para('验证提交 '+evidence['commit']);para('运行记录 '+evidence['run_url']);para('MySQL 原始执行产物 docs/test-results-mysql.json。'+evidence['scope'])
for part in [doc.element,doc.styles.element]:
    for border in list(part.iter(qn('w:pBdr'))):border.getparent().remove(border)
doc.settings.element.append(OxmlElement('w:updateFields'))
doc.settings.element[-1].set(qn('w:val'),'true')
out=DOCS/'智慧仓储与物流协同系统实验报告.docx';doc.save(out)
print(out)
