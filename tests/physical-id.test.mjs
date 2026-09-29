import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePhysicalId,formatPhysicalIdInput,validatePhysicalId,isPhysicalIdAlreadyIssued} from '../physical-id.mjs';
import {search} from '../normalize.mjs';
import {statusName} from '../status.mjs';
import {emptyDb,createSession,inspectSurvey,applySurvey,resolveReview} from '../inventory.mjs';

const book=(id,status='ACTIVE')=>({physicalId:id,titleRaw:'어린 왕자',titleCanonical:'어린 왕자',publisherRaw:'문학동네',publisherCanonical:'문학동네',volume:'',acquiredDateRaw:'2009.04.28.',status,labelStatus:'PRESENT',note:'',version:1});
function setup(){const db=emptyDb('catalog');db.physicalBooks=[book('2019-0034')];db.issuedIds=['2019-0034'];const session=createSession(db);db.sessions.push(session);return {db,session};}
const change=session=>({schema:'angela-survey/v2',catalogId:'catalog',sessionId:session.id,entries:[{action:'CHANGE_PHYSICAL_ID',oldPhysicalId:'20190034',physicalId:'20190087',temporaryId:null,isNew:false,titleRaw:'어린 왕자',publisherRaw:'문학동네',status:'ACTIVE',labelStatus:'PRESENT',acquiredDateRaw:'2099.01.01.'}]});

test('번호 8자리와 하이픈 입력을 같은 번호로 정규화한다',()=>{
  assert.equal(normalizePhysicalId('20210223'),'2021-0223');
  assert.equal(normalizePhysicalId('2021-0223'),'2021-0223');
  assert.equal(formatPhysicalIdInput('2021'),'2021');
  assert.equal(formatPhysicalIdInput('20210'),'2021-0');
  assert.equal(formatPhysicalIdInput('20210223'),'2021-0223');
  assert.equal(validatePhysicalId('2021-223'),false);
  assert.throws(()=>normalizePhysicalId('2021-223'),/YYYY-NNNN/);
  assert.equal(search('20210223',[book('2021-0223')])[0].physicalId,'2021-0223');
});

test('기존 실물번호 변경은 PC 검토 후 적용하고 기존 번호를 재사용하지 않는다',()=>{
  const {db,session}=setup(),report=change(session),inspection=inspectSurvey(db,report);
  assert.equal(inspection.reviews.find(x=>x.kind==='id-change').oldPhysicalId,'2019-0034');
  assert.equal(db.physicalBooks[0].physicalId,'2019-0034');
  const {next}=applySurvey(db,report,{'id-change:2019-0034':'apply'},inspection.revision,2026);
  assert.equal(next.physicalBooks[0].physicalId,'2019-0087');
  assert.equal(next.physicalBooks[0].acquiredDateRaw,'2009.04.28.');
  assert.deepEqual(next.issuedIds,['2019-0034','2019-0087']);
  assert.deepEqual(next.idChanges[0].oldPhysicalId,'2019-0034');
});

test('이미 사용 중이거나 폐기·분실로 남은 번호는 변경 대상이 될 수 없다',()=>{
  for(const status of ['ACTIVE','DISCARDED','LOST']){
    const {db,session}=setup();db.physicalBooks.push(book('2019-0087',status));db.issuedIds.push('2019-0087');
    assert.equal(isPhysicalIdAlreadyIssued(db,'20190087'),true);
    const preview=inspectSurvey(db,change(session));
    assert.match(preview.reviews.find(x=>x.kind==='id-change').message,/이미 사용 중/);
    assert.throws(()=>applySurvey(db,change(session),{'id-change:2019-0034':'apply'},preview.revision,2026),/이미 다른 책/);
  }
  const {db,session}=setup();db.issuedIds.push('2019-0087');
  const preview=inspectSurvey(db,change(session));
  assert.match(preview.reviews.find(x=>x.kind==='id-change').message,/이미 사용 중/);
  assert.equal(applySurvey(db,change(session),{'id-change:2019-0034':'apply','new-id:2019-0034':'2020-0002'},preview.revision,2026).next.physicalBooks[0].physicalId,'2020-0002');
});

