import {validatePhysicalId,normalizePhysicalId} from './physical-id.mjs';

export const canonical = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
export const searchKey = value => canonical(value).toLocaleLowerCase('ko-KR').replace(/[^\p{L}\p{N}]/gu, '');
export const textFields = (kind, value) => ({
  [`${kind}Raw`]: String(value ?? ''),
  [`${kind}Canonical`]: canonical(value),
  [`${kind}Search`]: searchKey(value)
});

const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
export function initials(value) {
  return [...canonical(value)].map(ch => {
    const n = ch.charCodeAt(0) - 0xac00;
    return n >= 0 && n < 11172 ? INITIALS[Math.floor(n / 588)] : ch;
  }).join('').replace(/\s+/gu, '');
}
function distance(a, b) {
  const row = Array.from({length:b.length + 1}, (_,i) => i);
  for (let i=1;i<=a.length;i++) {
    let previous=row[0]; row[0]=i;
    for (let j=1;j<=b.length;j++) {
      const old=row[j];
      row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));
      previous=old;
    }
  }
  return row[b.length];
}
export function rank(query, item) {
  const q=canonical(query), key=searchKey(q);
  if (!key) return 0;
  if (item.physicalId && validatePhysicalId(q) && normalizePhysicalId(q)===item.physicalId) return 100;
  if (item.legacyLedgerId && q.toUpperCase()===item.legacyLedgerId.toUpperCase()) return 95;
  const title=item.titleCanonical||canonical(item.titleRaw||item.title);
  const publisher=item.publisherCanonical||canonical(item.publisherRaw||item.publisher);
  const titleKey=item.titleSearch||searchKey(title);
  const publisherKey=item.publisherSearch||searchKey(publisher);
  if (q.toLocaleLowerCase('ko-KR')===title.toLocaleLowerCase('ko-KR')) return 90;
  if (key===titleKey) return 85;
  if (publisherKey && key===publisherKey) return 80;
  if (titleKey.startsWith(key)) return 75;
  if (publisherKey && publisherKey.startsWith(key)) return 70;
  if (titleKey.includes(key)) return 65;
  if (publisherKey && publisherKey.includes(key)) return 60;
  const words=q.toLocaleLowerCase('ko-KR').split(/\s+/u).filter(Boolean).map(searchKey);
  if (words.length>1 && words.every(w=>titleKey.includes(w)||publisherKey.includes(w))) return 55;
  const initialQuery=String(query).replace(/\s+/gu,'');
  const initial=initials(title);
  if (/^[ㄱ-ㅎ]+$/u.test(initialQuery) && initial.includes(initialQuery)) return 52;
  if (key.length>=3 && titleKey.length>=3) {
    const ratio=1-distance(key,titleKey)/Math.max(key.length,titleKey.length);
    if (ratio>=0.55) return Math.round(20+ratio*30);
  }
  return 0;
}
export function search(query, items, limit=20) {
  return items.map(item=>({item,score:rank(query,item)})).filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>({...x.item,matchScore:x.score}));
}
export function physicalCandidatesForLegacy(legacy,books,title,publisher,volume=''){
  const titleKey=searchKey(title||legacy?.titleRaw),publisherKey=searchKey(publisher||legacy?.publisherRaw),volumeKey=searchKey(volume);
  const linked=legacy?books.filter(x=>x.legacyRecordId===legacy.recordId):[];
  const exact=titleKey?books.filter(x=>searchKey(x.titleRaw||x.titleCanonical)===titleKey&&(!publisherKey||searchKey(x.publisherRaw||x.publisherCanonical)===publisherKey)&&searchKey(x.volume||'')===volumeKey):[];
  const similar=titleKey?search(title||legacy?.titleRaw,books,8).filter(x=>x.matchScore>=55):[];
  const candidates=[...new Map([...linked,...exact,...similar].map(x=>[x.physicalId,x])).values()];
  const matchingLinked=linked.filter(x=>searchKey(x.volume||'')===volumeKey);
  const preferred=matchingLinked.length===1?matchingLinked[0]:matchingLinked.length?null:exact.length===1?exact[0]:null;
  return {candidates,preferredPhysicalId:preferred?.physicalId||null};
}
export function publisherDictionary(records, books) {
  const map=new Map();
  for(const row of [...records,...books]) {
    const raw=row.publisherRaw ?? row.publisher ?? '';
    const name=row.publisherCanonical || canonical(raw);
    const key=searchKey(name);
    if(!key) continue;
    if(!map.has(key)) map.set(key,{id:key,canonicalName:name,aliases:[]});
    const entry=map.get(key);
    if(raw && !entry.aliases.includes(raw)) entry.aliases.push(raw);
  }
  return [...map.values()];
}
