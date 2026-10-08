import {canonical} from './normalize.mjs';

const END=0xfffffffe,FREE=0xffffffff;
const insist=(ok,message)=>{if(!ok)throw Error(message);};
const u16=(buffer,offset)=>buffer.readUInt16LE(offset);
const u32=(buffer,offset)=>buffer.readUInt32LE(offset);

function compoundStream(raw){
  insist(raw.length>=512&&raw.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')),'Excel .xls 구조가 올바르지 않습니다.');
  const sectorSize=2**u16(raw,30),miniSize=2**u16(raw,32);
  insist([512,4096].includes(sectorSize)&&miniSize===64,'지원하지 않는 Excel .xls 저장 형식입니다.');
  const sector=id=>{
    insist(Number.isInteger(id)&&id>=0&&((id+2)*sectorSize)<=raw.length+sectorSize,'손상된 Excel 섹터입니다.');
    const start=(id+1)*sectorSize;
    insist(start+sectorSize<=raw.length,'잘린 Excel 파일입니다.');
    return raw.subarray(start,start+sectorSize);
  };
  const fatSectors=[];
  for(let i=0;i<109;i++){const id=u32(raw,76+i*4);if(id!==FREE)fatSectors.push(id);}
  let difat=u32(raw,68);
  for(let i=0;i<u32(raw,72)&&difat!==END;i++){
    const bytes=sector(difat);
    for(let n=0;n<sectorSize/4-1;n++){const id=u32(bytes,n*4);if(id!==FREE)fatSectors.push(id);}
    difat=u32(bytes,sectorSize-4);
  }
  const fat=Buffer.concat(fatSectors.slice(0,u32(raw,44)).map(sector));
  const fatNext=id=>{insist(id*4+4<=fat.length,'손상된 Excel FAT입니다.');return u32(fat,id*4);};
  const chain=(start,next,read,max=20000)=>{
    const chunks=[],seen=new Set();let id=start;
    while(id!==END&&id!==FREE){
      insist(id<0xfffffffa&&!seen.has(id)&&chunks.length<max,'손상된 Excel 섹터 연결입니다.');
      seen.add(id);chunks.push(read(id));id=next(id);
    }
    return Buffer.concat(chunks);
  };
  const directory=chain(u32(raw,48),fatNext,sector);
  const entries=[];
  for(let offset=0;offset+128<=directory.length;offset+=128){
    const size=u16(directory,offset+64);
    if(!size)continue;
    const type=directory[offset+66];
    const name=directory.subarray(offset,offset+size-2).toString('utf16le');
    entries.push({type,name,start:u32(directory,offset+116),size:Number(directory.readBigUInt64LE(offset+120))});
  }
  const root=entries.find(x=>x.type===5),workbook=entries.find(x=>x.type===2&&['Workbook','Book'].includes(x.name));
  insist(root&&workbook,'Excel 통합 문서 스트림을 찾을 수 없습니다.');
  let content;
  if(workbook.size<u32(raw,56)){
    const miniFatBytes=chain(u32(raw,60),fatNext,sector,u32(raw,64)+1);
    const miniNext=id=>{insist(id*4+4<=miniFatBytes.length,'손상된 Excel MiniFAT입니다.');return u32(miniFatBytes,id*4);};
    const rootStream=chain(root.start,fatNext,sector).subarray(0,root.size);
    content=chain(workbook.start,miniNext,id=>{
      const offset=id*miniSize;insist(offset+miniSize<=rootStream.length,'손상된 Excel 미니 섹터입니다.');
      return rootStream.subarray(offset,offset+miniSize);
    });
  }else content=chain(workbook.start,fatNext,sector);
  return content.subarray(0,workbook.size);
}

function records(bytes,start=0,end=bytes.length){
  const list=[];
  for(let pos=start;pos+4<=end;){
    const type=u16(bytes,pos),length=u16(bytes,pos+2),next=pos+4+length;
    insist(next<=end,'잘린 Excel 레코드입니다.');
    list.push({type,data:bytes.subarray(pos+4,next),offset:pos});
    pos=next;
    if(type===0x000a)break;
  }
  return list;
}

function stringReader(parts){
  let part=0,position=0;
  const advance=()=>{while(part<parts.length&&position>=parts[part].length){part++;position=0;}insist(part<parts.length,'잘린 Excel 문자열입니다.');};
  const read=n=>{
    const chunks=[];let left=n;
    while(left){advance();const take=Math.min(left,parts[part].length-position);chunks.push(parts[part].subarray(position,position+take));position+=take;left-=take;}
    return Buffer.concat(chunks);
  };
  const byte=()=>read(1)[0];
  const characters=(length,wide)=>{
    let result='';
    for(let left=length;left;){
      if(position>=parts[part].length){part++;position=0;insist(part<parts.length,'잘린 Excel 문자열입니다.');wide=(byte()&1)!==0;}
      const unit=wide?2:1,available=Math.floor((parts[part].length-position)/unit);
      insist(available>0,'손상된 Excel 문자열입니다.');
      const count=Math.min(left,available),data=parts[part].subarray(position,position+count*unit);
      result+=data.toString(wide?'utf16le':'latin1');position+=count*unit;left-=count;
    }
    return result;
  };
  return {read,byte,characters};
}
function parseUnicode(reader){
  const count=u16(reader.read(2),0),flags=reader.byte();
  const rich=flags&8?u16(reader.read(2),0):0,extended=flags&4?u32(reader.read(4),0):0;
  const value=reader.characters(count,(flags&1)!==0);
  if(rich)reader.read(rich*4);
  if(extended)reader.read(extended);
  return value;
}
function parseSst(parts){
  const reader=stringReader(parts),header=reader.read(8),unique=u32(header,4),strings=[];
  insist(unique<=100000,'Excel 문자열이 너무 많습니다.');
  for(let i=0;i<unique;i++)strings.push(parseUnicode(reader));
  return strings;
}
function rkValue(raw){
  const flags=raw&3;
  let value;
  if(flags&2)value=(raw>>2);
  else {
    const bytes=Buffer.alloc(8);bytes.writeUInt32LE(raw&0xfffffffc,4);value=bytes.readDoubleLE(0);
  }
  return flags&1?value/100:value;
}
const dateFormat=format=>/[yd]/i.test(String(format||'').replace(/"[^"]*"|\[[^\]]*\]|\\./g,''));
const dateValue=value=>{
  const date=new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000);
  return Number.isFinite(date.getTime())?date.toISOString().slice(0,10).replace(/-/g,'.'):String(value);
};
function sheetRows(bytes,offset,shared,formats,xfs){
  const rows=[];
  const write=(row,col,value,xf=0)=>{
    if(row>10000)throw Error('Excel 행 수가 너무 많습니다.');
    if(value===null||value===undefined)return;
    if(typeof value==='number'){
      const format=xfs[xf]??0;
      value=([14,15,16,17,22].includes(format)||dateFormat(formats.get(format)))?dateValue(value):String(value);
    }
    (rows[row]??=[])[col]=String(value);
  };
  for(const record of records(bytes,offset)){
    const b=record.data;
    if(record.type===0x00fd&&b.length>=10)write(u16(b,0),u16(b,2),shared[u32(b,6)]);
    else if(record.type===0x0203&&b.length>=14)write(u16(b,0),u16(b,2),b.readDoubleLE(6),u16(b,4));
    else if(record.type===0x027e&&b.length>=10)write(u16(b,0),u16(b,2),rkValue(u32(b,6)),u16(b,4));
    else if(record.type===0x00bd&&b.length>=12){
      const row=u16(b,0),first=u16(b,2),count=(b.length-6)/6;
      for(let i=0;i<count;i++)write(row,first+i,rkValue(u32(b,6+i*6)),u16(b,4+i*6));
    }
    else if(record.type===0x0204&&b.length>=8){
      const length=u16(b,6),flags=b[8],start=9;
      write(u16(b,0),u16(b,2),b.subarray(start,start+length*(flags&1?2:1)).toString(flags&1?'utf16le':'latin1'));
    }
    else if(record.type===0x0006&&b.length>=14&&u16(b,12)!==0xffff)write(u16(b,0),u16(b,2),b.readDoubleLE(6),u16(b,4));
  }
  return rows;
}
const aliases={legacyLedgerId:['번호','등록번호','관리번호'],registeredDateRaw:['등록일','등록일자','날짜'],titleRaw:['도서명','책제목','제목'],publisherRaw:['출판사','출판처'],quantityRaw:['권수','수량'],noteRaw:['비고','메모'],authorRaw:['저자'],locationRaw:['위치']};
function extractRows(sheetName,rows){
  const headerIndex=rows.findIndex((row,i)=>i<20&&['legacyLedgerId','titleRaw','quantityRaw'].every(field=>aliases[field].some(x=>row?.map(canonical).includes(x))));
  if(headerIndex<0)return [];
  const headers=rows[headerIndex].map(canonical),column=field=>aliases[field].map(x=>headers.indexOf(x)).find(x=>x>=0);
  const hasContent=r=>r&&(canonical(r[column('titleRaw')])||['registeredDateRaw','publisherRaw','quantityRaw','noteRaw','authorRaw','locationRaw'].some(field=>canonical(r[column(field)])));
  return rows.slice(headerIndex+1).map((row,i)=>hasContent(row)?{
    sourceSheet:sheetName,sourceRow:i+headerIndex+2,
    ...Object.fromEntries(Object.keys(aliases).map(field=>[field,column(field)===undefined?'':String(row[column(field)]??'')]))
  }:null).filter(Boolean);
}
export function readXls(raw){
  const bytes=compoundStream(raw),global=records(bytes),sheets=[],formats=new Map(),xfs=[];
  let shared=[];
  for(let i=0;i<global.length;i++){
    const {type,data}=global[i];
    if(type===0x0085&&data.length>=8){
      const length=data[6],wide=(data[7]&1)!==0;
      sheets.push({offset:u32(data,0),name:data.subarray(8,8+length*(wide?2:1)).toString(wide?'utf16le':'latin1')});
    }
    if(type===0x00fc){
      const parts=[data];while(global[i+1]?.type===0x003c)parts.push(global[++i].data);
      shared=parseSst(parts);
    }
    if(type===0x041e&&data.length>=5){
      const length=u16(data,2),wide=(data[4]&1)!==0;
      formats.set(u16(data,0),data.subarray(5,5+length*(wide?2:1)).toString(wide?'utf16le':'latin1'));
    }
    if(type===0x00e0&&data.length>=4)xfs.push(u16(data,2));
  }
  const result=sheets.flatMap(sheet=>extractRows(sheet.name,sheetRows(bytes,sheet.offset,shared,formats,xfs)));
  insist(result.length,'번호·도서명·권수 열이 있는 시트에서 장부 행을 찾을 수 없습니다.');
  return result;
}
