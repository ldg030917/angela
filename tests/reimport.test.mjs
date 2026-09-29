import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyDb,createSession,inspectSurvey,applySurvey} from '../inventory.mjs';

function setup(){
  const db=emptyDb('catalog');
  db.physicalBooks.push({physicalId:'2026-0001',titleRaw:'기존 책',titleCanonical:'기존 책',publisherRaw:'출판사',publisherCanonical:'출판사',volume:'',acquiredDateRaw:'2026-09-01',status:'ACTIVE',labelStatus:'PRESENT',note:'',version:1});
  db.issuedIds.push('2026-0001');
  const session=createSession(db);
  db.sessions.push(session);
  return {db,session};
}
const entry=(id,overrides={})=>({physicalId:id,temporaryId:null,isNew:id!=='2026-0001',action:id==='2026-0001'?'UPDATE_INFO':null,titleRaw:id==='2026-0001'?'기존 책':'새 책',publisherRaw:'출판사',volume:'',acquiredDateRaw:'',legacyRecordId:null,status:'ACTIVE',labelStatus:'PRESENT',note:'',...overrides});
const report=(session,entries,reportId='one-worker')=>({schema:'angela-survey/v2',catalogId:'catalog',sessionId:session.id,reportId,entries});

test('같은 결과 파일에 새 항목을 더하면 이미 반영한 항목은 건너뛰고 신규 항목만 반영한다',()=>{
  const {db,session}=setup(),first=report(session,[entry('2026-0001')]);
  const once=applySurvey(db,first,{},db.revision,2026).next;
  assert.equal(inspectSurvey(once,first).entries.length,0);
  const extended=report(session,[entry('2026-0001'),entry('2026-0002')]);
  const preview=inspectSurvey(once,extended);
  assert.equal(preview.entries.length,1);
  assert.equal(preview.unchangedCount,1);
  const twice=applySurvey(once,extended,{},preview.revision,2026).next;
  assert.deepEqual(twice.physicalBooks.map(x=>x.physicalId),['2026-0001','2026-0002']);
  assert.equal(twice.physicalBooks[0].version,2);
});

test('같은 결과 파일의 기존 항목 수정은 재반영 검토 후 적용한다',()=>{
  const {db,session}=setup(),first=report(session,[entry('2026-0001')]);
  const once=applySurvey(db,first,{},db.revision,2026).next;
  const revised=report(session,[entry('2026-0001',{status:'LOST',titleRaw:'수정된 제목'})]);
  const preview=inspectSurvey(once,revised);
  assert.equal(preview.entries.length,1);
  assert.ok(preview.reviews.some(x=>x.kind==='reimport'));
  const decisions=Object.fromEntries(preview.reviews.map(x=>[x.key,'apply']));
  const twice=applySurvey(once,revised,decisions,preview.revision,2026).next;
  assert.equal(twice.physicalBooks[0].status,'LOST');
  assert.equal(twice.physicalBooks[0].titleRaw,'수정된 제목');
  assert.equal(inspectSurvey(twice,revised).entries.length,0);
});

test('과거 reportId 없는 반영 기록도 변경된 항목을 검사한다',()=>{
  const {db,session}=setup(),first=report(session,[entry('2026-0001')],undefined);
  delete first.reportId;
  const once=applySurvey(db,first,{},db.revision,2026).next;
  delete once.applied[0].entrySignatures;
  const extended=report(session,[entry('2026-0001'),entry('2026-0002')],undefined);
  delete extended.reportId;
  const preview=inspectSurvey(once,extended);
  assert.equal(preview.entries.length,1);
  const twice=applySurvey(once,extended,{},preview.revision,2026).next;
  assert.equal(twice.physicalBooks.length,2);
});

test('과거 reportId 없는 반영 기록의 수정 항목은 명시적으로 검토한다',()=>{
  const {db,session}=setup(),first=report(session,[entry('2026-0001')],undefined);
  delete first.reportId;
  const once=applySurvey(db,first,{},db.revision,2026).next;
  delete once.applied[0].entrySignatures;
  const revised=report(session,[entry('2026-0001',{status:'DISCARDED'})],undefined);
  delete revised.reportId;
  const preview=inspectSurvey(once,revised);
  assert.ok(preview.reviews.some(x=>x.kind==='reimport'));
  const decisions=Object.fromEntries(preview.reviews.map(x=>[x.key,'apply']));
  const twice=applySurvey(once,revised,decisions,preview.revision,2026).next;
  assert.equal(twice.physicalBooks[0].status,'DISCARDED');
});

