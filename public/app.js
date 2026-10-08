import {canonical,search,searchKey,publisherDictionary,physicalCandidatesForLegacy} from './normalize.mjs';
import {formatPhysicalIdInput,normalizePhysicalId,isPhysicalIdAlreadyIssued,reserveNextPhysicalIds} from './physical-id.mjs';
import {statusName} from './status.mjs';

const $=s=>document.querySelector(s),app=$('#app'),dialog=$('#dialog');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state,survey,report,inspection,noticeTimer,reportQueue=[];
const nativeApp=!!window.AngelaAndroid;
const mobilePage=location.pathname==='/mobile'||location.pathname.endsWith('/mobile.html');
const resultPayload=()=>({schema:'angela-survey/v2',catalogId:survey.catalogId,sessionId:survey.id,reportId:survey.reportId,worker:survey.worker,area:survey.area,entries:survey.entries});
const resultName=()=>`survey-result-${survey.reportId||survey.id}.json`;
function formatIdField(input){if(!input)return;input.addEventListener('input',()=>{input.value=formatPhysicalIdInput(input.value);});input.addEventListener('blur',()=>{if(input.value){try{input.value=normalizePhysicalId(input.value);}catch(e){notice(e.message,true);}}});}
function notice(message,error=false){const el=$('#notice');el.textContent=message;el.className=error?'error':'';el.style.display='block';clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>el.style.display='none',6000);}
const run=fn=>async(...args)=>{try{await fn(...args);}catch(e){notice(e.message,true);}};
async function api(url,body,raw=false){const response=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':raw?'application/octet-stream':'application/json'},body:raw?body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error||'요청에 실패했습니다.');return value;}
function click(selector,fn){$(selector)?.addEventListener('click',run(fn));}
async function download(data,name){if(nativeApp){window.AngelaAndroid.saveSurvey(JSON.stringify(data,null,2),name);return;}const {url}=await api('/api/download-json',{payload:data,filename:name});dialog.innerHTML=`<h2>파일 준비 완료</h2><a class="button" href="${url}" download="${esc(name)}">${esc(name)} 저장</a><div class="actions"><button id="close" class="secondary">닫기</button></div>`;click('#close',()=>dialog.close());dialog.showModal();}
async function shareResult(){
  const payload=resultPayload(),name=resultName(),content=JSON.stringify(payload,null,2);
  if(nativeApp){window.AngelaAndroid.shareSurvey(content);return;}
  const shared=new File([content],name,{type:'application/json'});
  if(navigator.canShare?.({files:[shared]})&&navigator.share){
    try{await navigator.share({files:[shared],title:'Angela 조사 결과',text:'도서 실물조사 결과 파일'});}catch(e){if(e.name!=='AbortError')throw e;}
    return;
  }
  notice('이 기기에서는 직접 공유를 지원하지 않습니다. 파일을 저장한 후 공유해주세요.');
  await download(payload,name);
}
async function saveExcel(){
  const response=await fetch('/api/export');if(!response.ok)throw Error((await response.json()).error||'Excel 생성에 실패했습니다.');
  const blob=await response.blob();const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}),name=`도서목록_${today}_조사반영.xlsx`;
  if(window.showSaveFilePicker){
    try{const handle=await window.showSaveFilePicker({suggestedName:name,types:[{description:'Excel 통합 문서',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}]});const writable=await handle.createWritable();await writable.write(blob);await writable.close();notice('결과 Excel을 저장했습니다.');}catch(e){if(e.name!=='AbortError')throw e;}
  }else{const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);notice('브라우저 다운로드 폴더에 결과 Excel을 저장했습니다.');}
}
const label=b=>`${b.physicalId||b.legacyLedgerId||b.temporaryId||''} · ${b.titleCanonical||b.titleRaw||''} · ${b.publisherCanonical||''}`;
const physicalNote=b=>{const legacy=state.legacyRecords.find(x=>x.recordId===b.legacyRecordId);return b.noteRawOverride?(b.noteRaw||''):legacy?.noteRawEdited?(legacy.noteRaw||''):(b.noteRaw||legacy?.noteRaw||'');};
function candidateList(items,type){return items.map(x=>`<div class="candidate"><strong>${esc(label(x))}</strong> <span class="muted">${type}${x.matchScore?` · 관련도 ${x.matchScore}`:''}</span></div>`).join('');}

