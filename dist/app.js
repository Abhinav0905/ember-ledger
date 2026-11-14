'use strict';
let data;
const {createModel, regions, keyFor, monthDays} = window.EmberModel;
const $ = id => document.getElementById(id);
const integer = new Intl.NumberFormat('en-US');
const pct = new Intl.NumberFormat('en-US', {style:'percent', maximumFractionDigits:0});
const fmt = n => integer.format(n);
const monthFormat = new Intl.DateTimeFormat('en-US', {month:'long', timeZone:'UTC'});
const dateFormat = new Intl.DateTimeFormat('en-US', {dateStyle:'long', timeZone:'UTC'});
const dateOf = day => new Date(day + 'T00:00:00Z');
const canvas = $('map');
const colors = {m:'#66cbe0', v:'#f278b3', both:'#ffe79b'};
const places = [
  ['San Francisco', -122.4194, 37.7749], ['Sacramento', -121.4944, 38.5816],
  ['Redding', -122.3917, 40.5865], ['Eureka', -124.1637, 40.8021],
  ['Reno', -119.8138, 39.5296], ['Chico', -121.8375, 39.7285]
];
let model, selected, scaleMap, drag, pointer;
let countCache = new Map();
let historyCache;
let currentRange = [];
let calibration;
let panStart;
const state = {region:'dixie', date:regions.dixie.date, km:4, box:null, drawing:false, view:null, color:'excess', historyMetric:'activity', adjusted:false};

function coordinates() {
  const [year, month, day] = state.date.split('-').map(Number);
  return {year, month, day};
}

function bounds() {
  return state.region === 'custom' ? state.box : regions[state.region].box;
}

function countFor(date) {
  if (!countCache.has(date)) countCache.set(date, model.summarize(date, state.km, bounds()).total);
  return countCache.get(date);
}

function renderCalendar() {
  const {year, month} = coordinates();
  const days = model.dayKeys(year, month);
  const entries = days.map((date, i) => {
    const count = countFor(date);
    const ref = model.reference(year, month, i + 1, countFor);
    return {date, count, cutoff:ref.cutoff, flagged:model.comparable(year) && count > ref.cutoff};
  });
  const max = Math.max(0, ...entries.map(entry => entry.count));
  const calendar = $('calendar');
  const activeDate = calendar.contains(document.activeElement) ? document.activeElement.dataset.date : '';
  calendar.replaceChildren();
  for (const day of ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']) {
    const label = document.createElement('span');
    label.className = 'weekday';
    label.textContent = day;
    calendar.append(label);
  }
  for (let i = 0; i < dateOf(days[0]).getUTCDay(); i++) calendar.append(document.createElement('span'));
  for (const [index, entry] of entries.entries()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day';
    btn.dataset.date = entry.date;
    const value = state.color === 'excess' && model.comparable(year) ? Math.max(0, entry.count - entry.cutoff) : entry.count;
    btn.style.backgroundColor = activityColor(value, state.color === 'excess' ? 100 : 250);
    btn.title = entry.date + ': ' + entry.count + ' observed active cells' + (model.comparable(year) ? '; seasonal reference ' + entry.cutoff : '; MODIS-only record');
    btn.setAttribute('aria-pressed', entry.date === state.date);
    btn.setAttribute('aria-label', dateFormat.format(dateOf(entry.date)) + ', ' + fmt(entry.count) + ' active cells' +
      (entry.flagged ? ', above seasonal reference' : ''));
    btn.innerHTML = '<span>' + (index + 1) + '</span><strong>' + fmt(entry.count) + '</strong>' +
      (entry.flagged ? '<span class="flag" aria-hidden="true">◆</span>' : '');
    btn.addEventListener('click', () => changeDate(entry.date));
    calendar.append(btn);
    if (entry.date === activeDate) btn.focus();
  }
  const flagged = entries.filter(entry => entry.flagged).length;
  $('calendar-month').textContent = monthFormat.format(dateOf(days[0])) + ' ' + year;
  $('calendar-summary').textContent = (model.comparable(year) ? flagged + (flagged === 1 ? ' day' : ' days') + ' above the seasonal reference. ' : 'MODIS-only observations. Cross-sensor anomaly flags are unavailable. ') + 'Monthly peak: ' + fmt(max) + ' cells.';
  $('color-legend').textContent = state.color === 'excess' && model.comparable(year) ? 'At or below reference' : '0 active cells';
  $('color-maximum').textContent = state.color === 'excess' && model.comparable(year) ? '100+ excess cells' : '250+ active cells';
  $('prev').disabled = year === data.years[0] && month === 1;
  $('next').disabled = year === data.years.at(-1) && month === 12;
  $('peak').disabled = max === 0;
}

