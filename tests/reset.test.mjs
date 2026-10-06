import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {emptyDb} from '../inventory.mjs';
import {makeInventoryExcel} from '../inventory-excel.mjs';

test('원장 초기화는 먼저 백업하고 원본 Excel을 다시 가져올 수 있게 비운다',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'angela-reset-'));
  const root=path.dirname(fileURLToPath(new URL('../server.mjs',import.meta.url)));
  const db=emptyDb('test-catalog');
  db.physicalBooks.push({physicalId:'2026-0001',legacyRecordId:null,titleCanonical:'테스트 책',publisherCanonical:'출판사',acquiredDateRaw:'2026-01-02',noteRaw:'기업 A',status:'ACTIVE'});
  const excel=path.join(folder,'result.xlsx');
  await makeInventoryExcel(db,excel);
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,DATA_DIR:folder,PORT:'0'},stdio:['ignore','pipe','pipe']});
  try{
    const port=await new Promise((resolve,reject)=>{
      let output='';
      const timer=setTimeout(()=>reject(Error('서버 시작 시간 초과: '+output)),10000);
      child.once('error',reject);
      child.stdout.on('data',chunk=>{output+=chunk.toString();const match=/Angela: http:\/\/127\.0\.0\.1:(\d+)/.exec(output);if(match){clearTimeout(timer);resolve(Number(match[1]));}});
      child.stderr.on('data',chunk=>{output+=chunk.toString();});
      child.once('exit',code=>{clearTimeout(timer);reject(Error('서버가 종료되었습니다: '+code+' '+output));});
    });
    const base='http://127.0.0.1:'+port;
    const imported=await fetch(base+'/api/result-excel',{method:'POST',body:await fs.readFile(excel)});
    assert.equal(imported.status,200);
    const before=await (await fetch(base+'/api/state')).json();
    assert.equal(before.physicalBooks.length,1);
    const stale=await fetch(base+'/api/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:before.revision-1})});
    assert.equal(stale.status,400);
    const response=await fetch(base+'/api/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:before.revision})});
    assert.equal(response.status,200);
    const {backup}=await response.json();
    const saved=JSON.parse(await fs.readFile(path.join(folder,backup),'utf8'));
    assert.equal(saved.physicalBooks[0].noteRaw,'기업 A');
    const after=await (await fetch(base+'/api/state')).json();
    assert.equal(after.physicalBooks.length,0);
    assert.equal(after.legacyRecords.length,0);
    assert.notEqual(after.catalogId,before.catalogId);
    const reimport=await fetch(base+'/api/result-excel',{method:'POST',body:await fs.readFile(excel)});
    assert.equal(reimport.status,200);
  }finally{
    child.kill();
    await new Promise(resolve=>child.once('exit',resolve));
    await fs.rm(folder,{recursive:true,force:true});
  }
});