async function desktop(){
  state=await api('/api/state');const latest=state.sessions.filter(x=>!x.legacyFormat).at(-1);
  if(latest)$('#mobile-nav').href=`/mobile?session=${latest.id}`;
  app.innerHTML=`<div class="lead"><div><div class="eyebrow">LIBRARY INVENTORY</div><h1>도서 실물조사</h1><p class="muted">과거 장부 ${state.legacyRecords.length}행 · 확인한 실물 ${state.physicalBooks.length}권</p></div><button id="export-excel" class="secondary">결과 Excel 저장</button></div>
    <div class="steps"><section class="panel"><span class="step-number">01 / 원장</span><h2>과거 Excel 가져오기</h2><label for="excel">Excel 파일 열기</label><input id="excel" type="file" accept=".xls,.xlsx" ${state.legacyRecords.length?'disabled':''}><p class="muted">.xls는 PC에 Microsoft Excel이 필요합니다. 제목이 있는 행을 시트명·행 번호와 함께 보존합니다.</p><button id="reset-catalog" class="secondary" ${state.legacyRecords.length||state.physicalBooks.length?'':'disabled'}>원장 초기화</button><label for="result-excel">결과 Excel 가져오기</label><input id="result-excel" type="file" accept=".xlsx"><p class="muted">이 프로그램에서 저장한 결과 Excel을 불러옵니다. 기존 번호와 내용이 충돌하면 원장을 바꾸지 않고 오류를 표시합니다.</p></section>
    <section class="panel"><span class="step-number">02 / 조사</span><h2>조사 시작</h2><input id="worker" placeholder="작업자"><input id="area" placeholder="조사 구역" style="margin-top:8px"><button id="create" style="margin-top:12px" ${!state.legacyRecords.length&&!state.physicalBooks.length?'disabled':''}>조사용 데이터 생성</button>${latest?`<button id="package" class="secondary">Android 앱용 조사 파일 다운로드</button>`:''}<a class="session-link" href="/api/android-app">Android 현장조사 앱 다운로드</a></section>
    <section class="panel"><span class="step-number">03 / 병합</span><h2>조사 결과 반영</h2><label for="json">조사 결과 불러오기</label><input id="json" type="file" accept=".json" multiple><p class="muted">여러 결과 파일을 함께 선택할 수 있습니다. 파일마다 충돌과 검토 항목을 결정합니다.</p></section></div>
    <section id="review"></section><section class="panel"><h2>검토 필요 <span class="tag warn">${state.reviewQueue.length+state.legacyRecords.filter(x=>x.reviewRequired).length}건</span></h2><div id="queue"></div></section>
    <section class="panel"><h2>실물 목록</h2><button id="pc-add" class="secondary">새로 들여온 책 등록</button><input id="pc-search" type="search" placeholder="실물번호 · 제목 · 출판사 검색"><div id="physical-list"></div></section>
<section class="panel"><h2>새 실물 Excel 일괄 추가</h2><p class="muted">기존 실물은 수정하지 않습니다. Excel의 번호를 실물번호로 사용하고, 시트의 실제 행 번호 범위만 가져옵니다. 번호 중복이나 잘못된 행이 있으면 전체를 중단합니다.</p><label for="bulk-file">기존 장부 형식 Excel (.xls/.xlsx)</label><input id="bulk-file" type="file" accept=".xls,.xlsx"><label for="bulk-sheet">시트명 (여러 시트의 행 범위가 겹칠 때 입력)</label><input id="bulk-sheet" placeholder="예: 도서목록"><div class="bulk-range"><div><label for="bulk-start">시작 행</label><input id="bulk-start" type="number" min="1" max="10001" placeholder="1457"></div><div><label for="bulk-end">끝 행</label><input id="bulk-end" type="number" min="1" max="10001" placeholder="1788"></div></div><button id="bulk-preview" class="secondary">추가할 책 미리 확인</button><div id="bulk-preview-result"></div></section>
    <section class="panel"><h2>과거 장부</h2><input id="legacy-search" type="search" placeholder="과거 번호 · 제목 · 출판사 검색"><div id="legacy-list"></div></section>`;
  const quality=state.legacyRecords.filter(x=>x.reviewRequired);
  $('#queue').innerHTML=(state.reviewQueue.map((x,i)=>x.kind==='id-change'?`<div class="candidate"><strong>실물번호 변경 요청 · ${esc(x.entry?.oldPhysicalId)} → ${esc(x.entry?.physicalId)}</strong><p class="muted">${esc(x.entry?.titleRaw)} · 사용 이력을 다시 확인하세요.</p><select id="queue-mode-${i}"><option value="">처리 방법</option><option value="apply-id-change">번호 변경 적용</option><option value="dismiss">기존 번호 유지</option></select><label for="queue-id-${i}">최종 번호 · 직접 입력 가능</label><input id="queue-id-${i}" inputmode="numeric" value="${esc(x.entry?.physicalId)}"><button data-resolve="${i}">결정 저장</button></div>`:`<div class="candidate"><strong>${esc(x.entry?.titleCanonical||x.entry?.titleRaw)}</strong> · ${esc(x.entry?.physicalId||x.entry?.temporaryId||'')}<p class="muted">실물 여부와 번호를 확인한 뒤 결정하세요.</p><select id="queue-mode-${i}"><option value="">처리 방법</option>${x.entry?.physicalId?'':'<option value="link">기존 실물 연결</option>'}<option value="issue">신규 실물번호 확정</option><option value="dismiss">조사 기록만 보관</option></select><input id="queue-id-${i}" inputmode="numeric" placeholder="기존 실물번호 (연결 시)"><label for="queue-status-${i}">확정 후 상태</label><select id="queue-status-${i}">${['ACTIVE','DISCARDED','LOST','UNKNOWN'].map(s=>`<option value="${s}" ${s===(x.entry?.status==='UNKNOWN'?'ACTIVE':x.entry?.status)?'selected':''}>${statusName(s)}</option>`).join('')}</select><button data-resolve="${i}">결정 저장</button></div>`).join('')+quality.map((x,i)=>`<div class="candidate"><strong>${esc(x.legacyLedgerId)} · ${esc(x.titleCanonical)}</strong><p class="muted">권수 원문 ${esc(x.quantityRaw)} · 비고 원문 ${esc(x.noteRaw)} · ${esc(x.reviewReason)}</p><button class="secondary" data-quality="${i}">원문 확인 완료</button></div>`).join(''))||'<p class="muted">대기 중인 항목이 없습니다.</p>';
  state.reviewQueue.forEach((_,i)=>formatIdField($(`#queue-id-${i}`)));
  document.querySelectorAll('[data-resolve]').forEach(el=>el.onclick=run(async()=>{const i=Number(el.dataset.resolve),item=state.reviewQueue[i],raw=$(`#queue-id-${i}`).value.trim();await api('/api/review/resolve',{reviewId:item.id,mode:$(`#queue-mode-${i}`).value,physicalId:raw?normalizePhysicalId(raw):'',year:state.year,status:$(`#queue-status-${i}`)?.value});await desktop();notice('검토 결정을 저장했습니다.');}));
  document.querySelectorAll('[data-quality]').forEach(el=>el.onclick=run(async()=>{await api('/api/review/legacy',{recordId:quality[Number(el.dataset.quality)].recordId});await desktop();notice('장부 원문 검토를 기록했습니다.');}));
  renderDesktopLists();click('#pc-add',pcAcquisitionDialog);$('#pc-search').oninput=renderDesktopLists;$('#legacy-search').oninput=renderDesktopLists;
  click('#export-excel',saveExcel);
  click('#reset-catalog',resetCatalogDialog);
  $('#excel').onchange=run(async e=>{const f=e.target.files[0];if(!f)return;const result=await api('/api/excel',await f.arrayBuffer(),true);await desktop();notice(`${result.count}개의 장부 행을 원문과 함께 보존했습니다.`);});
  $('#result-excel').onchange=run(async e=>{const f=e.target.files[0];if(!f)return;const result=await api('/api/result-excel',await f.arrayBuffer(),true);await desktop();notice(`결과 Excel을 불러왔습니다. 실물 ${result.addedPhysical}권, 미확인 장부 ${result.addedLegacy}행 추가 · 기존 ${result.unchanged}행 유지 · 권 번호 ${result.filledVolumes}건 보완`);});
  let bulkPreview=null,bulkFileBytes=null;
  $('#bulk-file').onchange=run(async e=>{
    bulkPreview=null;bulkFileBytes=null;$('#bulk-preview-result').innerHTML='';
    const file=e.target.files?.[0];if(!file)return;
    if(file.size>10*1024*1024)throw Error('Excel 파일은 10MB 이하만 가져올 수 있습니다.');
    try{bulkFileBytes=await file.arrayBuffer();}
    catch{throw Error('선택한 파일을 읽을 수 없습니다. 파일을 PC의 로컬 폴더에 복사한 뒤 다시 선택하세요.');}
    notice(file.name+' 파일을 읽었습니다. 행 범위를 입력한 뒤 미리 확인하세요.');
  });
  click('#bulk-preview',async()=>{
    if(!bulkFileBytes)throw Error('읽을 수 있는 Excel 파일을 다시 선택하세요.');
    const start=$('#bulk-start').value,end=$('#bulk-end').value,sheet=$('#bulk-sheet').value.trim();
    if(!start||!end)throw Error('시작 행과 끝 행을 입력하세요.');
    const query=new URLSearchParams({start,end,sheet});
    bulkPreview=await api('/api/physical/import-preview?'+query,bulkFileBytes,true);
    const rows=[...bulkPreview.first,...bulkPreview.last].filter((x,i,a)=>a.findIndex(y=>y.row===x.row)===i);
    $('#bulk-preview-result').innerHTML=`<div class="notice-inline"><strong>${esc(bulkPreview.sheet)} · ${bulkPreview.start}~${bulkPreview.end}행 · ${bulkPreview.count}권 추가 예정</strong><p>기존 실물은 수정하지 않습니다. 번호=실물번호, 날짜=입수일, 도서명, 출판사, 비고를 가져옵니다.</p>${rows.map(x=>`<div>${x.row}행 · ${esc(x.id)} · ${esc(x.title)} · ${esc(x.date)}</div>`).join('')}<button id="bulk-apply">확인한 ${bulkPreview.count}권 추가</button></div>`;
    click('#bulk-apply',async()=>{
      const result=await api('/api/physical/import-apply',{token:bulkPreview.token,revision:bulkPreview.revision});
      await desktop();notice(result.count+'권의 새 실물을 추가했습니다. 번호 '+result.firstId+' ~ '+result.lastId);
    });
  });
  for(const selector of ['#bulk-sheet','#bulk-start','#bulk-end'])$(selector).addEventListener('input',()=>{$('#bulk-preview-result').innerHTML='';bulkPreview=null;});
  click('#create',async()=>{await api('/api/session',{worker:$('#worker').value,area:$('#area').value});await desktop();notice('조사용 데이터를 생성했습니다.');});
  click('#package',()=>download(latest,`survey-package-${latest.id}.json`));
  $('#json').onchange=run(async e=>{const files=[...e.target.files];if(!files.length)return;reportQueue=await Promise.all(files.map(async file=>({name:file.name,value:JSON.parse(await file.text())})));await showNextReport();});
}
function resetCatalogDialog(){
  dialog.innerHTML='<form id="reset-form"><h2>원장 초기화</h2><p>과거 장부 '+state.legacyRecords.length+'행과 실물 '+state.physicalBooks.length+'권, 조사 기록을 모두 초기화합니다. 현재 원장은 PC 데이터 폴더에 자동 백업합니다.</p><label for="reset-word">확인을 위해 초기화 입력</label><input id="reset-word" autocomplete="off" required><div class="actions"><button type="button" id="reset-cancel" class="secondary">취소</button><button type="submit">백업 후 초기화</button></div></form>';
  click('#reset-cancel',()=>dialog.close());
  $('#reset-form').onsubmit=run(async event=>{event.preventDefault();if($('#reset-word').value.trim()!=='초기화')throw Error('초기화를 정확히 입력하세요.');const result=await api('/api/reset',{revision:state.revision});dialog.close();await desktop();notice('원장을 초기화했습니다. 백업: '+result.dataDirectory+'\\'+result.backup);});
  dialog.showModal();
}
async function showNextReport(){
  const item=reportQueue[0];report=item?.value||null;
  if(!item)return;
  $('#review').innerHTML=`<section class="panel"><h2>조사 파일: ${esc(item.name)}</h2><p class="muted">대기 중 ${reportQueue.length}개 파일 · 순서대로 확인합니다.</p><button id="inspect">충돌·중복 검사</button><button id="skip-report" class="secondary">이 파일 건너뛰기</button></section>`;
  click('#inspect',inspect);click('#skip-report',async()=>{reportQueue.shift();await showNextReport();if(!reportQueue.length)$('#review').innerHTML='';});
}
function renderDesktopLists(){
  const physicalQuery=$('#pc-search').value.trim(),legacyQuery=$('#legacy-search').value.trim();
  const books=physicalQuery?search(physicalQuery,state.physicalBooks,100):[];
  $('#physical-list').innerHTML=!physicalQuery?'<p class="muted">실물번호·제목·출판사를 검색하면 목록이 표시됩니다.</p>':books.length?books.map(b=>`<div class="candidate"><strong>${esc(b.physicalId)}</strong> · ${esc(b.titleCanonical)}${b.volume?' · 권 번호: '+esc(b.volume):''} · ${esc(b.publisherCanonical)} <span class="tag ${b.status==='ACTIVE'?'ok':'warn'}">${esc(statusName(b.status))}</span><button class="secondary" data-edit-book>편집</button><div class="muted">장부 연결: ${esc(state.legacyRecords.find(x=>x.recordId===b.legacyRecordId)?.legacyLedgerId||'없음')} · 번호표: ${esc(b.labelStatus)} · 상태 이력 ${(state.statusHistory||[]).filter(x=>x.physicalId===b.physicalId).length}건 · 비고: ${esc(physicalNote(b)||'없음')}</div></div>`).join(''):'<p class="muted">등록된 실물이 없습니다.</p>';
  document.querySelectorAll('[data-edit-book]').forEach(el=>el.onclick=()=>pcEditDialog(el.parentElement.querySelector('strong').textContent));
  const legacy=legacyQuery?search(legacyQuery,state.legacyRecords,100):[];
  $('#legacy-list').innerHTML=!legacyQuery?'<p class="muted">장부번호·제목·출판사를 검색하면 목록이 표시됩니다.</p>':legacy.length?legacy.map(x=>`<div class="candidate"><strong>${esc(x.legacyLedgerId)}</strong> · ${esc(x.titleCanonical)} · ${esc(x.publisherCanonical)}<div class="muted">${esc(x.sourceSheet)} ${x.sourceRow}행 · 원본 권수 ${esc(x.quantityRaw)} · 비고 ${esc(x.noteRaw||'없음')}</div><button type="button" class="secondary" data-legacy-note="${esc(x.recordId)}">비고 수정</button></div>`).join(''):'<p class="muted">원장 항목이 없습니다.</p>';
  document.querySelectorAll('[data-legacy-note]').forEach(el=>el.onclick=()=>pcLegacyNoteDialog(el.dataset.legacyNote));
}
function pcLegacyNoteDialog(recordId){
  const record=state.legacyRecords.find(x=>x.recordId===recordId);if(!record)throw Error('과거 장부 항목을 찾을 수 없습니다.');
  dialog.innerHTML='<form id="pc-legacy-note-form"><h2>과거 장부 비고 수정</h2><p class="muted">'+esc(label(record))+'</p><label for="pc-legacy-note">비고 · 후원사/기업 기록</label><textarea id="pc-legacy-note" name="noteRaw" rows="4" maxlength="2000">'+esc(record.noteRaw||'')+'</textarea><div class="actions"><button type="button" id="pc-legacy-note-cancel" class="secondary">취소</button><button type="submit">비고 저장</button></div></form>';
  click('#pc-legacy-note-cancel',()=>dialog.close());
  $('#pc-legacy-note-form').onsubmit=run(async event=>{event.preventDefault();await api('/api/legacy/note',{recordId,version:record.version,noteRaw:$('#pc-legacy-note').value});dialog.close();await desktop();notice('과거 장부 비고를 저장했습니다.');});
  dialog.showModal();
}
function pcAcquisitionDialog(){
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
  dialog.innerHTML='<form id="pc-acquisition-form"><h2>새로 들여온 책 등록</h2><p class="muted">매수만큼 각기 다른 실물번호를 자동 발급합니다.</p>'+
    '<label for="pc-acq-date">입수일</label><input id="pc-acq-date" name="acquiredDateRaw" type="date" required value="'+today+'">'+
    '<label for="pc-acq-title">도서명</label><input id="pc-acq-title" name="titleRaw" required>'+
    '<label for="pc-acq-volume">권 번호 (시리즈인 경우)</label><input id="pc-acq-volume" name="volume" placeholder="예: 1, 5, 상">'+
    '<label for="pc-acq-publisher">출판사</label><input id="pc-acq-publisher" name="publisherRaw" required>'+
    '<label for="pc-acq-quantity">매수</label><input id="pc-acq-quantity" name="quantity" type="number" min="1" max="100" value="1" required>'+
    '<label for="pc-acq-year">실물번호 연도</label><input id="pc-acq-year" name="year" type="number" min="2000" max="9999" value="'+today.slice(0,4)+'" required><div id="pc-acq-ids" class="read-value"></div>'+
    '<div class="actions"><button type="button" id="pc-acq-cancel" class="secondary">취소</button><button type="submit">등록</button></div></form>';
  click('#pc-acq-cancel',()=>dialog.close());
  const preview=()=>{try{const ids=reserveNextPhysicalIds(state,Number($('#pc-acq-year').value),Number($('#pc-acq-quantity').value));$('#pc-acq-ids').textContent='발급 예정: '+ids[0]+(ids.length>1?' ~ '+ids.at(-1):'');}catch(e){$('#pc-acq-ids').textContent=e.message;}};
  $('#pc-acq-year').oninput=preview;$('#pc-acq-quantity').oninput=preview;preview();
  $('#pc-acquisition-form').onsubmit=run(async event=>{event.preventDefault();const f=new FormData(event.target);const result=await api('/api/physical/add',Object.fromEntries(f));dialog.close();await desktop();notice(result.ids.length+'권 등록: '+result.ids[0]+(result.ids.length>1?' ~ '+result.ids.at(-1):''));});
  dialog.showModal();dialog.tabIndex=-1;dialog.focus();
}
function pcEditDialog(id){
  const book=state.physicalBooks.find(x=>x.physicalId===id);if(!book)throw Error('실물을 찾을 수 없습니다.');
  dialog.innerHTML='<form id="pc-edit-form"><h2>실물 목록 편집</h2>'+
    '<label for="pc-edit-id">도서번호</label><input id="pc-edit-id" name="physicalId" inputmode="numeric" required value="'+esc(book.physicalId)+'">'+
    '<label for="pc-edit-date">입수일</label><input id="pc-edit-date" name="acquiredDateRaw" placeholder="YYYY-MM-DD" value="'+esc(book.acquiredDateRaw||'')+'">'+
    '<label for="pc-edit-title">도서명</label><input id="pc-edit-title" name="titleRaw" required autocomplete="off" value="'+esc(book.titleRaw)+'">'+
    '<label for="pc-edit-volume">권 번호</label><input id="pc-edit-volume" name="volume" value="'+esc(book.volume||'')+'">'+
    '<label for="pc-edit-publisher">출판사</label><input id="pc-edit-publisher" name="publisherRaw" required value="'+esc(book.publisherRaw)+'">'+
    '<label for="pc-edit-note">비고 · 후원사/기업 기록</label><textarea id="pc-edit-note" name="noteRaw" rows="4" maxlength="2000">'+esc(physicalNote(book))+'</textarea>'+
    '<label>매수</label><div class="read-value">1권 · 한 행이 실물 한 권입니다.</div>'+
    '<label for="pc-edit-status">실물 상태</label><select id="pc-edit-status" name="status">'+['ACTIVE','DISCARDED','LOST','UNKNOWN'].map(x=>'<option value="'+x+'"'+(x===book.status?' selected':'')+'>'+statusName(x)+'</option>').join('')+'</select>'+
    '<div class="actions"><button type="button" id="pc-edit-cancel" class="secondary">취소</button><button type="submit">변경 저장</button></div></form>';
  click('#pc-edit-cancel',()=>dialog.close());formatIdField($('#pc-edit-id'));
  $('#pc-edit-form').onsubmit=run(async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.target));await api('/api/physical/edit',{...values,oldPhysicalId:id,version:book.version});dialog.close();await desktop();notice('실물 정보를 수정했습니다.');});
  dialog.showModal();dialog.tabIndex=-1;dialog.focus();
}async function inspect(){
  inspection=await api('/api/preview',{report});const p=inspection;
  if(!p.entries.length){
    $('#review').innerHTML='<section class="panel"><h2>변경된 조사 항목 없음</h2><p class="muted">이 파일의 '+p.unchangedCount+'권은 이전 반영 내용과 같습니다.</p><button id="next-unchanged" class="secondary">다음 조사 파일</button></section>';
    click('#next-unchanged',async()=>{reportQueue.shift();report=null;await showNextReport();if(!reportQueue.length)$('#review').innerHTML='';});
    return;
  }
  const category=e=>e.action==='CHANGE_PHYSICAL_ID'?'실물번호 변경 요청':e.action==='UPDATE_INFO'?'정보 변경 요청':e.action==='CONFIRM'?'정상 확인':e.action==='NEW_ACQUISITION'?'신규 입수':e.candidateChoice==='uncertain'?'PC 검토 필요':e.isNew?'신규 실물':'기존 실물';
  $('#review').innerHTML=`<section class="panel"><h2>병합 검토 · 변경 ${p.entries.length}권 · 기존 반영 ${p.unchangedCount}권 건너뜀</h2><p class="muted">${esc(reportQueue[0]?.name||'조사 파일')} · 실물번호 변경은 여기서 최종 적용합니다.</p><div class="table-wrap"><table><thead><tr><th>구분</th><th>기존 번호</th><th>조사 번호</th><th>도서명</th><th>권 번호</th><th>상태</th></tr></thead><tbody>${p.entries.map(e=>`<tr><td>${esc(category(e))}</td><td>${esc(e.oldPhysicalId||(!e.isNew?e.physicalId:'')||'—')}</td><td>${esc(e.physicalId||'번호 없음')}</td><td>${esc(e.titleCanonical)}</td><td>${esc(e.volume||'—')}</td><td>${esc(statusName(e.status))}</td></tr>`).join('')}</tbody></table></div>${p.reviews.map((r,i)=>`<div class="conflict"><h3>${esc(r.message)}</h3>${r.candidates?candidateList(r.candidates,'기존 실물'):''}<label for="decision-${i}">처리</label><select id="decision-${i}" data-key="${esc(r.key)}"><option value="">선택하세요</option>${r.options.map(o=>`<option value="${o}">${{keep:'기존 유지',apply:'변경 적용',defer:'보류 · PC 검토',issue:'신규 실물번호 발급',link:'기존 실물 연결',confirm:'확인 후 반영',distinct:'다른 실물로 등록'}[o]}</option>`).join('')}</select>${r.options.includes('link')?`<input id="link-${i}" inputmode="numeric" placeholder="기존 실물번호 (연결 선택 시)">`:''}${r.kind==='id-change'?`<label for="new-id-${i}">최종 실물번호 · 필요하면 직접 입력</label><input id="new-id-${i}" inputmode="numeric" value="${esc(r.physicalId)}">`:''}</div>`).join('')}<label for="year">발급 연도</label><input id="year" type="number" min="2000" max="9999" value="${state.year}"><div class="actions"><button id="apply" ${p.reviews.length?'disabled':''}>최종 반영</button><button id="recheck" class="secondary">재검사</button></div></section>`;
  const selects=[...document.querySelectorAll('[data-key]')];for(const s of selects)s.onchange=()=>$('#apply').disabled=selects.some(x=>!x.value);
  p.reviews.forEach((r,i)=>{formatIdField($(`#link-${i}`));formatIdField($(`#new-id-${i}`));});
  const reviewLabels={keep:'기존 유지',apply:'변경 적용',defer:'보류 · PC 검토',issue:'신규 실물번호 발급',link:'기존 실물 연결',confirm:'확인 후 반영',distinct:'다른 실물로 등록'};
  const defaultReview=r=>r.kind==='unidentified'?'issue':r.kind==='similar'?'distinct':r.kind==='uncertain'?'defer':r.kind==='mapping'?'confirm':r.options.includes('apply')?'apply':r.options[0];
  let reviewIndex=0;
  $('#review').querySelectorAll('.conflict').forEach(x=>x.hidden=true);
  $('#year').previousElementSibling.hidden=true;$('#year').hidden=true;
  const controls=document.createElement('div');controls.className='actions';controls.innerHTML='<p id="review-progress" class="muted"></p><button id="review-resume" class="secondary" type="button">검토 계속</button>';$('#apply').parentElement.before(controls);
  const progress=()=>{$('#review-progress').textContent='검토 '+Math.min(reviewIndex,p.reviews.length)+' / '+p.reviews.length+'건';};
  function reviewAt(i){
    reviewIndex=i;progress();if(dialog.open)dialog.close();
    if(i>=p.reviews.length){$('#apply').disabled=false;$('#review-resume').textContent='처음부터 다시 검토';return;}
    const r=p.reviews[i],e=p.entries.find(x=>x.physicalId===r.entryId||x.temporaryId===r.entryId||x.oldPhysicalId===r.entryId||x.oldPhysicalId===r.oldPhysicalId||x.physicalId===r.physicalId);
    const old=state.physicalBooks.find(x=>x.physicalId===(e?.oldPhysicalId||e?.physicalId));
    const select=$('#decision-'+i);if(!select.value)select.value=defaultReview(r);
    dialog.innerHTML='<form id="review-form"><div class="eyebrow">검토 '+(i+1)+' / '+p.reviews.length+'</div><h2>'+esc(e?.titleCanonical||old?.titleCanonical||'도서명 확인 필요')+'</h2><p class="muted">권 번호: '+esc(e?.volume||old?.volume||'미기재')+' · '+esc(e?.publisherCanonical||old?.publisherCanonical||'출판사 미기재')+'</p><div class="review-context"><div><span>기존 번호</span><strong>'+esc(e?.oldPhysicalId||old?.physicalId||'없음')+'</strong></div><div><span>조사 번호</span><strong>'+esc(e?.physicalId||'번호 없음')+'</strong></div></div><p class="notice-inline">'+esc(r.message)+'</p>'+(r.candidates?.length?'<div class="review-candidates"><strong>중복 후보</strong>'+r.candidates.map(x=>'<p>'+esc(x.physicalId||x.legacyLedgerId||'')+' · '+esc(x.title||x.titleCanonical||x.titleRaw||'')+'</p>').join('')+'</div>':'')+'<label for="review-choice">처리 방법</label><select id="review-choice">'+r.options.map(o=>'<option value="'+o+'">'+(reviewLabels[o]||o)+'</option>').join('')+'</select><div id="review-extra"></div><div class="actions"><button type="button" id="review-stop" class="secondary">중단</button><button type="button" id="review-back" class="secondary" '+(i?'':'disabled')+'>이전</button><button type="submit" id="review-next">'+(i===p.reviews.length-1?'확인 완료':'확인 후 다음')+' <kbd class="key-hint" aria-hidden="true">Enter ↵</kbd></button></div></form>';
    $('#review-choice').value=select.value;
    const showExtra=()=>{
      const choice=$('#review-choice').value,box=$('#review-extra');box.innerHTML='';
      if(choice==='link'){box.innerHTML='<label for="review-link">연결할 기존 실물번호</label><input id="review-link" inputmode="numeric" required value="'+esc($('#link-'+i)?.value||'')+'">';formatIdField($('#review-link'));}
      else if(r.kind==='id-change'&&choice==='apply'){box.innerHTML='<label for="review-new-id">최종 실물번호</label><input id="review-new-id" inputmode="numeric" required value="'+esc($('#new-id-'+i).value)+'">';formatIdField($('#review-new-id'));}
      else if(r.kind==='unidentified'&&choice==='issue'){box.innerHTML='<label for="review-year">발급 연도</label><input id="review-year" type="number" min="2000" max="9999" required value="'+esc($('#year').value)+'"><p class="muted">반영할 때 이 연도의 다음 실물번호를 발급합니다.</p>';}
    };
    $('#review-choice').onchange=showExtra;showExtra();
    $('#review-form').addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.isComposing)return;
      if(event.target.closest('button')?.id==='review-back'||event.target.closest('button')?.id==='review-stop')return;
      event.preventDefault();if(!event.repeat)$('#review-form').requestSubmit($('#review-next'));
    });
    click('#review-stop',()=>dialog.close());click('#review-back',()=>reviewAt(i-1));
    $('#review-form').onsubmit=run(async event=>{
      event.preventDefault();const choice=$('#review-choice').value;
      if(choice==='link'){const id=normalizePhysicalId($('#review-link').value);if(!state.physicalBooks.some(x=>x.physicalId===id))throw Error('연결할 기존 실물번호를 확인하세요.');$('#link-'+i).value=id;}
      if(r.kind==='id-change'&&choice==='apply'){const id=normalizePhysicalId($('#review-new-id').value),owner=state.physicalBooks.find(x=>x.physicalId===id);if(id===r.oldPhysicalId)throw Error('기존 번호와 다른 실물번호를 입력하세요.');if(owner)throw Error(id+'는 '+owner.titleCanonical+'에 이미 지정된 번호입니다.');$('#new-id-'+i).value=id;}
      if(r.kind==='unidentified'&&choice==='issue')$('#year').value=$('#review-year').value;
      select.value=choice;
      const pair=p.reviews.findIndex(x=>x.entryId===r.entryId&&x.kind===(r.kind==='similar'?'unidentified':'similar'));
      if(pair>=0){const other=$('#decision-'+pair);if(choice==='link'){other.value='link';$('#link-'+pair).value=$('#link-'+i).value;}else if(r.kind==='unidentified')other.value='distinct';else if(other.value==='link')other.value='issue';}
      reviewAt(i+1);
    });
    dialog.showModal();$('#review-next').focus();
  }
  progress();click('#review-resume',()=>reviewAt(reviewIndex>=p.reviews.length?0:reviewIndex));
  if(p.reviews.length)reviewAt(0);
  click('#recheck',inspect);
  click('#apply',async()=>{const decisions={};for(const [i,s] of selects.entries()){const review=p.reviews[i];decisions[s.dataset.key]=s.value;if(s.value==='link')decisions[`link:${review.entryId}`]=normalizePhysicalId($(`#link-${i}`).value);if(review.kind==='id-change'&&s.value==='apply')decisions[`new-id:${review.oldPhysicalId}`]=normalizePhysicalId($(`#new-id-${i}`).value);}const result=await api('/api/apply',{report,decisions,revision:p.revision,year:Number($('#year').value)});reportQueue.shift();report=null;await desktop();if(reportQueue.length)await showNextReport();else $('#review').innerHTML=`<section class="panel"><h2>반영 완료</h2>${result.mapping.map(x=>`<p>${esc(x.title)}: ${esc(x.oldPhysicalId||x.temporaryId)} → <strong>${esc(x.physicalId)}</strong></p>`).join('')}<button id="save-after-apply">결과 Excel 저장</button></section>`;click('#save-after-apply',saveExcel);notice('조사 결과를 반영했습니다.');});
}

