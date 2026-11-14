# Ember Ledger

Challenge: Harmonization of MODIS and VIIRS Hot Spots

Author: Kumar Abhinav

## Project summary

Ember Ledger is a historical fire-activity calendar built from NASA MODIS and VIIRS observations. It helps land managers compare years and seasons without treating every satellite detection as a separate fire. The atlas covers 2001–2025 in Northern California and nearby areas, with a shared grid, sensor-agreement map, year-by-month heatmap and date-range downloads. A separate experimental view adjusts older MODIS totals to the combined-observation scale for the full study region. Its 4 km model reduced daily count error by 44.8% across 13 held-out years; this measures agreement within the archive, not ground-truth fire accuracy. Estimated values are labeled and kept separate from mapped observations. For the Dixie Fire study area on August 5, 2021, 999 MODIS and 3,755 VIIRS detections occupy 98 shared-grid cells, including 76 seen by both sensors. The project makes the data, methods, source code and limitations available for review.

## Project details

THE PROBLEM
MODIS provides a long fire record, while VIIRS sees smaller features and follows different observation schedules. Joining their raw counts can confuse a change in sensors with a change in burning activity. Ember Ledger helps land managers and researchers inspect that difference.

WHAT I BUILT
The atlas uses 1,086,752 retained NASA FIRMS observations from 2001–2025 in Northern California and nearby areas. MODIS covers the full period; VIIRS Suomi NPP begins in 2012. A Python pipeline retains presumed vegetation-fire observations, applies each product's confidence filter and assigns detections to a shared equal-area grid. Each cell contributes once per UTC day. Users can compare 2, 4 and 8 km grids, inspect MODIS-only, VIIRS-only and shared cells, draw an area or enter coordinates, and zoom into the map.

The year-by-month heatmap shows active-cell days, the sum of daily occupied-cell counts. The daily calendar compares a selected date with the same calendar date plus or minus seven days across reference years 2017–2024, excluding the selected year. It flags counts above the nearest-rank 95th percentile. The reference is retrospective; MODIS-only years do not receive these cross-sensor flags.

HISTORICAL ADJUSTMENT
A separate experimental view estimates 2001–2011 aggregate activity for the full study window. Seasonal multipliers relate MODIS cell counts to the observed MODIS–VIIRS union. Terra-only inputs are used for 2001–2002, and Terra+Aqua for 2003–2011. Models are tested by leaving out each complete year from 2013–2025. At 4 km, mean absolute error against the observed union falls from 12.95 to 7.15 cells per day, a 44.8% reduction, with improvement in all 13 held-out years. Outage exclusion and a backward-transfer check also retain the improvement. Smaller-area results were less consistent, so the adjustment is restricted to the full region.

Estimated months are labeled and include empirical error ranges. No estimated hotspot locations are inserted into the map or source downloads. The test measures internal agreement because input and reference share MODIS observations. Transfer to years before VIIRS remains an assumption.

EVIDENCE AND DOWNLOADS
The original Dixie example remains reproducible: August 5, 2021 has 999 MODIS detections, 3,755 VIIRS detections, 98 union cells and 76 shared cells at 4 km. Its seasonal reference is 15 cells from 105 comparison days. In the original 984-day July–October 2017–2024 test, 109 days were flagged at some grid size; 93 were flagged at all three and 16 depended on the grid. This measures scale sensitivity, not detection accuracy.

A selected date range can be exported as daily analysis, retained NASA observations with original coordinates and timestamps, or an SVG chart. Full-region historical estimates have a separate download. The repository includes the Python pipeline, calibration experiment, candidate results, tests, source hashes and rebuild instructions.

LIMITS AND INTENDED USE
This is historical analysis for comparing recorded burning activity. Clouds, smoke, overpass timing, processing changes and outages affect detections. An empty cell can contain fire. Counts do not measure burned area, separate fire incidents or future risk. Study rectangles do not assign each detection to a named incident. The archive ends on December 31, 2025. Coverage masks and independent evaluation are the next steps before extending the adjustment to new regions.

Built with Python, HTML, CSS and JavaScript. Codex was used to analyse source code as well as for the web interface. This study uses satellite data from NASA/LANCE FIRMS.

## Links

- Project: https://abhinav0905.github.io/ember-ledger/
- Six-slide demonstration: https://abhinav0905.github.io/ember-ledger/pitch.html
- Source: https://github.com/Abhinav0905/ember-ledger
- Validation: https://abhinav0905.github.io/ember-ledger/validation.html

This text is for the saved project draft. Final submission for judging remains a separate user decision.
