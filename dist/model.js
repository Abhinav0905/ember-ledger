(function (scope) {
  const pad = number => String(number).padStart(2, '0');
  const keyFor = (year, month, day) => [year, pad(month), pad(day)].join('-');
  const monthDays = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
  const regions = {
    all: { name: 'Northern California study window' },
    dixie: { name: 'Dixie Fire area', box: [-122.05, 39.62, -120.15, 40.86], date: '2021-08-05' },
    august: { name: 'August Complex area', box: [-124.05, 39.33, -122.25, 40.70], date: '2020-09-09' },
    camp: { name: 'Camp Fire area', box: [-122.18, 39.49, -121.22, 40.15], date: '2018-11-08' }
  };

  function createModel(data) {
    const [west, south, east, north] = data.bounds;
    const {radius, cosLat, originSin} = data.projection;
    const radians = Math.PI / 180;
    const cellCenter = (x, y, km) => [
      west + ((x + 0.5) * km) / (radius * cosLat * radians),
      Math.asin((y + 0.5) * km * cosLat / radius + originSin) / radians
    ];

    function summarize(date, km, box) {
      const rows = data.days[date] ?? [];
      const scale = km / data.baseGridKm;
      const cells = new Map();
      let rawM = 0;
      let rawV = 0;
      for (let i = 0; i < rows.length; i += 4) {
        const x = rows[i];
        const y = rows[i + 1];
        if (box) {
          const [lon, lat] = cellCenter(x, y, data.baseGridKm);
          if (lon < box[0] || lon >= box[2] || lat < box[1] || lat >= box[3]) continue;
        }
        const col = Math.floor(x / scale);
        const row = Math.floor(y / scale);
        const key = col * 10000 + row;
        const cell = cells.get(key) ?? {col, row, m: 0, v: 0};
        cell.m += rows[i + 2];
        cell.v += rows[i + 3];
        rawM += rows[i + 2];
        rawV += rows[i + 3];
        cells.set(key, cell);
      }
      let mOnly = 0;
      let vOnly = 0;
      let both = 0;
      for (const cell of cells.values()) {
        if (cell.m && cell.v) both++;
        else if (cell.m) mOnly++;
        else vOnly++;
      }
      return {cells, rawM, rawV, mOnly, vOnly, both, total: cells.size};
    }

    // Other years only. Sample the same calendar date and the seven dates on either side.
    function reference(year, month, day, counts) {
      const samples = [];
      for (const historicalYear of (data.referenceYears ?? data.years)) {
        if (historicalYear === year) continue;
        const anchor = Math.min(day, monthDays(historicalYear, month));
        for (let offset = -7; offset <= 7; offset++) {
          const date = new Date(Date.UTC(historicalYear, month - 1, anchor + offset));
          if (date.getUTCFullYear() === year || !(data.referenceYears ?? data.years).includes(date.getUTCFullYear())) continue;
          samples.push(counts(date.toISOString().slice(0, 10)));
        }
      }
      samples.sort((a, b) => a - b);
      return {cutoff: samples.length ? samples[Math.ceil(samples.length * 0.95) - 1] : null, size: samples.length};
    }

    function dayKeys(year, month) {
      return Array.from({length: monthDays(year, month)}, (_, index) => keyFor(year, month, index + 1));
    }

    function sensorsFor(year) {
      return data.sources.filter(source => source.year === year).map(source => source.sensor);
    }

    function comparable(year) {
      const sensors = sensorsFor(year);
      return sensors.includes('modis') && sensors.includes('viirs-snpp');
    }

    function scaleAssessment(date, box) {
      const [year, month, day] = date.split('-').map(Number);
      const eligible = comparable(year);
      const rows = [2, 4, 8].map(km => {
        const cache = new Map();
        const count = key => {
          if (!cache.has(key)) cache.set(key, summarize(key, km, box).total);
          return cache.get(key);
        };
        const observed = summarize(date, km, box);
        const ref = eligible ? reference(year, month, day, count) : {cutoff:null, size:0};
        return {km, total:observed.total, both:observed.both, cutoff:ref.cutoff,
          samples:ref.size, flagged:eligible ? observed.total > ref.cutoff : null};
      });
      const flaggedCount = eligible ? rows.filter(row => row.flagged).length : null;
      const conclusion = !eligible ? 'Cross-sensor flags are unavailable for this MODIS-only year.'
        : flaggedCount === 3 ? 'Above the seasonal reference at all three grid sizes.'
        : flaggedCount === 0 ? 'At or below the seasonal reference at all three grid sizes.'
        : 'The flag changes with grid size. Inspect the separate results before comparing periods.';
      return {rows, eligible, flaggedCount, conclusion};
    }

    function reviewBrief(date, km, box, areaName) {
      const observed = summarize(date, km, box);
      const assessment = scaleAssessment(date, box);
      const extent = box ?? [west, south, east, north];
      return [
        'EMBER LEDGER | HISTORICAL REVIEW BRIEF',
        'Area: ' + areaName,
        'Bounds (west, south, east, north): ' + extent.join(', '),
        'Date (UTC): ' + date,
        'Selected grid: ' + km + ' km',
        'Record: observed satellite detections; no modeled locations',
        '', 'SELECTED-DAY EVIDENCE',
        'Retained MODIS detections: ' + observed.rawM,
        'Retained VIIRS Suomi NPP detections: ' + observed.rawV,
        'Combined occupied cells: ' + observed.total,
        'Cells seen by both sensors: ' + observed.both,
        '', 'GRID-SIZE CHECK',
        'Grid km | Occupied cells | Shared cells | Seasonal 95th | Comparison days | Above reference',
        ...assessment.rows.map(row => [row.km, row.total, row.both, row.cutoff ?? 'N/A',
          row.samples, row.flagged === null ? 'N/A' : row.flagged ? 'Yes' : 'No'].join(' | ')),
        assessment.conclusion,
        '', 'INTERPRETATION',
        'Use this record to choose historical periods for closer review and retain the evidence behind a comparison.',
        'A flag means recorded cell counts exceeded a retrospective seasonal reference. It is not a fire-risk alert.',
        'Reference: 2017-2024, same calendar date plus/minus seven days, selected year excluded.',
        'One cell counts once per UTC day. Counts are not separate fires, burned area or people affected.',
        'Cross-grid agreement measures sensitivity to grid size, not independent fire accuracy.',
        'Clouds, outages and overpass timing affect observations. No detections does not establish no fire.',
        'Named case-study rectangles do not attribute individual detections to an incident.',
        'Archive coverage: 2001-2025. No live observations or forecasts.',
        '', 'SOURCES AND METHODS',
        'NASA/LANCE FIRMS: https://firms.modaps.eosdis.nasa.gov/data/country/',
        'Methods and source hashes: https://abhinav0905.github.io/ember-ledger/method.html',
        'Archive manifest: https://abhinav0905.github.io/ember-ledger/dist/metadata.json',
        'Code: https://github.com/Abhinav0905/ember-ledger',
        'AI assistance: Codex helped build the review-brief code and draft its explanatory text.',
        ''
      ].join('\n');
    }

    return {summarize, reference, dayKeys, cellCenter, sensorsFor, comparable, scaleAssessment, reviewBrief,
      bounds: [west, south, east, north]};
  }

  function rangeKeys(start, end, years) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('Choose a valid start and end date.');
    const first = new Date(start + 'T00:00:00Z'), last = new Date(end + 'T00:00:00Z');
    if (!Number.isFinite(+first) || !Number.isFinite(+last) || first.toISOString().slice(0,10) !== start || last.toISOString().slice(0,10) !== end) throw new Error('Choose a valid date.');
    if (first > last) throw new Error('The start date must come before the end date.');
    if (!years.includes(first.getUTCFullYear()) || !years.includes(last.getUTCFullYear())) throw new Error('Choose dates within the available archive.');
    const keys = [];
    for (let day = +first; day <= +last; day += 86400000) keys.push(new Date(day).toISOString().slice(0,10));
    return keys;
  }

  function csv(rows) {
    const escape = value => {
      const text = value == null ? '' : String(value);
      return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    return rows.map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
  }

  scope.EmberModel = {createModel, regions, keyFor, monthDays, rangeKeys, csv};
})(typeof window === 'undefined' ? globalThis : window);
