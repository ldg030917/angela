import fs from 'node:fs/promises';
import path from 'node:path';
import {unzip} from './xlsx-native.mjs';
import {canonical} from './normalize.mjs';

const decode=s=>String(s??'').replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(_,hex,num,named)=>hex?String.fromCodePoint(parseInt(hex,16)):num?String.fromCodePoint(Number(num)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[named]);
const attributes=s=>Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
const strip=xml=>xml?.replace(/(<\/?)[\w]+:/g,'$1');
const aliases={legacyLedgerId:['번호','등록번호','관리번호'],registeredDateRaw:['등록일','등록일자','날짜'],titleRaw:['도서명','책제목','제목'],publisherRaw:['출판사','출판처'],quantityRaw:['권수','수량'],noteRaw:['비고','메모'],authorRaw:['저자'],locationRaw:['위치']};
export async function readLedger(file) {
  const files=unzip(await fs.readFile(file));
  const workbook=strip(files.get('xl/workbook.xml'));
  const rels=strip(files.get('xl/_rels/workbook.xml.rels'));
  if(!workbook||!rels)throw Error('Excel 원장 구조를 읽을 수 없습니다.');
  const sheets=[...workbook.matchAll(/<sheet\b([^>]*)\/?\s*>/g)].map(m=>attributes(m[1]));
  if(!sheets.length)throw Error('시트가 없습니다.');
  const relationships=[...rels.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map(m=>attributes(m[1]));
  const shared=[];
  for(const m of (strip(files.get('xl/sharedStrings.xml'))||'').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g))shared.push([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>decode(x[1])).join(''));
  const result=[];
  for(const sheet of sheets){
  const rel=relationships.find(x=>x.Id===sheet['r:id']);
  if(!rel)throw Error(`시트 경로가 없습니다: ${sheet.name}`);
  const target=rel.Target.startsWith('/')?rel.Target.slice(1):path.posix.normalize(`xl/${rel.Target}`);
  const xml=strip(files.get(target));if(!xml)throw Error(`시트를 읽을 수 없습니다: ${sheet.name}`);
  const rows=[];
  for(const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)){
    const rowNo=Number(attributes(rm[1]).r);if(rowNo>10001)throw Error('Excel 행 수가 너무 많습니다.');
    const cells=[];
    for(const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/c>)/g)){
      const a=attributes(cm[1]),letters=a.r?.match(/^[A-Z]+/i)?.[0];if(!letters)continue;
      const col=[...letters.toUpperCase()].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;
      const body=cm[2]||'',value=/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const inline=[...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>decode(x[1])).join('');
      cells[col]=a.t==='s'?shared[Number(value)]:a.t==='inlineStr'?inline:value!==undefined?decode(value):'';
    }
    rows[rowNo-1]=cells;
  }
  const headerIndex=rows.findIndex((row,i)=>i<20&&['legacyLedgerId','titleRaw','quantityRaw'].every(field=>aliases[field].some(x=>row?.map(canonical).includes(x))));
  if(headerIndex<0)continue;
  const headers=rows[headerIndex].map(canonical);
  const column=field=>aliases[field].map(x=>headers.indexOf(x)).find(x=>x>=0);
  const hasContent=r=>r&&(canonical(r[column('titleRaw')])||['registeredDateRaw','publisherRaw','quantityRaw','noteRaw','authorRaw','locationRaw'].some(field=>canonical(r[column(field)])));
  result.push(...rows.slice(headerIndex+1).map((r,i)=>hasContent(r)?{
    sourceSheet:sheet.name||'첫 번째 시트',sourceRow:i+headerIndex+2,
    ...Object.fromEntries(Object.keys(aliases).map(field=>[field,column(field)===undefined?'':String(r[column(field)]??'')]))
  }:null).filter(Boolean));
  }
  if(!result.length)throw Error('번호·도서명·권수 열이 있는 시트에서 장부 행을 찾을 수 없습니다.');
  return result;
}
