import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {emptyDb,addLegacy,createSession,inspectSurvey,applySurvey,importResultExcel,editPhysicalBook,editLegacyNote} from '../inventory.mjs';
import {makeInventoryExcel} from '../inventory-excel.mjs';
import {readResultExcel} from '../result-excel-import.mjs';
import {unzip,zip,sheet} from '../xlsx-native.mjs';

const sourceRows=[
  {legacyLedgerId:'2026-0001',registeredDateRaw:'2009.04.28.',titleRaw:'연결된 책',publisherRaw:'출판사',quantityRaw:'1',noteRaw:'후원사 A'},
  {legacyLedgerId:'2026-0002',registeredDateRaw:'2010.01.02.',titleRaw:'미확인 책',publisherRaw:'출판사',quantityRaw:'1',noteRaw:'기업 B'},
  {legacyLedgerId:'10',registeredDateRaw:'',titleRaw:'보조 자료',publisherRaw:'출판사',quantityRaw:'1'}
];
const source=()=>addLegacy(emptyDb('catalog'),sourceRows);

test('과거 장부 연결 시 원본 날짜를 실물 입수일로 보존한다',()=>{
  const db=source(),session=createSession(db);db.sessions.push(session);
  const report={schema:'angela-survey/v2',catalogId:'catalog',sessionId:session.id,entries:[{
    physicalId:'2026-0050',temporaryId:null,isNew:true,titleRaw:'연결된 책',publisherRaw:'출판사',
    legacyRecordId:db.legacyRecords[0].recordId,status:'ACTIVE',labelStatus:'PRESENT',note:''
  }]};
  const preview=inspectSurvey(db,report);
  const decisions=Object.fromEntries(preview.reviews.map(r=>[r.key,r.kind==='mapping'?'confirm':'distinct']));
  const {next}=applySurvey(db,report,decisions,preview.revision,2026);
  assert.equal(next.physicalBooks[0].acquiredDateRaw,'2009.04.28.');
});

