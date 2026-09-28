import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {zip} from '../xlsx-native.mjs';
import {readLedger} from '../ledger-excel.mjs';
import {readExcelUpload} from '../excel-upload.mjs';

const cell=(ref,value)=>`<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
const row=(number,values)=>`<row r="${number}">${values.map((value,i)=>cell(`${String.fromCharCode(65+i)}${number}`,value)).join('')}</row>`;
const sheet=rows=>`<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;
const workbook=zip([
  ['xl/workbook.xml','<workbook><sheets><sheet name="도서목록" r:id="rId1"/><sheet name="교육참고자료" r:id="rId2"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml',sheet([row(1,['도서목록대장']),row(2,['번호','날짜','도서명','출판사','권수','비고']),row(3,['2009-0001','2009.04.28.','책 하나','출판사','2','1~2'])])],
  ['xl/worksheets/sheet2.xml',sheet([row(2,['번호','도서명','출판사','권수','비고']),row(3,['1','교재','출판사','1','']),row(4,['2','','','',''])])]
]);

test('두 시트와 앞쪽 제목 행을 읽고 빈 양식 행은 제외한다',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'angela-test-'));
  try{
    const file=path.join(folder,'source.xlsx');await fs.writeFile(file,workbook);
    const rows=await readLedger(file);
    assert.equal(rows.length,2);
    assert.deepEqual(rows.map(x=>[x.sourceSheet,x.sourceRow]),[['도서목록',3],['교육참고자료',3]]);
    assert.equal(rows[0].registeredDateRaw,'2009.04.28.');
    assert.equal(rows[0].noteRaw,'1~2');
    assert.equal((await readExcelUpload(workbook)).length,2);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
