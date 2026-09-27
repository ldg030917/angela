import { Workbook, SpreadsheetFile, FileBlob } from '@oai/artifact-tool';
import { book, check } from './domain.mjs';
export const headers=['등록번호','도서명','저자','위치','권수','실물확인'];
export async function makeExcel(books,disposals,path) {
  const wb=Workbook.create();
  const sheets=[['도서원장',[headers,...books.map(b=>[b.id,b.title,b.author,b.location,b.qty,b.confirmed?'확인':'미확인'])]],['폐기기록',[['등록번호','도서명','폐기권수','사유','기록일시'],...disposals.map(d=>[d.id,d.title,d.qty,d.reason,d.at])]]];
  for(const [name,rows] of sheets){
    const s=wb.worksheets.add(name); s.getRangeByIndexes(0,0,rows.length,rows[0].length).values=rows.map(r=>r.map(v=>typeof v==='string'&&v.startsWith('=')?`'${v}`:v));
    s.getRangeByIndexes(0,0,1,rows[0].length).format.fill='#173D66';
    s.getRangeByIndexes(0,0,1,rows[0].length).format.font.color='#FFFFFF';
    s.getRangeByIndexes(0,0,1,rows[0].length).format.font.bold=true;
    s.getRangeByIndexes(0,0,rows.length,rows[0].length).format.columnWidth=16;
    s.getRangeByIndexes(0,0,rows.length,rows[0].length).format.rowHeight=24;
    s.getRange('B:B').format.columnWidth=30;
    s.getRange('C:C').format.columnWidth=name==='도서원장'?28:14;
    s.getRange('D:D').format.columnWidth=name==='도서원장'?16:32;
    if(name==='폐기기록'){s.getRange('E:E').format.columnWidth=26;if(rows.length>1)s.getRange(`E2:E${rows.length}`).setNumberFormat('yyyy-mm-dd hh:mm:ss');}
    s.freezePanes.freezeRows(1);
  }
  wb.recalculate(); await (await SpreadsheetFile.exportXlsx(wb)).save(path); return wb;
}
export async function readExcel(path) {
  const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(path));
  const s=wb.worksheets.getItemAt(0), rows=s.getUsedRange().values;
  check(rows.length>1 && rows.length<=10001,'도서 행이 1~10000개인 Excel을 사용하세요.');
  const h=rows[0].map(String); for(const name of headers.slice(0,5)) check(h.includes(name),`필수 열이 없습니다: ${name}`);
  const ids=new Set();
  return rows.slice(1).filter(r=>r.some(v=>v!==null&&v!=='')).map((r,i)=>{
    const cell=k=>r[h.indexOf(k)]; const id=String(cell('등록번호')??'').trim();
    check(/^\d{4}-\d{4}$/.test(id) && !ids.has(id),`${i+2}행: 등록번호는 중복 없는 YYYY-NNNN 형식이어야 합니다.`); ids.add(id);
    check(cell('권수')!==null && cell('권수')!=='',`${i+2}행: 권수를 입력하세요.`);
    const b=book({title:String(cell('도서명')??''),author:String(cell('저자')??''),location:String(cell('위치')??''),qty:Number(cell('권수'))});
    return {...b,id,version:1,confirmed:cell('실물확인')==='확인'};
  });
}