test('결과 Excel은 미확인 도서를 포함하고 날짜·정렬·권 번호·비고 일곱 열을 유지하며 다시 가져올 수 있다',async()=>{
  const db=source(),folder=await fs.mkdtemp(path.join(os.tmpdir(),'angela-result-'));
  db.physicalBooks.push({physicalId:'2026-0050',legacyRecordId:db.legacyRecords[0].recordId,
    titleRaw:'연결된 책',titleCanonical:'연결된 책',publisherRaw:'출판사',publisherCanonical:'출판사',
    acquiredDateRaw:'',volume:'5',status:'ACTIVE',labelStatus:'PRESENT',version:1});
  db.issuedIds.push('2026-0050');
  try{
    const file=path.join(folder,'result.xlsx');
    await makeInventoryExcel(db,file);
    const raw=await fs.readFile(file),rows=readResultExcel(raw),xml=unzip(raw).get('xl/worksheets/sheet1.xml');
    assert.deepEqual(rows.map(x=>x.physicalId),['2026-0002','2026-0050','10']);
    assert.deepEqual(rows.map(x=>x.status),['UNKNOWN','ACTIVE','UNKNOWN']);
    assert.equal(rows[1].acquiredDateRaw,'2009.04.28.');
    assert.equal(rows[0].acquiredDateRaw,'2010.01.02.');
    assert.doesNotMatch(xml,/매수/);
    assert.match(xml,/비고/);
    assert.match(xml,/권 번호/);
    assert.equal(rows[1].volume,'5');
    assert.equal(rows[0].volume,'');
    assert.equal(rows[0].noteRaw,'기업 B');
    assert.equal(rows[1].noteRaw,'후원사 A');
    assert.deepEqual([...xml.matchAll(/<row\b/g)].length,4);
    const restored=importResultExcel(emptyDb('new'),rows);
    assert.equal(restored.addedPhysical,1);
    assert.equal(restored.next.physicalBooks[0].volume,'5');
    assert.equal(restored.addedLegacy,2);
    await makeInventoryExcel(restored.next,path.join(folder,'roundtrip.xlsx'));
    const roundtrip=readResultExcel(await fs.readFile(path.join(folder,'roundtrip.xlsx')));
    assert.deepEqual(roundtrip.map(x=>[x.physicalId,x.acquiredDateRaw,x.titleRaw,x.publisherRaw,x.volume,x.noteRaw,x.status]),rows.map(x=>[x.physicalId,x.acquiredDateRaw,x.titleRaw,x.publisherRaw,x.volume,x.noteRaw,x.status]));
    const withoutVolume=structuredClone(restored.next);withoutVolume.physicalBooks[0].volume='';
    const supplemented=importResultExcel(withoutVolume,rows);
    assert.equal(supplemented.filledVolumes,1);
    assert.equal(supplemented.next.physicalBooks[0].volume,'5');
    const again=importResultExcel(restored.next,rows);
    assert.equal(again.unchanged,3);
    assert.equal(again.next.revision,restored.next.revision);
    const withSource=importResultExcel(source(),rows);
    assert.equal(withSource.next.physicalBooks[0].legacyRecordId,withSource.next.legacyRecords[0].recordId);
    assert.throws(()=>importResultExcel(restored.next,rows.map(x=>x.physicalId==='2026-0050'?{...x,volume:'4'}:x)),/권 번호와 다릅니다/);
    assert.throws(()=>importResultExcel(restored.next,rows.map(x=>x.physicalId==='2026-0050'?{...x,titleRaw:'다른 책'}:x)),/내용이 다릅니다/);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});


test('PC에서 장부·실물 비고를 수정하거나 비워도 Excel과 재조사에 반영된다',async()=>{
  const db=source(),legacy=db.legacyRecords[0];
  db.physicalBooks.push({physicalId:'2026-0050',legacyRecordId:legacy.recordId,
    titleRaw:'연결된 책',titleCanonical:'연결된 책',publisherRaw:'출판사',publisherCanonical:'출판사',
    acquiredDateRaw:'2009.04.28.',volume:'1',status:'ACTIVE',labelStatus:'PRESENT',version:1,noteRaw:'후원사 A'});
  db.issuedIds.push('2026-0050');
  const changed=editLegacyNote(db,legacy.recordId,'기업 C',1);
  assert.equal(changed.legacyRecords[0].noteRaw,'기업 C');
  assert.throws(()=>editLegacyNote(changed,legacy.recordId,'오래된 수정',1),/다른 작업/);
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'angela-note-'));
  try{
    const file=path.join(folder,'notes.xlsx');
    await makeInventoryExcel(changed,file);
    assert.equal(readResultExcel(await fs.readFile(file)).find(x=>x.physicalId==='2026-0050').noteRaw,'기업 C');
    const cleared=editLegacyNote(changed,legacy.recordId,'',2);
    await makeInventoryExcel(cleared,file);
    assert.equal(readResultExcel(await fs.readFile(file)).find(x=>x.physicalId==='2026-0050').noteRaw,'');
    const edited=editPhysicalBook(cleared,'2026-0050',{physicalId:'2026-0050',titleRaw:'연결된 책',publisherRaw:'출판사',acquiredDateRaw:'2009.04.28.',volume:'1',status:'ACTIVE',noteRaw:'개별 후원사',version:1});
    await makeInventoryExcel(edited,file);
    assert.equal(readResultExcel(await fs.readFile(file)).find(x=>x.physicalId==='2026-0050').noteRaw,'개별 후원사');
    const empty=editPhysicalBook(edited,'2026-0050',{physicalId:'2026-0050',titleRaw:'연결된 책',publisherRaw:'출판사',acquiredDateRaw:'2009.04.28.',volume:'1',status:'ACTIVE',noteRaw:'',version:2});
    const session=createSession(empty);empty.sessions.push(session);
    const report={schema:'angela-survey/v2',catalogId:empty.catalogId,sessionId:session.id,entries:[{physicalId:'2026-0050',temporaryId:null,isNew:false,action:'CONFIRM',titleRaw:'연결된 책',publisherRaw:'출판사',volume:'1',legacyRecordId:legacy.recordId,status:'ACTIVE',labelStatus:'PRESENT',note:''}]};
    const preview=inspectSurvey(empty,report),decisions=Object.fromEntries(preview.reviews.map(r=>[r.key,r.kind==='mapping'?'confirm':r.options[0]]));
    const merged=applySurvey(empty,report,decisions,preview.revision,2026).next;
    await makeInventoryExcel(merged,file);
    assert.equal(readResultExcel(await fs.readFile(file)).find(x=>x.physicalId==='2026-0050').noteRaw,'');
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});


test('이전 여섯 열 결과 Excel도 읽고 매수 열은 가져오지 않는다',()=>{
  const bytes=zip([
    ['xl/workbook.xml','<workbook><sheets><sheet name="실물원장" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml',sheet([
      ['도서번호','입수일','도서명','출판사','매수','실물 상태'],
      ['2026-0001','2026-09-01','기존 책','출판사',1,'보유 중']
    ],[18,18,36,30,10,16])]
  ]);
  const rows=readResultExcel(bytes);
  assert.equal(rows.length,1);
  assert.deepEqual([rows[0].physicalId,rows[0].status],['2026-0001','ACTIVE']);
  assert.equal(Object.hasOwn(rows[0],'quantity'),false);
  assert.equal(rows[0].noteRaw,null);
  assert.equal(rows[0].volume,null);
});

