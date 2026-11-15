import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import vm from 'node:vm';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),dist=path.join(root,'dist');
const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dist,'observations.json.gz'))));
vm.runInThisContext(fs.readFileSync(path.join(dist,'model.js'),'utf8'));
const {createModel,regions,rangeKeys,csv}=globalThis.EmberModel;
const model=createModel(data),box=regions.dixie.box;
assert.equal(data.sources.reduce((n,s)=>n+s.observations,0),1086752);
assert.equal(data.years.length,25);
assert.deepEqual(data.referenceYears,[2017,2018,2019,2020,2021,2022,2023,2024]);
assert.equal(model.comparable(2001),false);assert.equal(model.comparable(2025),true);
const flags=[];
for(const [km,total,both,cutoff] of [[2,268,190,31],[4,98,76,15],[8,39,30,8]]){
 const s=model.summarize('2021-08-05',km,box);
 assert.equal(s.rawM,999);assert.equal(s.rawV,3755);assert.equal(s.total,total);assert.equal(s.both,both);
 const cache=new Map();const count=d=>{if(!cache.has(d))cache.set(d,model.summarize(d,km,box).total);return cache.get(d)};
 assert.deepEqual(model.reference(2021,8,5,count),{cutoff,size:105});
 const flagged=new Set();for(const y of data.referenceYears)for(const m of [7,8,9,10])for(const date of model.dayKeys(y,m))if(count(date)>model.reference(y,m,+date.slice(-2),count).cutoff)flagged.add(date);
 flags.push(flagged);
}
const union=new Set(flags.flatMap(s=>[...s]));assert.equal(union.size,109);assert.equal([...union].filter(d=>flags.every(s=>s.has(d))).length,93);
// The user-facing grid check must expose agreement, disagreement and unavailable flags.
const stable=model.scaleAssessment('2021-08-05',box);
assert.deepEqual(stable.rows.map(r=>[r.km,r.total,r.both,r.cutoff]),[[2,268,190,31],[4,98,76,15],[8,39,30,8]]);
assert.equal(stable.flaggedCount,3);
const sensitiveDate=[...union].find(d=>!flags.every(s=>s.has(d)));
const sensitive=model.scaleAssessment(sensitiveDate,box);
assert.ok(sensitive.flaggedCount>0&&sensitive.flaggedCount<3);
assert.match(sensitive.conclusion,/changes with grid size/);
const early=model.scaleAssessment('2001-08-05',box);
assert.equal(early.flaggedCount,null);assert.ok(early.rows.every(r=>r.flagged===null&&r.cutoff===null));
const brief=model.reviewBrief('2021-08-05',4,box,regions.dixie.name);
for(const text of ['Retained MODIS detections: 999','Retained VIIRS Suomi NPP detections: 3755','Combined occupied cells: 98','4 | 98 | 76 | 15 | 105 | Yes','not independent fire accuracy','No live observations or forecasts'])assert.ok(brief.includes(text));
assert.ok(model.reviewBrief('2001-08-05',4,box,regions.dixie.name).includes('N/A | 0 | N/A'));
assert.equal(rangeKeys('2024-02-28','2024-03-01',data.years).length,3);
assert.throws(()=>rangeKeys('2021-02-29','2021-03-01',data.years));
assert.throws(()=>rangeKeys('2025-12-31','2026-01-01',data.years));
assert.throws(()=>rangeKeys('2021-08-10','2021-08-01',data.years));
assert.equal(rangeKeys('2021-08-01','2021-08-31',data.years).reduce((n,d)=>n+model.summarize(d,4,box).total,0),2013);
assert.equal(csv([['a,b','a"b',null]]),'"a,b","a""b",\r\n');
// Reconstruct selected-day observations from original-field export, using the same area rule.
const raw=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dist,'raw/2021.json.gz'))));
const idx=Object.fromEntries(raw.fields.map((name,i)=>[name,i]));const sensors={modis:0,'viirs-snpp':0};
for(const row of raw.rows){if(row[idx.acq_date]!=='2021-08-05')continue;const [lon,lat]=model.cellCenter(row[idx.base_cell_x],row[idx.base_cell_y],2);if(lon<box[0]||lon>=box[2]||lat<box[1]||lat>=box[3])continue;sensors[row[idx.source_sensor]]++;assert.equal(typeof row[idx.acq_time],'string');}
assert.deepEqual(sensors,{modis:999,'viirs-snpp':3755});
const cal=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dist,'calibration.json.gz'))));
for(const [km,g] of Object.entries(cal.grids)){
 assert.equal(g.daily.length,4017);assert.equal(g.monthly.length,132);
 for(const model of Object.values(g.models)){assert.equal(model.validation.yearsImprovedMAE,13);assert.equal(model.folds.length,13);assert.ok(model.validation.model.mae<model.validation.baseline.mae);}
 for(const row of g.daily){assert.ok(row.lower>=0&&row.lower<=row.estimate&&row.estimate<=row.upper);assert.equal(row.source,+row.date.slice(0,4)<=2002?'terra':'modis');}
 for(const row of g.monthly){const prefix=row.year+'-'+String(row.month).padStart(2,'0');const total=g.daily.filter(d=>d.date.startsWith(prefix)).reduce((n,d)=>n+d.estimate,0);assert.ok(Math.abs(total-row.estimate)<.001);}
}
const pitch=fs.readFileSync(path.join(dist,'pitch.html'),'utf8');assert.equal((pitch.match(/class="slide"/g)||[]).length,6);assert.ok(pitch.includes('Kumar Abhinav'));assert.ok(pitch.includes('Harmonization of MODIS and VIIRS Hot Spots'));
console.log('Passed: source counts, original benchmark, scale sensitivity, date bounds, leap day, range totals, raw export reconciliation, historical estimates and six-slide limits.');
