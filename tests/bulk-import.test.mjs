import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {zip} from '../xlsx-native.mjs';

const cell=(ref,value)=>`<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
const row=(number,values)=>`<row r="${number}">${values.map((value,i)=>cell(String.fromCharCode(65+i)+number,value)).join('')}</row>`;
const workbook=zip([
  ['xl/workbook.xml','<workbook><sheets><sheet name="도서목록" r:id="rId1"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml','<worksheet><sheetData>'+row(1,['번호','날짜','도서명','출판사','권수','비고'])+row(1457,['2026-0037','2026.10.01','첫 책','출판사','1','후원사'])+row(1458,['2026-0038','2026.10.01','둘째 책','출판사','1',''])+'</sheetData></worksheet>']
]);

test('새 실물 Excel 미리보기와 적용은 별도 원장에 한 번만 추가한다',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'angela-bulk-api-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:folder,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  try{
    let output='';
    const base=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('서버 시작 시간 초과')),10000);
      child.stdout.on('data',chunk=>{output+=chunk;const port=/Angela: http:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[1];if(port){clearTimeout(timer);resolve('http://127.0.0.1:'+port);}});
      child.once('error',reject);child.once('exit',code=>reject(Error('서버 종료: '+code)));
    });
    const preview=await fetch(base+'/api/physical/import-preview?start=1457&end=1458',{method:'POST',body:workbook});
    assert.equal(preview.status,200);
    const p=await preview.json();assert.equal(p.count,2);assert.equal(p.sheet,'도서목록');
    const stateBefore=await (await fetch(base+'/api/state')).json();assert.equal(stateBefore.physicalBooks.length,0);
    const applied=await fetch(base+'/api/physical/import-apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:p.token,revision:p.revision})});
    assert.equal(applied.status,200);assert.deepEqual((await applied.json()).count,2);
    const stateAfter=await (await fetch(base+'/api/state')).json();
    assert.deepEqual(stateAfter.physicalBooks.map(x=>x.physicalId),['2026-0037','2026-0038']);
    assert.equal(stateAfter.physicalBooks[0].noteRaw,'후원사');
    const repeated=await fetch(base+'/api/physical/import-preview?start=1457&end=1458',{method:'POST',body:workbook});
    assert.equal(repeated.status,400);assert.match((await repeated.json()).error,/이미 등록되거나 발급/);
    assert.equal((await (await fetch(base+'/api/state')).json()).physicalBooks.length,2);
  }finally{child.kill();await fs.rm(folder,{recursive:true,force:true});}
});