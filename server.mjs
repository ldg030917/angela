import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uid, check, quantity, preview, applyReport, yearNow } from './domain.mjs';
import { makeExcel, readExcel } from './xlsx-native.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const data=path.resolve(root,process.env.DATA_DIR||'data'); await fs.mkdir(data,{recursive:true});
const dbPath=path.join(data,'catalog.json');
let db; try {db=JSON.parse(await fs.readFile(dbPath,'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e; db={catalogId:uid(),revision:0,books:[],sessions:[],applied:[],disposals:[]};}
async function save(next){await fs.writeFile(dbPath+'.tmp',JSON.stringify(next,null,2));await fs.rename(dbPath+'.tmp',dbPath);db=next;}
const sample=[{id:'2026-0001',title:'어린 왕자',author:'앙투안 드 생텍쥐페리',location:'A-01',qty:3},{id:'2026-0002',title:'데미안',author:'헤르만 헤세',location:'A-02',qty:2},{id:'2026-0007',title:'코스모스',author:'칼 세이건',location:'B-01',qty:4},{id:'2025-0012',title:'우리의 정원',author:'김하늘',location:'C-03',qty:1}];
const downloads=new Map();
let queue=Promise.resolve();
const server=http.createServer((req,res)=>{const job=()=>handle(req,res).catch(e=>{res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:e.message}));});queue=queue.then(job,job);});
async function handle(req,res){
 const url=new URL(req.url,'http://localhost'); const p=url.pathname;
 const json=o=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(o));};
 const download=async(file,name)=>{res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${name}"`});res.end(await fs.readFile(file));};
 if(req.method==='GET'){
  if(p==='/api/state') return json({...db,year:yearNow()});
  if(p.startsWith('/api/download/')){const item=downloads.get(p.split('/').pop());check(item && item.expires>Date.now(),'다운로드가 만료되었습니다. 다시 내보내세요.');res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${item.name}"`,'Cache-Control':'no-store'});return res.end(item.content);}
  if(p.startsWith('/api/session/')){const s=db.sessions.find(s=>s.id===p.split('/').pop());check(s,'조사를 찾을 수 없습니다.');return json({...s,catalogId:db.catalogId,applied:db.applied.some(a=>a.sessionId===s.id)});}
  if(p==='/api/sample'){const f=path.join(data,'sample.xlsx');await makeExcel(sample,[],f);return download(f,'sample.xlsx');}
  if(p==='/api/export'){check(db.books.length,'먼저 원장을 불러오세요.');const f=path.join(data,'result.xlsx');await makeExcel(db.books,db.disposals,f);return download(f,'result.xlsx');}
  const files={'/':'index.html','/mobile':'index.html','/app.js':'app.js','/style.css':'style.css'};
  if(files[p]){res.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8','Cache-Control':'no-cache'});return res.end(await fs.readFile(path.join(root,'public',files[p])));}
  res.writeHead(404);return res.end('Not found');
 }
 check(req.method==='POST','지원하지 않는 요청입니다.');
 if(req.headers.origin) check(req.headers.origin===`http://${req.headers.host}`,'다른 사이트의 요청은 허용되지 않습니다.');
 let buffers=[],size=0; for await(const c of req){size+=c.length;check(size<=10*1024*1024,'파일 크기는 10MB 이하로 제한됩니다.');buffers.push(c);} const raw=Buffer.concat(buffers);
 if(p==='/api/excel'){
  check(!db.books.length,'이미 원장이 있습니다. 현재 원장을 덮어쓸 수 없습니다.');
  const f=path.join(data,'upload.xlsx');await fs.writeFile(f,raw); const books=await readExcel(f); check(books.length,'빈 원장입니다.');await save({...db,books,revision:db.revision+1});return json({count:books.length});
 }
 if(p==='/api/download-json'){
  const {payload:value,filename:name}=JSON.parse(raw.toString());check(['angela-survey/v1','angela-package/v1'].includes(value.schema),'지원하지 않는 파일 형식입니다.');
  check(/^[a-zA-Z0-9-]+\.json$/.test(name),'파일명이 올바르지 않습니다.');
  for(const [id,item] of downloads)if(item.expires<Date.now())downloads.delete(id);
  const id=uid();downloads.set(id,{name,content:JSON.stringify(value,null,2),expires:Date.now()+600000});return json({url:`/api/download/${id}`});
 }
 const body=JSON.parse(raw.toString()||'{}');
 if(p==='/api/session'){check(db.books.length,'먼저 Excel 원장을 불러오세요.');const s={id:uid(),createdAt:new Date().toISOString(),books:structuredClone(db.books)};await save({...db,sessions:[...db.sessions,s]});return json(s);}
 if(p==='/api/edit'){const next=structuredClone(db),b=next.books.find(b=>b.id===body.id);check(b,'도서가 없습니다.');check(body.version===b.version,'다른 창에서 도서가 변경되었습니다. 새로고침하세요.');b.qty=quantity(body.qty);b.version++;next.revision++;await save(next);return json({ok:true});}
 if(p==='/api/preview') return json(preview(db,body.report));
 if(p==='/api/apply'){const {next,mapping}=applyReport(db,body.report,body.choices,body.revision,body.year);await save(next);return json({mapping});}
 throw new Error('지원하지 않는 요청입니다.');
}
server.listen(Number(process.env.PORT||4173),process.env.HOST||'127.0.0.1',()=>console.log(`Angela: http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||4173}`));
