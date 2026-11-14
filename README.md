# Ember Ledger

A historical burning-activity calendar for **Harmonization of MODIS and VIIRS Hot Spots**, NASA Space Apps 2026. Built by **Kumar Abhinav**.

[Open the atlas](https://abhinav0905.github.io/ember-ledger/) · [Six-slide pitch](https://abhinav0905.github.io/ember-ledger/pitch.html) · [Methods](https://abhinav0905.github.io/ember-ledger/method.html) · [Validation](https://abhinav0905.github.io/ember-ledger/validation.html)

The problem is a changing satellite record. MODIS and VIIRS have different detection sensitivity, pixel sizes and overpass times. Raw counts cannot simply be joined into a comparable historical series.

Ember Ledger provides two views of that record. The observed atlas places NASA detections on a common grid and keeps sensor agreement visible. An experimental full-region adjustment estimates older aggregate counts on the combined-observation scale. Estimates are labeled and never inserted into the map or original-detection downloads.

## What is included

- 1,086,752 retained observations across 2001–2025, in Northern California and nearby parts of Oregon and Nevada.
- MODIS 2001–2025; VIIRS Suomi NPP 2012–2025. The latest included date is December 31, 2025, with no live or 2026 data.
- A years × months heatmap, daily calendar and a fixed 2017–2024 seasonal reference using the same calendar date ±7 days, selected year excluded.
- Drawn or typed areas, map zoom and pan, and 2/4/8 km grids. Sensor colors also have distinct marker shapes.
- Date-range CSV analysis, original NASA fields for retained detections, cell evidence and SVG chart export.
- Separate modeled 2001–2011 full-region totals with descriptive error ranges.

## Run locally

Use a current browser with `DecompressionStream` support. No account, API key, LLM API or build tool is needed.

```sh
python3 -m http.server 8000 --directory dist
```

Open `http://localhost:8000/`. A local server is needed because data are loaded with `fetch`; double-clicking HTML files is not supported. The app uses optional Google Fonts and otherwise runs from static files.

## Rebuild observations

Python 3.11 or newer, standard library only. The downloader requests 39 public NASA annual US CSVs and state outlines. Allow space for the national inputs; only observations inside the study rectangle enter the site assets.

```sh
python3 scripts/download.py /path/to/inputs
python3 scripts/prepare.py /path/to/inputs dist
```

`prepare.py` keeps type 0, MODIS confidence ≥30 and VIIRS nominal/high. It writes `observations.json.gz`, `metadata.json` and original-field gzip JSON files under `dist/raw/`. Source CSV hashes and literal version values are retained. MODIS values vary (`6.2`, `6.03`, `61.03`); these are not all one product release, and `6.2` must not be read as “Collection 6.2.”

The map and source CSV exports use the same rule: include a base 2 km cell when its center lies inside the selected area. Exported latitude/longitude and acquisition-time values remain the original strings. Added source and cell-index columns are named explicitly.

## Reproduce the calibration

The research dependencies are separate from the app. Use a virtual environment if needed.

```sh
python3 -m pip install -r scripts/calibration/requirements.txt
python3 scripts/calibration/extend.py /path/to/inputs /path/to/research
python3 scripts/calibration/evaluate.py /path/to/research
cp scripts/calibration/snpp-outages.html /path/to/research/snpp-outages.html
python3 scripts/calibration/package_calibration.py /path/to/research
python3 -c 'import gzip,pathlib; p=pathlib.Path("/path/to/research/calibration.json"); pathlib.Path("dist/calibration.json.gz").write_bytes(gzip.compress(p.read_bytes(),mtime=0))'
python3 scripts/render_docs.py
```

The full-region model uses four seasonal multipliers, fitted separately for each grid and for Terra-only or Terra+Aqua input. Whole-year holdouts cover 2013–2025. At 4 km, Terra+Aqua daily MAE against the observed union falls from 12.95 to 7.15 cells, a 44.8% reduction, with improvement in all 13 test years. The result also persists under the published outage exclusion and backward-transfer checks.

Read [the full report](analysis/CALIBRATION_REPORT.md) and [all candidate results](analysis/calibration-results.json). Smaller-region and affine candidates are included, including cases that performed worse. This is internal agreement validation. It does not establish ground-truth fire accuracy or prove transfer before 2012.

Historical estimates use Terra-only inputs for 2001–2002 and Terra+Aqua for 2003–2011. Error ranges are empirical held-out residual ranges, not guaranteed intervals. The adjustment applies only to the fixed full study window, not custom rectangles. No individual hotspot coordinates are estimated.

## Verify and publish

Node.js 20.11+ is used only for the verification script.

```sh
node tests/verify.mjs
python3 scripts/render_docs.py
python3 scripts/package_pages.py
```

The root HTML entry points use the files under `dist/`. GitHub Pages serves the repository's main branch and root directory. Commit the root entry points, `dist/`, `scripts/`, `tests/` and documentation together. The `.nojekyll` file keeps static assets unchanged.

The checks reconcile the original Dixie benchmark with raw source exports, verify range dates and leap years, reproduce 93/109 scale-stable flagged days, and check all historical estimate bounds and monthly sums. Browser checks cover map controls, range downloads, history modes and slide navigation.

## Known limits

Positive-detection files do not contain local clear-sky coverage masks. No retained observations does not mean no fire. The 2012 VIIRS archive starts partway through January. Clouds, sampling, outages and changes in processing remain sources of uncertainty. Study rectangles do not assign every hotspot to a named incident. Active-cell days are neither separate fire incidents nor burned area. The app does not forecast fires.

The next scientific steps are observation-coverage masks, independent evaluation and calibration for new regions. Adding a current-year feed would require a visible cutoff and a clear distinction between archive and near-real-time products.

## Sources and AI use

Data courtesy of NASA/LANCE FIRMS. ChatGPT/Codex assisted with prototype code, interface text, analysis and tests. All observed detections come from NASA files. Modeled aggregate values are labeled separately.

- [NASA FIRMS annual country archive](https://firms.modaps.eosdis.nasa.gov/data/country/)
- [NASA CSV field definitions](https://firms.modaps.eosdis.nasa.gov/data/country/AttributesReadme.txt)
- [Official challenge brief](https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/)
- [NASA Suomi NPP outage history](https://modaps.modaps.eosdis.nasa.gov/services/production/outages_suomi_npp.html)
- [MODIS fire user guide](https://landweb.modaps.eosdis.nasa.gov/data/userguide/MODIS_C6_Fire_User_Guide_C.pdf)
- [State outlines via PublicaMundi Mapping API examples](https://github.com/PublicaMundi/MappingAPI/blob/master/data/geojson/us-states.json)
