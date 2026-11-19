"""Flask app for the “violence on the margins of protests” dashboard.

Run:           python app.py      then open http://127.0.0.1:5000
Prerequisite:  scripts/process_data.py must have been run; it writes protests_dashboard.json at the project root.

Routes
  /               the page (templates/index.html)
  /api/data       the JSON prepared by process_data.py (feeds the charts and the table)
  /api/summary    indicators and correlations computed here, for a given country and threshold
  /api/context    crosses the countries with a World Bank API indicator
"""
import json
import math
import os
import time

import pandas as pd
import requests
from flask import Flask, jsonify, render_template, request

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_JSON = os.path.join(BASE, 'protests_dashboard.json')
THRESHOLDS = [0, 20, 50, 100, 200, 500]          # thresholds of the robustness table

WB_URL = 'https://api.worldbank.org/v2'
WB_CACHE_SECONDS = 24 * 3600                      # annual indicators rarely change
WB_CHUNK = 25                                     # countries per request (keeps the URL short)

# Indicators offered in the “context” form: World Bank code -> label
INDICATORS = {
    'NY.GDP.PCAP.PP.CD': 'GDP per capita (PPP, current international $)',
    'SI.POV.GINI': 'Gini index (0 = perfect equality, 100 = maximum inequality)',
    'SL.UEM.TOTL.ZS': 'Unemployment (% of the labour force)',
}

# ACLED country names -> ISO 3 code used by the World Bank API
ISO3 = {
    'Germany': 'DEU', 'Netherlands': 'NLD', 'Sweden': 'SWE', 'Denmark': 'DNK', 'Norway': 'NOR',
    'Finland': 'FIN', 'Switzerland': 'CHE', 'Austria': 'AUT', 'Belgium': 'BEL', 'Ireland': 'IRL',
    'United Kingdom': 'GBR', 'Luxembourg': 'LUX', 'Iceland': 'ISL',
    'France': 'FRA', 'Italy': 'ITA', 'Spain': 'ESP', 'Greece': 'GRC', 'Portugal': 'PRT',
    'Turkey': 'TUR', 'Türkiye': 'TUR', 'Cyprus': 'CYP', 'Malta': 'MLT',
    'Poland': 'POL', 'Hungary': 'HUN', 'Romania': 'ROU', 'Bulgaria': 'BGR', 'Czechia': 'CZE',
    'Czech Republic': 'CZE', 'Slovakia': 'SVK', 'Serbia': 'SRB', 'Croatia': 'HRV', 'Slovenia': 'SVN',
    'Bosnia and Herzegovina': 'BIH', 'North Macedonia': 'MKD', 'Albania': 'ALB', 'Montenegro': 'MNE',
    'Kosovo': 'XKX', 'Georgia': 'GEO', 'Lithuania': 'LTU', 'Latvia': 'LVA', 'Estonia': 'EST',
    'Ukraine': 'UKR', 'Russia': 'RUS', 'Belarus': 'BLR', 'Moldova': 'MDA',
}

app = Flask(__name__)


class ApiError(Exception):
    """Error returned to the browser as {"error": "..."} with an HTTP status code."""
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message, self.status = message, status


@app.errorhandler(ApiError)
def handle_api_error(e):
    return jsonify(error=e.message), e.status


# ---------------------------------------------------------------- prepared ACLED data

_data = {'mtime': None, 'value': None}


def get_data():
    """Reads protests_dashboard.json, and rereads it only if it has been regenerated."""
    try:
        mtime = os.path.getmtime(DATA_JSON)
    except OSError:
        raise ApiError("protests_dashboard.json not found: run scripts/process_data.py.", 503)
    if _data['mtime'] != mtime:
        try:
            with open(DATA_JSON, encoding='utf-8') as f:
                _data.update(mtime=mtime, value=json.load(f))
        except ValueError:
            raise ApiError("protests_dashboard.json is unreadable: rerun scripts/process_data.py.", 503)
    return _data['value']


# ---------------------------------------------------------------- statistics

def num(v):
    """JSON-compatible float: None if the value is missing, NaN or infinite."""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def correlation(x, y):
    """Pearson, Spearman and the 95% CI of Pearson (Fisher transformation)."""
    n = len(x)
    out = {'n': n, 'pearson': None, 'spearman': None, 'ci': None}
    if n < 3:
        return out
    s = pd.DataFrame({'x': x, 'y': y}, dtype=float)
    r = num(s.x.corr(s.y))
    out['pearson'] = r
    out['spearman'] = num(s.x.rank().corr(s.y.rank()))     # Spearman = Pearson on the ranks (avoids depending on scipy)
    if r is not None and n > 3:
        if abs(r) >= 1:
            out['ci'] = [r, r]
        else:
            z, se = math.atanh(r), 1 / math.sqrt(n - 3)
            out['ci'] = [math.tanh(z - 1.96 * se), math.tanh(z + 1.96 * se)]
    return out


