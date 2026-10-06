import path from 'node:path';
import {unzip} from './xlsx-native.mjs';
import {statusLabels} from './status.mjs';

const decode=value=>String(value??'').replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(_,hex,num,named)=>hex?String.fromCodePoint(parseInt(hex,16)):num?String.fromCodePoint(Number(num)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[named]);
const attributes=value=>Object.fromEntries([...value.matchAll(/([\w:]+)="([^"]*)"/g)].map(match=>[match[1],decode(match[2])]));
const strip=xml=>xml?.replace(/(<\/?)[\w]+:/g,'$1');
const required=['도서번호','입수일','도서명','출판사','실물 상태'];
const asDate=value=>{
  const text=String(value??'').trim();
  if(!/^\d{5}(?:\.\d+)?$/.test(text))return text;
  const serial=Number(text);
  if(serial<20000||serial>80000)return text;
  return new Date(Date.UTC(1899,11,30)+Math.floor(serial)*86400000).toISOString().slice(0,10);
};

export function readResultExcel(buffer){
  const files=unzip(buffer),workbook=strip(files.get('xl/workbook.xml')),rels=strip(files.get('xl/_rels/workbook.xml.rels'));
  if(!workbook||!rels)throw Error('결과 Excel 구조를 읽을 수 없습니다.');
  const first=/<sheet\b([^>]*)\/?\s*>/.exec(workbook);
  if(!first)throw Error('결과 Excel 시트를 찾을 수 없습니다.');
  const relId=attributes(first[1])['r:id'];
  const target=[...rels.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map(x=>attributes(x[1])).find(x=>x.Id===relId)?.Target;
  if(!target)throw Error('결과 Excel 시트 경로를 찾을 수 없습니다.');
  const name=target.startsWith('/')?target.slice(1):path.posix.normalize('xl/'+target);
  const xml=strip(files.get(name));
  if(!xml)throw Error('결과 Excel 시트를 읽을 수 없습니다.');
  const shared=[];
  for(const item of (strip(files.get('xl/sharedStrings.xml'))||'').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g))shared.push([...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>decode(x[1])).join(''));
  const rows=[];
  for(const match of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)){
    const number=Number(attributes(match[1]).r);
    if(number<1||number>10001)throw Error('결과 Excel 행 수가 너무 많습니다.');
    const cells=[];
    for(const cell of match[2].matchAll(/<c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/c>)/g)){
      const attr=attributes(cell[1]),letters=attr.r?.match(/^[A-Z]+/i)?.[0];
      if(!letters)continue;
      const column=[...letters.toUpperCase()].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;
      const body=cell[2]||'',value=/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1],inline=[...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>decode(x[1])).join('');
      cells[column]=attr.t==='s'?shared[Number(value)]:attr.t==='inlineStr'?inline:value===undefined?'':decode(value);
    }
    rows[number-1]=cells;
  }
  const headerIndex=rows.findIndex((r,i)=>i<20&&required.every(h=>r?.map(x=>String(x??'').trim()).includes(h)));
  if(headerIndex<0)throw Error('도서번호·입수일·도서명·출판사·실물 상태 열이 있는 결과 Excel을 선택하세요.');
  const header=rows[headerIndex].map(x=>String(x??'').trim()),column=name=>header.indexOf(name),seen=new Set(),result=[];
  for(let index=headerIndex+1;index<rows.length;index++){
    const row=rows[index];if(!row||row.every(x=>!String(x??'').trim()))continue;
    const id=String(row[column('도서번호')]??'').trim(),titleRaw=String(row[column('도서명')]??'').trim(),publisherRaw=String(row[column('출판사')]??'').trim();
    const rawStatus=String(row[column('실물 상태')]??'').trim();
    const status=Object.entries(statusLabels).find(([key,label])=>rawStatus===key||rawStatus===label)?.[0]||(rawStatus?'':'UNKNOWN');
    if(!id||seen.has(id))throw Error((index+1)+'행: 도서번호가 비었거나 중복되었습니다.');
    if(!titleRaw)throw Error((index+1)+'행: 도서명이 비었습니다.');
    if(!status)throw Error((index+1)+'행: 실물 상태를 확인하세요.');
    seen.add(id);
    result.push({physicalId:id,acquiredDateRaw:asDate(row[column('입수일')]),titleRaw,publisherRaw,volume:column('권 번호')<0?null:String(row[column('권 번호')]??'').trim(),noteRaw:column('비고')<0?null:String(row[column('비고')]??'').trim(),status,sourceRow:index+1});
  }
  if(!result.length)throw Error('결과 Excel에 도서가 없습니다.');
  return result;
}