test('같은 모바일 결과의 신규 입수 수정과 추가 부수를 중복 없이 반영한다',()=>{
  const {db,session}=setup();
  const acquired=(id,title)=>({physicalId:id,temporaryId:null,isNew:true,action:'NEW_ACQUISITION',issuedYear:2026,titleRaw:title,publisherRaw:'출판사',volume:'',acquiredDateRaw:'2026-09-29',legacyRecordId:null,status:'ACTIVE',labelStatus:'MISSING',note:'새로 들여온 책'});
  const first=report(session,[acquired('2026-0002','새 책')]);
  const once=applySurvey(db,first,{},db.revision,2026).next;
  const revised=report(session,[acquired('2026-0002','새 책 수정'),acquired('2026-0003','두 번째 책')]);
  const preview=inspectSurvey(once,revised);
  assert.equal(preview.entries.length,2);
  const decisions=Object.fromEntries(preview.reviews.map(x=>[x.key,'apply']));
  const twice=applySurvey(once,revised,decisions,preview.revision,2026).next;
  assert.deepEqual(twice.physicalBooks.map(x=>x.physicalId),['2026-0001','2026-0002','2026-0003']);
  assert.equal(twice.physicalBooks[1].titleRaw,'새 책 수정');
  assert.equal(twice.physicalBooks[2].titleRaw,'두 번째 책');
  assert.equal(inspectSurvey(twice,revised).entries.length,0);
});
test('모바일에서 기존 조사 기록의 번호를 수정해 다시 가져오면 책을 중복 생성하지 않는다',()=>{
  const {db,session}=setup();
  const first=report(session,[entry('2026-0002')]);
  const once=applySurvey(db,first,{},db.revision,2026).next;
  const revised=report(session,[entry('2026-0003',{originalPhysicalId:'2026-0002',titleRaw:'수정한 새 책',status:'LOST'})]);
  const preview=inspectSurvey(once,revised);
  assert.deepEqual(preview.reviews.map(x=>x.kind),['reimport','id-change']);
  const decisions=Object.fromEntries(preview.reviews.map(x=>[x.key,'apply']));
  const twice=applySurvey(once,revised,decisions,preview.revision,2026).next;
  assert.deepEqual(twice.physicalBooks.map(x=>x.physicalId),['2026-0001','2026-0003']);
  assert.equal(twice.physicalBooks[1].titleRaw,'수정한 새 책');
  assert.equal(twice.physicalBooks[1].status,'LOST');
  assert.ok(twice.issuedIds.includes('2026-0002'));
  assert.equal(inspectSurvey(twice,revised).entries.length,0);
  const later=report(session,[entry('2026-0004',{originalPhysicalId:'2026-0002',titleRaw:'수정한 새 책',status:'LOST'})]);
  const nextPreview=inspectSurvey(twice,later);
  assert.ok(nextPreview.reviews.some(x=>x.key==='id-change:2026-0003'));
  const nextDecisions=Object.fromEntries(nextPreview.reviews.map(x=>[x.key,'apply']));
  const thrice=applySurvey(twice,later,nextDecisions,nextPreview.revision,2026).next;
  assert.deepEqual(thrice.physicalBooks.map(x=>x.physicalId),['2026-0001','2026-0004']);
});
test('첫 반영 전에 모바일에서 번호를 고쳐도 이후 재수정은 같은 책으로 연결한다',()=>{
  const {db,session}=setup();
  const first=report(session,[entry('2026-0003',{originalPhysicalId:'2026-0002'})]);
  const once=applySurvey(db,first,{},db.revision,2026).next;
  assert.deepEqual(once.physicalBooks.map(x=>x.physicalId),['2026-0001','2026-0003']);
  const revised=report(session,[entry('2026-0004',{originalPhysicalId:'2026-0002'})]);
  const preview=inspectSurvey(once,revised);
  assert.ok(preview.reviews.some(x=>x.key==='id-change:2026-0003'));
  const decisions=Object.fromEntries(preview.reviews.map(x=>[x.key,'apply']));
  const twice=applySurvey(once,revised,decisions,preview.revision,2026).next;
  assert.deepEqual(twice.physicalBooks.map(x=>x.physicalId),['2026-0001','2026-0004']);
});
