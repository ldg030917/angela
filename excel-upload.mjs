import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readLedger} from './ledger-excel.mjs';
import {readXls} from './xls-native.mjs';

const ole=Buffer.from('d0cf11e0a1b11ae1','hex');

export async function readExcelUpload(raw){
  if(raw.subarray(0,8).equals(ole))return readXls(raw);
  if(!raw.subarray(0,4).equals(Buffer.from('504b0304','hex')))throw Error('Excel .xls 또는 .xlsx 파일을 선택하세요.');
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'angela-ledger-'));
  const source=path.join(folder,'source.xlsx');
  try{
    await fs.writeFile(source,raw);
    return await readLedger(source);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
}
