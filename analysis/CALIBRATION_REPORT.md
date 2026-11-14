# Experimental full-window count calibration

This experiment asks a limited question. Can MODIS counts estimate the daily cell union that MODIS and Suomi NPP observed during their overlap? It does not estimate burned area, locate missing fires or establish ground-truth accuracy.

The study window is 125°W–117.7°W, 36.6°N–42.8°N. All calculations use the app's original filters and nested 2, 4 and 8 km equal-area grids.

## Method

For each grid size and predictor (Terra-only MODIS, or Terra+Aqua MODIS), fit four slopes through the origin, one per calendar quarter. A slope is `max(1, sum(x*y)/sum(x*x))`, where x is the daily predictor cell count and y is the observed MODIS+SNPP cell union. Empty denominators use slope 1. Each seasonal slope is shrunk toward the all-season slope with weight `active_input_days / (active_input_days + 30)`. There is no intercept. Zero observations therefore produce a zero point estimate.

Use 2013–2025 for fitting and validation. 2012 is excluded because the SNPP archive starts on January 20. For each of 13 folds, exclude the entire held-out calendar year before estimating any coefficient. Evaluate the resulting daily predictions against that year's observed union. The final backcast uses factors fitted across all 13 overlap years.

## Results

These are errors against the observed cell union. Counts share MODIS inputs with the target, so this is an internal agreement test.

| Grid | Predictor | Unadjusted daily MAE | Adjusted daily MAE | MAE reduction | Monthly-total MAE before → after | Years with lower daily MAE |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2 km | Terra + Aqua | 19.09 | 9.93 | 48.0% | 581.00 → 194.35 | 13/13 |
| 2 km | Terra only | 25.01 | 13.73 | 45.1% | 761.21 → 296.65 | 13/13 |
| 4 km | Terra + Aqua | 12.95 | 7.15 | 44.8% | 394.22 → 136.64 | 13/13 |
| 4 km | Terra only | 16.58 | 10.02 | 39.5% | 504.62 → 220.58 | 13/13 |
| 8 km | Terra + Aqua | 10.11 | 5.86 | 42.0% | 307.60 → 114.13 | 13/13 |
| 8 km | Terra only | 12.71 | 8.14 | 35.9% | 386.75 → 186.69 | 13/13 |

Daily MAE uses all 4,748 dates in the 13-year overlap. Monthly MAE compares sums of daily cell counts, called active-cell days, across 156 months. A repeated active cell on two days contributes two cell-days. Neither quantity is a count of individual fire incidents.

A separate sensitivity check removes 211 UTC dates listed in NASA MODAPS' SNPP outage table, including endpoints of each outage period. It then refits and validates the models using the remaining 4,537 dates. The 4 km Terra+Aqua MAE reduction changes from 44.8% to 45.6%; each of the 13 held-out years still improves. This coarse exclusion is not a local clear-sky observation mask, and it does not account for all MODIS outages.

A further backward-transfer check trains on 2018–2025 and evaluates on 2013–2017. Exact results for each grid and predictor are included in `calibration.json`.

## Backcast and error ranges

Historical modeled counts cover 2001–2011. The 2001–2002 estimates use Terra-only counts because Aqua began observing partway through 2002. Estimates for 2003–2011 use combined Terra+Aqua counts. The 2012–2025 observed series remains separate. No missing observations or locations are fabricated in the map or original-detection exports.

Daily error ranges use the empirical 5th and 95th percentiles of held-out signed daily residuals. Monthly ranges use residuals of whole-month totals, not a sum of daily intervals. Bounds are clipped at zero and expanded if needed to include the point estimate. These are descriptive error ranges, not confidence intervals or guaranteed prediction intervals. The multiplier often underestimates monthly observed activity; the signed residuals and bias are published rather than concealed.

## Limits and rejected alternatives

The key transfer assumption remains unverified: the relationship learned after 2012 may not hold in earlier years. No VIIRS observations exist in that earlier period to check it. Clouds, coverage gaps, varying overpass times and archive processing changes can affect the relationship. A zero input is no assurance that fire was absent.

This model is specific to the full study window. It must not be applied to a custom rectangle or individual mapped cell. Testing the same methods in the smaller Dixie, August Complex and Camp study windows produced weaker results and some failed years. A seasonal affine model was also tested. It slightly improved full-window scores but often worsened scores in the smaller windows, so the simpler multiplier is the exposed experimental model. All 48 candidate combinations and their year-level failures are in `calibration-results.json`.

MODIS archive records contain literal `version` values `6.2`, `6.03` and `61.03`; SNPP records contain `2`. These should not all be labeled as the same product release. The NASA MODIS guide distinguishes a collection from a product version within that collection. Source hashes and literal version fields are retained in the archive manifest.

## Reproduce

Requirements: Python 3.11+, numpy, pandas, scipy and lxml. The main app remains buildless; these dependencies are only for the research experiment.

With the three scripts kept in the same directory, run:

```sh
python -m pip install -r requirements.txt
python extend.py /path/to/annual_csvs /path/to/research_output
python evaluate.py /path/to/research_output
python package_calibration.py /path/to/research_output
```

Before packaging, place the frozen `snpp-outages.html` snapshot beside the generated research outputs. A refreshed snapshot may change the sensitivity result; its retrieval date must be recorded. The archive folder also needs `us-states.json`, as described in the app's main README.

Outputs include the full candidate report, held-out daily predictions, empirical residuals, source counts and hashes, modeled daily and monthly records, and outage sensitivity.

## NASA sources

- [FIRMS archive](https://firms.modaps.eosdis.nasa.gov/download/)
- [Annual CSV attributes](https://firms.modaps.eosdis.nasa.gov/data/country/AttributesReadme.txt)
- [MODAPS Suomi NPP outage history](https://modaps.modaps.eosdis.nasa.gov/services/production/outages_suomi_npp.html), retrieved November 14, 2026
- [MODIS Collection 6 guide, sections 5.5.1–5.5.2](https://landweb.modaps.eosdis.nasa.gov/data/userguide/MODIS_C6_Fire_User_Guide_C.pdf)
- [MODIS fire product description and satellite coverage](https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_MODIS_Firehotspots.html)

Data courtesy of NASA/LANCE FIRMS. ChatGPT/Codex assisted with the analysis code and documentation.