function renderEvidence() {
  const {year, month, day} = coordinates();
  const {rawM, rawV, mOnly, vOnly, both, total} = selected;
  const ref = model.reference(year, month, day, countFor);
  $('date-title').textContent = dateFormat.format(dateOf(state.date));
  $('m-raw').textContent = fmt(rawM);
  $('v-raw').textContent = fmt(rawV);
  $('combined').textContent = fmt(total);
  $('reference').textContent = model.comparable(year) ? fmt(ref.cutoff) : 'N/A';
  $('m-cell').textContent = fmt(mOnly + both) + ' distinct MODIS cells';
  $('v-cell').textContent = fmt(vOnly + both) + ' distinct VIIRS cells';
  $('overlap').textContent = total ? fmt(both) + ' seen by both · ' + pct.format(both / total) + ' overlap' : 'No cells with retained detections';
  $('samples').textContent = model.comparable(year) ? fmt(ref.size) + ' comparison days · 2017–2024' : 'Both sensors needed for this comparison';
  $('download').disabled = total === 0;
  $('explain').textContent = total
    ? fmt(rawM + rawV) + ' retained detections fall into ' + fmt(total) + ' unique ' + state.km + ' km cells. ' +
      (!model.comparable(year) ? 'Only MODIS is represented in this year. The map contains observed cells.' : total > ref.cutoff ? 'This day is above the seasonal reference for this area.' : 'This day is within the seasonal reference for this area.')
    : 'The filtered archive has no detections in this area on this date.';
}

function renderMap() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const [west, south, east, north] = state.view ?? model.bounds;
  const project = (lon, lat) => [14 + (lon - west) * (width - 28) / (east - west), height - 14 - (lat - south) * (height - 28) / (north - south)];
  scaleMap = {project, unproject: (x, y) => [
    west + (Math.max(14, Math.min(width - 14, x)) - 14) * (east - west) / (width - 28),
    south + (height - 14 - Math.max(14, Math.min(height - 14, y))) * (north - south) / (height - 28)
  ]};
  ctx.fillStyle = '#18262f';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  const [left, top] = project(west, north);
  const [right, bottom] = project(east, south);
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.clip();
  for (const geometry of Object.values(data.states)) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const rings of polygons) {
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([lon, lat], index) => {
          const xy = project(lon, lat);
          if (index === 0) ctx.moveTo(...xy);
          else ctx.lineTo(...xy);
        });
        ctx.closePath();
      }
      ctx.fillStyle = '#252f32';
      ctx.fill('evenodd');
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#6a7673';
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#a4aeb128';
  ctx.lineWidth = 1;
  for (let lon = Math.ceil(west); lon < east; lon++) {
    ctx.beginPath(); ctx.moveTo(...project(lon, south)); ctx.lineTo(...project(lon, north)); ctx.stroke();
  }
  for (let lat = Math.ceil(south); lat < north; lat++) {
    ctx.beginPath(); ctx.moveTo(...project(west, lat)); ctx.lineTo(...project(east, lat)); ctx.stroke();
  }
  ctx.font = '10px Arial';
  const mapArea = bounds();
  for (const [label, lon, lat] of places) {
    const [x, y] = project(lon, lat);
    ctx.fillStyle = '#99aaaa';
    ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.fillText(label, x + 6, y + 3);
  }
  for (const cell of selected.cells.values()) {
    const [x, y] = project(...model.cellCenter(cell.col, cell.row, state.km));
    const [nextX, nextY] = project(...model.cellCenter(cell.col + 1, cell.row + 1, state.km));
    const w = Math.max(2, (nextX - x) * .91);
    const h = Math.max(2, (y - nextY) * .91);
    ctx.fillStyle = cell.m && cell.v ? colors.both : (cell.m ? colors.m : colors.v);
    if (cell.m && cell.v) {
      ctx.beginPath();ctx.moveTo(x,y-h/2);ctx.lineTo(x+w/2,y);ctx.lineTo(x,y+h/2);ctx.lineTo(x-w/2,y);ctx.closePath();ctx.fill();
    } else if (cell.v) {ctx.beginPath();ctx.ellipse(x,y,w/2,h/2,0,0,Math.PI*2);ctx.fill();}
    else ctx.fillRect(x-w/2,y-h/2,w,h);
  }
  if (mapArea) {
    const [x0, y0] = project(mapArea[0], mapArea[3]);
    const [x1, y1] = project(mapArea[2], mapArea[1]);
    ctx.strokeStyle = '#a4ded2';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
  if (drag && pointer) {
    ctx.setLineDash([]);
    ctx.fillStyle = '#94d7cc33';
    ctx.strokeStyle = '#94d7cc';
    ctx.fillRect(drag.x, drag.y, pointer.x - drag.x, pointer.y - drag.y);
    ctx.strokeRect(drag.x, drag.y, pointer.x - drag.x, pointer.y - drag.y);
  }
  ctx.restore();
}