const surveyKey=id=>`angela-survey-v2:${id}`;
function saveSurvey(next){localStorage.setItem(surveyKey(next.id),JSON.stringify(next));survey=next;}
function loadPackage(value){if(value?.schema!=='angela-package/v2'||!value.id||!value.catalogId||!Array.isArray(value.legacyRecords)||!Array.isArray(value.physicalBooks))throw Error('조사용 JSON v2가 아닙니다.');const previous=localStorage.getItem(surveyKey(value.id));if(previous&&JSON.parse(previous).entries?.length)throw Error('이 조사본의 저장된 기록이 있습니다. 기존 조사 계속하기를 사용하세요.');saveSurvey({...value,reportId:crypto.randomUUID(),entries:[],savedAt:null,receivedAt:new Date().toISOString()});if(!nativeApp)history.replaceState(null,'',`/mobile?session=${encodeURIComponent(value.id)}`);mobileRender();}
window.angelaOpenPackage=text=>{try{loadPackage(JSON.parse(text));}catch(e){notice(e.message,true);}};
window.angelaPackageError=message=>notice(message||'조사 파일을 열 수 없습니다.',true);
window.angelaFileSaved=()=>notice('조사 결과 파일을 저장했습니다.');
window.angelaHandleBack=()=>{if(dialog.open){dialog.close();return true;}if(nativeApp&&app.querySelector('#home')){mobile();return true;}return false;};
async function mobile(){
  const id=new URLSearchParams(location.search).get('session');
  if(!id){app.innerHTML=`<div class="mobile-wrap"><h1>현장 도서 조사</h1><section class="panel">${nativeApp?'<button id="open-package">PC에서 받은 조사 파일 열기</button>':'<label for="package-file">조사용 JSON 열기</label><input id="package-file" type="file" accept=".json">'}<div id="drafts"></div></section></div>`;
    const drafts=Object.keys(localStorage).filter(x=>x.startsWith('angela-survey-v2:')).flatMap(key=>{try{const value=JSON.parse(localStorage.getItem(key));return value?.id?[{key,value}]:[];}catch{return [];}});
    drafts.sort((a,b)=>Date.parse(b.value.receivedAt||b.value.createdAt||0)-Date.parse(a.value.receivedAt||a.value.createdAt||0));
    $('#drafts').innerHTML=drafts.map(({value:s})=>`<div class="candidate"><button class="session-link secondary" data-draft="${esc(s.id)}">${esc(s.receivedAt||s.createdAt||'받은 날짜 없음')} · ${s.entries?.length||0}권 조사 계속하기</button><button class="danger" data-delete-draft="${esc(s.id)}">이 조사 기록 삭제</button></div>`).join('');
    document.querySelectorAll('[data-draft]').forEach(el=>el.onclick=()=>{survey=JSON.parse(localStorage.getItem(surveyKey(el.dataset.draft)));if(!survey.reportId)survey.reportId=crypto.randomUUID();saveSurvey(survey);mobileRender();});
    document.querySelectorAll('[data-delete-draft]').forEach(el=>el.onclick=()=>deleteSurveyDialog(el.dataset.deleteDraft));
    if(nativeApp)click('#open-package',()=>window.AngelaAndroid.openPackage());
    else $('#package-file').onchange=run(async e=>loadPackage(JSON.parse(await e.target.files[0].text())));return;}
  const cached=localStorage.getItem(surveyKey(id));survey=cached?JSON.parse(cached):{...await api(`/api/session/${id}`),reportId:crypto.randomUUID(),entries:[],savedAt:null};
  if(!survey.reportId)survey.reportId=crypto.randomUUID();
  if(survey.schema!=='angela-package/v2')throw Error('이전 조사 형식입니다. PC에서 새 조사를 생성하세요.');
  saveSurvey(survey);mobileRender();
}
function deleteSurveyDialog(id){
  const saved=localStorage.getItem(surveyKey(id));if(!saved)return;
  const item=JSON.parse(saved);
  dialog.innerHTML=`<form id="delete-survey-form"><h2>조사 기록 삭제</h2><p><strong>이 휴대전화에 저장된 조사 ${esc(item.receivedAt||item.createdAt||id)}의 ${item.entries?.length||0}권 기록이 모두 제거됩니다.</strong></p><p class="muted">삭제한 기록은 앱에서 되돌릴 수 없습니다. PC로 보낸 결과 파일은 따로 보관됩니다.</p><label for="delete-survey-word">정말 제거하려면 삭제를 입력하세요</label><input id="delete-survey-word" autocomplete="off" required><div class="actions"><button type="button" id="delete-survey-cancel" class="secondary">취소</button><button type="submit" class="danger">기록 제거</button></div></form>`;
  click('#delete-survey-cancel',()=>dialog.close());
  $('#delete-survey-form').onsubmit=run(async event=>{event.preventDefault();if($('#delete-survey-word').value.trim()!=='삭제')throw Error('삭제를 정확히 입력하세요.');localStorage.removeItem(surveyKey(id));if(survey?.id===id)survey=null;dialog.close();await mobile();notice('휴대전화의 조사 기록을 삭제했습니다.');});
  dialog.showModal();
}
function mobileRender(){
  app.innerHTML=`<div class="mobile-wrap"><div class="lead"><div><div class="eyebrow">FIELD SURVEY</div><h1>실물 한 권씩 조사</h1><p class="muted">${esc(survey.worker||'작업자 미기재')} · ${esc(survey.area||'구역 미기재')} · ${survey.entries.length}권 기록</p></div><span class="saved">${survey.savedAt?'기기에 저장됨':'조사 준비 완료'}</span></div>${nativeApp?'<button id="home" class="secondary">조사 목록 / 새 파일 열기</button>':''}
    <section class="panel"><label for="find">실물번호 또는 제목 검색</label><input id="find" type="search" placeholder="예: 2014-0087, 김수환 사랑, ㄱㄹㄷㅊㅇㅅ"><div id="matches"></div></section>
    <div class="actions"><button id="numbered">＋ 번호 있는 책</button><button id="unlabelled" class="secondary">번호 없음 / 훼손</button><button id="new-acquisition" class="secondary">새로 들여온 책</button></div>
    <section class="panel" style="margin-top:18px"><h2>이번 조사 기록</h2><div id="entries"></div><div class="actions"><button id="export" ${!survey.entries.length?'disabled':''}>결과 저장</button><button id="share" class="secondary" ${!survey.entries.length?'disabled':''}>공유</button></div></section></div>`;
  $('#find').oninput=()=>{if(/^[\d-]+$/.test($('#find').value))$('#find').value=formatPhysicalIdInput($('#find').value);renderMatches();};renderMatches();renderEntries();
  click('#numbered',()=>entryDialog(false));click('#unlabelled',()=>entryDialog(true));click('#new-acquisition',mobileAcquisitionDialog);
  click('#home',mobile);
  click('#export',()=>download(resultPayload(),resultName()));click('#share',shareResult);
}
function renderMatches(){
  const q=$('#find').value.trim();if(!q){$('#matches').innerHTML='<p class="muted">검색 결과에서 실물을 선택하거나 새 책을 기록하세요.</p>';return;}
  const physical=search(q,survey.physicalBooks,10),legacy=search(q,survey.legacyRecords,10);
  $('#matches').innerHTML=`<h3>기존 실물</h3>${physical.map(x=>`<div class="candidate candidate-row"><div><strong>${esc(x.physicalId)} · ${esc(x.titleCanonical)}</strong><span class="muted">${x.volume?'권 번호: '+esc(x.volume)+' · ':''}${esc(x.publisherCanonical)} · ${esc(statusName(x.status))}</span></div><button class="secondary" data-existing="${esc(x.physicalId)}">조사</button></div>`).join('')||'<p class="muted">없음</p>'}<h3>과거 장부 후보</h3>${legacy.map(x=>`<div class="candidate candidate-row"><div><strong>${esc(x.legacyLedgerId)} · ${esc(x.titleCanonical)}</strong><span class="muted">${esc(x.publisherCanonical)} · ${esc(x.sourceSheet)} ${esc(x.sourceRow)}행</span></div><button class="secondary" data-legacy="${esc(x.recordId)}">연결</button></div>`).join('')||'<p class="muted">없음</p>'}`;
  document.querySelectorAll('[data-existing]').forEach(el=>el.onclick=()=>entryDialog(false,survey.physicalBooks.find(x=>x.physicalId===el.dataset.existing)));
  document.querySelectorAll('[data-legacy]').forEach(el=>el.onclick=()=>entryDialog(false,null,survey.legacyRecords.find(x=>x.recordId===el.dataset.legacy)));
}
function renderEntries(){
  $('#entries').innerHTML=survey.entries.length?survey.entries.map((e,i)=>'<div class="candidate candidate-row"><div><strong>'+esc(e.oldPhysicalId?e.oldPhysicalId+' → '+e.physicalId:e.physicalId||e.temporaryId)+'</strong> · '+esc(canonical(e.titleRaw))+' · '+esc(e.publisherRaw)+(e.volume?' · 권 번호: '+esc(e.volume):'')+' <span class="tag '+(e.status==='ACTIVE'?'ok':'warn')+'">'+esc(statusName(e.status))+'</span>'+(e.action==='CHANGE_PHYSICAL_ID'?'<span class="muted">실물번호 변경 요청 · PC 확인 필요</span>':'')+'</div><button type="button" class="secondary" data-edit-entry="'+i+'">수정</button></div>').join(''):'<p class="muted">기록이 없습니다.</p>';
  document.querySelectorAll('[data-edit-entry]').forEach(el=>el.onclick=()=>editSurveyEntryDialog(Number(el.dataset.editEntry)));
}
function editSurveyEntryDialog(index){
  const entry=survey.entries[index];if(!entry)return;
  const acquisition=entry.action==='NEW_ACQUISITION';
  const numbered=!!entry.physicalId;
  dialog.innerHTML='<form id="edit-entry-form"><h2>조사 기록 수정</h2><p class="muted">'+esc(entry.oldPhysicalId?'기존 번호 '+entry.oldPhysicalId+' → 조사 번호 '+entry.physicalId:entry.temporaryId||entry.physicalId)+'</p>'+
    (numbered?'<label for="edit-entry-id">실물번호</label><input id="edit-entry-id" name="physicalId" inputmode="numeric" maxlength="9" required value="'+esc(entry.physicalId)+'" '+(acquisition?'readonly':'')+'>':'<div class="read-value">번호 없는 책 · PC에서 번호 발급</div>')+
    (acquisition?'<label for="edit-entry-date">입수일</label><input id="edit-entry-date" name="acquiredDateRaw" type="date" required value="'+esc(entry.acquiredDateRaw)+'">':'')+
    '<label for="edit-entry-title">도서명</label><input id="edit-entry-title" name="titleRaw" required autocomplete="off" value="'+esc(entry.titleRaw)+'">'+
    '<label for="edit-entry-publisher">출판사</label><input id="edit-entry-publisher" name="publisherRaw" autocomplete="off" value="'+esc(entry.publisherRaw)+'">'+
    '<label for="edit-entry-volume">권 번호 (알고 있는 경우)</label><input id="edit-entry-volume" name="volume" value="'+esc(entry.volume||'')+'">'+
    (acquisition?'':'<label for="edit-entry-status">실물 상태</label><select id="edit-entry-status" name="status">'+['ACTIVE','DISCARDED','LOST','UNKNOWN'].map(s=>'<option value="'+s+'" '+(s===entry.status?'selected':'')+'>'+statusName(s)+'</option>').join('')+'</select>')+
    (acquisition?'':'<label for="edit-entry-legacy-search">과거 장부 연결 · 도서명 또는 장부번호 검색</label><input id="edit-entry-legacy-search" type="search" autocomplete="off" placeholder="도서명 또는 장부번호" value="'+esc(entry.titleRaw)+'"><input id="edit-entry-legacy-id" type="hidden" name="legacyRecordId" value="'+esc(entry.legacyRecordId||'')+'"><div id="edit-entry-legacy-selected" aria-live="polite"></div><div id="edit-entry-legacy-suggestions"></div>')+
    '<div class="actions"><button type="button" id="edit-entry-cancel" class="secondary">취소</button><button type="submit">수정 저장</button></div></form>';
  click('#edit-entry-cancel',()=>dialog.close());formatIdField($('#edit-entry-id'));
  if(!acquisition){
    const legacyRecords=survey.legacyRecords||[];
    const showSelected=()=>{
      const selected=legacyRecords.find(x=>x.recordId===$('#edit-entry-legacy-id').value);
      $('#edit-entry-legacy-selected').innerHTML=selected?'<div class="candidate candidate-row"><div><strong>연결됨 · '+esc(label(selected))+'</strong><span class="muted">'+esc(selected.sourceSheet||'')+' '+esc(selected.sourceRow||'')+'행</span></div><button type="button" class="secondary" id="edit-entry-legacy-clear">연결 해제</button></div>':'<p class="muted">연결된 과거 장부가 없습니다.</p>';
      const clear=$('#edit-entry-legacy-clear');
      if(clear)clear.onclick=()=>{$('#edit-entry-legacy-id').value='';showSelected();};
    };
    const showSuggestions=()=>{
      const query=$('#edit-entry-legacy-search').value.trim();
      const matches=query?search(query,legacyRecords,8):[];
      $('#edit-entry-legacy-suggestions').innerHTML=!query?'':matches.length?matches.map(x=>'<div class="candidate candidate-row"><div><strong>'+esc(x.legacyLedgerId)+' · '+esc(x.titleCanonical)+'</strong><span class="muted">'+esc(x.publisherCanonical)+' · '+esc(x.sourceSheet)+' '+esc(x.sourceRow)+'행</span></div><button type="button" class="secondary" data-edit-legacy="'+esc(x.recordId)+'">연결</button></div>').join(''):'<p class="muted">일치하는 과거 장부가 없습니다.</p>';
      $('#edit-entry-legacy-suggestions').querySelectorAll('[data-edit-legacy]').forEach(button=>button.onclick=()=>{$('#edit-entry-legacy-id').value=button.dataset.editLegacy;$('#edit-entry-legacy-search').value='';showSelected();showSuggestions();});
    };
    $('#edit-entry-legacy-search').oninput=showSuggestions;
    showSelected();showSuggestions();
  }
  $('#edit-entry-form').onsubmit=run(async event=>{
    event.preventDefault();const f=new FormData(event.target),next=structuredClone(survey),updated=next.entries[index];
    const id=numbered?normalizePhysicalId(f.get('physicalId')):null;
    if(id&&id!==entry.physicalId){
      const owner=survey.physicalBooks.find(x=>x.physicalId===id&&x.physicalId!==entry.oldPhysicalId);
      const pending=survey.entries.some((x,i)=>i!==index&&x.physicalId===id);
      if(owner||pending||survey.issuedIds?.includes(id))throw Error(id+'는 이미 다른 책에 지정되었거나 발급된 번호입니다.');
      if(entry.isNew&&!updated.originalPhysicalId)updated.originalPhysicalId=entry.physicalId;
      if(!entry.isNew&&!entry.oldPhysicalId)updated.oldPhysicalId=entry.physicalId;
      if(!entry.isNew&&id===updated.oldPhysicalId)throw Error('기존 번호와 다른 새 번호를 입력하세요.');
      if(!entry.isNew)updated.action='CHANGE_PHYSICAL_ID';
      updated.physicalId=id;
    }
    updated.titleRaw=String(f.get('titleRaw')).trim();updated.publisherRaw=String(f.get('publisherRaw')).trim();
    updated.volume=String(f.get('volume')||'').trim();
    if(!updated.titleRaw)throw Error('도서명을 입력하세요.');
    if(acquisition){updated.acquiredDateRaw=String(f.get('acquiredDateRaw'));if(!updated.acquiredDateRaw)throw Error('입수일을 입력하세요.');}
    else {updated.status=String(f.get('status'));updated.legacyRecordId=String(f.get('legacyRecordId')||'')||null;}
    const original=survey.physicalBooks.find(x=>x.physicalId===(updated.oldPhysicalId||entry.physicalId));
    if(original&&!updated.oldPhysicalId&&updated.action==='CONFIRM'&&(canonical(updated.titleRaw)!==original.titleCanonical||canonical(updated.publisherRaw)!==original.publisherCanonical||updated.volume!==(original.volume||'')))updated.action='UPDATE_INFO';
    updated.recordedAt=new Date().toISOString();next.savedAt=updated.recordedAt;saveSurvey(next);dialog.close();mobileRender();notice('조사 기록을 수정했습니다.');
  });
  dialog.showModal();dialog.tabIndex=-1;dialog.focus();
}
function mobileAcquisitionDialog(){
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
  const publishers=survey.publishers||publisherDictionary(survey.legacyRecords,survey.physicalBooks);
  dialog.innerHTML='<form id="acquisition-form"><h2>새로 들여온 책</h2><p class="muted">매수만큼 한 권씩 서로 다른 실물번호를 만듭니다. PC 반영 시 현재 번호에 맞춰 최종 확정합니다.</p>'+
    '<label for="acq-date">입수일</label><input id="acq-date" name="acquiredDateRaw" type="date" required value="'+today+'">'+
    '<label for="acq-title">도서명</label><input id="acq-title" name="titleRaw" required autocomplete="off">'+
    '<label for="acq-volume">권 번호 (시리즈인 경우)</label><input id="acq-volume" name="volume" placeholder="예: 1, 5, 상">'+
    '<label for="acq-publisher">출판사</label><input id="acq-publisher" name="publisherRaw" required autocomplete="off"><div id="acq-publisher-suggestions"></div>'+
    '<label for="acq-quantity">매수 (보유 부수)</label><input id="acq-quantity" name="quantity" type="number" min="1" max="100" value="1" required>'+
    '<label for="acq-year">실물번호 연도</label><input id="acq-year" name="year" type="number" min="2000" max="9999" value="'+today.slice(0,4)+'" required><div id="acq-ids" class="read-value"></div>'+
    '<div class="actions"><button type="button" id="acq-cancel" class="secondary">취소</button><button type="submit">기록 저장</button></div></form>';
  click('#acq-cancel',()=>dialog.close());
  const preview=()=>{try{const ids=reserveNextPhysicalIds(survey,Number($('#acq-year').value),Number($('#acq-quantity').value));$('#acq-ids').textContent='예상 번호: '+ids[0]+(ids.length>1?' ~ '+ids.at(-1):'');}catch(e){$('#acq-ids').textContent=e.message;}};
  $('#acq-year').oninput=preview;$('#acq-quantity').oninput=preview;preview();
  const suggest=()=>{const q=searchKey($('#acq-publisher').value),matches=q?publishers.filter(x=>x.id.includes(q)||q.includes(x.id)).slice(0,5):[];$('#acq-publisher-suggestions').innerHTML=matches.map((x,i)=>'<button type="button" class="secondary" data-acq-publisher="'+i+'">'+esc(x.canonicalName)+'</button>').join('');document.querySelectorAll('[data-acq-publisher]').forEach(el=>el.onclick=()=>{$('#acq-publisher').value=matches[Number(el.dataset.acqPublisher)].canonicalName;$('#acq-publisher-suggestions').innerHTML='';});};
  $('#acq-publisher').oninput=suggest;
  $('#acquisition-form').onsubmit=run(async event=>{
    event.preventDefault();const f=new FormData(event.target),date=String(f.get('acquiredDateRaw')),title=String(f.get('titleRaw')).trim(),publisher=String(f.get('publisherRaw')).trim(),year=Number(f.get('year')),quantity=Number(f.get('quantity'));
    if(!title||!publisher||!date)throw Error('입수일, 도서명, 출판사를 입력하세요.');
    const ids=reserveNextPhysicalIds(survey,year,quantity),next=structuredClone(survey),stamp=new Date().toISOString(),volume=String(f.get('volume')||'').trim();
    for(const id of ids)next.entries.push({action:'NEW_ACQUISITION',issuedYear:year,physicalId:id,temporaryId:null,isNew:true,titleRaw:title,publisherRaw:publisher,volume,acquiredDateRaw:date,legacyRecordId:null,status:'ACTIVE',labelStatus:'MISSING',note:'',recordedAt:stamp,candidateChoice:'distinct'});
    next.savedAt=stamp;saveSurvey(next);dialog.close();mobileRender();notice(quantity+'권을 조사 기록에 저장했습니다.');
  });
  dialog.showModal();dialog.tabIndex=-1;dialog.focus();
}
function physicalIdConflict(id,sourceId=null){
  const owner=survey.physicalBooks.find(x=>x.physicalId===id);
  if(owner&&id!==sourceId)return id+'는 이미 '+owner.titleCanonical+'의 실물번호입니다. 다른 책의 번호를 덮어쓸 수 없습니다.';
  const pending=survey.entries.find(x=>x.physicalId===id&&x.oldPhysicalId!==sourceId);
  if(pending)return id+'는 이번 조사 기록의 '+canonical(pending.titleRaw)+'에 이미 사용 중입니다.';
  if(survey.issuedIds?.includes(id)&&id!==sourceId)return id+'는 이전에 발급된 번호라 다시 사용할 수 없습니다.';
  return '';
}
function entryDialog(noLabel=false,existing=null,legacy=null,options={}){
  const publishers=survey.publishers||publisherDictionary(survey.legacyRecords,survey.physicalBooks);

  dialog.innerHTML=`<form id="entry-form"><h2>${existing?'기존 실물 조사':noLabel?'번호 없는 책':'번호 있는 책 기록'}</h2>
    ${existing?'<label for="existing-action">이 책의 처리</label><select id="existing-action"><option value="CONFIRM">기존 항목이 맞음</option><option value="UPDATE_INFO">기존 항목이 맞지만 정보가 다름</option><option value="CHANGE_PHYSICAL_ID">실물 번호 수정</option></select><p class="muted">번호 수정은 같은 책의 번호만 잘못된 경우에 선택하세요. PC에서 다시 확인합니다.</p>':''}
    ${noLabel?'<p class="notice-inline">임시 ID로 저장합니다. PC 검토 전에는 새 실물번호를 발급하지 않습니다.</p><button type="button" id="new-from-unlabelled" class="secondary">새로 들여온 책 등록</button>':`<label for="physical-id">실제 책의 번호</label><input id="physical-id" name="physicalId" inputmode="numeric" maxlength="9" pattern="[0-9]{4}-[0-9]{4}" placeholder="YYYY-NNNN" required value="${esc(options.actualId||existing?.physicalId||'')}"><div id="physical-id-check" class="muted"></div>`}
    <label for="title">도서명</label><input id="title" name="titleRaw" required autocomplete="off" value="${esc(existing?.titleRaw||legacy?.titleRaw||'')}">
    <label for="publisher">출판사</label><input id="publisher" name="publisherRaw" autocomplete="off" value="${esc(existing?.publisherRaw||legacy?.publisherRaw||'')}"><div id="publisher-suggestions"></div>
    <label for="volume">권 번호 (알고 있는 경우)</label><input id="volume" name="volume" value="${esc(existing?.volume||'')}">
    <label>입수일 · 조회 전용</label><div id="entry-acquired-date" class="read-value">${esc(existing?.acquiredDateRaw||legacy?.registeredDateRaw||'기록 없음')}</div>
    <label for="legacy">과거 장부 연결</label><select id="legacy" name="legacyRecordId"><option value="">연결하지 않음</option>${survey.legacyRecords.map(x=>`<option value="${esc(x.recordId)}" ${x.recordId===(legacy?.recordId||existing?.legacyRecordId)?'selected':''}>${esc(label(x))}</option>`).join('')}</select>
    <label for="status">실물 상태</label><select id="status" name="status">${['ACTIVE','DISCARDED','LOST','UNKNOWN'].map(x=>`<option value="${x}" ${x===(existing?.status||(noLabel?'UNKNOWN':'ACTIVE'))?'selected':''}>${statusName(x)}</option>`).join('')}</select>
    <div id="duplicate-warning"></div><div class="actions"><button type="button" id="cancel" class="secondary">취소</button><button type="submit">후보 확인 후 저장</button></div></form>`;
  click('#cancel',()=>dialog.close());click('#new-from-unlabelled',()=>{dialog.close();mobileAcquisitionDialog();});
  const form=$('#entry-form');
  let lastLookup=JSON.stringify([$('#legacy').value,searchKey($('#title').value),searchKey($('#publisher').value),searchKey($('#volume').value)]),statusTouched=false;
  $('#status').onchange=()=>{statusTouched=true;};
  const preview=()=>{
    if(existing){$('#duplicate-warning').innerHTML='';return;}
    const q=$('#title').value;
    const selectedLegacy=survey.legacyRecords.find(x=>x.recordId===$('#legacy').value)||null;
    $('#entry-acquired-date').textContent=selectedLegacy?.registeredDateRaw||'기록 없음';
    const candidates=search(q,[...survey.physicalBooks,...survey.legacyRecords],5).filter(x=>x.matchScore>=55);
    if(!selectedLegacy&&!candidates.length){$('#duplicate-warning').innerHTML='';return;}
    const previousChoice=$('#duplicate-choice')?.value||'';
    const lookup=JSON.stringify([$('#legacy').value,searchKey(q),searchKey($('#publisher').value),searchKey($('#volume').value)]);
    const previousRelated=lastLookup===lookup?$('#related-physical')?.value||'':'';
    lastLookup=lookup;
    const {candidates:related,preferredPhysicalId}=physicalCandidatesForLegacy(selectedLegacy,survey.physicalBooks,q,$('#publisher').value,$('#volume').value);
    const choices='<option value="">선택하세요</option>'+
      (!noLabel&&selectedLegacy?'<option value="ledger">과거 장부와 연결/실제 번호 수정</option>':'')+
      '<option value="distinct">다른 책 / 신규 실물로 기록</option><option value="uncertain">확실하지 않음 / PC 검토</option>'+
      (noLabel?'<option value="existing">기존 항목이 맞음 · 연결</option>':'');
    const relatedChoices=related.length?'<label for="related-physical">같은 책의 기존 실물</label><select id="related-physical"><option value="">기존 실물을 확인하세요</option><option value="new">같은 책의 기존 실물 없음 · 새 실물 생성</option>'+
      related.map(x=>'<option value="'+esc(x.physicalId)+'">'+esc(x.physicalId+' · '+x.titleCanonical+(x.legacyRecordId===selectedLegacy?.recordId?' · 이 장부에 연결됨':''))+'</option>').join('')+'</select><p class="muted">같은 책의 기존 실물이 있으면 선택하세요. 기존 실물의 도서명·출판사·권 번호는 유지하며, 제목이 비슷한 다른 책이면 새 실물 생성을 선택합니다.</p>':'<p class="muted">연결된 기존 실물이 없어 새 실물로 기록합니다.</p>';
    $('#duplicate-warning').innerHTML='<div class="notice-inline"><strong>후보가 같은 책인지 확인하세요. 자동 병합하지 않습니다.</strong>'+
      candidateList(candidates,'후보')+'<label for="duplicate-choice">이 책의 처리</label><select id="duplicate-choice" required>'+choices+'</select>'+
      (!noLabel&&selectedLegacy?'<div id="ledger-fields">'+relatedChoices+'</div>':'')+
      (noLabel?'<input id="candidate-physical" inputmode="numeric" placeholder="기존 실물번호 (기존 실물 연결 시)">':'')+'</div>';
    if(previousChoice&&[...$('#duplicate-choice').options].some(x=>x.value===previousChoice))$('#duplicate-choice').value=previousChoice;
    else if(selectedLegacy&&!noLabel)$('#duplicate-choice').value='ledger';
    if($('#related-physical')){
      if(previousRelated&&[...$('#related-physical').options].some(x=>x.value===previousRelated))$('#related-physical').value=previousRelated;
      else if(preferredPhysicalId)$('#related-physical').value=preferredPhysicalId;
    }
    const sync=()=>{if($('#ledger-fields'))$('#ledger-fields').hidden=$('#duplicate-choice').value!=='ledger';const relatedId=$('#duplicate-choice').value==='ledger'?$('#related-physical')?.value:null;const relatedBook=survey.physicalBooks.find(x=>x.physicalId===relatedId);if(!statusTouched)$('#status').value=relatedBook?.status||'ACTIVE';updateOccupancy();};
    $('#duplicate-choice').onchange=sync;$('#related-physical')?.addEventListener('change',updateOccupancy);sync();
    formatIdField($('#candidate-physical'));
  };
  const suggestPublisher=()=>{const q=searchKey($('#publisher').value);$('#publisher-suggestions').innerHTML=q?publishers.filter(x=>x.id.includes(q)||q.includes(x.id)).slice(0,5).map((x,i)=>`<button type="button" class="secondary" data-publisher="${i}">${esc(x.canonicalName)}${x.aliases.length>1?` · ${x.aliases.length}개 표기`:''}</button>`).join(''):'';const matches=publishers.filter(x=>x.id.includes(q)||q.includes(x.id)).slice(0,5);document.querySelectorAll('[data-publisher]').forEach(el=>el.onclick=()=>{$('#publisher').value=matches[Number(el.dataset.publisher)].canonicalName;$('#publisher-suggestions').innerHTML='';preview();});};
  const updateOccupancy=()=>{
    const field=$('#physical-id'),message=$('#physical-id-check');
    if(!field||!message)return;
    let id;try{id=normalizePhysicalId(field.value);}catch{message.textContent='실제 책에 적힌 번호를 YYYY-NNNN 형식으로 입력하세요.';return;}
    const relatedId=$('#duplicate-choice')?.value==='ledger'?$('#related-physical')?.value:null;
    const source=relatedId&&relatedId!=='new'?survey.physicalBooks.find(x=>x.physicalId===relatedId):null;
    const sourceId=existing?.physicalId||source?.physicalId;
    const conflict=id===sourceId?'':physicalIdConflict(id,sourceId);
    message.className=conflict?'id-conflict':'muted';
    message.textContent=id===sourceId?'현재 저장된 번호입니다.':conflict||'다른 실물에 지정되지 않은 번호입니다. PC 반영 시 다시 검사합니다.';
  };
  formatIdField($('#physical-id'));
  if(existing){
    if(options.action)$('#existing-action').value=options.action;
    const syncAction=()=>{
      const mode=$('#existing-action').value,info=mode==='UPDATE_INFO';
      for(const field of ['#title','#publisher','#volume'])$(field).readOnly=!info;
      $('#physical-id').readOnly=mode!=='CHANGE_PHYSICAL_ID';
      $('#status').disabled=mode==='CHANGE_PHYSICAL_ID';
      if(mode!=='CHANGE_PHYSICAL_ID')$('#physical-id').value=existing.physicalId;
      updateOccupancy();
    };
    $('#existing-action').onchange=syncAction;syncAction();
  }
  $('#physical-id')?.addEventListener('input',updateOccupancy);updateOccupancy();
  $('#title').oninput=preview;$('#publisher').oninput=()=>{suggestPublisher();preview();};$('#volume').oninput=preview;$('#legacy').onchange=preview;preview();suggestPublisher();
  form.onsubmit=run(async event=>{
    event.preventDefault();
    const f=new FormData(form),id=noLabel?null:normalizePhysicalId(f.get('physicalId'));
    const choice=$('#duplicate-choice')?.value;
    if($('#duplicate-choice')&&!choice)throw Error('유사 도서 후보를 확인하고 처리 방법을 선택하세요.');
    const selectedLegacy=survey.legacyRecords.find(x=>x.recordId===f.get('legacyRecordId'))||null;
    let source=existing||null,action=existing?$('#existing-action').value:null;
    if(choice==='ledger'){
      if(!selectedLegacy||noLabel)throw Error('연결할 과거 장부와 실제 번호를 확인하세요.');
      const relatedChoice=$('#related-physical')?$('#related-physical').value:'new';
      if(!relatedChoice)throw Error('같은 책의 기존 실물을 선택하거나 새 실물 생성을 선택하세요.');
      source=relatedChoice==='new'?null:survey.physicalBooks.find(x=>x.physicalId===relatedChoice);
      if(relatedChoice!=='new'&&!source)throw Error('선택한 기존 실물을 찾을 수 없습니다.');
      if(source&&canonical(source.volume)&&canonical(f.get('volume'))&&searchKey(source.volume)!==searchKey(f.get('volume')))throw Error('선택한 실물의 권 번호가 다릅니다. 같은 권을 선택하거나 새 실물 생성을 선택하세요.');
    }
    const titleRaw=source&&choice==='ledger'&&canonical(f.get('titleRaw'))===canonical(selectedLegacy?.titleRaw)?source.titleRaw:String(f.get('titleRaw'));
    const publisherRaw=source&&choice==='ledger'&&canonical(f.get('publisherRaw'))===canonical(selectedLegacy?.publisherRaw)?source.publisherRaw:String(f.get('publisherRaw')||'');
    const volume=source&&choice==='ledger'&&!canonical(f.get('volume'))?source.volume||'':String(f.get('volume')||'');
    if(choice==='ledger'&&source)action=id===source.physicalId?
      (canonical(titleRaw)===canonical(source.titleRaw)&&canonical(publisherRaw)===canonical(source.publisherRaw)&&canonical(volume)===canonical(source.volume||'')?'CONFIRM':'UPDATE_INFO'):
      'CHANGE_PHYSICAL_ID';
    if(action==='CHANGE_PHYSICAL_ID'&&id===source?.physicalId)throw Error('기존 번호와 다른 새 실물번호를 입력하세요.');
    if(id&&id!==source?.physicalId){const conflict=physicalIdConflict(id,source?.physicalId);if(conflict)throw Error(conflict);}
    let physicalId=id,temporaryId=null;
    if(noLabel){temporaryId=`temp-${crypto.randomUUID()}`;if(choice==='existing'){physicalId=normalizePhysicalId($('#candidate-physical').value);if(!survey.physicalBooks.some(x=>x.physicalId===physicalId))throw Error('기존 실물번호를 확인하세요.');temporaryId=null;}}
    const oldPhysicalId=action==='CHANGE_PHYSICAL_ID'?source.physicalId:null;
    const entry={physicalId,oldPhysicalId,action,temporaryId,isNew:!source&&!(noLabel&&choice==='existing'),titleRaw,publisherRaw,volume,acquiredDateRaw:source?.acquiredDateRaw||(choice==='distinct'?'':selectedLegacy?.registeredDateRaw||''),legacyRecordId:choice==='distinct'?null:selectedLegacy?.recordId||null,status:action==='CHANGE_PHYSICAL_ID'?source.status:f.get('status'),labelStatus:noLabel?'MISSING':'PRESENT',note:source?.note||'',recordedAt:new Date().toISOString(),candidateChoice:choice||null};
    const next=structuredClone(survey),index=next.entries.findIndex(x=>source?(x.oldPhysicalId===source.physicalId||x.physicalId===source.physicalId):(x.physicalId&&x.physicalId===physicalId));
    if(index>=0)next.entries[index]=entry;else next.entries.push(entry);
    next.savedAt=new Date().toISOString();saveSurvey(next);dialog.close();mobileRender();notice('조사 기록을 기기에 저장했습니다.');
  });
  dialog.showModal();dialog.tabIndex=-1;dialog.focus();
}
run(mobilePage?mobile:desktop)();
