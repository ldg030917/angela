import fs from 'node:fs';
import assert from 'node:assert/strict';
import {unzip} from '../xlsx-native.mjs';

const file=process.argv[2];
if(!file)throw Error('사용법: node tests/verify-excel.mjs <결과.xlsx>');
const parts=unzip(fs.readFileSync(file));
const workbook=parts.get('xl/workbook.xml')||'';
for(const name of ['실물원장','과거장부','폐기기록'])assert.ok(workbook.includes(`name="${name}"`),`${name} 시트 없음`);
for(let i=1;i<=3;i++)assert.ok(parts.get(`xl/worksheets/sheet${i}.xml`),`${i}번 시트 데이터 없음`);
assert.ok(parts.get('xl/worksheets/sheet1.xml').includes('실물번호'));
assert.ok(parts.get('xl/worksheets/sheet2.xml').includes('과거 장부번호'));
console.log('PASS: 실물원장 · 과거장부 · 폐기기록 시트와 헤더를 확인했습니다.');