function render() {
  const {year, month} = coordinates();
  $('region').value = state.region;
  $('year').value = year;
  $('month').value = month;
  $('grid').value = state.km;
  selected = model.summarize(state.date, state.km, bounds());
  renderCalendar();
  renderHistory();
  renderMap();
  renderEvidence();
  const regionName = state.region === 'custom' ? 'Custom map area' : regions[state.region].name;
  canvas.setAttribute('aria-label', regionName + ' on ' + dateFormat.format(dateOf(state.date)) + ', ' +
    selected.mOnly + ' MODIS-only cells, ' + selected.vOnly + ' VIIRS-only cells, ' + selected.both + ' cells seen by both.');
  if (!state.drawing) $('map-status').textContent = regionName + ' · ' + fmt(selected.total) + ' observed cells · drag to pan';
  syncCoordinates();
  updateRange();
}

function changeDate(date) {
  state.date = date;
  render();
}

function changePeriod(year, month, day = coordinates().day) {
  changeDate(keyFor(year, month, Math.min(day, monthDays(year, month))));
}

function shiftMonth(amount) {
  const {year, month} = coordinates();
  const d = new Date(Date.UTC(year, month - 1 + amount, 1));
  if (data.years.includes(d.getUTCFullYear())) changePeriod(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

function setDraw(enabled) {
  state.drawing = enabled;
  $('draw').textContent = enabled ? 'Cancel drawing' : 'Draw area';
  $('draw').setAttribute('aria-pressed', enabled);
  canvas.classList.toggle('drawing', enabled);
  if (enabled) $('map-status').textContent = 'Drag a rectangle on the map to choose a custom area. Press Escape to cancel.';
  else {
    drag = pointer = null;
    render();
  }
}

function finishArea(event) {
  if (!drag) return;
  const endX = event.offsetX;
  const endY = event.offsetY;
  if (Math.abs(endX - drag.x) >= 8 && Math.abs(endY - drag.y) >= 8) {
    const [lon1, lat1] = scaleMap.unproject(drag.x, drag.y);
    const [lon2, lat2] = scaleMap.unproject(endX, endY);
    state.box = [Math.min(lon1, lon2), Math.min(lat1, lat2), Math.max(lon1, lon2), Math.max(lat1, lat2)];
    state.region = 'custom';
    state.adjusted=false;
    fitArea();
    $('region').querySelector('[value="custom"]').disabled = false;
    invalidate();
    setDraw(false);
  } else {
    drag = pointer = null;
    renderMap();
  }
}

function downloadEvidence() {
  const rows = [['date_utc','grid_km','cell_x','cell_y','center_lon','center_lat','modis_detections','viirs_detections','sensor_agreement']];
  for (const cell of selected.cells.values()) {
    const [lon, lat] = model.cellCenter(cell.col, cell.row, state.km);
    rows.push([state.date, state.km, cell.col, cell.row, lon.toFixed(5), lat.toFixed(5), cell.m, cell.v,
      cell.m && cell.v ? 'both' : (cell.m ? 'modis_only' : 'viirs_only')]);
  }
  const url = URL.createObjectURL(new Blob([window.EmberModel.csv(rows)], {type:'text/csv'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ember-ledger-' + state.date + '-' + state.km + 'km.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function init() {
  model = createModel(data);
  $('loading').hidden=true;
  document.querySelectorAll('[data-initial-disabled]').forEach(element=>{element.disabled=element.dataset.initialDisabled==='true';delete element.dataset.initialDisabled;});
  $('archive-years').textContent = data.years[0] + '–' + data.years.at(-1);
  for (const id of ['range-start','range-end']) {$(id).min = data.years[0] + '-01-01'; $(id).max=data.years.at(-1) + '-12-31';}
  $('range-start').value = '2021-08-01'; $('range-end').value = '2021-08-31';
  fitArea();
  for (const year of data.years) $('year').add(new Option(year, year));
  for (let i = 1; i <= 12; i++) $('month').add(new Option(monthFormat.format(dateOf(keyFor(2020,i,1))), i));
  $('region').addEventListener('change', event => {
    state.region = event.target.value;
    state.adjusted = false;
    fitArea();
    invalidate();
    render();
  });
  $('year').addEventListener('change', event => changePeriod(Number(event.target.value), coordinates().month));
  $('month').addEventListener('change', event => changePeriod(coordinates().year, Number(event.target.value)));
  $('grid').addEventListener('change', event => {
    state.km = Number(event.target.value);
    invalidate();
    render();
  });
  $('prev').addEventListener('click', () => shiftMonth(-1));
  $('next').addEventListener('click', () => shiftMonth(1));
  $('peak').addEventListener('click', () => {
    const {year, month} = coordinates();
    const days = model.dayKeys(year, month);
    changeDate(days.reduce((best, day) => countFor(day) > countFor(best) ? day : best));
  });
  $('draw').addEventListener('click', () => setDraw(!state.drawing));
  $('download').addEventListener('click', downloadEvidence);
  for (const button of document.querySelectorAll('[data-story]')) button.addEventListener('click', () => {
    state.region = button.dataset.story;
    state.adjusted = false;
    fitArea();
    invalidate();
    changeDate(regions[state.region].date);
    $('calendar-title').scrollIntoView({block:'start'});
  });
  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId);
    if (!state.drawing) {panStart={x:event.offsetX,y:event.offsetY,view:[...(state.view??model.bounds)]};return;}
    drag = pointer = {x:event.offsetX, y:event.offsetY};
  });
  canvas.addEventListener('pointermove', event => {
    if (panStart) {
      const v=panStart.view,dx=(event.offsetX-panStart.x)*(v[2]-v[0])/(canvas.clientWidth-28),dy=(event.offsetY-panStart.y)*(v[3]-v[1])/(canvas.clientHeight-28);
      state.view=clampView([v[0]-dx,v[1]+dy,v[2]-dx,v[3]+dy]);renderMap();return;
    }
    if (!drag) return;
    pointer = {x:event.offsetX, y:event.offsetY};
    renderMap();
  });
  canvas.addEventListener('pointerup', event=>{if(panStart){panStart=null;return;}finishArea(event);});
  canvas.addEventListener('pointercancel', () => {panStart=null; if (state.drawing) setDraw(false); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.drawing) setDraw(false);
  });
  bindExtendedControls();
  const resize = new ResizeObserver(() => renderMap());
  render();
  resize.observe(canvas);
}

window.EMBER_READY.then(async loaded => {
  data=loaded;
  try {calibration=await window.EmberLoadJSON('calibration.json.gz');} catch (_) {}
  init();
}).catch(error => {
  $('error').textContent='The observation archive could not be loaded. Refresh to try again.';
  $('error').hidden=false;
  $('loading').hidden=true;
  console.error(error);
});

function invalidate() {countCache.clear(); historyCache=null;}
function activityColor(value, cap) {
  if (!value) return '#263034';
  const strength=Math.min(1,Math.log1p(value)/Math.log1p(Math.max(1,cap)));
  return 'hsl(' + (25+12*strength) + ', ' + (30+36*strength) + '%, ' + (17+27*strength) + '%)';
}
function shortCount(value) {return value>=1000000 ? (value/1000000).toFixed(1)+'m' : value>=1000 ? (value/1000).toFixed(1)+'k' : fmt(value);}
function regionName() {return state.region==='custom'?'Custom map area':regions[state.region].name;}
function monthlyHistory() {
  if (historyCache) return historyCache;
  historyCache=[];
  for (const year of data.years) for(let month=1;month<=12;month++) {
    let cellDays=0, unusual=0, peak=0;
    for (const day of model.dayKeys(year,month)) {
      const count=countFor(day);cellDays+=count;peak=Math.max(peak,count);
      if(model.comparable(year) && count>model.reference(year,month,+day.slice(-2),countFor).cutoff) unusual++;
    }
    historyCache.push({year,month,cellDays,unusual,peak});
  }
  return historyCache;
}
function renderHistory() {
  const history=$('history');history.replaceChildren();
  const rows=monthlyHistory();
  const adjusted = state.adjusted && state.region==='all' && state.historyMetric==='activity' && calibration;
  const estimates = adjusted ? calibration.grids[String(state.km)].monthly : [];
  const estimateFor = row => estimates.find(e=>e.year===row.year&&e.month===row.month);
  const metric=state.historyMetric==='activity'?'cellDays':'unusual';
  const maximum=Math.max(1,...rows.map(row=>estimateFor(row)?.estimate??row[metric]));
  const top=document.createElement('span');top.className='month-label';top.textContent='YEAR / SENSOR';history.append(top);
  for(let m=1;m<=12;m++) {const label=document.createElement('span');label.className='month-label';label.textContent=monthFormat.format(dateOf(keyFor(2021,m,1))).slice(0,3).toUpperCase();history.append(label);}
  for(const row of rows) {
    if(row.month===1) {
      const label=document.createElement('span');label.className='year-label';
      label.append(document.createTextNode(String(row.year)));
      const badge=document.createElement('small');badge.textContent=model.comparable(row.year)?'M+V':adjusted?'EST':'M';label.append(badge);history.append(label);
    }
    const unavailable=metric==='unusual'&&!model.comparable(row.year);
    const estimate=estimateFor(row); const value=estimate?.estimate??row[metric];
    const button=document.createElement('button');button.className='month-cell'+(unavailable?' unavailable':'');button.type='button';
    button.textContent=unavailable?'—':(estimate?'~':'')+shortCount(Math.round(value));
    if(estimate)button.classList.add('estimated');
    if(!unavailable)button.style.backgroundColor=activityColor(value,maximum);
    button.setAttribute('aria-pressed',String(row.year===coordinates().year&&row.month===coordinates().month));
    const label=monthFormat.format(dateOf(keyFor(row.year,row.month,1)))+' '+row.year;
    button.title=label+': '+fmt(row.cellDays)+' active-cell days; '+(model.comparable(row.year)?row.unusual+' days above reference':'MODIS-only, no cross-sensor flags');
    if(estimate)button.title=label+': estimated '+fmt(Math.round(estimate.estimate))+' active-cell days; empirical error range '+fmt(Math.round(estimate.lower))+'–'+fmt(Math.round(estimate.upper))+'. Map and exports retain original observations.';
    button.setAttribute('aria-label',button.title);
    button.addEventListener('click',()=>{changePeriod(row.year,row.month,1);$('calendar-title').scrollIntoView({block:'start',behavior:'smooth'});});
    button.addEventListener('focus',()=>{$('history-description').textContent=button.title;});
    button.addEventListener('mouseenter',()=>{$('history-description').textContent=button.title;});
    history.append(button);
  }
  $('history-legend').textContent='One shared color scale across years · '+(metric==='cellDays'?'0–'+fmt(maximum)+' active-cell days':'0–'+maximum+' days above reference');
  const entry=rows.find(row=>row.year===coordinates().year&&row.month===coordinates().month);
  $('history-description').textContent=fmt(entry.cellDays)+' observed active-cell days in the selected month'+(adjusted?' · ~ marks modeled history':'');
  if($('adjusted-history')){$('adjusted-history').setAttribute('aria-pressed',String(!!adjusted));$('observed-history').setAttribute('aria-pressed',String(!adjusted));}
  $('history-coverage').textContent='M = MODIS only (2001–2011). M+V = MODIS and VIIRS SNPP (2012–2025). These are observed counts, so the sensor change can affect comparisons. The seasonal reference is fixed to 2017–2024 and excludes the selected year. The archive ends on December 31, 2025.';
  if(adjusted)$('history-coverage').textContent='Experimental full-region history. ~ / EST marks modeled 2001–2011 monthly counts on the combined-observation scale; later months show observed unions. 2001–2002 use Terra-only calibration. The map and ordinary CSV exports remain observed data. Empirical error ranges appear on hover. See validation for transfer assumptions and held-out errors.';
}
function clampView(view) {
  const b=model.bounds,w=Math.min(b[2]-b[0],Math.max(.03,view[2]-view[0])),h=Math.min(b[3]-b[1],Math.max(.03,view[3]-view[1]));
  const west=Math.max(b[0],Math.min(b[2]-w,(view[0]+view[2]-w)/2));
  const south=Math.max(b[1],Math.min(b[3]-h,(view[1]+view[3]-h)/2));
  return [west,south,west+w,south+h];
}
function fitArea() {
  if(!model)return;
  const b=bounds()??model.bounds,dx=(b[2]-b[0])*.12,dy=(b[3]-b[1])*.12;
  state.view=clampView([b[0]-dx,b[1]-dy,b[2]+dx,b[3]+dy]);
}
function zoomMap(factor) {
  const b=state.view??model.bounds,cx=(b[0]+b[2])/2,cy=(b[1]+b[3])/2,w=(b[2]-b[0])*factor/2,h=(b[3]-b[1])*factor/2;
  state.view=clampView([cx-w,cy-h,cx+w,cy+h]);renderMap();
}
function syncCoordinates() {
  const b=bounds()??model.bounds;
  ['west','south','east','north'].forEach((id,i)=>{if(document.activeElement!==$(id))$(id).value=b[i].toFixed(3);});
}
function bindExtendedControls() {
  $('history-metric').addEventListener('change',event=>{state.historyMetric=event.target.value;if(state.historyMetric!=='activity')state.adjusted=false;renderHistory();});
  $('observed-history').addEventListener('click',()=>{state.adjusted=false;renderHistory();});
  $('adjusted-history').addEventListener('click',()=>{if(!calibration)return;state.region='all';state.adjusted=true;state.historyMetric='activity';$('history-metric').value='activity';invalidate();fitArea();render();});
  $('download-estimates').addEventListener('click',downloadEstimates);
  $('calendar-color').addEventListener('change',event=>{state.color=event.target.value;renderCalendar();});
  $('fit-area').addEventListener('click',()=>{fitArea();renderMap();});
  $('reset-map').addEventListener('click',()=>{state.view=[...model.bounds];renderMap();});
  $('zoom-in').addEventListener('click',()=>zoomMap(.65));
  $('zoom-out').addEventListener('click',()=>zoomMap(1/.65));
  $('coordinates-form').addEventListener('submit',event=>{
    event.preventDefault();
    const b=['west','south','east','north'].map(id=>Number($(id).value)),limit=model.bounds;
    if(b.some(n=>!Number.isFinite(n))||b[0]>=b[2]||b[1]>=b[3]||b[0]<limit[0]||b[1]<limit[1]||b[2]>limit[2]||b[3]>limit[3]) {
      $('coordinate-message').textContent='Use an ordered rectangle within '+limit.join(', ')+'.';$('coordinate-message').className='error-text';return;
    }
    state.region='custom';state.box=b;state.adjusted=false;$('region').querySelector('[value="custom"]').disabled=false;
    invalidate();fitArea();render();$('coordinate-message').className='';$('coordinate-message').textContent='Area applied.';
  });
  $('range-form').addEventListener('submit',event=>{event.preventDefault();updateRange();});
  for(const id of ['range-start','range-end'])$(id).addEventListener('change',updateRange);
  $('download-range').addEventListener('click',downloadRange);
  $('download-raw').addEventListener('click',downloadRaw);
  $('download-chart').addEventListener('click',downloadChart);
}
function updateRange() {
  try {
    currentRange=window.EmberModel.rangeKeys($('range-start').value,$('range-end').value,data.years);
    let cellDays=0,peak=0,peakDate=currentRange[0],unusual=0,eligible=0;
    for(const day of currentRange) {
      const count=countFor(day),[year,month,date]=day.split('-').map(Number);cellDays+=count;
      if(count>peak){peak=count;peakDate=day;}
      if(model.comparable(year)){eligible++;if(count>model.reference(year,month,date,countFor).cutoff)unusual++;}
    }
    $('range-results').className='range-results';
    $('range-results').replaceChildren();
    const heading=document.createElement('strong');heading.textContent=fmt(cellDays)+' active-cell days across '+fmt(currentRange.length)+(currentRange.length===1?' day':' days');
    const description=document.createElement('p');description.textContent=regionName()+' · '+state.km+' km grid · peak '+fmt(peak)+' observed cells on '+peakDate+'. '+unusual+(unusual===1?' day':' days')+' above reference among '+eligible+(eligible===1?' day':' days')+' with both sensor records.';
    $('range-results').append(heading,description);
    if(eligible<currentRange.length){const note=document.createElement('p');note.textContent='This range crosses the MODIS-only record. Its counts are not adjusted for the change in sensors.';$('range-results').append(note);}
    for(const id of ['download-range','download-raw','download-chart'])$(id).disabled=false;
  }catch(error){
    currentRange=[];$('range-results').textContent=error.message;$('range-results').className='range-results error-text';
    for(const id of ['download-range','download-raw','download-chart'])$(id).disabled=true;
  }
}
function saveFile(filename,content,type) {
  const url=URL.createObjectURL(new Blob(Array.isArray(content)?content:[content],{type}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadRange() {
  updateRange();if(!currentRange.length)return;
  const b=bounds()??model.bounds;
  const rows=[['date_utc','grid_km','west','south','east','north','sensors_in_annual_archive','modis_detections','viirs_detections','modis_cells','viirs_cells','both_cells','observed_union_cells','reference_95th_cells','reference_samples','above_reference','record_kind']];
  for(const day of currentRange) {
    const s=model.summarize(day,state.km,bounds()),[year,month,date]=day.split('-').map(Number),ref=model.reference(year,month,date,countFor),eligible=model.comparable(year);
    rows.push([day,state.km,...b,model.sensorsFor(year).join('+'),s.rawM,s.rawV,s.mOnly+s.both,s.vOnly+s.both,s.both,s.total,eligible?ref.cutoff:null,eligible?ref.size:null,eligible?(s.total>ref.cutoff):null,'observed']);
  }
  saveFile('ember-ledger-daily-'+currentRange[0]+'-to-'+currentRange.at(-1)+'.csv',window.EmberModel.csv(rows),'text/csv;charset=utf-8');
  $('export-status').textContent='Downloaded '+fmt(currentRange.length)+(currentRange.length===1?' daily row':' daily rows')+', including zero-observation days. Reference years: 2017–2024, selected year excluded.';
}
async function downloadRaw() {
  updateRange();if(!currentRange.length)return;
  const start=currentRange[0],end=currentRange.at(-1),area=bounds()?[...bounds()]:null;
  const years=[...new Set(currentRange.map(day=>+day.slice(0,4)))];
  const canonical=['source_sensor','source_file','base_cell_x','base_cell_y','latitude','longitude','brightness','scan','track','acq_date','acq_time','satellite','instrument','confidence','version','bright_t31','frp','daynight','type','bright_ti4','bright_ti5'];
  const parts=[window.EmberModel.csv([canonical])];let retained=0;
  $('download-raw').disabled=true;
  try {
    for(const year of years) {
      $('export-status').textContent='Preparing original NASA fields for '+year+' ('+(years.indexOf(year)+1)+' of '+years.length+').';
      const file=data.rawFiles[String(year)];if(!file)throw new Error('Source export is unavailable for '+year);
      const raw=await window.EmberLoadJSON(file.url),idx=Object.fromEntries(raw.fields.map((field,i)=>[field,i]));
      const mapping=canonical.map(field=>idx[field]);const rows=[];
      for(const row of raw.rows) {
        const date=row[idx.acq_date];if(date<start||date>end)continue;
        if(area){const [lon,lat]=model.cellCenter(Number(row[idx.base_cell_x]),Number(row[idx.base_cell_y]),data.baseGridKm);if(lon<area[0]||lon>=area[2]||lat<area[1]||lat>=area[3])continue;}
        rows.push(mapping.map(index=>index===undefined?'':row[index]));retained++;
      }
      parts.push(window.EmberModel.csv(rows));
    }
    saveFile('ember-ledger-source-detections-'+start+'-to-'+end+'.csv',parts,'text/csv;charset=utf-8');
    $('export-status').textContent='Downloaded '+fmt(retained)+' retained NASA observations. Original coordinates and timestamps are preserved; area inclusion uses base-cell centers, matching the displayed counts.';
  }catch(error){$('export-status').textContent='Download failed: '+error.message;}
  finally{$('download-raw').disabled=false;}
}
function downloadChart() {
  updateRange();if(!currentRange.length)return;
  const values=currentRange.map(countFor),max=Math.max(1,...values),width=1100,height=440,left=75,right=30,top=80,bottom=80;
  const points=values.map((v,i)=>(left+(width-left-right)*(values.length===1?.5:i/(values.length-1))).toFixed(2)+','+(height-bottom-v/max*(height-top-bottom)).toFixed(2)).join(' ');
  let grid='';for(let i=0;i<=4;i++){const y=height-bottom-i/4*(height-top-bottom);grid+='<line x1="'+left+'" x2="'+(width-right)+'" y1="'+y+'" y2="'+y+'" stroke="#d6d9db"/><text x="'+(left-10)+'" y="'+(y+4)+'" text-anchor="end">'+Math.round(max*i/4)+'</text>';}
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'"><rect width="100%" height="100%" fill="#faf9f5"/><g font-family="Arial,sans-serif" font-size="13" fill="#25343b"><text x="'+left+'" y="30" font-size="22">Ember Ledger | observed daily active cells</text><text x="'+left+'" y="54">'+regionName()+' | '+state.km+' km grid | '+currentRange[0]+' to '+currentRange.at(-1)+'</text>'+grid+'<polyline fill="none" stroke="#bf6e32" stroke-width="2" points="'+points+'"/><text x="'+left+'" y="'+(height-50)+'">'+currentRange[0]+'</text><text x="'+(width-right)+'" y="'+(height-50)+'" text-anchor="end">'+currentRange.at(-1)+'</text><text x="'+left+'" y="'+(height-20)+'">NASA FIRMS | Empty days mean no retained detections. MODIS-only before 2012; no calibration applied.</text></g></svg>';
  saveFile('ember-ledger-activity-'+currentRange[0]+'-to-'+currentRange.at(-1)+'.svg',svg,'image/svg+xml');
  $('export-status').textContent='Downloaded an SVG chart with the selected dates, area, grid size and source note.';
}
function downloadEstimates() {
  if(!calibration){$('export-status').textContent='The calibration file could not be loaded.';return;}
  const rows=[['date_utc','scope','grid_km','model_input','input_observed_cells','estimated_union_cells','empirical_lower','empirical_upper','record_kind']];
  for(const row of calibration.grids[String(state.km)].daily)rows.push([row.date,'full_northern_california_study_window',state.km,row.source,row.inputCount,row.estimate,row.lower,row.upper,'modeled_backcast']);
  saveFile('ember-ledger-full-region-estimates-2001-2011-'+state.km+'km.csv',window.EmberModel.csv(rows),'text/csv;charset=utf-8');
  $('export-status').textContent='Downloaded modeled 2001–2011 daily totals for the full study region at '+state.km+' km. These estimates have no individual hotspot coordinates and do not use the selected custom area or date range.';
}
