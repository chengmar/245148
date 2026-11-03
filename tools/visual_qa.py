from pathlib import Path
import sys,json
from PIL import Image,ImageDraw
import pdfplumber
p=Path(sys.argv[1]);files=sorted(p.glob('page-*.png'))
for start in range(0,len(files),6):
    canvas=Image.new('RGB',(1500,1450),'#d9ddd6');d=ImageDraw.Draw(canvas)
    for j,f in enumerate(files[start:start+6]):
        im=Image.open(f);im.thumbnail((480,680));x=(j%3)*500+10;y=(j//3)*725+25;canvas.paste(im,(x,y));d.text((x,y-18),f.name,fill='black')
    canvas.save(p/f'contact-{start//6+1}.png')
with pdfplumber.open(p/'report.pdf') as pdf:
    result=[]
    for i,page in enumerate(pdf.pages):
        outside=[c for c in page.chars if c['x0']<55 or c['x1']>page.width-55 or c['top']<35 or c['bottom']>page.height-20]
        result.append({'page':i+1,'text_chars':len(page.extract_text() or ''),'outside_count':len(outside)})
    (p/'layout-check.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print('Pages',len(pdf.pages),'Outside text',sum(r['outside_count'] for r in result))