def min_events_arg():
    """Minimum number of events received in the URL (?min=50), never negative."""
    return max(0.0, request.args.get('min', 50, type=float))


# ---------------------------------------------------------------- World Bank API

_wb_cache = {}


def worldbank_latest(indicator, iso3_codes):
    """{ISO3 code: (value, year)}: latest available value of the indicator for each country."""
    key = (indicator, tuple(iso3_codes))
    hit = _wb_cache.get(key)
    if hit and time.time() - hit[0] < WB_CACHE_SECONDS:
        return hit[1]

    result = {}
    for i in range(0, len(iso3_codes), WB_CHUNK):
        url = f"{WB_URL}/country/{';'.join(iso3_codes[i:i + WB_CHUNK])}/indicator/{indicator}"
        try:
            resp = requests.get(url, params={'format': 'json', 'mrnev': 1, 'per_page': 100}, timeout=10)
            resp.raise_for_status()
            payload = resp.json()
        except (requests.RequestException, ValueError) as e:
            raise ApiError(f"World Bank API unreachable or unreadable ({type(e).__name__}). "
                           "Please try again in a moment.", 502)
        # Normal response: [pagination metadata, [records]]
        if not isinstance(payload, list) or len(payload) < 2:
            raise ApiError("Unexpected response from the World Bank API (indicator or country code rejected?).", 502)
        for rec in payload[1] or []:
            value, code, year = num(rec.get('value')), rec.get('countryiso3code'), str(rec.get('date') or '')
            if value is None or not code:
                continue
            if code not in result or year > result[code][1]:      # keep the most recent year
                result[code] = (value, year)

    _wb_cache[key] = (time.time(), result)
    return result


# ---------------------------------------------------------------- routes

@app.get('/')
def index():
    return render_template('index.html')


@app.get('/api/data')
def api_data():
    return jsonify(get_data())


@app.get('/api/summary')
def api_summary():
    """Filters form: ?country=ALL|<country>&min=<threshold>."""
    countries = get_data()['countries']
    country = request.args.get('country', 'ALL')
    min_events = min_events_arg()

    if country == 'ALL':
        scope = countries
    else:
        scope = [c for c in countries if c['country'] == country]
        if not scope:
            raise ApiError(f"Unknown country: {country}", 404)

    total = sum(c['total'] for c in scope)

    def share(*keys):                       # share (in %) of the events in scope
        return 100 * sum(c[k] for c in scope for k in keys) / total if total else 0.0

    def corr_for(threshold):                # repression / violence correlation across countries ≥ threshold
        kept = [c for c in countries if c['total'] >= threshold]
        return correlation([c['intervention_rate'] for c in kept], [c['violence_rate'] for c in kept])

    return jsonify(
        scope='Europe' if country == 'ALL' else country,
        kpis={'peaceful': share('peaceful'), 'repression': share('intervention', 'excessive'),
              'violence': share('violent')},
        correlation=corr_for(min_events),
        robustness=[{'threshold': t, 'current': t == min_events, **corr_for(t)} for t in THRESHOLDS],
    )


@app.get('/api/context')
def api_context():
    """“Context” form: ?indicator=<World Bank code>&min=<threshold>."""
    indicator = request.args.get('indicator', '')
    if indicator not in INDICATORS:
        raise ApiError('Unknown indicator.', 400)

    kept = [c for c in get_data()['countries'] if c['total'] >= min_events_arg()]
    codes = sorted({ISO3[c['country']] for c in kept if c['country'] in ISO3})
    values = worldbank_latest(indicator, codes) if codes else {}

    rows, missing = [], []
    for c in kept:
        found = values.get(ISO3.get(c['country']))
        if found is None:
            missing.append(c['country'])
            continue
        rows.append({'country': c['country'], 'family': c['family'], 'value': found[0], 'year': found[1],
                     'intervention_rate': c['intervention_rate'], 'violence_rate': c['violence_rate']})
    rows.sort(key=lambda r: r['value'], reverse=True)

    values_list = [r['value'] for r in rows]
    return jsonify(
        indicator={'id': indicator, 'label': INDICATORS[indicator]},
        n=len(rows),
        rows=rows,
        missing=missing,
        with_violence=correlation(values_list, [r['violence_rate'] for r in rows]),
        with_repression=correlation(values_list, [r['intervention_rate'] for r in rows]),
        source='World Bank, API v2 (api.worldbank.org)',
    )


if __name__ == '__main__':
    app.run(debug=True)       # debug=True: for local development only
