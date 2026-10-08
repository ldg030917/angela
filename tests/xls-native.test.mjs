import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readExcelUpload} from '../excel-upload.mjs';

const END=0xfffffffe,FREE=0xffffffff;
const rec=(type,data=Buffer.alloc(0))=>{const header=Buffer.alloc(4);header.writeUInt16LE(type,0);header.writeUInt16LE(data.length,2);return Buffer.concat([header,data]);};
const bof=()=>rec(0x0809,Buffer.from([0x00,0x06,0x05,0x00,0,0,0,0]));
const text=value=>{const chars=Buffer.from(value,'utf16le'),header=Buffer.alloc(3);header.writeUInt16LE(value.length,0);header[2]=1;return Buffer.concat([header,chars]);};
const cell=(row,col,stringIndex)=>{const data=Buffer.alloc(10);data.writeUInt16LE(row,0);data.writeUInt16LE(col,2);data.writeUInt32LE(stringIndex,6);return rec(0x00fd,data);};
const rk=(row,col,value)=>{const data=Buffer.alloc(10);data.writeUInt16LE(row,0);data.writeUInt16LE(col,2);data.writeUInt32LE((value<<2)|2,6);return rec(0x027e,data);};
function fixture(){
  const values=['번호','날짜','도서명','출판사','권수','비고','2026-0037','2026.10.01','첫 책','출판사','후원사'];
  const sstHeader=Buffer.alloc(8);sstHeader.writeUInt32LE(values.length,0);sstHeader.writeUInt32LE(values.length,4);
  const sst=rec(0x00fc,Buffer.concat([sstHeader,...values.map(text)]));
  const sheet=Buffer.concat([bof(),...values.slice(0,6).map((_,i)=>cell(0,i,i)),cell(1456,0,6),cell(1456,1,7),cell(1456,2,8),cell(1456,3,9),rk(1456,4,1),cell(1456,5,10),rec(0x000a)]);
  const name=Buffer.from('도서목록','utf16le'),bound=Buffer.alloc(8+name.length);bound[6]=4;bound[7]=1;name.copy(bound,8);
  const first=bof(),last=rec(0x000a);bound.writeUInt32LE(first.length+bound.length+4+sst.length+last.length,0);
  const workbook=Buffer.alloc(4096);Buffer.concat([first,rec(0x0085,bound),sst,last,sheet]).copy(workbook);
  const header=Buffer.alloc(512,0xff);Buffer.from('d0cf11e0a1b11ae1','hex').copy(header);header.writeUInt16LE(0x003e,24);header.writeUInt16LE(3,26);header.writeUInt16LE(0xfffe,28);header.writeUInt16LE(9,30);header.writeUInt16LE(6,32);header.writeUInt32LE(1,44);header.writeUInt32LE(0,48);header.writeUInt32LE(4096,56);header.writeUInt32LE(END,60);header.writeUInt32LE(END,68);header.writeUInt32LE(9,76);
  const directory=Buffer.alloc(512);
  const entry=(offset,name,type,start,size)=>{const chars=Buffer.from(name+'\0','utf16le');chars.copy(directory,offset);directory.writeUInt16LE(chars.length,offset+64);directory[offset+66]=type;directory.writeUInt32LE(start,offset+116);directory.writeBigUInt64LE(BigInt(size),offset+120);};
  entry(0,'Root Entry',5,END,0);entry(128,'Workbook',2,1,4096);
  const fat=Buffer.alloc(512,0xff);fat.writeUInt32LE(END,0);for(let i=1;i<8;i++)fat.writeUInt32LE(i+1,i*4);fat.writeUInt32LE(END,8*4);fat.writeUInt32LE(0xfffffffd,9*4);
  return Buffer.concat([header,directory,workbook,fat]);
}

test('.xls 장부를 Excel 실행 없이 직접 읽는다',async()=>{
  const rows=await readExcelUpload(fixture());
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0],{
    sourceSheet:'도서목록',sourceRow:1457,legacyLedgerId:'2026-0037',registeredDateRaw:'2026.10.01',
    titleRaw:'첫 책',publisherRaw:'출판사',quantityRaw:'1',noteRaw:'후원사',authorRaw:'',locationRaw:''
  });
});
