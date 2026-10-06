import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {emptyDb,addNewAcquisition,importPhysicalRows,editPhysicalBook,createSession,inspectSurvey,applySurvey} from '../inventory.mjs';
import {reserveNextPhysicalIds} from '../physical-id.mjs';
import {makeInventoryExcel} from '../inventory-excel.mjs';
import {unzip} from '../xlsx-native.mjs';

const input={year:2026,quantity:3,acquiredDateRaw:'2026-09-29',titleRaw:'새 책',publisherRaw:'새 출판사',volume:'1'};
function seeded(){const db=emptyDb('catalog');db.issuedIds=['2026-0023'];return db;}

test('매수별로 독립된 실물번호를 연속 발급하고 사용한 번호를 남긴다',()=>{
  const first=addNewAcquisition(seeded(),input);
  assert.deepEqual(first.ids,['2026-0024','2026-0025','2026-0026']);
  assert.equal(first.next.physicalBooks.length,3);
  assert.deepEqual(first.next.physicalBooks.map(x=>x.status),['ACTIVE','ACTIVE','ACTIVE']);
  assert.deepEqual(first.next.physicalBooks.map(x=>x.volume),['1','1','1']);
  assert.deepEqual(first.next.physicalBooks.map(x=>x.acquiredDateRaw),Array(3).fill('2026-09-29'));
  const second=addNewAcquisition(first.next,{...input,quantity:2});
  assert.deepEqual(second.ids,['2026-0027','2026-0028']);
  assert.equal(new Set(second.next.physicalBooks.map(x=>x.physicalId)).size,5);
  assert.deepEqual(reserveNextPhysicalIds({...first.next,entries:[{physicalId:'2026-0027'}]},2026,2),['2026-0028','2026-0029']);
});

test('PC에서 실물을 편집하고 이전 번호와 폐기 번호 재사용을 막는다',()=>{
  const {next}=addNewAcquisition(seeded(),input);
  const edited=editPhysicalBook(next,'2026-0024',{physicalId:'2026-0099',titleRaw:'새 책 개정',publisherRaw:'새 출판사',acquiredDateRaw:'2026-09-30',status:'DISCARDED',volume:'5',version:1});
  assert.equal(edited.physicalBooks[0].physicalId,'2026-0099');
  assert.equal(edited.physicalBooks[0].titleCanonical,'새 책 개정');
  assert.equal(edited.physicalBooks[0].acquiredDateRaw,'2026-09-30');
  assert.equal(edited.physicalBooks[0].status,'DISCARDED');
  assert.equal(edited.physicalBooks[0].volume,'5');
  assert.ok(edited.issuedIds.includes('2026-0024'));
  assert.throws(()=>editPhysicalBook(edited,'2026-0025',{physicalId:'2026-0024',titleRaw:'중복',publisherRaw:'출판사',status:'ACTIVE',version:1}),/이미 다른 책/);
  assert.throws(()=>editPhysicalBook(edited,'2026-0099',{physicalId:'2026-0099',titleRaw:'변경',publisherRaw:'출판사',status:'ACTIVE',version:1}),/다른 작업/);
});

test('모바일 예상 번호가 다른 PC 작업과 충돌하면 반영 시 새 번호를 발급한다',()=>{
  const db=seeded(),session=createSession(db);db.sessions.push(session);
  const report={schema:'angela-survey/v2',catalogId:'catalog',sessionId:session.id,reportId:'worker-1',entries:[0,1].map(i=>({action:'NEW_ACQUISITION',issuedYear:2026,physicalId:'2026-002'+(4+i),temporaryId:null,isNew:true,titleRaw:'같은 책',publisherRaw:'출판사',volume:String(i+1),acquiredDateRaw:'2026-09-29',status:'ACTIVE',labelStatus:'MISSING'}))};
  const current=addNewAcquisition(db,input).next;
  const preview=inspectSurvey(current,report);
  assert.equal(preview.reviews.length,0);
  const result=applySurvey(current,report,{},preview.revision,2026);
  assert.deepEqual(result.mapping.map(x=>x.physicalId),['2026-0027','2026-0028']);
  assert.deepEqual(result.next.physicalBooks.filter(x=>result.mapping.some(m=>m.physicalId===x.physicalId)).map(x=>x.volume),['1','2']);
  assert.equal(new Set(result.next.physicalBooks.map(x=>x.physicalId)).size,5);
  assert.throws(()=>addNewAcquisition(seeded(),{...input,quantity:0}),/매수/);
  assert.throws(()=>addNewAcquisition(seeded(),{...input,acquiredDateRaw:'2026-02-30'}),/입수일/);
});

test('결과 Excel은 실물 한 권당 한 행과 요청한 일곱 열만 제공한다',async()=>{
  const {next}=addNewAcquisition(seeded(),input);
  const directory=new URL('../data-real-validation/',import.meta.url);
  await mkdir(directory,{recursive:true});
  const location=new URL('acquisition-result-test.xlsx',directory);
  await makeInventoryExcel(next,location);
  const files=unzip(await readFile(location));
  assert.match(files.get('xl/workbook.xml'),/실물원장/);
  assert.doesNotMatch(files.get('xl/workbook.xml'),/과거장부|폐기기록/);
  const xml=files.get('xl/worksheets/sheet1.xml');
  assert.deepEqual([...xml.matchAll(/<row\b/g)].length,4);
  for(const title of ['도서번호','입수일','도서명','권 번호','출판사','비고','실물 상태'])assert.ok(xml.includes(title));
  assert.ok(xml.includes('2026-0024'));
  assert.ok(xml.includes('보유 중'));
  assert.doesNotMatch(xml,/매수/);
});
test('과거 Excel 행을 새 실물로만 일괄 추가하고 원문 필드를 보존한다',()=>{
  const db=seeded();
  const rows=[{sourceSheet:'도서목록',sourceRow:1457,legacyLedgerId:'2026-0037',registeredDateRaw:'2026.10.01',titleRaw:'새 책 1',publisherRaw:'웅진북클럽',noteRaw:'기증 A'},
    {sourceSheet:'도서목록',sourceRow:1458,legacyLedgerId:'2026-0038',registeredDateRaw:'2026.10.01',titleRaw:'새 책 2',publisherRaw:'웅진북클럽',noteRaw:''}];
  const {next,ids}=importPhysicalRows(db,rows);
  assert.deepEqual(ids,['2026-0037','2026-0038']);
  assert.equal(db.physicalBooks.length,0);
  assert.equal(next.physicalBooks.length,2);
  assert.equal(next.physicalBooks[0].acquiredDateRaw,'2026.10.01');
  assert.equal(next.physicalBooks[0].noteRaw,'기증 A');
  assert.equal(next.physicalBooks[0].status,'ACTIVE');
  assert.deepEqual(next.issuedIds,['2026-0023',...ids]);
  assert.throws(()=>importPhysicalRows(next,rows),/이미 등록되거나 발급/);
  assert.throws(()=>importPhysicalRows(db,[rows[0],{...rows[1],legacyLedgerId:'2026-0037'}]),/중복/);
  assert.throws(()=>importPhysicalRows(db,[{...rows[0],legacyLedgerId:'잘못된 번호'}]),/YYYY-NNNN/);
  assert.equal(db.physicalBooks.length,0);
});