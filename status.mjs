export const statusLabels={ACTIVE:'보유 중',DISCARDED:'폐기',LOST:'분실',UNKNOWN:'상태 미확인'};
export const statusName=value=>statusLabels[value]||value||'상태 미확인';
