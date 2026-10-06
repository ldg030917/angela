import {randomUUID} from 'node:crypto';
import {canonical, searchKey, textFields, search, publisherDictionary} from './normalize.mjs';
import {normalizePhysicalId,validatePhysicalId,isPhysicalIdAlreadyIssued} from './physical-id.mjs';

const fail=message=>{throw new Error(message);};
const insist=(ok,message)=>{if(!ok)fail(message);};
export const validId=validatePhysicalId;
const now=()=>new Date().toISOString();
const clean=(kind,raw)=>textFields(kind,raw);
function acquisitionInput(input){
  const year=Number(input.year),quantity=Number(input.quantity),date=String(input.acquiredDateRaw||'').trim();
  insist(Number.isInteger(year)&&year>=2000&&year<=9999,'발급 연도를 확인하세요.');
  insist(Number.isInteger(quantity)&&quantity>=1&&quantity<=100,'매수는 1~100으로 입력하세요.');
  insist(/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date,'입수일을 확인하세요.');
  insist(canonical(input.titleRaw),'도서명을 입력하세요.');
  insist(canonical(input.publisherRaw),'출판사를 입력하세요.');
  return {year,quantity,acquiredDateRaw:date,titleRaw:String(input.titleRaw),publisherRaw:String(input.publisherRaw)};
}
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
    physicalBooks:structuredClone(db.physicalBooks),legacyRecords:structuredClone(db.legacyRecords),publishers:structuredClone(db.publishers||[]),issuedIds:structuredClone(db.issuedIds||[])};
}
export function lookup(db,query,limit=20) {
  return {physical:search(query,db.physicalBooks,limit),legacy:search(query,db.legacyRecords,limit),publishers:search(query,(db.publishers||publisherDictionary(db.legacyRecords,db.physicalBooks)).map(p=>({publisherCanonical:p.canonicalName,publisherSearch:searchKey(p.canonicalName),...p})),limit)};
}
function normalizedEntry(e) {
  insist(e && typeof e==='object','조사 항목 형식이 올바르지 않습니다.');
  const physicalId=e.physicalId?normalizePhysicalId(e.physicalId):null,temporaryId=e.temporaryId||null;
  const oldPhysicalId=e.oldPhysicalId?normalizePhysicalId(e.oldPhysicalId):null;
  const originalPhysicalId=e.originalPhysicalId?normalizePhysicalId(e.originalPhysicalId):null;
  const action=e.action||null;
  insist(!action||['CONFIRM','UPDATE_INFO','CHANGE_PHYSICAL_ID','NEW_ACQUISITION'].includes(action),'조사 처리 형식이 올바르지 않습니다.');
  if(action==='NEW_ACQUISITION'){
    const fields=acquisitionInput({...e,year:e.issuedYear,quantity:1});
    insist(e.isNew&&!temporaryId&&physicalId?.startsWith(String(fields.year)+'-')&&!e.legacyRecordId&&e.status==='ACTIVE','신규 입수 항목 형식이 올바르지 않습니다.');
  }
  if(action==='CHANGE_PHYSICAL_ID')insist(oldPhysicalId&&physicalId&&oldPhysicalId!==physicalId&&!e.isNew&&!temporaryId,'기존 번호와 서로 다른 새 실물번호가 필요합니다.');
  insist((physicalId&&validId(physicalId)) || (temporaryId&&typeof temporaryId==='string'&&temporaryId.startsWith('temp-')),'실물 번호 또는 임시 ID가 필요합니다.');
  insist(!(physicalId&&temporaryId),'실물 번호와 임시 ID를 함께 지정할 수 없습니다.');
  insist(typeof e.isNew==='boolean','기존 실물 또는 신규 실물 구분이 필요합니다.');
  insist(!originalPhysicalId||e.isNew,'원래 실물번호는 신규 조사 기록에만 지정할 수 있습니다.');
  insist(['ACTIVE','DISCARDED','LOST','UNKNOWN'].includes(e.status),'실물 상태가 올바르지 않습니다.');
  insist(['PRESENT','MISSING','DAMAGED','UNKNOWN'].includes(e.labelStatus),'번호표 상태가 올바르지 않습니다.');
  insist(typeof e.titleRaw==='string' && canonical(e.titleRaw),'도서명을 입력하세요.');
  insist(typeof e.publisherRaw==='string','출판사 형식이 올바르지 않습니다.');
  insist(!e.legacyRecordId || typeof e.legacyRecordId==='string','장부 연결 형식이 올바르지 않습니다.');
  return {...e,physicalId,oldPhysicalId,...(originalPhysicalId?{originalPhysicalId}:{}),action,temporaryId,volume:canonical(e.volume||''),note:String(e.note||''),acquiredDateRaw:String(e.acquiredDateRaw||''),
    ...clean('title',e.titleRaw),...clean('publisher',e.publisherRaw)};
}
const entryKey=e=>e.action==='CHANGE_PHYSICAL_ID'?e.oldPhysicalId:e.originalPhysicalId||idOf(e);
const entrySignature=e=>JSON.stringify(Object.fromEntries(Object.entries(e).filter(([key])=>key!=='recordedAt').sort(([a],[b])=>a.localeCompare(b))));
function previousReport(db,report){
  const sameId=(db.applied||[]).filter(x=>report.reportId&&x.reportId===report.reportId&&x.sessionId===report.sessionId);
  return sameId.at(-1)||(db.applied||[]).filter(x=>!x.reportId&&x.sessionId===report.sessionId).at(-1)||null;
}
function appliedPhysicalId(db,report,key){
  const records=(db.applied||[]).filter(x=>x.sessionId===report.sessionId&&(!report.reportId||x.reportId===report.reportId||!x.reportId));
  let current=key;
  for(const applied of records){
    const match=applied.mapping?.find(x=>x.temporaryId===current||x.oldPhysicalId===current);
    if(match)current=match.physicalId;
  }
  return current;
}function reflectedByCurrent(db,report,e){
  const id=appliedPhysicalId(db,report,entryKey(e));
  const current=db.physicalBooks.find(x=>x.physicalId===id);
  if(!current)return false;
  if(e.action==='CHANGE_PHYSICAL_ID')return current.physicalId===e.physicalId;
  if(current.status!==e.status||current.labelStatus!==e.labelStatus)return false;
  if(e.action==='CONFIRM')return true;
  if(e.action==='NEW_ACQUISITION')return current.titleCanonical===e.titleCanonical&&current.publisherCanonical===e.publisherCanonical&&current.acquiredDateRaw===e.acquiredDateRaw;
  return current.titleCanonical===e.titleCanonical&&current.publisherCanonical===e.publisherCanonical&&current.note===e.note&&(!e.acquiredDateRaw||current.acquiredDateRaw===e.acquiredDateRaw);
}
export function inspectSurvey(db,report) {
  insist(report?.schema==='angela-survey/v2' && report.catalogId===db.catalogId,'이 원장의 조사 JSON v2가 아닙니다.');
  const session=db.sessions.find(s=>s.id===report.sessionId && !s.legacyFormat);
  insist(session,'조사 기준본을 찾을 수 없습니다.');
  insist(Array.isArray(report.entries)&&report.entries.length>0&&report.entries.length<=10000,'조사 항목이 없습니다.');
  const entries=report.entries.map(normalizedEntry),seen=new Map(),reviews=[];
  for(const e of entries){
    const id=e.physicalId||e.temporaryId;
    if(seen.has(id)){
      const prev=seen.get(id);
      insist(JSON.stringify({...prev,recordedAt:null})===JSON.stringify({...e,recordedAt:null}),`같은 실물 ${id}의 조사 내용이 서로 다릅니다. 작업자가 확인해야 합니다.`);
    } else seen.set(id,e);
  }
  const allEntries=[...seen.values()],previous=previousReport(db,report),previousSignatures=previous?.entrySignatures||{};
  const previouslyApplied=new Set();
  const unique=allEntries.filter(e=>{
    if(!previous)return true;
    const key=entryKey(e),signature=entrySignature(e);
    if(Object.hasOwn(previousSignatures,key)){
      previouslyApplied.add(key);
      return previousSignatures[key]!==signature;
    }
    if(!previous.entrySignatures&&reflectedByCurrent(db,report,e)){previouslyApplied.add(key);return false;}
    if(!previous.entrySignatures&&db.physicalBooks.some(x=>x.physicalId===appliedPhysicalId(db,report,key)))previouslyApplied.add(key);
    return true;
  });
  for(const e of unique.filter(x=>x.action==='CHANGE_PHYSICAL_ID'))insist(!unique.some(x=>x!==e&&(x.physicalId===e.oldPhysicalId||x.oldPhysicalId===e.oldPhysicalId)),'한 조사에서 같은 기존 실물번호를 중복 처리할 수 없습니다.');
  for(const e of unique){
    const key=entryKey(e);
    if(previouslyApplied.has(key))reviews.push({key:'reimport:'+key,kind:'reimport',entryId:idOf(e),message:'이전에 반영한 '+key+'의 조사 내용이 변경되었습니다. 새 내용을 적용할지 확인하세요.',options:['apply','keep','defer']});
    if(e.legacyRecordId) insist(db.legacyRecords.some(x=>x.recordId===e.legacyRecordId),'연결할 장부 항목을 찾을 수 없습니다.');
    const priorId=e.originalPhysicalId&&previouslyApplied.has(key)?appliedPhysicalId(db,report,key):null;
    if(priorId&&priorId!==e.physicalId&&db.physicalBooks.some(x=>x.physicalId===priorId)){
      const occupied=isPhysicalIdAlreadyIssued(db,e.physicalId);
      reviews.push({key:`id-change:${priorId}`,kind:'id-change',entryId:e.physicalId,oldPhysicalId:priorId,physicalId:e.physicalId,message:`조사 기록의 실물번호 수정: ${priorId} → ${e.physicalId}${occupied?' · 새 번호가 이미 사용 중입니다. 다른 번호를 입력하거나 보류하세요.':''}`,options:['keep','apply','defer']});
      continue;
    }    if(e.action==='CHANGE_PHYSICAL_ID'){
      const old=db.physicalBooks.find(x=>x.physicalId===e.oldPhysicalId);
      const baseline=session.physicalBooks.find(x=>x.physicalId===e.oldPhysicalId);
      insist(old&&baseline,'번호를 바꿀 기존 실물을 찾을 수 없습니다.');
      const occupied=isPhysicalIdAlreadyIssued(db,e.physicalId);
      if(old.version!==baseline.version)reviews.push({key:`conflict:${e.oldPhysicalId}`,kind:'conflict',entryId:e.oldPhysicalId,message:`${e.oldPhysicalId}의 정보가 조사 시작 후 PC에서 변경되었습니다.`,options:['keep','apply']});
      reviews.push({key:`id-change:${e.oldPhysicalId}`,kind:'id-change',entryId:e.physicalId,oldPhysicalId:e.oldPhysicalId,physicalId:e.physicalId,message:`실물번호 변경 요청: ${e.oldPhysicalId} → ${e.physicalId}${occupied?' · 새 번호가 이미 사용 중입니다. 다른 번호를 입력하거나 보류하세요.':''}`,options:['keep','apply','defer']});
      continue;
    }
    if(e.action==='NEW_ACQUISITION')continue;
    const current=db.physicalBooks.find(x=>x.physicalId===e.physicalId);
    const baseline=session.physicalBooks.find(x=>x.physicalId===e.physicalId);
    if(current&&e.isNew&&!previouslyApplied.has(key))fail(`이미 등록된 실물번호입니다: ${e.physicalId}`);
    if(e.physicalId&&!current&&!e.isNew)fail(`기존 실물을 찾을 수 없습니다: ${e.physicalId}`);
    if(e.physicalId && !current && db.issuedIds.includes(e.physicalId)&&!previouslyApplied.has(key)) fail(`이미 발급된 실물 번호입니다: ${e.physicalId}`);
    if(['CONFIRM','UPDATE_INFO'].includes(e.action))insist(current&&!e.isNew,'기존 실물 처리 대상이 아닙니다.');
    if(current && !baseline) reviews.push({key:`existing:${e.physicalId}`,kind:'existing',entryId:e.physicalId,message:'조사 시작 이후 등록된 실물 번호입니다.',options:['keep','apply']});
    if(current && baseline && current.version!==baseline.version) reviews.push({key:`conflict:${e.physicalId}`,kind:'conflict',entryId:e.physicalId,message:'조사 시작 이후 PC에서 변경된 실물입니다.',options:['keep','apply']});
    if(e.temporaryId) reviews.push({key:`unidentified:${e.temporaryId}`,kind:'unidentified',entryId:e.temporaryId,message:e.labelStatus==='PRESENT'?'신규 책의 번호 발급을 결정하세요.':'번호 없는 책입니다. 기존 실물인지 확인하세요.',options:['defer','issue','link']});
    if(e.candidateChoice==='uncertain') reviews.push({key:`uncertain:${idOf(e)}`,kind:'uncertain',entryId:idOf(e),message:'작업자가 기존 책인지 확실하지 않다고 표시했습니다.',options:['confirm','defer']});
    if(e.physicalId && e.legacyRecordId){const legacy=db.legacyRecords.find(x=>x.recordId===e.legacyRecordId);if(legacy.legacyLedgerId && legacy.legacyLedgerId!==e.physicalId)reviews.push({key:`mapping:${idOf(e)}`,kind:'mapping',entryId:idOf(e),message:`실물 ${e.physicalId} ↔ 과거 장부 ${legacy.legacyLedgerId}`,options:['confirm','defer']});}
    const candidates=search(e.titleRaw,db.physicalBooks.filter(x=>x.physicalId!==e.physicalId),5).filter(x=>x.matchScore>=55);
    if(!current && candidates.length) reviews.push({key:`similar:${idOf(e)}`,kind:'similar',entryId:idOf(e),message:'유사한 기존 실물이 있습니다.',candidates:candidates.map(x=>({physicalId:x.physicalId,title:x.titleCanonical,score:x.matchScore})),options:e.physicalId?['distinct','defer']:['distinct','link','defer']});
  }
  return {revision:db.revision,entries:unique,reviews,unchangedCount:allEntries.length-unique.length,entrySignatures:Object.fromEntries(allEntries.map(e=>[entryKey(e),entrySignature(e)]))};
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
export function addNewAcquisition(db,input){
  const fields=acquisitionInput(input),next=structuredClone(db),ids=[];
  for(let i=0;i<fields.quantity;i++){
    const id=nextPhysicalId(next,fields.year),stamp=now();
    next.physicalBooks.push({physicalId:id,temporaryId:null,legacyRecordId:null,...clean('title',fields.titleRaw),...publisherFields(next,fields.publisherRaw),volume:'',quantity:1,status:'ACTIVE',labelStatus:'MISSING',note:'',acquiredDateRaw:fields.acquiredDateRaw,version:1,createdAt:stamp,updatedAt:stamp,discardedAt:null,authorRaw:'',locationRaw:''});
    next.issuedIds.push(id);next.statusHistory.push({physicalId:id,from:null,to:'ACTIVE',at:stamp,sessionId:null});ids.push(id);
  }
  next.revision++;
  return {next,ids};
}
export function editPhysicalBook(db,oldPhysicalId,input){
  const next=structuredClone(db),oldId=normalizePhysicalId(oldPhysicalId),index=next.physicalBooks.findIndex(x=>x.physicalId===oldId);
  insist(index>=0,'수정할 실물을 찾을 수 없습니다.');
  const old=next.physicalBooks[index],id=normalizePhysicalId(input.physicalId);
  insist(Number(input.version)===old.version,'다른 작업에서 실물이 변경되었습니다. 목록을 새로 확인하세요.');
  insist(id===oldId||!isPhysicalIdAlreadyIssued(next,id),'이 실물 번호는 이미 다른 책에 사용 중입니다.');
  insist(canonical(input.titleRaw),'도서명을 입력하세요.');
  insist(canonical(input.publisherRaw),'출판사를 입력하세요.');
  insist(['ACTIVE','DISCARDED','LOST','UNKNOWN'].includes(input.status),'실물 상태가 올바르지 않습니다.');
  const date=String(input.acquiredDateRaw||'').trim();
  insist(!date||/^\d{4}[-.]\d{2}[-.]\d{2}\.?$/.test(date),'입수일 형식을 확인하세요.');
  const stamp=now(),row={...old,physicalId:id,...clean('title',input.titleRaw),...publisherFields(next,input.publisherRaw),acquiredDateRaw:date,status:input.status,quantity:1,version:old.version+1,updatedAt:stamp,discardedAt:input.status==='DISCARDED'?(old.discardedAt||stamp):null};
  next.physicalBooks[index]=row;
  if(!next.issuedIds.includes(oldId))next.issuedIds.push(oldId);
  if(id!==oldId){next.issuedIds.push(id);next.idChanges=[...(next.idChanges||[]),{oldPhysicalId:oldId,newPhysicalId:id,sessionId:null,at:stamp}];}
  if(old.status!==row.status)next.statusHistory.push({physicalId:id,from:old.status,to:row.status,at:stamp,sessionId:null});
  if(row.status==='DISCARDED'&&old.status!=='DISCARDED')next.disposals.push({physicalId:id,legacyRecordId:row.legacyRecordId,title:row.titleCanonical,at:stamp,note:'PC에서 상태 수정',sessionId:null});
  next.revision++;
  return next;
}
function applyIdChange(next,e,newId,sessionId){
  const id=normalizePhysicalId(newId);
  const old=next.physicalBooks.find(x=>x.physicalId===e.oldPhysicalId);
  insist(old,'번호를 바꿀 기존 실물을 찾을 수 없습니다.');
  insist(id!==e.oldPhysicalId&&!isPhysicalIdAlreadyIssued(next,id),'이 실물 번호는 이미 다른 책에 사용 중입니다.');
  const stamp=now(),legacy=next.legacyRecords.find(x=>x.recordId===(e.legacyRecordId||old.legacyRecordId)),row={...old,physicalId:id,acquiredDateRaw:old.acquiredDateRaw||legacy?.registeredDateRaw||'',legacyRecordId:e.legacyRecordId||old.legacyRecordId,...clean('title',e.titleRaw),...publisherFields(next,e.publisherRaw),volume:e.volume,status:e.status,labelStatus:e.labelStatus,note:e.note||old.note,version:old.version+1,updatedAt:stamp,discardedAt:e.status==='DISCARDED'?(old.discardedAt||stamp):null};
  next.physicalBooks[next.physicalBooks.indexOf(old)]=row;
  if(old.status!==row.status)next.statusHistory.push({physicalId:id,from:old.status,to:row.status,at:stamp,sessionId});
  if(row.status==='DISCARDED'&&old.status!=='DISCARDED')next.disposals.push({physicalId:id,legacyRecordId:row.legacyRecordId,title:row.titleCanonical,at:stamp,note:e.note,sessionId});
  if(!next.issuedIds.includes(e.oldPhysicalId))next.issuedIds.push(e.oldPhysicalId);
  next.issuedIds.push(id);
  next.idChanges=[...(next.idChanges||[]),{oldPhysicalId:e.oldPhysicalId,newPhysicalId:id,sessionId,at:now()}];
  return {oldPhysicalId:e.oldPhysicalId,physicalId:id,title:old.titleCanonical};
}
export function applySurvey(db,report,decisions,revision,year) {
  insist(revision===db.revision,'검사 후 원장이 변경되었습니다. 다시 검사하세요.');
  const inspected=inspectSurvey(db,report),next=structuredClone(db),mapping=[];
  insist(inspected.entries.length>0,'이전에 반영한 조사와 비교해 변경된 항목이 없습니다.');
  for(const review of inspected.reviews) insist(review.options.includes(decisions?.[review.key]),`검토 항목을 결정하세요: ${review.message}`);
  for(const e of inspected.entries){
    const key=idOf(e),reimport=decisions?.['reimport:'+entryKey(e)];
    if(reimport==='keep')continue;
    if(reimport==='defer'){next.reviewQueue.push({id:randomUUID(),kind:'unresolved',entry:e,sessionId:report.sessionId,createdAt:now()});continue;}
    const prior=previousReport(db,report),priorKey=entryKey(e);
    const priorId=e.originalPhysicalId&&prior?.entrySignatures&&Object.hasOwn(prior.entrySignatures,priorKey)?appliedPhysicalId(db,report,priorKey):null;
    if(priorId&&priorId!==e.physicalId&&next.physicalBooks.some(x=>x.physicalId===priorId)){
      const choice=decisions?.[`id-change:${priorId}`];
      if(choice==='keep')continue;
      if(choice==='defer'){next.reviewQueue.push({id:randomUUID(),kind:'id-change',entry:{...e,oldPhysicalId:priorId,isNew:false},sessionId:report.sessionId,createdAt:now()});continue;}
      mapping.push(applyIdChange(next,{...e,oldPhysicalId:priorId},decisions?.[`new-id:${priorId}`]||e.physicalId,report.sessionId));
      continue;
    }    if(e.action==='NEW_ACQUISITION'){
      const existingId=reimport==='apply'?appliedPhysicalId(db,report,entryKey(e)):null;
      const existing=existingId?next.physicalBooks.find(x=>x.physicalId===existingId):null;
      if(existing){
        insist(existing.physicalId.startsWith(String(e.issuedYear)+'-'),'기존 입수 번호의 연도 변경은 PC 실물 목록에서 수정하세요.');
        Object.assign(next,editPhysicalBook(next,existingId,{physicalId:existingId,version:existing.version,acquiredDateRaw:e.acquiredDateRaw,titleRaw:e.titleRaw,publisherRaw:e.publisherRaw,status:'ACTIVE'}));
      }else{
        const {next:created,ids}=addNewAcquisition(next,{year:e.issuedYear,quantity:1,acquiredDateRaw:e.acquiredDateRaw,titleRaw:e.titleRaw,publisherRaw:e.publisherRaw});
        Object.assign(next,created);mapping.push({temporaryId:e.physicalId,physicalId:ids[0],title:e.titleCanonical});
      }
      continue;
    }
    if(e.action==='CHANGE_PHYSICAL_ID'){
      const choice=decisions?.[`id-change:${e.oldPhysicalId}`];
      if(choice==='keep'||decisions?.[`conflict:${e.oldPhysicalId}`]==='keep')continue;
      if(choice==='defer'){next.reviewQueue.push({id:randomUUID(),kind:'id-change',entry:e,sessionId:report.sessionId,createdAt:now()});continue;}
      mapping.push(applyIdChange(next,e,decisions?.[`new-id:${e.oldPhysicalId}`]||e.physicalId,report.sessionId));
      continue;
    }
    if(['keep','defer'].includes(decisions?.[`conflict:${key}`])||decisions?.[`existing:${key}`]==='keep')continue;
    if(decisions?.[`mapping:${key}`]==='defer'||decisions?.[`similar:${key}`]==='defer'||decisions?.[`unidentified:${key}`]==='defer'||decisions?.[`uncertain:${key}`]==='defer'){
      next.reviewQueue.push({id:randomUUID(),kind:'unresolved',entry:e,sessionId:report.sessionId,createdAt:now()});continue;
    }
    let id=e.physicalId;
    const selected=decisions?.[`similar:${key}`];
    if(selected==='link')insist(decisions?.[`unidentified:${key}`]==='link','기존 실물 연결 결정을 일치시키세요.');
    if(selected==='distinct')insist(decisions?.[`unidentified:${key}`]!=='link','신규 등록과 기존 실물 연결을 동시에 선택할 수 없습니다.');
    if(selected==='link'||decisions?.[`unidentified:${key}`]==='link'){
      id=normalizePhysicalId(decisions?.[`link:${key}`]);
      insist(next.physicalBooks.some(x=>x.physicalId===id),'연결할 기존 실물 번호를 선택하세요.');
    }
    if(!id){id=nextPhysicalId(next,year);mapping.push({temporaryId:e.temporaryId,physicalId:id,title:e.titleCanonical});}
    let old=next.physicalBooks.find(x=>x.physicalId===id);
    if(!old) insist(!next.issuedIds.includes(id),`이미 발급된 실물 번호입니다: ${id}`);
    const linked=!!(selected==='link'||decisions?.[`unidentified:${key}`]==='link');
    const keepInfo=e.action==='CONFIRM'&&!!old;
    const legacy=next.legacyRecords.find(x=>x.recordId===e.legacyRecordId);
    const row={physicalId:id,temporaryId:null,legacyRecordId:e.legacyRecordId||null,...clean('title',keepInfo?old.titleRaw:e.titleRaw),...publisherFields(next,keepInfo?old.publisherRaw:e.publisherRaw),
      volume:keepInfo?old.volume:e.volume,status:e.status,labelStatus:e.labelStatus,note:e.note,acquiredDateRaw:old?.acquiredDateRaw||e.acquiredDateRaw||legacy?.registeredDateRaw||'',version:(old?.version||0)+1,
      createdAt:old?.createdAt||now(),updatedAt:now(),discardedAt:e.status==='DISCARDED'?(old?.discardedAt||now()):null,
      authorRaw:e.authorRaw||'',locationRaw:e.locationRaw||''};
    if(linked&&old){Object.assign(row,{legacyRecordId:e.legacyRecordId||old.legacyRecordId,titleRaw:old.titleRaw,titleCanonical:old.titleCanonical,titleSearch:old.titleSearch,publisherRaw:old.publisherRaw,publisherCanonical:old.publisherCanonical,publisherSearch:old.publisherSearch,volume:old.volume,authorRaw:old.authorRaw,locationRaw:old.locationRaw,status:e.status==='UNKNOWN'?old.status:e.status});}
    if(old)next.physicalBooks[next.physicalBooks.indexOf(old)]=row;else next.physicalBooks.push(row);
    if(!old&&e.originalPhysicalId&&e.originalPhysicalId!==id)mapping.push({oldPhysicalId:e.originalPhysicalId,physicalId:id,title:e.titleCanonical});
    if(!old||old.status!==row.status)next.statusHistory.push({physicalId:id,from:old?.status||null,to:row.status,at:now(),sessionId:report.sessionId});
    if(!next.issuedIds.includes(id))next.issuedIds.push(id);
    if(e.status==='DISCARDED'&&old?.status!=='DISCARDED')next.disposals.push({physicalId:id,legacyRecordId:e.legacyRecordId||null,title:e.titleCanonical,at:row.discardedAt,note:e.note,sessionId:report.sessionId});
  }
  next.applied.push({sessionId:report.sessionId,reportId:report.reportId||null,at:now(),mapping,entrySignatures:inspected.entrySignatures});next.revision++;
  return {next,mapping};
}
export function resolveReview(db,reviewId,mode,physicalId,year,status){
  const next=structuredClone(db),index=next.reviewQueue.findIndex(x=>x.id===reviewId);
  insist(index>=0,'검토 항목을 찾을 수 없습니다.');
  const pending=next.reviewQueue[index],e=pending.entry;
  if(pending.kind==='id-change'){
    insist(['apply-id-change','dismiss'].includes(mode),'번호 변경 처리 방법을 선택하세요.');
    const changed=mode==='apply-id-change'?applyIdChange(next,e,physicalId||e.physicalId,pending.sessionId):null;
    next.reviewQueue.splice(index,1);
    next.reviewHistory=[...(next.reviewHistory||[]),{reviewId,mode,physicalId:changed?.physicalId||null,at:now(),entry:e}];
    next.revision++;
    return {next,physicalId:changed?.physicalId||null};
  }
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
    const normalized=normalizePhysicalId(physicalId);
    insist(next.physicalBooks.some(x=>x.physicalId===normalized),'기존 실물번호를 확인하세요.');id=normalized;
  }
  if(id){
    const old=next.physicalBooks.find(x=>x.physicalId===id);
    const legacy=next.legacyRecords.find(x=>x.recordId===e.legacyRecordId);
    const row={physicalId:id,temporaryId:null,legacyRecordId:e.legacyRecordId||old?.legacyRecordId||null,...clean('title',e.titleRaw),...publisherFields(next,e.publisherRaw),
      volume:e.volume||'',status:status||e.status,labelStatus:e.labelStatus,note:e.note||'',acquiredDateRaw:old?.acquiredDateRaw||e.acquiredDateRaw||legacy?.registeredDateRaw||'',version:(old?.version||0)+1,
      createdAt:old?.createdAt||now(),updatedAt:now(),discardedAt:(status||e.status)==='DISCARDED'?(old?.discardedAt||now()):null,
      authorRaw:e.authorRaw||'',locationRaw:e.locationRaw||''};
    if(mode==='link'&&old){Object.assign(row,{titleRaw:old.titleRaw,titleCanonical:old.titleCanonical,titleSearch:old.titleSearch,publisherRaw:old.publisherRaw,publisherCanonical:old.publisherCanonical,publisherSearch:old.publisherSearch,volume:old.volume,authorRaw:old.authorRaw,locationRaw:old.locationRaw});}
    if(old)next.physicalBooks[next.physicalBooks.indexOf(old)]=row;else next.physicalBooks.push(row);
    if(!old&&e.originalPhysicalId&&e.originalPhysicalId!==id)mapping.push({oldPhysicalId:e.originalPhysicalId,physicalId:id,title:e.titleCanonical});
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

export function importResultExcel(db,rows){
  insist(Array.isArray(rows)&&rows.length>0&&rows.length<=10000,'결과 Excel 도서 행을 확인하세요.');
  const next=structuredClone(db),seen=new Set();
  let addedPhysical=0,addedLegacy=0,unchanged=0,filledDates=0,filledNotes=0;
  for(const row of rows){
    const id=String(row.physicalId||'').trim(),title=canonical(row.titleRaw),publisher=canonical(row.publisherRaw);
    const date=String(row.acquiredDateRaw||'').trim(),noteRaw=String(row.noteRaw||'').trim(),status=row.status;
    insist(id&&!seen.has(id),'도서번호가 비었거나 중복되었습니다: '+id);
    insist(title,'도서명을 입력하세요: '+id);
    insist(['ACTIVE','DISCARDED','LOST','UNKNOWN'].includes(status),'실물 상태가 올바르지 않습니다: '+id);
    seen.add(id);
    const physical=next.physicalBooks.find(x=>x.physicalId===id);
    const legacy=next.legacyRecords.find(x=>x.legacyLedgerId===id);
    if(status==='UNKNOWN'&&!physical){
      if(legacy){
        insist(legacy.titleCanonical===title,'기존 장부의 도서명과 다릅니다: '+id);
        if(!legacy.registeredDateRaw&&date){legacy.registeredDateRaw=date;filledDates++;}
        if(noteRaw&&!legacy.noteRaw){legacy.noteRaw=noteRaw;filledNotes++;}
        unchanged++;continue;
      }
      next.legacyRecords.push({recordId:randomUUID(),sourceSheet:'결과 Excel',sourceRow:row.sourceRow||0,
        legacyLedgerId:id,registeredDateRaw:date,registeredDateNormalized:'',
        ...clean('title',row.titleRaw),...clean('publisher',row.publisherRaw),
        quantityRaw:'',noteRaw,authorRaw:'',locationRaw:'',reviewRequired:false,reviewReason:'',version:1});
      addedLegacy++;continue;
    }
    insist(/^\d{4}-\d{4}$/.test(id),'확인된 실물의 도서번호는 YYYY-NNNN 형식이어야 합니다: '+id);
    if(physical){
      const currentDate=physical.acquiredDateRaw||next.legacyRecords.find(x=>x.recordId===physical.legacyRecordId)?.registeredDateRaw||'';
      insist(physical.titleCanonical===title&&physical.publisherCanonical===publisher&&physical.status===status&&currentDate===date,'기존 실물과 내용이 다릅니다: '+id+' · PC 실물 편집이나 조사 반영에서 수정하세요.');
      if(noteRaw&&!physical.noteRaw){physical.noteRaw=noteRaw;filledNotes++;}
      unchanged++;continue;
    }
    insist(!next.issuedIds.includes(id),'이미 사용된 도서번호입니다: '+id);
    const candidates=next.legacyRecords.filter(x=>x.titleCanonical===title&&x.publisherCanonical===publisher&&(!date||x.registeredDateRaw===date));
    const linked=legacy?.titleCanonical===title?legacy:candidates.length===1?candidates[0]:null,stamp=now();
    next.physicalBooks.push({physicalId:id,temporaryId:null,legacyRecordId:linked?.recordId||null,
      ...clean('title',row.titleRaw),...publisherFields(next,row.publisherRaw),volume:'',
      quantity:1,status,labelStatus:'UNKNOWN',note:'',noteRaw,acquiredDateRaw:date,
      version:1,createdAt:stamp,updatedAt:stamp,discardedAt:status==='DISCARDED'?stamp:null,authorRaw:'',locationRaw:''});
    next.issuedIds.push(id);
    next.statusHistory.push({physicalId:id,from:null,to:status,at:stamp,sessionId:null});
    if(status==='DISCARDED')next.disposals.push({physicalId:id,legacyRecordId:linked?.recordId||null,title,at:stamp,note:'결과 Excel에서 가져옴',sessionId:null});
    addedPhysical++;
  }
  if(addedPhysical||addedLegacy||filledDates||filledNotes){next.publishers=publisherDictionary(next.legacyRecords,next.physicalBooks);next.revision++;}
  return {next,addedPhysical,addedLegacy,unchanged,filledDates,filledNotes};
}
