import {canonical,search,searchKey,publisherDictionary} from '/normalize.mjs';

const $=s=>document.querySelector(s),app=$('#app'),dialog=$('#dialog');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state,survey,report,inspection,noticeTimer;
const mobilePage=location.pathname==='/mobile';
function notice(message,error=false){const el=$('#notice');el.textContent=message;el.className=error?'error':'';el.style.display='block';clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>el.style.display='none',6000);}
const run=fn=>async(...args)=>{try{await fn(...args);}catch(e){notice(e.message,true);}};
async function api(url,body,raw=false){const response=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':raw?'application/octet-stream':'application/json'},body:raw?body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error||'요청에 실패했습니다.');return value;}
function click(selector,fn){$(selector)?.addEventListener('click',run(fn));}
async function download(data,name){const {url}=await api('/api/download-json',{payload:data,filename:name});dialog.innerHTML=`<h2>파일 준비 완료</h2><a class="button" href="${url}" download="${esc(name)}">${esc(name)} 저장</a><div class="actions"><button id="close" class="secondary">닫기</button></div>`;click('#close',()=>dialog.close());dialog.showModal();}
const label=b=>`${b.physicalId||b.legacyLedgerId||b.temporaryId||''} · ${b.titleCanonical||b.titleRaw||''} · ${b.publisherCanonical||''}`;
function candidateList(items,type){return items.map(x=>`<div class="candidate"><strong>${esc(label(x))}</strong> <span class="muted">${type}${x.matchScore?` · 관련도 ${x.matchScore}`:''}</span></div>`).join('');}

async function desktop(){
  state=await api('/api/state');const latest=state.sessions.filter(x=>!x.legacyFormat).at(-1);
  if(latest)$('#mobile-nav').href=`/mobile?session=${latest.id}`;
  app.innerHTML=`<div class="lead"><div><div class="eyebrow">LIBRARY INVENTORY</div><h1>도서 실물조사</h1><p class="muted">과거 장부 ${state.legacyRecords.length}행 · 확인한 실물 ${state.physicalBooks.length}권</p></div><a class="button secondary" href="/api/export">결과 Excel 생성</a></div>
    <div class="steps"><section class="panel"><span class="step-number">01 / 원장</span><h2>과거 Excel 가져오기</h2><a class="button secondary" href="/api/sample">샘플 다운로드</a><label for="excel">Excel 원장</label><input id="excel" type="file" accept=".xls,.xlsx" ${state.legacyRecords.length?'disabled':''}><p class="muted">.xls는 PC에 Microsoft Excel이 필요합니다. 제목이 있는 행을 시트명·행 번호와 함께 보존합니다.</p></section>
    <section class="panel"><span class="step-number">02 / 조사</span><h2>조사 시작</h2><input id="worker" placeholder="작업자"><input id="area" placeholder="조사 구역" style="margin-top:8px"><button id="create" style="margin-top:12px" ${!state.legacyRecords.length&&!state.physicalBooks.length?'disabled':''}>조사용 데이터 생성</button>${latest?`<a class="session-link" href="/mobile?session=${latest.id}">모바일 조사 화면 열기 ↗</a><button id="package" class="secondary">조사용 JSON 저장</button>`:''}</section>
    <section class="panel"><span class="step-number">03 / 병합</span><h2>조사 결과 반영</h2><label for="json">조사 JSON 파일</label><input id="json" type="file" accept=".json"><p class="muted">충돌과 검토 항목을 결정한 뒤 실물번호를 발급합니다.</p></section></div>
    <section id="review"></section><section class="panel"><h2>검토 필요 <span class="tag warn">${state.reviewQueue.length+state.legacyRecords.filter(x=>x.reviewRequired).length}건</span></h2><div id="queue"></div></section>
    <section class="panel"><h2>실물 목록</h2><input id="pc-search" type="search" placeholder="실물번호 · 제목 · 출판사 검색"><div id="physical-list"></div></section>
    <section class="panel"><h2>과거 장부</h2><input id="legacy-search" type="search" placeholder="과거 번호 · 제목 · 출판사 검색"><div id="legacy-list"></div></section>`;
  const quality=state.legacyRecords.filter(x=>x.reviewRequired);
  $('#queue').innerHTML=(state.reviewQueue.map((x,i)=>`<div class="candidate"><strong>${esc(x.entry?.titleCanonical||x.entry?.titleRaw)}</strong> · ${esc(x.entry?.physicalId||x.entry?.temporaryId||'')}<p class="muted">실물 여부와 번호를 확인한 뒤 결정하세요.</p><select id="queue-mode-${i}"><option value="">처리 방법</option>${x.entry?.physicalId?'':'<option value="link">기존 실물 연결</option>'}<option value="issue">신규 실물번호 확정</option><option value="dismiss">조사 기록만 보관</option></select><input id="queue-id-${i}" placeholder="기존 실물번호 (연결 시)"><label for="queue-status-${i}">확정 후 상태</label><select id="queue-status-${i}">${['ACTIVE','DISCARDED','LOST','UNKNOWN'].map(s=>`<option value="${s}" ${s===(x.entry?.status==='UNKNOWN'?'ACTIVE':x.entry?.status)?'selected':''}>${s}</option>`).join('')}</select><button data-resolve="${i}">결정 저장</button></div>`).join('')+quality.map((x,i)=>`<div class="candidate"><strong>${esc(x.legacyLedgerId)} · ${esc(x.titleCanonical)}</strong><p class="muted">권수 원문 ${esc(x.quantityRaw)} · 비고 원문 ${esc(x.noteRaw)} · ${esc(x.reviewReason)}</p><button class="secondary" data-quality="${i}">원문 확인 완료</button></div>`).join(''))||'<p class="muted">대기 중인 항목이 없습니다.</p>';
  document.querySelectorAll('[data-resolve]').forEach(el=>el.onclick=run(async()=>{const i=Number(el.dataset.resolve),item=state.reviewQueue[i];await api('/api/review/resolve',{reviewId:item.id,mode:$(`#queue-mode-${i}`).value,physicalId:$(`#queue-id-${i}`).value.trim(),year:state.year,status:$(`#queue-status-${i}`).value});await desktop();notice('검토 결정을 저장했습니다.');}));
  document.querySelectorAll('[data-quality]').forEach(el=>el.onclick=run(async()=>{await api('/api/review/legacy',{recordId:quality[Number(el.dataset.quality)].recordId});await desktop();notice('장부 원문 검토를 기록했습니다.');}));
  renderDesktopLists();$('#pc-search').oninput=renderDesktopLists;$('#legacy-search').oninput=renderDesktopLists;
  $('#excel').onchange=run(async e=>{const f=e.target.files[0];if(!f)return;const result=await api('/api/excel',await f.arrayBuffer(),true);await desktop();notice(`${result.count}개의 장부 행을 원문과 함께 보존했습니다.`);});
  click('#create',async()=>{await api('/api/session',{worker:$('#worker').value,area:$('#area').value});await desktop();notice('조사용 데이터를 생성했습니다.');});
  click('#package',()=>download(latest,`survey-package-${latest.id}.json`));
  $('#json').onchange=run(async e=>{const f=e.target.files[0];if(!f)return;report=JSON.parse(await f.text());$('#review').innerHTML=`<section class="panel"><h2>조사 파일: ${esc(f.name)}</h2><button id="inspect">충돌·중복 검사</button></section>`;click('#inspect',inspect);});
}
function renderDesktopLists(){
  const physical=search($('#pc-search').value,state.physicalBooks,100);
  const books=$('#pc-search').value?physical:state.physicalBooks;
  $('#physical-list').innerHTML=books.length?books.map(b=>`<div class="candidate"><strong>${esc(b.physicalId)}</strong> · ${esc(b.titleCanonical)} · ${esc(b.publisherCanonical)} <span class="tag ${b.status==='ACTIVE'?'ok':'warn'}">${esc(b.status)}</span><div class="muted">장부 연결: ${esc(state.legacyRecords.find(x=>x.recordId===b.legacyRecordId)?.legacyLedgerId||'없음')} · 번호표: ${esc(b.labelStatus)} · 상태 이력 ${(state.statusHistory||[]).filter(x=>x.physicalId===b.physicalId).length}건</div></div>`).join(''):'<p class="muted">등록된 실물이 없습니다.</p>';
  const legacy=$('#legacy-search').value?search($('#legacy-search').value,state.legacyRecords,100):state.legacyRecords;
  $('#legacy-list').innerHTML=legacy.length?legacy.slice(0,100).map(x=>`<div class="candidate"><strong>${esc(x.legacyLedgerId)}</strong> · ${esc(x.titleCanonical)} · ${esc(x.publisherCanonical)}<div class="muted">${esc(x.sourceSheet)} ${x.sourceRow}행 · 원본 권수 ${esc(x.quantityRaw)} · 비고 ${esc(x.noteRaw)}</div></div>`).join(''):'<p class="muted">원장 항목이 없습니다.</p>';
}
async function inspect(){
  inspection=await api('/api/preview',{report});const p=inspection;
  $('#review').innerHTML=`<section class="panel"><h2>병합 검토 · ${p.entries.length}권</h2><p class="muted">실물번호는 한 권에 하나씩 유지됩니다. 유사 후보는 자동 연결되지 않습니다.</p>${p.reviews.map((r,i)=>`<div class="conflict"><h3>${esc(r.message)}</h3>${r.candidates?candidateList(r.candidates,'기존 실물'):''}<label for="decision-${i}">처리</label><select id="decision-${i}" data-key="${esc(r.key)}"><option value="">선택하세요</option>${r.options.map(o=>`<option value="${o}">${{keep:'PC 유지',apply:'조사 반영',defer:'보류 · 검토 큐',issue:'신규 실물번호 발급',link:'기존 실물 연결',confirm:'확인 후 반영',distinct:'다른 실물로 등록'}[o]}</option>`).join('')}</select>${r.options.includes('link')?`<input id="link-${i}" placeholder="기존 실물번호 (연결 선택 시)">`:''}</div>`).join('')}<label for="year">발급 연도</label><input id="year" type="number" min="2000" max="9999" value="${state.year}"><div class="actions"><button id="apply" ${p.reviews.length?'disabled':''}>최종 반영</button><button id="recheck" class="secondary">재검사</button></div></section>`;
  const selects=[...document.querySelectorAll('[data-key]')];for(const s of selects)s.onchange=()=>$('#apply').disabled=selects.some(x=>!x.value);
  click('#recheck',inspect);
  click('#apply',async()=>{const decisions={};for(const [i,s] of selects.entries()){decisions[s.dataset.key]=s.value;if(s.value==='link')decisions[`link:${p.reviews[i].entryId}`]=$(`#link-${i}`).value.trim();}const result=await api('/api/apply',{report,decisions,revision:p.revision,year:Number($('#year').value)});report=null;await desktop();$('#review').innerHTML=`<section class="panel"><h2>반영 완료</h2>${result.mapping.map(x=>`<p>${esc(x.title)}: ${esc(x.temporaryId)} → <strong>${esc(x.physicalId)}</strong></p>`).join('')}<a class="button" href="/api/export">결과 Excel 저장</a></section>`;notice('조사 결과를 반영했습니다.');});
}

const surveyKey=id=>`angela-survey-v2:${id}`;
function saveSurvey(next){localStorage.setItem(surveyKey(next.id),JSON.stringify(next));survey=next;}
async function mobile(){
  const id=new URLSearchParams(location.search).get('session');
  if(!id){app.innerHTML=`<div class="mobile-wrap"><h1>현장 도서 조사</h1><section class="panel"><label for="package-file">조사용 JSON 열기</label><input id="package-file" type="file" accept=".json"><div id="drafts"></div></section></div>`;
    $('#drafts').innerHTML=Object.keys(localStorage).filter(x=>x.startsWith('angela-survey-v2:')).map(x=>{try{const s=JSON.parse(localStorage.getItem(x));return `<a class="session-link" href="/mobile?session=${encodeURIComponent(s.id)}">${esc(s.createdAt)} · ${s.entries.length}권 조사 계속하기</a>`;}catch{return '';}}).join('');
    $('#package-file').onchange=run(async e=>{const value=JSON.parse(await e.target.files[0].text());if(value.schema!=='angela-package/v2')throw Error('조사용 JSON v2가 아닙니다.');saveSurvey({...value,entries:[],savedAt:null});history.replaceState(null,'',`/mobile?session=${encodeURIComponent(value.id)}`);mobileRender();});return;}
  const cached=localStorage.getItem(surveyKey(id));survey=cached?JSON.parse(cached):{...await api(`/api/session/${id}`),entries:[],savedAt:null};
  if(survey.schema!=='angela-package/v2')throw Error('이전 조사 형식입니다. PC에서 새 조사를 생성하세요.');
  saveSurvey(survey);mobileRender();
}
function mobileRender(){
  app.innerHTML=`<div class="mobile-wrap"><div class="lead"><div><div class="eyebrow">FIELD SURVEY</div><h1>실물 한 권씩 조사</h1><p class="muted">${esc(survey.worker||'작업자 미기재')} · ${esc(survey.area||'구역 미기재')} · ${survey.entries.length}권 기록</p></div><span class="saved">${survey.savedAt?'기기에 저장됨':'조사 준비 완료'}</span></div>
    <section class="panel"><label for="find">실물번호 또는 제목 검색</label><input id="find" type="search" placeholder="예: 2014-0087, 김수환 사랑, ㄱㄹㄷㅊㅇㅅ"><div id="matches"></div></section>
    <div class="actions"><button id="numbered">＋ 번호 있는 책</button><button id="unlabelled" class="secondary">번호 없음 / 훼손</button></div>
    <section class="panel" style="margin-top:18px"><h2>이번 조사 기록</h2><div id="entries"></div><button id="export" ${!survey.entries.length?'disabled':''}>조사 JSON export</button></section></div>`;
  $('#find').oninput=renderMatches;renderMatches();renderEntries();
  click('#numbered',()=>entryDialog(false));click('#unlabelled',()=>entryDialog(true));
  click('#export',()=>download({schema:'angela-survey/v2',catalogId:survey.catalogId,sessionId:survey.id,worker:survey.worker,area:survey.area,entries:survey.entries},`survey-result-${survey.id}.json`));
}
function renderMatches(){
  const q=$('#find').value.trim();if(!q){$('#matches').innerHTML='<p class="muted">검색 결과에서 실물을 선택하거나 새 책을 기록하세요.</p>';return;}
  const physical=search(q,survey.physicalBooks,10),legacy=search(q,survey.legacyRecords,10);
  $('#matches').innerHTML=`<h3>기존 실물</h3>${candidateList(physical,'실물')||'<p class="muted">없음</p>'}<h3>과거 장부 후보</h3>${candidateList(legacy,'장부')||'<p class="muted">없음</p>'}<div class="actions">${physical.map(x=>`<button class="secondary" data-existing="${esc(x.physicalId)}">${esc(x.physicalId)} 조사</button>`).join('')}${legacy.map(x=>`<button class="secondary" data-legacy="${esc(x.recordId)}">${esc(x.legacyLedgerId)}와 연결</button>`).join('')}</div>`;
  document.querySelectorAll('[data-existing]').forEach(el=>el.onclick=()=>entryDialog(false,survey.physicalBooks.find(x=>x.physicalId===el.dataset.existing)));
  document.querySelectorAll('[data-legacy]').forEach(el=>el.onclick=()=>entryDialog(false,null,survey.legacyRecords.find(x=>x.recordId===el.dataset.legacy)));
}
function renderEntries(){$('#entries').innerHTML=survey.entries.length?survey.entries.map(e=>`<div class="candidate"><strong>${esc(e.physicalId||e.temporaryId)}</strong> · ${esc(canonical(e.titleRaw))} · ${esc(e.publisherRaw)} <span class="tag ${e.status==='ACTIVE'?'ok':'warn'}">${esc(e.status)}</span></div>`).join(''):'<p class="muted">기록이 없습니다.</p>';}
function entryDialog(noLabel=false,existing=null,legacy=null){
  const publishers=survey.publishers||publisherDictionary(survey.legacyRecords,survey.physicalBooks);
  const titles=[...new Set([...survey.legacyRecords,...survey.physicalBooks].map(x=>x.titleCanonical).filter(Boolean))];
  dialog.innerHTML=`<form id="entry-form"><h2>${existing?'기존 실물 조사':noLabel?'번호 없는 책':'번호 있는 책 기록'}</h2>
    ${noLabel?'<p class="notice-inline">임시 ID로 저장합니다. PC 검토 전에는 새 실물번호를 발급하지 않습니다.</p>':`<label for="physical-id">실제 책의 번호</label><input id="physical-id" name="physicalId" pattern="[0-9]{4}-[0-9]{4}" placeholder="YYYY-NNNN" required value="${esc(existing?.physicalId||'')}">`}
    <label for="title">도서명</label><input id="title" name="titleRaw" required list="title-options" value="${esc(existing?.titleRaw||legacy?.titleRaw||'')}"><datalist id="title-options">${titles.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
    <label for="publisher">출판사</label><input id="publisher" name="publisherRaw" list="publisher-options" value="${esc(existing?.publisherRaw||legacy?.publisherRaw||'')}"><datalist id="publisher-options">${publishers.map(x=>`<option value="${esc(x.canonicalName)}">`).join('')}</datalist><div id="publisher-suggestions"></div>
    <label for="volume">권 번호 (알고 있는 경우)</label><input id="volume" name="volume" value="${esc(existing?.volume||'')}">
    <label for="acquired-date">입수일 원문 (알고 있는 경우)</label><input id="acquired-date" name="acquiredDateRaw" value="${esc(existing?.acquiredDateRaw||'')}">
    <label for="legacy">과거 장부 연결</label><select id="legacy" name="legacyRecordId"><option value="">연결하지 않음</option>${survey.legacyRecords.map(x=>`<option value="${esc(x.recordId)}" ${x.recordId===(legacy?.recordId||existing?.legacyRecordId)?'selected':''}>${esc(label(x))}</option>`).join('')}</select>
    <label for="status">실물 상태</label><select id="status" name="status">${['ACTIVE','DISCARDED','LOST','UNKNOWN'].map(x=>`<option value="${x}" ${x===(existing?.status||(noLabel?'UNKNOWN':'ACTIVE'))?'selected':''}>${x}</option>`).join('')}</select>
    <label for="note">조사 메모</label><input id="note" name="note" value="${esc(existing?.note||'')}">
    <div id="duplicate-warning"></div><div class="actions"><button type="button" id="cancel" class="secondary">취소</button><button type="submit">후보 확인 후 저장</button></div></form>`;
  click('#cancel',()=>dialog.close());
  const form=$('#entry-form');
  const preview=()=>{if(existing){$('#duplicate-warning').innerHTML='';return;}const q=$('#title').value;const candidates=search(q,[...survey.physicalBooks,...survey.legacyRecords],5).filter(x=>x.matchScore>=55);$('#duplicate-warning').innerHTML=candidates.length?`<div class="notice-inline"><strong>비슷한 기존 도서가 있습니다. 자동 병합하지 않습니다.</strong>${candidateList(candidates,'후보')}<label for="duplicate-choice">이 책의 처리</label><select id="duplicate-choice" required><option value="">선택하세요</option><option value="distinct">다른 책 · 신규 실물로 기록</option><option value="uncertain">확실하지 않음 · PC 검토</option>${noLabel?'<option value="existing">기존 실물과 연결</option>':''}</select>${noLabel?`<input id="candidate-physical" placeholder="기존 실물번호 (기존 실물 연결 시)">`:''}</div>`:'';};
  const suggestPublisher=()=>{const q=searchKey($('#publisher').value);$('#publisher-suggestions').innerHTML=q?publishers.filter(x=>x.id.includes(q)||q.includes(x.id)).slice(0,5).map((x,i)=>`<button type="button" class="secondary" data-publisher="${i}">${esc(x.canonicalName)}${x.aliases.length>1?` · ${x.aliases.length}개 표기`:''}</button>`).join(''):'';const matches=publishers.filter(x=>x.id.includes(q)||q.includes(x.id)).slice(0,5);document.querySelectorAll('[data-publisher]').forEach(el=>el.onclick=()=>{$('#publisher').value=matches[Number(el.dataset.publisher)].canonicalName;$('#publisher-suggestions').innerHTML='';});};
  $('#title').oninput=preview;$('#publisher').oninput=suggestPublisher;preview();suggestPublisher();
  form.onsubmit=run(async event=>{event.preventDefault();const f=new FormData(form),id=f.get('physicalId')?.trim()||null;
    if(id && survey.physicalBooks.some(x=>x.physicalId===id) && existing?.physicalId!==id)throw Error('이미 등록된 실물번호입니다. 검색 결과에서 기존 실물을 선택하세요.');
    if(id && survey.entries.some(x=>x.physicalId===id) && existing?.physicalId!==id)throw Error('이번 조사에 이미 사용한 실물번호입니다.');
    const choice=$('#duplicate-choice')?.value;if($('#duplicate-choice')&&!choice)throw Error('유사 도서 후보를 확인하고 처리 방법을 선택하세요.');
    let physicalId=id,temporaryId=null;
    if(noLabel){temporaryId=`temp-${crypto.randomUUID()}`;if(choice==='existing'){physicalId=$('#candidate-physical').value.trim();if(!survey.physicalBooks.some(x=>x.physicalId===physicalId))throw Error('기존 실물번호를 확인하세요.');temporaryId=null;}}
    const entry={physicalId,temporaryId,isNew:!existing&&!(noLabel&&choice==='existing'),titleRaw:f.get('titleRaw'),publisherRaw:f.get('publisherRaw')||'',volume:f.get('volume')||'',acquiredDateRaw:f.get('acquiredDateRaw')||'',legacyRecordId:f.get('legacyRecordId')||null,status:f.get('status'),labelStatus:noLabel?'MISSING':'PRESENT',note:f.get('note')||'',recordedAt:new Date().toISOString(),candidateChoice:choice||null};
    if(choice==='uncertain'){entry.note=`[유사 도서 확인 필요] ${entry.note}`.trim();}
    const next=structuredClone(survey),index=next.entries.findIndex(x=>x.physicalId&&x.physicalId===physicalId);
    if(index>=0)next.entries[index]=entry;else next.entries.push(entry);
    next.savedAt=new Date().toISOString();saveSurvey(next);dialog.close();mobileRender();notice('조사 기록을 기기에 저장했습니다.');
  });
  dialog.showModal();
}
run(mobilePage?mobile:desktop)();