test('PC 직접 입력도 중복을 재검증하고 보류된 변경은 별도 처리한다',()=>{
  const {db,session}=setup(),report=change(session),p=inspectSurvey(db,report);
  db.issuedIds.push('2020-0001');
  assert.throws(()=>applySurvey(db,report,{'id-change:2019-0034':'apply','new-id:2019-0034':'20200001'},p.revision,2026),/이미 다른 책/);
  db.issuedIds.pop();
  const {next}=applySurvey(db,report,{'id-change:2019-0034':'defer'},p.revision,2026);
  assert.equal(next.reviewQueue[0].kind,'id-change');
  const resolved=resolveReview(next,next.reviewQueue[0].id,'apply-id-change','20200002',2026);
  assert.equal(resolved.next.physicalBooks[0].physicalId,'2020-0002');
});

test('기존 책의 입수일은 모바일 JSON 값을 무시하고 상태 enum은 유지한다',()=>{
  const {db,session}=setup(),report={schema:'angela-survey/v2',catalogId:'catalog',sessionId:session.id,entries:[{physicalId:'20190034',temporaryId:null,isNew:false,action:'UPDATE_INFO',titleRaw:'어린 왕자 개정판',publisherRaw:'문학동네',status:'DISCARDED',labelStatus:'PRESENT',acquiredDateRaw:'2099.01.01.'}]};
  const {next}=applySurvey(db,report,{},db.revision,2026);
  assert.equal(next.physicalBooks[0].acquiredDateRaw,'2009.04.28.');
  assert.equal(next.physicalBooks[0].status,'DISCARDED');
  assert.equal(next.physicalBooks[0].titleRaw,'어린 왕자 개정판');
  assert.deepEqual(['ACTIVE','DISCARDED','LOST','UNKNOWN'].map(statusName),['보유 중','폐기','분실','상태 미확인']);
});

test('같은 조사본에서 만든 작업자별 결과를 차례로 반영하고 동일 결과 재반영은 막는다',()=>{
  const {db,session}=setup();
  const first={...change(session),reportId:'worker-a'};
  const firstPreview=inspectSurvey(db,first);
  const {next}=applySurvey(db,first,{'id-change:2019-0034':'keep'},firstPreview.revision,2026);
  const second={...change(session),reportId:'worker-b',entries:[{...change(session).entries[0],action:'CONFIRM',oldPhysicalId:null,physicalId:'20190034'}]};
  const secondPreview=inspectSurvey(next,second);
  const applied=applySurvey(next,second,{},secondPreview.revision,2026).next;
  assert.equal(applied.applied.length,2);
  assert.equal(inspectSurvey(applied,first).entries.length,0);
});

test('과거 장부에서 찾은 기존 실물의 번호를 바꾸며 장부 연결을 보존한다',()=>{
  const {db,session}=setup();
  db.legacyRecords.push({recordId:'legacy-1',legacyLedgerId:'2019-0007',titleRaw:'어린 왕자',titleCanonical:'어린 왕자',publisherRaw:'문학동네',publisherCanonical:'문학동네'});
  const report={...change(session),entries:[{...change(session).entries[0],legacyRecordId:'legacy-1'}]};
  const preview=inspectSurvey(db,report);
  const {next}=applySurvey(db,report,{'id-change:2019-0034':'apply'},preview.revision,2026);
  assert.equal(next.physicalBooks[0].physicalId,'2019-0087');
  assert.equal(next.physicalBooks[0].legacyRecordId,'legacy-1');
  assert.ok(next.issuedIds.includes('2019-0034'));
  const later=createSession(next);next.sessions.push(later);
  const reuse={schema:'angela-survey/v2',catalogId:'catalog',sessionId:later.id,entries:[{physicalId:'2019-0034',temporaryId:null,isNew:true,titleRaw:'다른 책',publisherRaw:'출판사',status:'ACTIVE',labelStatus:'PRESENT'}]};
  assert.throws(()=>inspectSurvey(next,reuse),/이미 발급/);
});
