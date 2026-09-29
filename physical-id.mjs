const pattern=/^\d{4}-\d{4}$/;

export function formatPhysicalIdInput(value){
  const digits=String(value??'').replace(/\D/g,'').slice(0,8);
  return digits.length>4?`${digits.slice(0,4)}-${digits.slice(4)}`:digits;
}

export function normalizePhysicalId(value){
  const raw=String(value??'').trim();
  if(pattern.test(raw))return raw;
  if(/^\d{8}$/.test(raw))return `${raw.slice(0,4)}-${raw.slice(4)}`;
  throw Error('실물번호는 연도 4자리와 번호 4자리(YYYY-NNNN)로 입력하세요.');
}

export function validatePhysicalId(value){try{normalizePhysicalId(value);return true;}catch{return false;}}
export function isPhysicalIdAlreadyIssued(catalog,value,except=null){
  const id=normalizePhysicalId(value);
  if(id===except)return false;
  return !!catalog.issuedIds?.includes(id)||!!catalog.physicalBooks?.some(x=>x.physicalId===id)||!!catalog.entries?.some(x=>x.physicalId===id);
}

export function reserveNextPhysicalIds(catalog,year,quantity=1){
  const number=Number(year),count=Number(quantity);
  if(!Number.isInteger(number)||number<2000||number>9999)throw Error('발급 연도를 확인하세요.');
  if(!Number.isInteger(count)||count<1||count>100)throw Error('매수는 1~100으로 입력하세요.');
  const prefix=String(number)+'-';
  const used=[...(catalog.issuedIds||[]),...(catalog.physicalBooks||[]).map(x=>x.physicalId),...(catalog.entries||[]).map(x=>x.physicalId)].filter(x=>x?.startsWith(prefix));
  const max=Math.max(0,...used.map(x=>Number(x.slice(5))));
  if(max+count>9999)throw Error('해당 연도의 번호를 모두 사용했습니다.');
  return Array.from({length:count},(_,i)=>prefix+String(max+i+1).padStart(4,'0'));
}