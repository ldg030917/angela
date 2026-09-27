import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Workbook,SpreadsheetFile,FileBlob} from '@oai/artifact-tool';
const out='outputs/verification'; await fs.mkdir(out,{recursive:true});
const source=process.argv[2]||`${out}/result.xlsx`;
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const rows=wb.worksheets.getItem('도서원장').getUsedRange().values;
const disposal=wb.worksheets.getItem('폐기기록').getUsedRange().values;
assert.equal(rows.length,6);assert.equal(rows[1][4],4);assert.equal(rows[5][0],'2026-0008');assert.equal(rows[5][1],'달빛 도서관');assert.equal(rows[5][4],2);
assert.equal(rows.slice(1).reduce((n,r)=>n+r[4],0),13);assert.equal(disposal[1][2],1);assert.equal(disposal[1][3],'표지 파손');
console.log((await wb.inspect({kind:'table',range:'도서원장!A1:F6',include:'values,formulas',tableMaxRows:8,tableMaxCols:6})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:20}})).ndjson);
for(const name of ['도서원장','폐기기록']){const image=await wb.render({sheetName:name,range:name==='도서원장'?'A1:F6':'A1:E2',scale:2,format:'png'});await fs.writeFile(`${out}/${name}.png`,new Uint8Array(await image.arrayBuffer()));}
if(path.resolve(source)!==path.resolve(`${out}/result.xlsx`))await fs.copyFile(source,`${out}/result.xlsx`);
console.log('PASS: downloaded Excel contains 5 titles, 13 copies, new ID 2026-0008 and 1 disposal.');
