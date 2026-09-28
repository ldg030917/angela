import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {emptyDb,migrate,addLegacy,createSession,lookup,inspectSurvey,applySurvey,resolveReview,resolveLegacyReview} from './inventory.mjs';
import {readExcelUpload} from './excel-upload.mjs';
import {makeExcel} from './xlsx-native.mjs';
import {makeInventoryExcel} from './inventory-excel.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const data=path.resolve(root,process.env.DATA_DIR||'data');await fs.mkdir(data,{recursive:true});
const dbPath=path.join(data,'catalog.json');
let db;
try {db=migrate(JSON.parse(await fs.readFile(dbPath,'utf8')));} catch(e){if(e.code!=='ENOENT')throw e;db=emptyDb();}
async function save(next){await fs.writeFile(dbPath+'.tmp',JSON.stringify(next,null,2));await fs.rename(dbPath+'.tmp',dbPath);db=next;}
const downloads=new Map();
const sample=[{id:'2026-0001',title:'어린 왕자',author:'',location:'',qty:3},{id:'2026-0002',title:'데미안',author:'',location:'',qty:2},{id:'2026-0007',title:'코스모스',author:'',location:'',qty:4}];
let queue=Promise.resolve();
const server=http.createServer((req,res)=>{const work=()=>handle(req,res).catch(e=>{if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:e.message}));});queue=queue.then(work,work);});
async function handle(req,res){
  const url=new URL(req.url,'http://localhost'),p=url.pathname;
  const json=value=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const file=async(location,name)=>{res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${name}"`});res.end(await fs.readFile(location));};
  if(req.method==='GET'){
    if(p==='/api/state')return json({...db,year:Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date()))});
    if(p==='/api/lookup')return json(lookup(db,url.searchParams.get('q')||''));
    if(p.startsWith('/api/session/')){const s=db.sessions.find(x=>x.id===p.split('/').pop());if(!s)throw Error('조사를 찾을 수 없습니다.');return json(s);}
    if(p.startsWith('/api/download/')){const item=downloads.get(p.split('/').pop());if(!item||item.expires<Date.now())throw Error('다운로드가 만료되었습니다.');res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${item.name}"`,'Cache-Control':'no-store'});return res.end(item.content);}
    if(p==='/api/sample'){const location=path.join(data,'sample.xlsx');await makeExcel(sample,[],location);return file(location,'sample.xlsx');}
    if(p==='/api/android-app'){
      const apk=path.join(root,'dist','Angela-offline-android.apk');
      const content=await fs.readFile(apk);
      res.writeHead(200,{'Content-Type':'application/vnd.android.package-archive','Content-Disposition':'attachment; filename="Angela-offline-android.apk"','Content-Length':content.length});
      return res.end(content);
    }
    if(p==='/api/export'){
      const location=path.join(data,'result.xlsx');
      await makeInventoryExcel(db,location);return file(location,'result.xlsx');
    }
    if(p==='/normalize.mjs'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(await fs.readFile(path.join(root,'normalize.mjs')));}
    const files={'/':'index.html','/mobile':'index.html','/app.js':'app.js','/style.css':'style.css'};
    if(files[p]){res.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8','Cache-Control':'no-cache'});return res.end(await fs.readFile(path.join(root,'public',files[p])));}
    res.writeHead(404);return res.end('Not found');
  }
  if(req.method!=='POST')throw Error('지원하지 않는 요청입니다.');
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw Error('다른 사이트의 요청은 허용되지 않습니다.');
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024)throw Error('파일 크기는 10MB 이하로 제한됩니다.');chunks.push(chunk);}
  const raw=Buffer.concat(chunks);
  if(p==='/api/excel'){
    const rows=await readExcelUpload(raw);if(!rows.length)throw Error('빈 원장입니다.');
    await save(addLegacy(db,rows));return json({count:rows.length});
  }
  const body=JSON.parse(raw.toString()||'{}');
  if(p==='/api/download-json'){
    const value=body.payload,name=body.filename;
    if(!['angela-survey/v2','angela-package/v2'].includes(value?.schema)||!(/^[a-zA-Z0-9-]+\.json$/).test(name))throw Error('파일 형식이 올바르지 않습니다.');
    const id=randomUUID();downloads.set(id,{name,content:JSON.stringify(value,null,2),expires:Date.now()+600000});return json({url:`/api/download/${id}`});
  }
  if(p==='/api/session'){
    if(!db.legacyRecords.length&&!db.physicalBooks.length)throw Error('먼저 Excel 원장을 불러오세요.');
    const session=createSession(db,body.worker,body.area);await save({...db,sessions:[...db.sessions,session]});return json(session);
  }
  if(p==='/api/preview')return json(inspectSurvey(db,body.report));
  if(p==='/api/apply'){const {next,mapping}=applySurvey(db,body.report,body.decisions,body.revision,body.year);await save(next);return json({mapping});}
  if(p==='/api/review/resolve'){const {next,physicalId}=resolveReview(db,body.reviewId,body.mode,body.physicalId,body.year,body.status);await save(next);return json({physicalId});}
  if(p==='/api/review/legacy'){await save(resolveLegacyReview(db,body.recordId));return json({ok:true});}
  throw Error('지원하지 않는 요청입니다.');
}
server.listen(Number(process.env.PORT||4173),process.env.HOST||'127.0.0.1',()=>console.log(`Angela: http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||4173}`));
