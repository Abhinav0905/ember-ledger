"""Package the fixed-window seasonal multiplier experiment for the prototype.

Usage: python package_calibration.py RESEARCH_DIRECTORY
Requires numpy, pandas and scipy (also used by evaluate.py).
"""
import argparse
import json
import re
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from evaluate import metrics, train


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    root = args.directory
    findings = json.loads((root / 'calibration-results.json').read_text())
    data = pd.read_csv(root / 'daily-counts.csv', parse_dates=['date'])
    predictions = pd.read_csv(root / 'held-out-predictions.csv', parse_dates=['date'])
    outage_days = set()
    table = pd.read_html(root / 'snpp-outages.html')[0]
    for value in table['Year-Day']:
        endpoints = re.findall(r'(20\d\d)-(\d\d\d)', str(value))
        if not endpoints:
            continue
        start_year, start_doy = map(int, endpoints[0])
        end_year, end_doy = map(int, endpoints[-1])
        day = datetime(start_year, 1, 1) + timedelta(days=start_doy - 1)
        last = datetime(end_year, 1, 1) + timedelta(days=end_doy - 1)
        while day <= last:
            if 2013 <= day.year <= 2025:
                outage_days.add(day.strftime('%Y-%m-%d'))
            day += timedelta(days=1)
    outage_meta = {
        'source': 'https://modaps.modaps.eosdis.nasa.gov/services/production/outages_suomi_npp.html',
        'retrieved': '2026-11-14',
        'method': 'Sensitivity check excludes every UTC calendar date listed in a NASA MODAPS SNPP outage period, including range endpoints. It is conservative and not an AOI-specific observation mask.',
        'excludedDays': sorted(outage_days),
    }
    (root / 'snpp-outage-days.json').write_text(json.dumps(outage_meta, indent=2))
    payload = {
        'schemaVersion': 1,
        'scope': {'id': 'all', 'name': 'Northern California study window', 'bounds': [-125, 36.6, -117.7, 42.8]},
        'trainingYears': list(range(2013, 2026)),
        'trainingStart': '2013-01-01', 'trainingEnd': '2025-12-31',
        'historicalStart': '2001-01-01', 'historicalEnd': '2011-12-31',
        'method': 'Seasonal multiplier through the origin. Four calendar-quarter slopes are shrunk toward the all-season slope using active-input-days / (active-input-days + 30). The slope is at least one.',
        'target': 'Daily active-cell union of retained MODIS Terra+Aqua and VIIRS Suomi NPP observations in the fixed study window.',
        'validation': 'Leave one complete year out. All observations from the held-out year are excluded from fitting. Thirteen held-out years, 2013–2025.',
        'bands': 'Descriptive 5th–95th percentile held-out signed residual range, using daily residuals for daily values and whole-month summed residuals for monthly values. Bounds are clipped at zero and include the point estimate. These are empirical error ranges, not confidence intervals or guaranteed prediction intervals.',
        'sourceByYear': {str(y): 'terra' if y <= 2002 else 'modis' for y in range(2001, 2012)},
        'limitations': [
            'Historical estimates assume the overlap-era relationship transfers to earlier years. No VIIRS reference exists before 2012 to validate that assumption.',
            'The target is a count of archived observed active cells, not fire occurrence, burned area or a forecast.',
            'This model is fitted only for the fixed full study window. Do not apply it to custom areas or individual mapped cells.',
            'Only aggregate counts are estimated. The map and raw exports remain satellite observations.',
            'Terra-only observations are used for 2001 and all of 2002 to avoid mixing an incomplete Aqua year into the early backcast.',
            'The reference and predictor share MODIS observations; agreement is an internal consistency test, not independent ground-truth validation.',
            'Zero input produces zero point estimate. That does not establish that no fire occurred.',
            'Clouds, viewing geometry, platform outages and changes in archive processing are not fully corrected. The file contains a separate outage sensitivity check.',
            'The residual range is unconditional over the overlap period and does not guarantee coverage in earlier years or for extreme fire days.',
        ],
        'outageSensitivity': {k: v for k, v in outage_meta.items() if k != 'excludedDays'},
        'grids': {},
    }
    payload['outageSensitivity']['excludedDayCount'] = len(outage_days)
    for km in [2, 4, 8]:
        part = data[(data.region == 'all') & (data.grid_km == km)].set_index('date')
        training = part.reindex(pd.date_range('2013-01-01', '2025-12-31')).fillna(0)
        hist = part.reindex(pd.date_range('2001-01-01', '2011-12-31')).fillna(0)
        grid = {'models': {}, 'daily': [], 'monthly': []}
        for sensor in ['modis', 'terra']:
            result = next(r for r in findings['results'] if r['region'] == 'all' and r['gridKm'] == km and r['sensor'] == sensor and r['method'] == 'multiplier')
            preds = predictions[(predictions.region == 'all') & (predictions.gridKm == km) & (predictions.sensor == sensor)].set_index('date')
            residual = preds['heldOutPrediction'] - preds['observedUnion']
            monthly_residual = residual.resample('MS').sum()
            daily_q = np.quantile(residual.to_numpy(), [.05, .5, .95])
            monthly_q = np.quantile(monthly_residual.to_numpy(), [.05, .5, .95])
            clean = training.loc[~training.index.strftime('%Y-%m-%d').isin(outage_days)]
            x = clean[sensor].to_numpy(float)
            y = clean['union'].to_numpy(float)
            years = clean.index.year.to_numpy()
            quarters = clean.index.quarter.to_numpy()
            p = np.zeros(len(clean))
            improved = 0
            for held in sorted(set(years)):
                test = years == held
                factors = train(x[~test], y[~test], quarters[~test], 'multiplier')
                for quarter in [1, 2, 3, 4]:
                    take = test & (quarters == quarter)
                    p[take] = factors[quarter][0] * x[take]
                improved += int(metrics(y[test], p[test])['mae'] < metrics(y[test], x[test])['mae'])
            clean_baseline, clean_model = metrics(y, x), metrics(y, p)
            # A second temporal split resembles the intended backward transfer:
            # train on the newer era and evaluate on earlier overlap years.
            old = training.index.year < 2018
            tx = training[sensor].to_numpy(float)
            ty = training['union'].to_numpy(float)
            tq = training.index.quarter.to_numpy()
            backward_factors = train(tx[~old], ty[~old], tq[~old], 'multiplier')
            backward_p = np.array([backward_factors[int(q)][0] * value for q, value in zip(tq[old], tx[old])])
            backward_baseline = metrics(ty[old], tx[old])
            backward_model = metrics(ty[old], backward_p)
            grid['models'][sensor] = {
                'seasonalFactors': {q: c[0] for q, c in result['fittedSeasonalCoefficients'].items()},
                'validation': {
                    'sampleDays': len(preds), 'yearsImprovedMAE': result['yearsImprovedMAE'], 'yearsTotal': result['yearsTotal'],
                    'baseline': result['baseline'], 'model': result['model'],
                    'maeImprovementPct': result['maeImprovementPct'], 'monthlyTotals': result['monthlyTotals'],
                },
                'folds': result['folds'],
                'residualQuantilesDaily': dict(zip(['p05', 'p50', 'p95'], map(float, daily_q))),
                'residualQuantilesMonthly': dict(zip(['p05', 'p50', 'p95'], map(float, monthly_q))),
                'trainingMaxInput': result['trainingMaxInput'],
                'outageExcludedSensitivity': {'sampleDays': len(clean), 'yearsImprovedMAE': improved, 'yearsTotal': 13,
                                             'baseline': clean_baseline, 'model': clean_model,
                                             'maeImprovementPct': 100 * (1 - clean_model['mae'] / clean_baseline['mae'])},
                'backwardTransferCheck': {'trainingYears': list(range(2018, 2026)), 'heldOutYears': list(range(2013, 2018)),
                                          'baseline': backward_baseline, 'model': backward_model,
                                          'maeImprovementPct': 100 * (1 - backward_model['mae'] / backward_baseline['mae'])},
            }
        for date, row in hist.iterrows():
            sensor = 'terra' if date.year <= 2002 else 'modis'
            model = grid['models'][sensor]
            x = float(row[sensor])
            estimate = model['seasonalFactors'][str(date.quarter)] * x
            q = model['residualQuantilesDaily']
            grid['daily'].append({
                'date': str(date.date()), 'source': sensor, 'inputCount': int(x),
                'estimate': round(estimate, 4),
                'lower': round(max(0, min(estimate, estimate - q['p95'])), 4),
                'upper': round(max(estimate, estimate - q['p05']), 4),
                'outsideTrainingRange': x > model['trainingMaxInput'],
            })
        daily_frame = pd.DataFrame(grid['daily'])
        daily_frame['date'] = pd.to_datetime(daily_frame['date'])
        for month, month_data in daily_frame.set_index('date').groupby(pd.Grouper(freq='MS')):
            sensor = month_data['source'].iloc[0]
            total = float(month_data['estimate'].sum())
            q = grid['models'][sensor]['residualQuantilesMonthly']
            grid['monthly'].append({
                'year': int(month.year), 'month': int(month.month), 'source': sensor,
                'inputCellDays': int(month_data['inputCount'].sum()), 'estimate': round(total, 4),
                'lower': round(max(0, min(total, total - q['p95'])), 4),
                'upper': round(max(total, total - q['p05']), 4),
                'outsideTrainingRange': bool(month_data['outsideTrainingRange'].any()),
            })
        payload['grids'][str(km)] = grid
    (root / 'calibration.json').write_text(json.dumps(payload, separators=(',', ':')))
    for km, grid in payload['grids'].items():
        for sensor, model in grid['models'].items():
            print(km, sensor, 'all-day MAE improvement', round(model['validation']['maeImprovementPct'], 3),
                  'outage-excluded', round(model['outageExcludedSensitivity']['maeImprovementPct'], 3),
                  model['outageExcludedSensitivity']['sampleDays'], flush=True)
    print('Wrote calibration.json', (root / 'calibration.json').stat().st_size, flush=True)


if __name__ == '__main__':
    main()
