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
