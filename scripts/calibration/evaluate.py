"""Evaluate overlap-period count adjustment using whole-year holdouts.

This evaluates agreement with an observed cell union, not fire-detection truth.
No model is selected or deployed automatically. Results include failed years.
"""
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.optimize import nnls

def fit(x, y, method):
    if method == 'multiplier':
        denom = float(np.dot(x, x))
        return np.array([max(1.0, float(np.dot(x, y)) / denom) if denom else 1.0, 0.0])
    residual = np.maximum(0, y - x)
    extra, intercept = nnls(np.column_stack((x, np.ones(len(x)))), residual)[0]
    return np.array([1.0 + extra, intercept])


def train(x, y, season, method):
    global_coef = fit(x, y, method)
    coefficients = {}
    for q in range(1, 5):
        take = season == q
        coef = fit(x[take], y[take], method)
        # Stabilize sparse seasons without learning from held-out outcomes.
        n_active = int(np.count_nonzero(x[take]))
        weight = n_active / (n_active + 30)
        coefficients[q] = weight * coef + (1 - weight) * global_coef
    return coefficients


def metrics(y, p):
    diff = p - y
    return {'mae': float(np.mean(np.abs(diff))),
            'rmse': float(np.sqrt(np.mean(diff ** 2))),
            'bias': float(np.mean(diff)),
            'observedMean': float(np.mean(y))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path, help='Directory containing daily-counts.csv')
    ROOT = parser.parse_args().directory
    frame = pd.read_csv(ROOT / 'daily-counts.csv', parse_dates=['date'])
    all_dates = pd.date_range('2013-01-01', '2025-12-31')
    results = []
    predictions = []
    for (region, km), part in frame.groupby(['region', 'grid_km']):
        part = part.set_index('date').reindex(all_dates).fillna(0)
        year = part.index.year.to_numpy()
        season = part.index.quarter.to_numpy()
        y = part['union'].to_numpy(float)
        for sensor in ['modis', 'terra']:
            x = part[sensor].to_numpy(float)
            baseline = metrics(y, x)
            for method in ['multiplier', 'affine']:
                p = np.zeros(len(x))
                folds = []
                for holdout in sorted(set(year)):
                    test = year == holdout
                    coefs = train(x[~test], y[~test], season[~test], method)
                    for q in range(1, 5):
                        take = test & (season == q)
                        a, b = coefs[q]
                        p[take] = a * x[take] + b
                    folds.append({'year': int(holdout),
                                  'baseline': metrics(y[test], x[test]),
                                  'model': metrics(y[test], p[test])})
                fitted = train(x, y, season, method)
                predicted = metrics(y, p)
                result = {'region': region, 'gridKm': int(km), 'sensor': sensor,
                          'method': method, 'baseline': baseline, 'model': predicted,
                          'maeImprovementPct': 100 * (1 - predicted['mae'] / baseline['mae']) if baseline['mae'] else None,
                          'yearsImprovedMAE': sum(f['model']['mae'] < f['baseline']['mae'] for f in folds),
                          'yearsTotal': len(folds), 'folds': folds,
                          'fittedSeasonalCoefficients': {str(q): v.tolist() for q, v in fitted.items()},
                          'trainingMaxInput': float(x.max()),
                          'absoluteErrorQuantiles': {str(q): float(np.quantile(np.abs(p - y), q)) for q in [.5, .9, .95]},
                          'signedErrorQuantiles': {str(q): float(np.quantile(p - y, q)) for q in [.05, .5, .95]},
                          }
                monthly = pd.DataFrame({'actual': y, 'baseline': x, 'estimate': p}, index=part.index).resample('MS').sum()
                result['monthlyTotals'] = {'baseline': metrics(monthly.actual.to_numpy(), monthly.baseline.to_numpy()),
                                           'model': metrics(monthly.actual.to_numpy(), monthly.estimate.to_numpy())}
                results.append(result)
                if method == 'multiplier':
                    predictions += [{'date': str(d.date()), 'region': region, 'gridKm': int(km),
                                     'sensor': sensor, 'observedUnion': int(o),
                                     'inputCount': int(i), 'heldOutPrediction': round(float(e), 5)}
                                    for d, o, i, e in zip(part.index, y, x, p)]
                print(region, km, sensor, method, round(result['maeImprovementPct'], 2), result['yearsImprovedMAE'],
                      'of', result['yearsTotal'], flush=True)
    (ROOT / 'calibration-results.json').write_text(json.dumps({
        'trainingYears': list(range(2013, 2026)),
        'validation': 'Leave one complete calendar year out; all seasons for the held-out year excluded from fitting.',
        'target': 'Observed MODIS + Suomi NPP daily active-cell union under the original filters.',
        'limitations': [
            'Validation establishes agreement with the observed union, not actual fire occurrence or burned area.',
            'No true reference is available before the VIIRS record; backcasts remain unvalidated estimates.',
            'Cloud and sampling coverage are unavailable in positive-detection CSV files.',
            'Error quantiles are descriptive held-out residuals, not guaranteed prediction intervals.',
            'Models are region- and grid-specific and are not transferable to arbitrary map selections.',
            'Candidate methods and all held-out years are reported; no outcome-based model selection is hidden.'
        ], 'results': results}, indent=2))
    pd.DataFrame(predictions).to_csv(ROOT / 'held-out-predictions.csv', index=False)


if __name__ == '__main__':
    main()
