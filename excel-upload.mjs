import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readLedger} from './ledger-excel.mjs';

const run=promisify(execFile);
const script=fileURLToPath(new URL('./scripts/convert-xls.ps1',import.meta.url));
const ole=Buffer.from('d0cf11e0a1b11ae1','hex');

export async function readExcelUpload(raw){
  const old=raw.subarray(0,8).equals(ole);
  const zip=raw.subarray(0,4).equals(Buffer.from('504b0304','hex'));
  if(!old&&!zip)throw Error('Excel .xls 또는 .xlsx 파일을 선택하세요.');
  if(old&&process.platform!=='win32')throw Error('.xls 가져오기는 Windows와 Microsoft Excel 설치가 필요합니다.');
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'angela-ledger-'));
  const source=path.join(folder,old?'source.xls':'source.xlsx');
  const converted=path.join(folder,'converted.xlsx');
  try{
    await fs.writeFile(source,raw);
    if(old){
      try{await run('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-Source',source,'-Destination',converted],{timeout:120000,windowsHide:true});}
      catch(e){throw Error(`.xls 변환에 실패했습니다. PC에 Microsoft Excel이 설치되어 있는지 확인하세요. ${e.message}`);}
    }
    return await readLedger(old?converted:source);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
}
