import {randomUUID} from 'node:crypto';
import {canonical, searchKey, textFields, search, publisherDictionary} from './normalize.mjs';

const fail=message=>{throw new Error(message);};
const insist=(ok,message)=>{if(!ok)fail(message);};
export const validId=id=>typeof id==='string' && /^\d{4}-\d{4}$/.test(id);
const now=()=>new Date().toISOString();
const clean=(kind,raw)=>textFields(kind,raw);
function publisherFields(db,raw){
  const value=String(raw??''),key=searchKey(value);
  const existing=(db.publishers||publisherDictionary(db.legacyRecords,db.physicalBooks)).find(x=>x.id===key);
  if(key){
    if(existing){if(value&&!existing.aliases.includes(value))existing.aliases.push(value);}
    else {db.publishers??=[];db.publishers.push({id:key,canonicalName:canonical(value),aliases:[value]});}
  }
  return {...clean('publisher',value),publisherCanonical:existing?.canonicalName||canonical(value)};
}

export function migrate(input) {
  if(input.schemaVersion===2) return {...input,publishers:input.publishers||publisherDictionary(input.legacyRecords||[],input.physicalBooks||[]),statusHistory:input.statusHistory||[]};
  const old=input.books||[];
  return {
    ...input,schemaVersion:2,
    legacyRecords:old.map((b,i)=>({recordId:`legacy-${i+1}`,sourceSheet:'이전 원장',sourceRow:i+2,
      legacyLedgerId:b.id||'',registeredDateRaw:'',registeredDateNormalized:'',
      ...clean('title',b.title),...clean('publisher',b.publisher||''),
      quantityRaw:b.qty,noteRaw:'',authorRaw:b.author||'',locationRaw:b.location||'',
      reviewRequired:false,reviewReason:'',version:b.version||1})),
    physicalBooks:[],issuedIds:[],reviewQueue:[],publishers:[],statusHistory:[],
    sessions:(input.sessions||[]).map(s=>({...s,legacyFormat:true})),
    applied:input.applied||[],disposals:input.disposals||[]
  };
}
export function emptyDb(catalogId=randomUUID()) {return migrate({catalogId,revision:0,books:[],sessions:[],applied:[],disposals:[]});}
export function addLegacy(db,rows) {
  insist(!db.legacyRecords.length && !db.physicalBooks.length,'이미 원장이 있습니다. 현재 원장을 덮어쓸 수 없습니다.');
  const next=structuredClone(db);
  next.legacyRecords=rows.map((r,i)=>({recordId:randomUUID(),sourceSheet:r.sourceSheet||'첫 번째 시트',sourceRow:r.sourceRow||i+2,
    legacyLedgerId:String(r.legacyLedgerId??''),registeredDateRaw:String(r.registeredDateRaw??''),registeredDateNormalized:r.registeredDateNormalized||'',
    ...clean('title',r.titleRaw),...clean('publisher',r.publisherRaw),quantityRaw:r.quantityRaw,
    noteRaw:String(r.noteRaw??''),authorRaw:String(r.authorRaw??''),locationRaw:String(r.locationRaw??''),
    reviewRequired:!!r.reviewRequired||(/\d\s*[-~～]\s*\d|\d\s*\(\s*\d+\s*\)/u.test(String(r.noteRaw??''))),
    reviewReason:r.reviewReason||(/\d\s*[-~～]\s*\d|\d\s*\(\s*\d+\s*\)/u.test(String(r.noteRaw??''))?'quantity/note interpretation':''),version:1}));
  next.publishers=publisherDictionary(next.legacyRecords,next.physicalBooks);
  next.revision++;
  return next;
}
export function createSession(db,worker='',area='') {
  return {id:randomUUID(),schema:'angela-package/v2',catalogId:db.catalogId,createdAt:now(),worker:canonical(worker),area:canonical(area),
    physicalBooks:structuredClone(db.physicalBooks),legacyRecords:structuredClone(db.legacyRecords),publishers:structuredClone(db.publishers||[])};
}
export function lookup(db,query,limit=20) {
  return {physical:search(query,db.physicalBooks,limit),legacy:search(query,db.legacyRecords,limit),publishers:search(query,(db.publishers||publisherDictionary(db.legacyRecords,db.physicalBooks)).map(p=>({publisherCanonical:p.canonicalName,publisherSearch:searchKey(p.canonicalName),...p})),limit)};
}
function normalizedEntry(e) {
  insist(e && typeof e==='object','조사 항목 형식이 올바르지 않습니다.');
  const physicalId=e.physicalId||null,temporaryId=e.temporaryId||null;
  insist((physicalId&&validId(physicalId)) || (temporaryId&&typeof temporaryId==='string'&&temporaryId.startsWith('temp-')),'실물 번호 또는 임시 ID가 필요합니다.');
  insist(!(physicalId&&temporaryId),'실물 번호와 임시 ID를 함께 지정할 수 없습니다.');
  insist(typeof e.isNew==='boolean','기존 실물 또는 신규 실물 구분이 필요합니다.');
  insist(['ACTIVE','DISCARDED','LOST','UNKNOWN'].includes(e.status),'실물 상태가 올바르지 않습니다.');
  insist(['PRESENT','MISSING','DAMAGED','UNKNOWN'].includes(e.labelStatus),'번호표 상태가 올바르지 않습니다.');
  insist(typeof e.titleRaw==='string' && canonical(e.titleRaw),'도서명을 입력하세요.');
  insist(typeof e.publisherRaw==='string','출판사 형식이 올바르지 않습니다.');
  insist(!e.legacyRecordId || typeof e.legacyRecordId==='string','장부 연결 형식이 올바르지 않습니다.');
  return {...e,physicalId,temporaryId,volume:canonical(e.volume||''),note:String(e.note||''),acquiredDateRaw:String(e.acquiredDateRaw||''),
    ...clean('title',e.titleRaw),...clean('publisher',e.publisherRaw)};
}
export function inspectSurvey(db,report) {
  insist(report?.schema==='angela-survey/v2' && report.catalogId===db.catalogId,'이 원장의 조사 JSON v2가 아닙니다.');
  const session=db.sessions.find(s=>s.id===report.sessionId && !s.legacyFormat);
  insist(session,'조사 기준본을 찾을 수 없습니다.');
  insist(!db.applied.some(x=>x.sessionId===report.sessionId),'이미 반영한 조사입니다.');
  insist(Array.isArray(report.entries)&&report.entries.length>0&&report.entries.length<=10000,'조사 항목이 없습니다.');
  const entries=report.entries.map(normalizedEntry),seen=new Map(),reviews=[];
  for(const e of entries){
    const id=e.physicalId||e.temporaryId;
    if(seen.has(id)){
      const prev=seen.get(id);
      insist(JSON.stringify({...prev,recordedAt:null})===JSON.stringify({...e,recordedAt:null}),`같은 실물 ${id}의 조사 내용이 서로 다릅니다. 작업자가 확인해야 합니다.`);
    } else seen.set(id,e);
  }
  const unique=[...seen.values()];
  for(const e of unique){
    if(e.legacyRecordId) insist(db.legacyRecords.some(x=>x.recordId===e.legacyRecordId),'연결할 장부 항목을 찾을 수 없습니다.');
    const current=db.physicalBooks.find(x=>x.physicalId===e.physicalId);
    const baseline=session.physicalBooks.find(x=>x.physicalId===e.physicalId);
    if(current&&e.isNew)fail(`이미 등록된 실물번호입니다: ${e.physicalId}`);
    if(e.physicalId&&!current&&!e.isNew)fail(`기존 실물을 찾을 수 없습니다: ${e.physicalId}`);
    if(e.physicalId && !current && db.issuedIds.includes(e.physicalId)) fail(`이미 발급된 실물 번호입니다: ${e.physicalId}`);
    if(current && !baseline) reviews.push({key:`existing:${e.physicalId}`,kind:'existing',entryId:e.physicalId,message:'조사 시작 이후 등록된 실물 번호입니다.',options:['keep','apply']});
    if(current && baseline && current.version!==baseline.version) reviews.push({key:`conflict:${e.physicalId}`,kind:'conflict',entryId:e.physicalId,message:'조사 시작 이후 PC에서 변경된 실물입니다.',options:['keep','apply']});
    if(e.temporaryId) reviews.push({key:`unidentified:${e.temporaryId}`,kind:'unidentified',entryId:e.temporaryId,message:e.labelStatus==='PRESENT'?'신규 책의 번호 발급을 결정하세요.':'번호 없는 책입니다. 기존 실물인지 확인하세요.',options:['defer','issue','link']});
    if(e.candidateChoice==='uncertain') reviews.push({key:`uncertain:${idOf(e)}`,kind:'uncertain',entryId:idOf(e),message:'작업자가 기존 책인지 확실하지 않다고 표시했습니다.',options:['confirm','defer']});
    if(e.physicalId && e.legacyRecordId){const legacy=db.legacyRecords.find(x=>x.recordId===e.legacyRecordId);if(legacy.legacyLedgerId && legacy.legacyLedgerId!==e.physicalId)reviews.push({key:`mapping:${idOf(e)}`,kind:'mapping',entryId:idOf(e),message:`실물 ${e.physicalId} ↔ 과거 장부 ${legacy.legacyLedgerId}`,options:['confirm','defer']});}
    const candidates=search(e.titleRaw,db.physicalBooks.filter(x=>x.physicalId!==e.physicalId),5).filter(x=>x.matchScore>=55);
    if(!current && candidates.length) reviews.push({key:`similar:${idOf(e)}`,kind:'similar',entryId:idOf(e),message:'유사한 기존 실물이 있습니다.',candidates:candidates.map(x=>({physicalId:x.physicalId,title:x.titleCanonical,score:x.matchScore})),options:e.physicalId?['distinct','defer']:['distinct','link','defer']});
  }
  return {revision:db.revision,entries:unique,reviews};
}
const idOf=e=>e.physicalId||e.temporaryId;
export function nextPhysicalId(db,year,reserved=[]) {
  insist(Number.isInteger(year)&&year>=2000&&year<=9999,'발급 연도를 확인하세요.');
  const prefix=`${year}-`;
  const all=[...db.issuedIds,...db.physicalBooks.map(x=>x.physicalId),...reserved];
  const max=Math.max(0,...all.filter(x=>x?.startsWith(prefix)).map(x=>Number(x.slice(5))));
  insist(max<9999,'해당 연도의 번호를 모두 사용했습니다.');
  return `${prefix}${String(max+1).padStart(4,'0')}`;
}
export function applySurvey(db,report,decisions,revision,year) {
  insist(revision===db.revision,'검사 후 원장이 변경되었습니다. 다시 검사하세요.');
  const inspected=inspectSurvey(db,report),next=structuredClone(db),mapping=[];
  for(const review of inspected.reviews) insist(review.options.includes(decisions?.[review.key]),`검토 항목을 결정하세요: ${review.message}`);
  for(const e of inspected.entries){
    const key=idOf(e);
    if(['keep','defer'].includes(decisions?.[`conflict:${key}`])||decisions?.[`existing:${key}`]==='keep')continue;
    if(decisions?.[`mapping:${key}`]==='defer'||decisions?.[`similar:${key}`]==='defer'||decisions?.[`unidentified:${key}`]==='defer'||decisions?.[`uncertain:${key}`]==='defer'){
      next.reviewQueue.push({id:randomUUID(),kind:'unresolved',entry:e,sessionId:report.sessionId,createdAt:now()});continue;
    }
    let id=e.physicalId;
    const selected=decisions?.[`similar:${key}`];
    if(selected==='link')insist(decisions?.[`unidentified:${key}`]==='link','기존 실물 연결 결정을 일치시키세요.');
    if(selected==='distinct')insist(decisions?.[`unidentified:${key}`]!=='link','신규 등록과 기존 실물 연결을 동시에 선택할 수 없습니다.');
    if(selected==='link'||decisions?.[`unidentified:${key}`]==='link'){
      id=decisions?.[`link:${key}`];
      insist(validId(id)&&next.physicalBooks.some(x=>x.physicalId===id),'연결할 기존 실물 번호를 선택하세요.');
    }
    if(!id){id=nextPhysicalId(next,year);mapping.push({temporaryId:e.temporaryId,physicalId:id,title:e.titleCanonical});}
    let old=next.physicalBooks.find(x=>x.physicalId===id);
    if(!old) insist(!next.issuedIds.includes(id),`이미 발급된 실물 번호입니다: ${id}`);
    const linked=!!(selected==='link'||decisions?.[`unidentified:${key}`]==='link');
    const row={physicalId:id,temporaryId:null,legacyRecordId:e.legacyRecordId||null,...clean('title',e.titleRaw),...publisherFields(next,e.publisherRaw),
      volume:e.volume,status:e.status,labelStatus:e.labelStatus,note:e.note,acquiredDateRaw:e.acquiredDateRaw||old?.acquiredDateRaw||'',version:(old?.version||0)+1,
      createdAt:old?.createdAt||now(),updatedAt:now(),discardedAt:e.status==='DISCARDED'?(old?.discardedAt||now()):null,
      authorRaw:e.authorRaw||'',locationRaw:e.locationRaw||''};
    if(linked&&old){Object.assign(row,{legacyRecordId:e.legacyRecordId||old.legacyRecordId,titleRaw:old.titleRaw,titleCanonical:old.titleCanonical,titleSearch:old.titleSearch,publisherRaw:old.publisherRaw,publisherCanonical:old.publisherCanonical,publisherSearch:old.publisherSearch,volume:old.volume,authorRaw:old.authorRaw,locationRaw:old.locationRaw,status:e.status==='UNKNOWN'?old.status:e.status});}
    if(old)next.physicalBooks[next.physicalBooks.indexOf(old)]=row;else next.physicalBooks.push(row);
    if(!old||old.status!==row.status)next.statusHistory.push({physicalId:id,from:old?.status||null,to:row.status,at:now(),sessionId:report.sessionId});
    if(!next.issuedIds.includes(id))next.issuedIds.push(id);
    if(e.status==='DISCARDED'&&old?.status!=='DISCARDED')next.disposals.push({physicalId:id,legacyRecordId:e.legacyRecordId||null,title:e.titleCanonical,at:row.discardedAt,note:e.note,sessionId:report.sessionId});
  }
  next.applied.push({sessionId:report.sessionId,at:now(),mapping});next.revision++;
  return {next,mapping};
}
export function resolveReview(db,reviewId,mode,physicalId,year,status){
  const next=structuredClone(db),index=next.reviewQueue.findIndex(x=>x.id===reviewId);
  insist(index>=0,'검토 항목을 찾을 수 없습니다.');
  const pending=next.reviewQueue[index],e=pending.entry;
  insist(['issue','link','dismiss'].includes(mode),'처리 방법을 선택하세요.');
  insist(!status||['ACTIVE','DISCARDED','LOST','UNKNOWN'].includes(status),'실물 상태가 올바르지 않습니다.');
  let id=null;
  if(mode==='issue'){
    id=e.physicalId||nextPhysicalId(next,year);
    insist(!next.issuedIds.includes(id)&&!next.physicalBooks.some(x=>x.physicalId===id),'이미 발급된 실물번호입니다.');
    next.issuedIds.push(id);
  }
  if(mode==='link'){
    insist(!e.physicalId,'번호가 있는 실물은 다른 번호에 연결할 수 없습니다.');
    insist(validId(physicalId)&&next.physicalBooks.some(x=>x.physicalId===physicalId),'기존 실물번호를 확인하세요.');id=physicalId;
  }
  if(id){
    const old=next.physicalBooks.find(x=>x.physicalId===id);
    const row={physicalId:id,temporaryId:null,legacyRecordId:e.legacyRecordId||old?.legacyRecordId||null,...clean('title',e.titleRaw),...publisherFields(next,e.publisherRaw),
      volume:e.volume||'',status:status||e.status,labelStatus:e.labelStatus,note:e.note||'',acquiredDateRaw:e.acquiredDateRaw||old?.acquiredDateRaw||'',version:(old?.version||0)+1,
      createdAt:old?.createdAt||now(),updatedAt:now(),discardedAt:(status||e.status)==='DISCARDED'?(old?.discardedAt||now()):null,
      authorRaw:e.authorRaw||'',locationRaw:e.locationRaw||''};
    if(mode==='link'&&old){Object.assign(row,{titleRaw:old.titleRaw,titleCanonical:old.titleCanonical,titleSearch:old.titleSearch,publisherRaw:old.publisherRaw,publisherCanonical:old.publisherCanonical,publisherSearch:old.publisherSearch,volume:old.volume,authorRaw:old.authorRaw,locationRaw:old.locationRaw});}
    if(old)next.physicalBooks[next.physicalBooks.indexOf(old)]=row;else next.physicalBooks.push(row);
    if(!old||old.status!==row.status)next.statusHistory.push({physicalId:id,from:old?.status||null,to:row.status,at:now(),sessionId:pending.sessionId});
    if(row.status==='DISCARDED'&&old?.status!=='DISCARDED')next.disposals.push({physicalId:id,legacyRecordId:row.legacyRecordId,title:row.titleCanonical,at:row.discardedAt,note:row.note,sessionId:pending.sessionId});
  }
  next.reviewQueue.splice(index,1);
  next.reviewHistory=[...(next.reviewHistory||[]),{reviewId,mode,physicalId:id,at:now(),entry:e}];
  next.revision++;
  return {next,physicalId:id};
}
export function resolveLegacyReview(db,recordId){
  const next=structuredClone(db),record=next.legacyRecords.find(x=>x.recordId===recordId);
  insist(record&&record.reviewRequired,'검토할 장부 항목을 찾을 수 없습니다.');
  record.reviewRequired=false;
  next.reviewHistory=[...(next.reviewHistory||[]),{kind:'legacy-quality',recordId,at:now(),quantityRaw:record.quantityRaw,noteRaw:record.noteRaw}];
  next.revision++;
  return next;
}
