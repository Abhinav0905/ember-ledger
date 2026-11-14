"""Build Ember Ledger's observed grid archive and original-field export files.

Python 3.11+. Inputs are NASA FIRMS US annual CSVs. No fitted or synthetic
observations are inserted. Raw downloads retain input field values as strings.
"""
import argparse
import csv
import gzip
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

BASE = 'https://firms.modaps.eosdis.nasa.gov/data/country/'
BOUNDARY = 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json'
WEST, SOUTH, EAST, NORTH = -125, 36.6, -117.7, 42.8
RADIUS = 6371.0088
ORIGIN_LAT = math.radians(SOUTH)
COS_LAT = math.cos(math.radians(39.7))
BASE_GRID_KM = 2
YEARS = range(2001, 2026)
SENSORS = ('modis', 'viirs-snpp')
REFERENCE_YEARS = list(range(2017, 2025))


def grid_cell(lon, lat):
    x = RADIUS * COS_LAT * math.radians(lon - WEST)
    y = RADIUS * (math.sin(math.radians(lat)) - math.sin(ORIGIN_LAT)) / COS_LAT
    return math.floor(x / BASE_GRID_KM), math.floor(y / BASE_GRID_KM)


def retained(row, sensor):
    lon, lat = float(row['longitude']), float(row['latitude'])
    if not (WEST <= lon < EAST and SOUTH <= lat < NORTH) or row['type'] != '0':
        return False
    return int(row['confidence']) >= 30 if sensor == 'modis' else row['confidence'].lower() in {'n', 'h'}


def write_gzip(path, content):
    path.write_bytes(gzip.compress(content, mtime=0))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('output_directory', type=Path)
    args = parser.parse_args()
    out = args.output_directory
    out.mkdir(parents=True, exist_ok=True)
    (out / 'raw').mkdir(exist_ok=True)
    days = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    sources, raw_files = [], {}
    for year in YEARS:
        original_fields = []
        paths = []
        for sensor_id, sensor in enumerate(SENSORS):
            if sensor == 'viirs-snpp' and year < 2012:
                continue
            path = args.archive / f'{sensor}_{year}_United_States.csv'
            with path.open(newline='') as source:
                fields = csv.DictReader(source).fieldnames
            for field in fields:
                if field not in original_fields:
                    original_fields.append(field)
            paths.append((sensor_id, sensor, path))
        fields = ['source_sensor', 'source_file', 'base_cell_x', 'base_cell_y'] + original_fields
        raw_rows = []
        for sensor_id, sensor, path in paths:
            kept = 0
            versions = set()
            with path.open(newline='') as source:
                for row in csv.DictReader(source):
                    if not retained(row, sensor):
                        continue
                    date = row['acq_date']
                    if date[:4] != str(year):
                        raise ValueError(f'Unexpected year in {path.name}: {date}')
                    cell = grid_cell(float(row['longitude']), float(row['latitude']))
                    days[date][cell][sensor_id] += 1
                    raw_rows.append([sensor, path.name, *cell] + [row.get(field, '') for field in original_fields])
                    versions.add(row.get('version', ''))
                    kept += 1
            with path.open('rb') as source:
                digest = hashlib.file_digest(source, 'sha256').hexdigest()
            sources.append({'sensor': sensor, 'year': year, 'observations': kept,
                            'sha256': digest, 'url': BASE + path.name,
                            'versionValues': sorted(versions)})
            print(path.name, kept, flush=True)
        raw_path = out / 'raw' / f'{year}.json.gz'
        raw_bytes = json.dumps({'fields': fields, 'rows': raw_rows}, separators=(',', ':')).encode()
        digest = write_gzip(raw_path, raw_bytes)
        raw_files[str(year)] = {'url': f'raw/{year}.json.gz', 'rows': len(raw_rows),
                                'bytes': raw_path.stat().st_size, 'sha256': digest}
    features = json.loads((args.archive / 'us-states.json').read_text())['features']
    states = {item['properties']['name']: item['geometry'] for item in features
              if item['properties']['name'] in {'California', 'Oregon', 'Nevada'}}
    data = {'bounds': [WEST, SOUTH, EAST, NORTH], 'years': list(YEARS),
            'referenceYears': REFERENCE_YEARS, 'sources': sources, 'rawFiles': raw_files,
            'boundarySource': BOUNDARY, 'states': states, 'baseGridKm': BASE_GRID_KM,
            'coverageStart': '2001-01-01', 'coverageEnd': '2025-12-31',
            'sensorYears': {'modis': list(YEARS), 'viirs-snpp': list(range(2012, 2026))},
            'projection': {'radius': RADIUS, 'cosLat': COS_LAT, 'originSin': math.sin(ORIGIN_LAT)},
            'days': {day: [value for (x, y), (m, v) in sorted(cells.items()) for value in (x, y, m, v)]
                     for day, cells in sorted(days.items())}}
    payload = json.dumps(data, separators=(',', ':')).encode()
    digest = write_gzip(out / 'observations.json.gz', payload)
    # Small metadata payload also powers Methods without loading the grid.
    metadata = {key: value for key, value in data.items() if key not in {'days', 'states'}}
    metadata['retainedObservations'] = sum(source['observations'] for source in sources)
    metadata['populatedDates'] = len(days)
    metadata['archiveSha256'] = digest
    (out / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(f'{len(days)} populated dates, {metadata["retainedObservations"]:,} retained observations.')
    print(f'Grid archive SHA-256: {digest}')


if __name__ == '__main__':
    main()
