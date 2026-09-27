from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist'/'Angela-사용방법.pdf'
OUT.parent.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('Malgun','C:/Windows/Fonts/malgun.ttf'))
pdfmetrics.registerFont(TTFont('MalgunBold','C:/Windows/Fonts/malgunbd.ttf'))
c=canvas.Canvas(str(OUT),pagesize=A4)
W,H=A4
navy=HexColor('#173D66'); ink=HexColor('#1A2D42'); gray=HexColor('#65768A'); pale=HexColor('#EDF3F9'); green=HexColor('#236444')

def text(x,y,s,size=10,color=ink,bold=False):
    c.setFillColor(color);c.setFont('MalgunBold' if bold else 'Malgun',size);c.drawString(x,y,s)
def wrap(s,maxw,size=10,bold=False):
    font='MalgunBold' if bold else 'Malgun';words=s.split(' ');lines=[];line=''
    for word in words:
        test=(line+' '+word).strip()
        if pdfmetrics.stringWidth(test,font,size)>maxw and line:lines.append(line);line=word
        else:line=test
    if line:lines.append(line)
    return lines
def para(x,y,s,maxw=490,size=10,leading=17,color=ink,bold=False):
    for line in wrap(s,maxw,size,bold):text(x,y,line,size,color,bold);y-=leading
    return y
def base(num,title,kicker):
    c.setFillColor(navy);c.rect(0,H-82,W,82,fill=1,stroke=0)
    text(42,H-43,'Angela  |  도서 실사',17,HexColor('#FFFFFF'),True)
    text(42,H-63,kicker,9,HexColor('#D7E8FA'))
    text(42,H-115,title,21,navy,True)
    c.setStrokeColor(HexColor('#DCE4ED'));c.line(42,48,W-42,48)
    text(42,32,'Angela 도서 실사 · Windows 사용 안내',8,gray)
    text(W-62,32,f'{num} / 3',8,gray)
def section(y,no,title,body):
    c.setFillColor(pale);c.roundRect(42,y-13,28,25,5,fill=1,stroke=0)
    text(49,y-6,no,10,navy,True)
    text(82,y-3,title,13,ink,True)
    y=para(82,y-28,body,470,10,18)
    return y-19
def box(y,title,lines):
    height=34+len(lines)*19+14
    c.setFillColor(pale);c.roundRect(42,y-height,W-84,height,9,fill=1,stroke=0)
    text(58,y-25,title,11,navy,True)
    yy=y-48
    for line in lines:yy=para(58,yy,line,W-116,9,18,ink)-1
    return y-height-18

base(1,'처음 시작하기','EXCEL 원장 → 모바일 조사 → 결과 EXCEL')
y=H-154
y=para(42,y,'압축 파일을 풀고 Angela-시작.cmd를 두 번 클릭합니다. 잠시 후 브라우저에 도서 원장이 열립니다. 작업이 끝나면 열린 서버 창을 닫습니다.',510,11,20)-25
y=section(y,'01','샘플 Excel 준비','PC 원장에서 샘플 Excel 다운로드를 누릅니다. 내려받은 sample.xlsx를 Excel 원장 파일에서 선택합니다. 예시 원장은 도서 4종, 보유 10권입니다.')
y=section(y,'02','조사본 만들기','조사용 데이터 생성을 누른 뒤 모바일 조사 화면 열기를 선택합니다. 화면 상단에서 조사 일자와 저장 상태를 확인합니다.')
y=section(y,'03','조사 결과 반영','현장 조사를 마친 뒤 조사 JSON export → JSON 파일 저장을 누릅니다. PC 원장 화면에서 그 JSON 파일을 선택하고 충돌 검사를 실행합니다.')
y=box(y,'기존 Excel을 가져올 때 필요한 열',['첫 번째 시트: 등록번호 · 도서명 · 저자 · 위치 · 권수','등록번호는 YYYY-NNNN 형식이며 중복되면 가져오기가 중단됩니다.','권수는 0 이상의 정수입니다.'])
text(42,y-5,'화면 주소: http://127.0.0.1:4173',9,gray)
c.showPage()

base(2,'모바일 조사하기','검색 · 실물 확인 · 권수 변경 · 폐기 · 신규 등록')
y=H-154
y=section(y,'01','기존 도서 찾기','검색 상자에 도서명, 등록번호, 저자 또는 위치를 입력합니다. 검색 결과에서 도서와 현재 권수를 확인합니다.')
y=section(y,'02','실물 확인·권수 변경','도서를 찾으면 실물 확인을 누릅니다. 실제 남아 있는 권수가 다르면 권수 변경에서 정수를 입력하고 저장합니다. 저장된 내용은 같은 브라우저의 이 조사에 자동 보관됩니다.')
y=section(y,'03','폐기 기록','폐기 기록을 누르고 폐기 권수와 사유를 입력합니다. 저장하면 현재 보유 권수가 폐기 수량만큼 줄고 기록이 별도로 남습니다. 보유 권수보다 많이 폐기할 수 없습니다.')
y=section(y,'04','신규 도서 추가','신규 도서 추가에서 도서명, 저자, 위치, 권수를 입력합니다. 화면에는 번호 발급 대기로 표시되며 PC 반영 시 YYYY-NNNN 번호가 발급됩니다.')
y=box(y,'저장 및 파일 전달',['페이지를 닫았다 다시 열어도 같은 브라우저와 주소에서는 기록이 유지됩니다.','다른 브라우저나 PC로 자동 동기화되지 않습니다. 조사를 마치면 JSON 파일을 저장해 PC에서 불러오세요.'])
c.showPage()

base(3,'검사하고 Excel 받기','충돌 선택 · 신규 번호 · 결과 보관')
y=H-154
y=section(y,'01','충돌 검사','PC 원장에서 조사 결과 파일을 선택하고 충돌 검사를 누릅니다. 조사 시작 뒤 PC 원장에서 바뀐 도서는 시작 값, 현재 PC 값, 조사 결과를 나란히 보여줍니다.')
y=section(y,'02','충돌 처리','각 충돌에 PC 원장 유지 또는 조사 결과 반영을 선택합니다. PC 원장 유지를 선택하면 그 도서의 조사 내용과 폐기 기록을 반영하지 않습니다. 모두 선택해야 반영 버튼이 활성화됩니다.')
y=section(y,'03','번호 발급 및 Excel','신규 번호 발급 연도를 확인하고 원장 반영 · 신규 번호 발급을 누릅니다. 해당 연도의 최대 번호 다음 순번을 사용합니다. 결과 Excel 생성으로 도서원장·폐기기록 두 시트의 파일을 받습니다.')
y=box(y,'다음 작업과 데이터 보관',['같은 조사 JSON은 한 번만 반영할 수 있습니다. 다음 조사는 조사용 데이터 생성을 다시 실행하세요.','PC 원장과 반영 이력은 앱 폴더의 data/catalog.json에 저장됩니다. 백업할 때 이 파일을 보관하세요.','폐기기록 Excel의 기록일시는 UTC 기준입니다.'])
text(42,y-3,'접속 범위: 기본 실행은 이 PC 전용입니다. 휴대전화에서 직접 접속하려면 별도 배포·접속 설정이 필요합니다.',8,gray)
c.save()
print(OUT)
