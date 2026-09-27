import { randomUUID } from 'node:crypto';
export const uid = () => randomUUID();
export const yearNow = () => Number(new Intl.DateTimeFormat('en', { timeZone:'Asia/Seoul',year:'numeric' }).format(new Date()));
export function check(ok, message) { if (!ok) throw new Error(message); }
export function quantity(n) { check(Number.isInteger(n) && n >= 0 && n <= 99999, '권수는 0~99999 사이의 정수여야 합니다.'); return n; }
export function book(b) {
  check(b && typeof b === 'object', '도서 정보가 올바르지 않습니다.');
  check(typeof b.title === 'string' && b.title.trim() && b.title.length <= 300, '도서명을 입력하세요 (최대 300자).');
  for (const k of ['author','location']) check(typeof b[k] === 'string' && b[k].length <= 300, '저자·위치 형식이 올바르지 않습니다.');
  quantity(b.qty);
  return {title:b.title.trim(),author:b.author.trim(),location:b.location.trim(),qty:b.qty};
}
export function validateReport(db, r) {
  check(r?.schema === 'angela-survey/v1', '지원하지 않는 조사 JSON 형식입니다.');
  const session = db.sessions.find(s => s.id === r.sessionId);
  check(session && r.catalogId === db.catalogId, '이 원장에서 생성한 조사 데이터가 아닙니다.');
  check(!db.applied.some(a => a.sessionId === r.sessionId), '이미 반영한 조사입니다. 새 조사를 생성하세요.');
  check(Array.isArray(r.entries) && r.entries.length <= 10000, '조사 항목 형식이 올바르지 않습니다.');
  const ids = new Set();
  const entries = r.entries.map(e => {
    check(e && typeof e.id === 'string' && e.id.length <= 100 && !ids.has(e.id), '중복되거나 잘못된 도서 ID입니다.'); ids.add(e.id);
    const b = book(e);
    check(typeof e.confirmed === 'boolean', '실물 확인 값이 올바르지 않습니다.');
    check(Array.isArray(e.disposals) && e.disposals.length <= 1000, '폐기 기록 형식이 올바르지 않습니다.');
    for (const d of e.disposals) { quantity(d.qty); check(d.qty > 0 && typeof d.reason === 'string' && d.reason.trim() && d.reason.length <= 500 && typeof d.at === 'string' && Number.isFinite(Date.parse(d.at)), '폐기 수량·사유·일자를 확인하세요.'); }
    const baseline = session.books.find(b => b.id === e.id);
    check(baseline || (e.isNew === true && e.id.startsWith('new-')), '조사 대상에 없는 도서입니다.');
    check(!baseline || !e.isNew, '기존 도서는 신규 도서로 처리할 수 없습니다.');
    return {...b,id:e.id,confirmed:e.confirmed,disposals:e.disposals.map(d=>({qty:d.qty,reason:d.reason.trim(),at:d.at})),isNew:!baseline};
  });
  check(entries.length > 0, '변경하거나 확인한 도서가 없습니다.');
  return {session,entries};
}
export function preview(db,r) {
  const {session,entries} = validateReport(db,r);
  const conflicts = entries.filter(e=> !e.isNew && db.books.find(b=>b.id===e.id)?.version !== session.books.find(b=>b.id===e.id).version).map(e=>({id:e.id,title:e.title,base:session.books.find(b=>b.id===e.id),current:db.books.find(b=>b.id===e.id),incoming:e}));
  return {revision:db.revision,conflicts,existing:entries.filter(e=>!e.isNew).length,newCount:entries.filter(e=>e.isNew).length,disposals:entries.reduce((n,e)=>n+e.disposals.reduce((n,d)=>n+d.qty,0),0)};
}
export function applyReport(db,r,choices,revision,year) {
  check(revision === db.revision, '검사 후 원장이 변경되었습니다. 충돌 검사를 다시 실행하세요.');
  check(Number.isInteger(year) && year>=2000 && year<=9999, '발급 연도를 확인하세요.');
  const p = preview(db,r), {entries} = validateReport(db,r);
  for(const c of p.conflicts) check(['pc','survey'].includes(choices?.[c.id]), '모든 충돌의 처리 방법을 선택하세요.');
  const next = structuredClone(db), mapping = [];
  let max = Math.max(0,...next.books.filter(b=>b.id.startsWith(`${year}-`)).map(b=>Number(b.id.slice(5))));
  for(const e of entries) {
    if(p.conflicts.some(c=>c.id===e.id) && choices[e.id]==='pc') continue;
    const old = next.books.find(b=>b.id===e.id);
    let id=e.id;
    if(e.isNew) { check(max<9999,'해당 연도의 번호를 모두 사용했습니다.'); id=`${year}-${String(++max).padStart(4,'0')}`; mapping.push({temporaryId:e.id,id,title:e.title}); }
    const row={...book(e),id,version:(old?.version||0)+1,confirmed:e.confirmed,checkedAt:e.confirmed?new Date().toISOString():null};
    if(old) next.books[next.books.indexOf(old)]=row; else next.books.push(row);
    next.disposals.push(...e.disposals.map(d=>({...d,id,title:e.title,sessionId:r.sessionId})));
  }
  next.revision++; next.applied.push({sessionId:r.sessionId,at:new Date().toISOString(),mapping});
  return {next,mapping};
}
