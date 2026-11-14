"""Prepare 2001–2025 research data without changing the published project.

The activity data retain the original app's filtering and grid assignment.
Per-sensor availability is explicit: absence of VIIRS before 2012 is not zero.
"""
import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

WEST, SOUTH, EAST, NORTH = -125, 36.6, -117.7, 42.8
RADIUS = 6371.0088
ORIGIN_SIN = math.sin(math.radians(SOUTH))
COS_LAT = math.cos(math.radians(39.7))
REGIONS = {
    'all': None,
    'dixie': [-122.05, 39.62, -120.15, 40.86],
    'august': [-124.05, 39.33, -122.25, 40.70],
    'camp': [-122.18, 39.49, -121.22, 40.15],
}


def cell(lon, lat):
    x = RADIUS * COS_LAT * math.radians(lon - WEST)
    y = RADIUS * (math.sin(math.radians(lat)) - ORIGIN_SIN) / COS_LAT
    return math.floor(x / 2), math.floor(y / 2)


def center(x, y):
    return (WEST + math.degrees((x + .5) * 2 / (RADIUS * COS_LAT)),
            math.degrees(math.asin((y + .5) * 2 * COS_LAT / RADIUS + ORIGIN_SIN)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, help='Directory containing the original annual CSV files and us-states.json')
    parser.add_argument('output', type=Path, help='Research output directory')
    args = parser.parse_args()
    ROOT, OUT = args.archive, args.output
    OUT.mkdir(parents=True, exist_ok=True)
    days = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))
    sources = []
    for idx, sensor in enumerate(['modis', 'viirs-snpp']):
        years = range(2001 if idx == 0 else 2012, 2026)
        for year in years:
            path = ROOT / f'{sensor}_{year}_United_States.csv'
            kept = total = 0
            versions = set()
            min_date, max_date = '9999-99-99', '0000-00-00'
            with path.open(newline='') as src:
                for row in csv.DictReader(src):
                    total += 1
                    day = row['acq_date']
                    if not day.startswith(str(year)):
                        raise ValueError(f'Wrong year: {path} {day}')
                    min_date, max_date = min(min_date, day), max(max_date, day)
                    versions.add(row['version'])
                    lon, lat = float(row['longitude']), float(row['latitude'])
                    if not (WEST <= lon < EAST and SOUTH <= lat < NORTH):
                        continue
                    if row['type'] != '0':
                        continue
                    if idx == 0 and float(row['confidence']) < 30:
                        continue
                    if idx == 1 and row['confidence'].lower() not in {'n', 'h'}:
                        continue
                    item = days[day][cell(lon, lat)]
                    item[idx] += 1
                    if idx == 0 and row['satellite'] == 'Terra':
                        item[2] += 1
                    kept += 1
            with path.open('rb') as raw:
                digest = hashlib.file_digest(raw, 'sha256').hexdigest()
            sources.append({
                'sensor': sensor, 'year': year, 'observations': kept,
                'sha256': digest,
                'url': 'https://firms.modaps.eosdis.nasa.gov/data/country/' + path.name,
                'archiveRows': total, 'versions': sorted(versions),
                'firstArchiveDetection': min_date, 'lastArchiveDetection': max_date,
            })
            print(sensor, year, total, kept, sorted(versions), flush=True)
    features = json.loads((ROOT / 'us-states.json').read_text())['features']
    data = {
        'bounds': [WEST, SOUTH, EAST, NORTH], 'years': list(range(2001, 2026)),
        'sources': sources,
        'boundarySource': 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',
        'states': {f['properties']['name']: f['geometry'] for f in features
                   if f['properties']['name'] in {'California', 'Oregon', 'Nevada'}},
        'baseGridKm': 2,
        'projection': {'radius': RADIUS, 'cosLat': COS_LAT, 'originSin': ORIGIN_SIN},
        'coverage': {
            'modis': {'start': '2001-01-01', 'end': '2025-12-31', 'years': list(range(2001, 2026))},
            'viirs-snpp': {'start': '2012-01-20', 'end': '2025-12-31', 'years': list(range(2012, 2026))},
            'completeOverlapYears': list(range(2013, 2026)),
            'note': 'Archive coverage describes the available annual files, not clear-sky observation coverage. A date with no retained observations does not establish absence of fire.'
        },
        'days': {d: [v for (x, y), (m, viirs, terra) in sorted(cells.items())
                    for v in (x, y, m, viirs)] for d, cells in sorted(days.items())},
    }
    (OUT / 'extended-data.json').write_text(json.dumps(data, separators=(',', ':')))
    (OUT / 'archive-summary.json').write_text(json.dumps(sources, indent=2))
    with (OUT / 'daily-counts.csv').open('w', newline='') as out:
        writer = csv.writer(out)
        writer.writerow(['date', 'region', 'grid_km', 'modis', 'viirs', 'union', 'terra'])
        for day, base in sorted(days.items()):
            for region, bbox in REGIONS.items():
                filtered = {}
                for (x, y), values in base.items():
                    if bbox:
                        lon, lat = center(x, y)
                        if not (bbox[0] <= lon < bbox[2] and bbox[1] <= lat < bbox[3]):
                            continue
                    filtered[x, y] = values
                for km in [2, 4, 8]:
                    scale = km // 2
                    cells = defaultdict(lambda: [0, 0, 0])
                    for (x, y), values in filtered.items():
                        dest = cells[x // scale, y // scale]
                        for i in range(3):
                            dest[i] += values[i]
                    m = sum(v[0] > 0 for v in cells.values())
                    viirs = sum(v[1] > 0 for v in cells.values())
                    terra = sum(v[2] > 0 for v in cells.values())
                    writer.writerow([day, region, km, m, viirs, len(cells), terra])
    print('DONE', len(days), sum(s['observations'] for s in sources), flush=True)


if __name__ == '__main__':
    main()
