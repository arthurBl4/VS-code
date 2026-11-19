const FAM = { 'Négociée': '#0f766e', 'Confrontationnelle': '#be123c', 'Est & Balkans': '#4f46e5', 'Non classé': '#94a3b8' };
// The JSON produced by process_data.py keeps French category names; these maps translate them for display only.
const FAM_EN = { 'Négociée': 'Negotiated', 'Confrontationnelle': 'Confrontational', 'Est & Balkans': 'Eastern Europe & Balkans', 'Non classé': 'Unclassified' };
const THEME_EN = { 'Social & retraites': 'Labour & pensions', 'Climat & environnement': 'Climate & environment', 'Palestine / Gaza': 'Palestine / Gaza',
  'Guerre en Ukraine': 'War in Ukraine', 'Agriculture': 'Agriculture', 'Migration & identité': 'Migration & identity',
  'Démocratie & institutions': 'Democracy & institutions', 'Autre': 'Other' };
const VAR_EN = { 'Pays': 'Country', "Tradition de maintien de l'ordre (famille)": 'Policing tradition (family)', 'Mois': 'Month',
  'Revendication': 'Claim', 'Pays + revendication': 'Country + claim' };
const en = (map, k) => map[k] || k;
const COLS = [['country','Country'],['family','Tradition'],['total','Total'],['peaceful','Peaceful'],['intervention','Interventions'],
  ['excessive','Excessive force'],['violent','Violent'],['intervention_rate','Repression %'],['violence_rate','Violence %']];
let D, charts = {}, S = { country: 'ALL', min: 50, sort: 'total', q: '', tk: 'total', asc: false }, reqId = 0;

// $ no longer crashes if an element is missing from the HTML: it warns in the console and returns a dummy object.
const missing = new Set();
const $ = id => {
  const e = document.getElementById(id);
  if (e) return e;
  if (!missing.has(id)) { missing.add(id); console.warn(`HTML element not found: #${id}`); }
  return { classList: { add() {}, remove() {} }, style: {}, dataset: {}, add() {}, querySelectorAll: () => [] };
};
const f1 = x => x.toFixed(1);
const f2 = x => x == null ? '–' : x.toFixed(2);                  // null (calculation impossible) -> dash
const pct = (a, b) => b ? a / b * 100 : 0;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mk = (id, cfg) => { charts[id]?.destroy(); charts[id] = new Chart($(id), cfg); };

// Each rendering step is isolated: if one fails, the others still display.
const failed = [];
function safe(name, fn) {
  try { fn(); } catch (e) { console.error(`[${name}]`, e); failed.push(`${name} : ${e.message}`); }
}
function safeAsync(name, fn) {                                    // same principle for server calls
  fn().catch(e => { console.error(`[${name}]`, e); failed.push(`${name} : ${e.message}`); showFailures(); });
}
function showFailures() {
  let b = document.getElementById('renderErrors');
  if (!failed.length) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('div');
    b.id = 'renderErrors';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:50;background:#fef2f2;color:#7f1d1d;font:13px system-ui,sans-serif;padding:8px 14px;border-bottom:1px solid #fecaca';
    document.body.prepend(b);
  }
  b.textContent = "Display error (details in the console): " + failed.join(' | ');
}

// Data now comes from the Flask server (/api/data route), not from a file read directly.
async function load() {
  const r = await fetch('/api/data');
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status} on /api/data`);
  return body;
}

load().then(d => { D = d; D.countries.sort((a, b) => b.total - a.total); init(); safe('effects', setupDynamicEffects); showFailures(); })
  .catch(e => { console.error(e); $('err').classList.remove('hidden'); $('errDetail').textContent = e.message; });

function init() {
  [...D.countries].sort((a, b) => a.country.localeCompare(b.country))
    .forEach(c => $('countrySelect').add(new Option(c.country, c.country)));
  $('thead').innerHTML = COLS.map(([k, l]) =>
    `<th data-k="${k}" class="py-3 px-4 font-semibold cursor-pointer hover:text-slate-900 ${k === 'country' || k === 'family' ? '' : 'text-right'}">${l} ↕</th>`).join('');
  $('thead').querySelectorAll('th').forEach(th => th.onclick = () => {
    const k = th.dataset.k; S.asc = S.tk === k ? !S.asc : false; S.tk = k; safe('table', table); showFailures();
  });
  $('filters').onsubmit = e => { e.preventDefault(); render(); };   // Enter in the form: no page reload
  $('countrySelect').onchange = e => { S.country = e.target.value; render(); };

  $('sortSelect').onchange = e => {
    S.sort = e.target.value;
    S.tk = S.sort;
    failed.length = 0; safe('bars', bars); safe('table', table); showFailures();
  };

  $('minRange').oninput = e => { S.min = +e.target.value; $('minVal').textContent = S.min; render(); };
  $('searchInput').oninput = e => { S.q = e.target.value.toLowerCase(); failed.length = 0; safe('table', table); showFailures(); };
  $('resetBtn').onclick = () => {
    S = { country: 'ALL', min: 50, sort: 'total', q: '', tk: 'total', asc: false };
    $('countrySelect').value = 'ALL'; $('sortSelect').value = 'total'; $('minRange').value = 50;
    $('minVal').textContent = 50; $('searchInput').value = ''; render();
  };
  $('contextForm').onsubmit = loadContext;

  // Charts created inside the collapsed block have no size: resize them when it opens.
  document.getElementById('complements')?.addEventListener('toggle', () => Object.values(charts).forEach(c => c.resize()));
  render();
}

// Interactive effect: protesters and police move closer on scroll
function setupDynamicEffects() {
  window.addEventListener('scroll', () => {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const progress = docHeight > 0 ? Math.min(scrollTop / docHeight, 1) : 0;

    const fill = document.getElementById('tensionFill');
    if (fill) fill.style.width = (progress * 100) + '%';

    const maxShift = Math.min(window.innerWidth * 0.22, 220);
    const shift = progress * maxShift;

    const protesters = document.getElementById('protestersGroup');
    const police = document.getElementById('policeGroup');
    const statusText = document.getElementById('scrollStatusText');

    if (protesters) protesters.style.transform = `translateX(${shift}px)`;
    if (police) police.style.transform = `translateX(-${shift}px)`;

    if (statusText) {
      if (progress < 0.2) statusText.textContent = "Peaceful gathering";
      else if (progress < 0.6) statusText.textContent = "Deployment and face-off";
      else if (progress < 0.9) statusText.textContent = "Flashpoint / Escalation";
      else statusText.textContent = "Methodological summary";
    }
  });
}

const kept = () => D.countries.filter(c => c.total >= S.min);

function render() {
  failed.length = 0;
  [['scatter', scatter], ['bars', bars], ['monthly', monthly], ['variance', variance],
   ['heat', heat], ['table', table]].forEach(([n, f]) => safe(n, f));
  safeAsync('summary', summary);                                   // indicators and correlations: computed by Flask
  showFailures();
}

// Filters form -> /api/summary route: KPIs, correlation and robustness table computed server-side.
async function summary() {
  const id = ++reqId;
  const r = await fetch('/api/summary?' + new URLSearchParams({ country: S.country, min: S.min }));
  const j = await r.json();
  if (id !== reqId) return;                                       // a more recent request has been sent: ignore this one
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status} on /api/summary`);

  $('badge').textContent = j.scope;
  $('kP').textContent = f1(j.kpis.peaceful) + '%';
  $('kR').textContent = f1(j.kpis.repression) + '%';
  $('kV').textContent = f1(j.kpis.violence) + '%';
  safe('scene', () => { window.__psRatio = j.kpis.repression / 30; window.ProtestScene?.setIntensity(window.__psRatio); });

  const c = j.correlation, ci = c.ci || [null, null];
  $('kC').innerHTML = c.pearson == null ? '–' :
    `r = ${f2(c.pearson)} <span class="text-xs font-normal text-slate-500 block mt-1">(ρ = ${f2(c.spearman)}, N = ${c.n}, 95% CI [${f2(ci[0])}, ${f2(ci[1])}])</span>`;
  $('scatterNote').textContent = c.pearson == null ? '' :
    `Across ${c.n} countries (threshold ≥ ${S.min}), the Pearson correlation is ${f2(c.pearson)} (Spearman ρ = ${f2(c.spearman)}, 95% CI [${f2(ci[0])}, ${f2(ci[1])}]). It does not establish direct causality.`;

  robustness(j.robustness);
}

function robustness(rows) {
  const tbody = document.getElementById('robustnessBody');
  if (!tbody) return;
  tbody.innerHTML = rows.map(x => {
    if (x.n < 3) {
      return `<tr><th class="p-2 border-b">${x.threshold}</th><td class="p-2 border-b">${x.n}</td><td colspan="3" class="p-2 border-b text-slate-400">Sample too small (N &lt; 3)</td></tr>`;
    }
    const ci = x.ci || [null, null];
    return `<tr class="${x.current ? 'bg-red-50 font-semibold text-[#731f1f]' : ''}">
      <th class="p-2 border-b">${x.threshold} ${x.current ? '(current)' : ''}</th>
      <td class="p-2 border-b">${x.n}</td>
      <td class="p-2 border-b">${f2(x.pearson)}</td>
      <td class="p-2 border-b">[${f2(ci[0])}, ${f2(ci[1])}]</td>
      <td class="p-2 border-b">${f2(x.spearman)}</td>
    </tr>`;
  }).join('');
}

// “Context” form -> /api/context route, which queries the World Bank API.
async function loadContext(ev) {
  ev.preventDefault();
  const status = $('contextStatus'), out = $('contextResult');
  status.textContent = "Querying the World Bank API…";
  out.innerHTML = '';
  try {
    const r = await fetch('/api/context?' + new URLSearchParams({ indicator: $('indicatorSelect').value, min: S.min }));
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status} on /api/context`);

    const nf = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
    const v = j.with_violence, p = j.with_repression;
    status.textContent = '';
    if (j.n < 3) {
      out.innerHTML = `<p class="text-sm">Only ${j.n} countries have a value: not enough to compute a correlation. Lower the event threshold.</p>`;
      return;
    }
    out.innerHTML = `
      <p class="text-sm p-4 rounded-lg bg-slate-50 border border-slate-200">
        Across <b>${j.n}</b> countries (threshold ≥ ${S.min} events), the Spearman correlation between <b>${esc(j.indicator.label)}</b>
        and the violence rate is <b>${f2(v.spearman)}</b>, and with the repression rate <b>${f2(p.spearman)}</b>.
        Small sample and simple correlation: it does not establish causality.</p>
      <div class="overflow-x-auto mt-4"><table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-slate-500"><tr>
          <th class="py-2 px-3">Country</th><th class="py-2 px-3 text-right">Value (year)</th>
          <th class="py-2 px-3 text-right">Repression %</th><th class="py-2 px-3 text-right">Violence %</th></tr></thead>
        <tbody class="divide-y divide-slate-100">${j.rows.map(x => `<tr>
          <td class="py-2 px-3 font-semibold">${esc(x.country)}</td>
          <td class="py-2 px-3 text-right">${nf(x.value)} <span class="text-slate-400">(${esc(x.year)})</span></td>
          <td class="py-2 px-3 text-right">${f1(x.intervention_rate)}%</td>
          <td class="py-2 px-3 text-right">${f1(x.violence_rate)}%</td></tr>`).join('')}</tbody></table></div>
      <p class="text-xs text-slate-500 mt-3">Source: ${esc(j.source)}. Latest available year for each country, so it varies from one country to another.${
        j.missing.length ? ` No value: ${j.missing.map(esc).join(', ')}.` : ''}</p>`;
  } catch (e) {
    console.error('[context]', e);
    status.textContent = 'Error: ' + e.message;
  }
}

function scatter() {
  const sel = c => c.country === S.country;
  mk('scatter', {
    type: 'bubble',
    data: { datasets: Object.keys(FAM).map(f => ({
      label: en(FAM_EN, f), backgroundColor: FAM[f] + '99',
      borderColor: ctx => ctx.raw && sel(ctx.raw.c) ? '#0f172a' : FAM[f],
      borderWidth: ctx => ctx.raw && sel(ctx.raw.c) ? 3 : 1,
      data: kept().filter(c => c.family === f).map(c => ({ x: c.intervention_rate, y: c.violence_rate, r: Math.max(4, Math.sqrt(c.total) / 2.2), c })) })) },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { x: { title: { display: true, text: 'Police repression rate (%)' }, beginAtZero: true },
                y: { title: { display: true, text: 'Violent demonstration rate (%)' }, beginAtZero: true } },
      plugins: { tooltip: { callbacks: { label: ctx => { const c = ctx.raw.c;
        return `${c.country}: repression ${f1(c.intervention_rate)}%, violence ${f1(c.violence_rate)}%, ${Math.round(c.total)} events`; } } } } }
  });
}

function bars() {
  const top = [...kept()].sort((a, b) => b[S.sort] - a[S.sort]).slice(0, 12);
  mk('bars', {
    type: 'bar',
    data: { labels: top.map(c => `${c.country} (${S.sort === 'total' ? Math.round(c.total) + ' events' : f1(c[S.sort]) + '%'})`), datasets: [
      { label: 'Repression (%)', data: top.map(c => c.intervention_rate), backgroundColor: '#d97706', borderRadius: 4 },
      { label: 'Violence (%)', data: top.map(c => c.violence_rate), backgroundColor: '#be123c', borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { beginAtZero: true } } }
  });
}

function monthly() {
  const months = [...new Set(D.monthly.map(m => m.month))].sort();
  $('monthlyNote').textContent = !months.length
    ? "No monthly data in the JSON: rerun the latest version of process_data.py."
    : months.length === 1 ? "Only one period detected: the CSV has no usable date column (event_date, week or date)." : '';
  mk('monthly', {
    type: 'line',
    data: { labels: months, datasets: Object.keys(FAM).map(f => ({
      label: en(FAM_EN, f), borderColor: FAM[f], backgroundColor: FAM[f], tension: .25, pointRadius: 2, spanGaps: true,
      data: months.map(mo => { const r = D.monthly.find(m => m.month === mo && m.family === f); return r && r.total ? pct(r.violent, r.total) : null; }) })) },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: 'Violence rate (%)' } } } }
  });
}

function variance() {
  const v = D.variance, max = Math.max(...v.map(x => x.eta2), .01);
  $('variance').innerHTML = v.map(x => `<div><div class="flex justify-between text-sm"><span>${en(VAR_EN, x.label)}</span><b>${f1(x.eta2 * 100)}%</b></div>
    <div class="h-3 bg-slate-100 rounded"><div class="h-3 rounded bg-[#731f1f]" style="width:${(x.eta2 / max) * 100}%"></div></div></div>`).join('');
  const e = k => v.find(x => x.label.startsWith(k))?.eta2;
  const pays = e('Pays'), th = e('Revendication'), both = e('Pays +');
  $('verdict').innerHTML = th == null
    ? `Country alone explains <b>${f1(pays * 100)}%</b> of the variance. Claims are not available in the export used: add an event-level export with the <code>notes</code> column to test H1.`
    : `Country explains <b>${f1(pays * 100)}%</b> of the variance, the claim alone <b>${f1(th * 100)}%</b>. Knowing the claim in addition to the country adds <b>${f1((both - pays) * 100)} point(s)</b>. `
      + (pays > 2 * th ? 'National traditions (H2) weigh clearly more than the nature of the demands (H1).'
        : th > 2 * pays ? 'The nature of the demands (H1) weighs clearly more than the country (H2).' : 'Both factors carry comparable weight.');
}

function heat() {
  if (!D.themes.length) { $('heat').innerHTML = `<p class="text-sm text-slate-500">This chart needs the claims. ACLED’s aggregated export does not contain them: download the event-level export (<code>notes</code> column), then rerun <code>process_data.py</code>.</p>`; return; }
  const cs = D.countries.filter(c => D.themes.some(t => t.country === c.country)).slice(0, 12);
  const ths = [...new Set(D.themes.map(t => t.theme))];
  const cell = (th, c) => { const t = D.themes.find(x => x.theme === th && x.country === c);
    if (!t || t.n < 20) return '<td class="bg-slate-100 text-slate-400">n&lt;20</td>';
    const r = pct(t.v, t.n); return `<td style="background:rgba(115,31,31,${Math.min(r / 40, 1)});color:${r > 22 ? '#fff' : '#1e293b'}" title="${Math.round(t.n)} events">${f1(r)}</td>`; };
  $('heat').innerHTML = `<table class="hm"><thead><tr><th></th>${cs.map(c => `<th class="font-medium text-xs">${c.country}</th>`).join('')}</tr></thead>
    <tbody>${ths.map(th => `<tr><th class="text-left text-xs pr-3 whitespace-nowrap font-medium">${en(THEME_EN, th)}</th>${cs.map(c => cell(th, c.country)).join('')}</tr>`).join('')}</tbody></table>
    <p class="text-xs text-slate-500 mt-3">Violence rate in %. Greyed cells: fewer than 20 events.</p>`;
}

function table() {
  const scope = S.country === 'ALL' ? D.countries : D.countries.filter(c => c.country === S.country);
  const rows = scope.filter(c => c.country.toLowerCase().includes(S.q))
    .sort((a, b) => { const x = a[S.tk], y = b[S.tk];
      const d = typeof x === 'string' ? x.localeCompare(y) : x - y; return S.asc ? d : -d; });
  $('tbody').innerHTML = rows.length ? rows.map(c => `<tr class="hover:bg-slate-50">
    <td class="py-3 px-4 font-semibold">${c.country}</td>
    <td class="py-3 px-4"><span class="inline-block w-2.5 h-2.5 rounded-full mr-2" style="background:${FAM[c.family]}"></span>${en(FAM_EN, c.family)}</td>
    ${['total', 'peaceful', 'intervention', 'excessive', 'violent'].map(k => `<td class="py-3 px-4 text-right">${Math.round(c[k])}</td>`).join('')}
    <td class="py-3 px-4 text-right">${f1(c.intervention_rate)}%</td><td class="py-3 px-4 text-right">${f1(c.violence_rate)}%</td></tr>`).join('')
    : '<tr><td colspan="9" class="py-6 text-center text-slate-500">No matching country.</td></tr>';
}

/* =====================================================================
   Animated scene: protesters and police in SVG (self-contained, cannot break the dashboard)
   ===================================================================== */
/* scene.js : manifestants et police dessinés en SVG, sans image.
 * - Seuls : les manifestants agitent pancartes et poings, les policiers oscillent.
 * - Au scroll : les deux groupes avancent l'un vers l'autre (les jambes marchent),
 *   puis les matraques s'abaissent, des nuages de gaz montent, certains manifestants reculent ou tombent.
 * Autonome : crée sa propre bande fixe en bas de page et injecte son CSS.
 * Respecte prefers-reduced-motion (positions au scroll, mais aucune animation en boucle).
 */
(() => {
  const start = () => { try { (() => {
  'use strict';
  if (window.ProtestScene) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PROT = '#731f1f', COP = '#0f172a', GEAR = '#475569';
  const BG = '248,250,252'; // couleur de fond de la page (RGB) pour le dégradé sous les figures

  /* ---------- CSS ---------- */
  const css = `
  body{padding-bottom:150px}
  .ps-root{--h:96px;position:fixed;left:0;right:0;bottom:0;height:calc(var(--h) + 34px);
    pointer-events:none;z-index:30;overflow:hidden;
    background:linear-gradient(to top,rgba(${BG},.95) 30%,rgba(${BG},0))}
  @media (max-width:640px){.ps-root{--h:64px} body{padding-bottom:110px}}
  .ps-ground{position:absolute;left:0;right:0;bottom:7px;height:2px;background:#cbd5e1}
  .ps-cap{position:absolute;right:14px;top:4px;font:600 12px/1 system-ui,sans-serif;color:#475569}
  .ps-group{position:absolute;left:0;bottom:8px;display:flex;align-items:flex-end;gap:8px;will-change:transform}
  .ps-p,.ps-c{height:var(--h);width:calc(var(--h)*46/98)}
  .ps-fig{display:block;width:100%;height:100%;overflow:visible;transform-origin:50% 100%;
    transition:transform .8s cubic-bezier(.3,1.4,.5,1)}

  /* marche : seulement quand la page défile */
  .ps-fig .leg{transform-origin:20px 46px}
  .ps-root[data-moving="1"] .leg.l{animation:ps-step .42s ease-in-out infinite alternate}
  .ps-root[data-moving="1"] .leg.r{animation:ps-step .42s ease-in-out infinite alternate-reverse}
  @keyframes ps-step{from{transform:rotate(-22deg)}to{transform:rotate(22deg)}}

  /* manifestants : bras levé qui s'agite, plus vite pendant l'affrontement */
  .ps-p .arm.r{transform-origin:27px 24px;animation:ps-wave 1.3s ease-in-out infinite alternate;animation-delay:var(--d)}
  .ps-root[data-phase="clash"] .ps-p .arm.r{animation-duration:.3s}
  @keyframes ps-wave{from{transform:rotate(-8deg)}to{transform:rotate(10deg)}}
  .ps-root[data-phase="clash"] .ps-p:nth-child(3n+2) .ps-fig{transform:rotate(-14deg)}
  .ps-root[data-phase="after"] .ps-p.fall .ps-fig{transform:rotate(-80deg)}

  /* police : repos, puis coups de matraque */
  .ps-c .arm.b{transform-origin:27px 25px;animation:ps-idle 2.2s ease-in-out infinite alternate;animation-delay:var(--d)}
  @keyframes ps-idle{from{transform:rotate(8deg)}to{transform:rotate(22deg)}}
  .ps-root[data-phase="clash"] .ps-c .arm.b{animation:ps-baton .6s ease-in infinite;animation-delay:var(--d)}
  @keyframes ps-baton{0%,100%{transform:rotate(15deg)}45%{transform:rotate(-75deg)}}
  .ps-root[data-phase="clash"] .ps-c .ps-fig{transform:rotate(-6deg)}

  /* gaz */
  .ps-gas{position:absolute;bottom:16px;left:50%;width:0;height:0;opacity:0;transition:opacity 1s}
  .ps-root[data-phase="clash"] .ps-gas,.ps-root[data-phase="after"] .ps-gas{opacity:1}
  .ps-gas i{position:absolute;left:-22px;bottom:0;width:44px;height:44px;border-radius:50%;
    background:rgba(100,116,139,.35);filter:blur(7px);opacity:0;
    animation:ps-gas 3.6s ease-out infinite;animation-delay:calc(var(--k)*.6s)}
  @keyframes ps-gas{0%{opacity:0;transform:translate(0,0) scale(.5)}
    20%{opacity:.9}100%{opacity:0;transform:translate(var(--dx),-70px) scale(2.3)}}

  @media (prefers-reduced-motion:reduce){.ps-root *{animation:none!important;transition:none!important}}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- Personnages (viewBox 46 x 98, origine des bras/jambes en unités du viewBox) ---------- */
  const legs = c => `
    <g class="leg l"><rect x="14" y="46" width="6" height="32" rx="3" fill="${c}"/></g>
    <g class="leg r"><rect x="21" y="46" width="6" height="32" rx="3" fill="${c}"/></g>`;

  const protester = i => {
    const fist = i % 3 === 0;
    const raised = fist
      ? `<line x1="27" y1="24" x2="34" y2="6" stroke="${PROT}" stroke-width="5" stroke-linecap="round"/>
         <circle cx="34.5" cy="4" r="3.6" fill="${PROT}"/>`
      : `<line x1="27" y1="24" x2="33" y2="2" stroke="${PROT}" stroke-width="4" stroke-linecap="round"/>
         <rect x="22" y="-12" width="22" height="14" rx="2" fill="#fff" stroke="${PROT}" stroke-width="2"/>
         <line x1="26" y1="-8" x2="40" y2="-8" stroke="${PROT}" stroke-width="2"/>
         <line x1="26" y1="-4" x2="36" y2="-4" stroke="${PROT}" stroke-width="2"/>`;
    return `<svg class="ps-fig" viewBox="0 -14 46 98" aria-hidden="true">
      ${legs(PROT)}
      <rect x="12" y="19" width="16" height="32" rx="7" fill="${PROT}"/>
      <line x1="13" y1="24" x2="9" y2="42" stroke="${PROT}" stroke-width="5" stroke-linecap="round"/>
      <circle cx="20" cy="10" r="7" fill="${PROT}"/>
      <g class="arm r">${raised}</g>
    </svg>`;
  };

  // Policier tourné vers la gauche (vers les manifestants) : bouclier devant, matraque levée
  const cop = () => `<svg class="ps-fig" viewBox="0 -14 46 98" aria-hidden="true">
      ${legs(COP)}
      <rect x="12" y="19" width="16" height="32" rx="7" fill="${COP}"/>
      <circle cx="20" cy="10" r="7" fill="${COP}"/>
      <path d="M12.5 10a7.5 7.5 0 0 1 15 0z" fill="${GEAR}"/>
      <g class="arm b">
        <line x1="27" y1="25" x2="21" y2="8" stroke="${COP}" stroke-width="5" stroke-linecap="round"/>
        <line x1="21" y1="8" x2="11" y2="-10" stroke="${GEAR}" stroke-width="3.5" stroke-linecap="round"/>
      </g>
      <rect x="2" y="24" width="13" height="34" rx="4" fill="${GEAR}" stroke="${COP}" stroke-width="2"/>
    </svg>`;

  /* ---------- Structure ---------- */
  const root = document.createElement('div');
  root.className = 'ps-root';
  root.setAttribute('aria-hidden', 'true');
  root.dataset.phase = 'calm';
  root.dataset.moving = '0';
  root.innerHTML = `<div class="ps-cap"></div>
    <div class="ps-gas">${Array.from({ length: 6 }, (_, k) =>
      `<i style="--k:${k};--dx:${((k % 3) - 1) * 30}px"></i>`).join('')}</div>
    <div class="ps-group ps-prots"></div><div class="ps-group ps-cops"></div><div class="ps-ground"></div>`;
  document.body.appendChild(root);

  const prots = root.querySelector('.ps-prots');
  const cops = root.querySelector('.ps-cops');
  const gas = root.querySelector('.ps-gas');
  const cap = root.querySelector('.ps-cap');

  let nCops = 4; // modifiable via ProtestScene.setIntensity

  function build() {
    const W = innerWidth;
    const figW = (W <= 640 ? 64 : 96) * 46 / 98;
    const maxEach = Math.max(2, Math.floor((W - 140) / 2 / (figW + 8)));
    const nP = Math.min(W < 640 ? 3 : W < 1000 ? 4 : 5, maxEach);
    const nC = Math.min(nCops, maxEach);
    prots.innerHTML = Array.from({ length: nP }, (_, i) =>
      `<div class="ps-p ${i % 3 === 1 ? 'fall' : ''}" style="--d:${(i * 0.17).toFixed(2)}s">${protester(i)}</div>`).join('');
    cops.innerHTML = Array.from({ length: nC }, (_, i) =>
      `<div class="ps-c" style="--d:${(i * 0.13).toFixed(2)}s">${cop()}</div>`).join('');
  }

  /* ---------- Position selon le scroll ---------- */
  const clamp01 = x => Math.min(Math.max(x, 0), 1);
  const ease = t => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;

  const progress = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    return h > 0 ? clamp01(scrollY / h) : 0;
  };

  const PHASES = [
    [0.2, 'calm', 'Peaceful gathering'],
    [0.6, 'face', 'Face-off'],
    [0.9, 'clash', 'Police intervention'],
    [1.01, 'after', 'Dispersal']
  ];

  function layout(p) {
    const W = innerWidth, gp = prots.offsetWidth, gc = cops.offsetWidth;
    const mid = W / 2, gap = 36;
    const approach = ease(clamp01(p / 0.6));
    const retreat = ease(clamp01((p - 0.6) / 0.4));
    prots.style.transform = `translateX(${lerp(12, mid - gap - gp, approach) - retreat * 70}px)`;
    cops.style.transform = `translateX(${lerp(W - gc - 12, mid + gap, approach) - retreat * 45}px)`;
    gas.style.left = mid + 'px';

    const [, phase, label] = PHASES.find(([max]) => p < max);
    if (root.dataset.phase !== phase) { root.dataset.phase = phase; cap.textContent = label; }
  }

  let cur = 0, raf = 0;
  function tick() {
    raf = 0;
    const t = progress();
    cur = reduce ? t : cur + (t - cur) * 0.1;   // lissage : le mouvement continue un instant après l'arrêt du scroll
    layout(cur);
    const d = Math.abs(t - cur);
    root.dataset.moving = d > 0.0015 ? '1' : '0';
    if (d > 0.0005 && !reduce) raf = requestAnimationFrame(tick);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', () => { build(); kick(); });

  build();
  cap.textContent = PHASES[0][2];
  kick();

  /* ---------- API : lier le nombre de policiers au taux de répression du dashboard ---------- */
  window.ProtestScene = {
    /** ratio entre 0 et 1 -> 3 à 6 policiers */
    setIntensity(ratio) {
      const n = 3 + Math.round(clamp01(ratio) * 3);
      if (n === nCops) return;
      nCops = n;
      build(); kick();
    }
  };
  if (window.__psRatio != null) window.ProtestScene.setIntensity(window.__psRatio);
})(); } catch (e) { console.warn('scene.js disabled:', e); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

/* =====================================================================
   Fumée qui s'échappe de la photo (illustration.jpg) vers le bord droit de la page.
   - Ne modifie NI la photo NI la mise en page : la fumée est dessinée sur un calque
     transparent fixe, au-dessus de la page (la carte a "overflow-hidden", donc la fumée
     ne pourrait pas en sortir autrement).
   - Astuce : Maj + clic sur la photo, à l'endroit où se trouve la fumée, règle l'origine en direct
     (les valeurs s'affichent dans la console : copie-les dans origin ci-dessous).
   ===================================================================== */
(() => {
  const SMOKE = {
    selector: 'img[src*="illustration"]',
    origin: { x: 0.5, y: 0.6 },   // d'où part la fumée, en fraction de la photo (0 à 1)
    angle: 17,                    // direction : degrés au-dessus de l'horizontale, vers la droite
    rate: 14,                     // bouffées par seconde
    color: [150, 156, 168],       // couleur de la fumée (RGB)
    opacity: 0.42,                // intensité (0 à 1)
    size: [0.2, 0.5],             // rayon final des nuages, en fraction de la hauteur de la photo
    speed: [80, 130],             // vitesse de dérive, en px/s
    life: [7, 11],                // durée de vie, en secondes
    spread: 0.04                  // étalement de la source, en fraction de la largeur de la photo
  };

  const start = () => { try { run(); } catch (e) { console.warn('smoke disabled:', e); } };
  if (document.readyState === 'complete') start(); else addEventListener('load', start);

  function run() {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hero = document.querySelector(SMOKE.selector) ||
      [...document.images].find(i => { const r = i.getBoundingClientRect(); return r.width > 300 && r.height > 150; });
    if (!hero) { console.warn("Smoke: photo not found. Set SMOKE.selector."); return; }

    // Calque fixe, de la taille de l'écran : n'influence jamais la taille de la page ni de la photo.
    const cvs = document.createElement('canvas');
    cvs.setAttribute('aria-hidden', 'true');
    cvs.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:20';
    document.body.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let VW = 0, VH = 0;
    const fit = () => {
      VW = document.documentElement.clientWidth; VH = innerHeight;
      if (cvs.width !== VW) cvs.width = VW;
      if (cvs.height !== VH) cvs.height = VH;
      cvs.style.width = VW + 'px'; cvs.style.height = VH + 'px';
    };

    const a = SMOKE.angle * Math.PI / 180, dirx = Math.cos(a), diry = -Math.sin(a);
    let ex = 0, ey = 0, hw = 1, hh = 1, vis = true;
    function measure() {
      const r = hero.getBoundingClientRect();
      hw = r.width; hh = r.height;
      ex = r.left + scrollX + SMOKE.origin.x * r.width;     // coordonnées de la page
      ey = r.top + scrollY + SMOKE.origin.y * r.height;
      vis = r.bottom > -300 && r.top < VH + 300;
    }

    // Sprites de nuages : plusieurs disques flous superposés
    const sprites = Array.from({ length: 4 }, () => {
      const s = 128, c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d'), [R, G, B] = SMOKE.color;
      for (let i = 0; i < 6; i++) {
        const x = s / 2 + (Math.random() - .5) * s * .35, y = s / 2 + (Math.random() - .5) * s * .35, r = s * (.22 + Math.random() * .2);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(${R},${G},${B},.55)`); gr.addColorStop(1, `rgba(${R},${G},${B},0)`);
        g.fillStyle = gr; g.fillRect(0, 0, s, s);
      }
      return c;
    });

    const rr = (lo, hi) => lo + Math.random() * (hi - lo);
    const P = []; let acc = 0;

    function spawn() {
      const ang = Math.random() * 6.283, d = Math.random() * SMOKE.spread * hw;
      P.push({ x: ex + Math.cos(ang) * d, y: ey + Math.sin(ang) * d * .6, age: 0, life: rr(...SMOKE.life),
        r0: rr(.03, .07) * hh, r1: rr(...SMOKE.size) * hh, speed: rr(...SMOKE.speed), ph: Math.random() * 6.283,
        rot: Math.random() * 6.283, vr: (Math.random() - .5) * .3, a: rr(.6, 1) * SMOKE.opacity,
        spr: sprites[(Math.random() * sprites.length) | 0] });
    }

    function step(dt) {
      acc += SMOKE.rate * dt;
      while (acc >= 1) { spawn(); acc--; }
      const pageW = document.documentElement.clientWidth;
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i]; p.age += dt;
        const t = p.age / p.life;
        if (t >= 1 || p.x - p.r1 > pageW || p.y < -250) { P.splice(i, 1); continue; }
        const v = p.speed * (0.25 + 0.75 * Math.min(1, t * 3)) * (1 + t * 0.7);   // jaillit doucement puis accélère
        p.x += (dirx * v + Math.sin(p.age * .9 + p.ph) * 12) * dt;                 // turbulence
        p.y += (diry * v + Math.cos(p.age * .7 + p.ph * 1.3) * 9) * dt;
        p.rot += p.vr * dt;
      }
    }

    function draw() {
      ctx.clearRect(0, 0, VW, VH);
      for (const p of P) {
        const t = p.age / p.life;
        const r = p.r0 + (p.r1 - p.r0) * (1 - (1 - t) * (1 - t));
        const sx = p.x - scrollX, sy = p.y - scrollY;
        if (sx + r < 0 || sx - r > VW || sy + r < 0 || sy - r > VH) continue;
        ctx.globalAlpha = p.a * Math.min(1, t / .1) * Math.pow(1 - t, 1.4);
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.rot);
        ctx.drawImage(p.spr, -r, -r, 2 * r, 2 * r);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    fit(); measure();
    addEventListener('resize', () => { fit(); measure(); });

    // Maj + clic sur la photo : règle l'origine de la fumée
    document.addEventListener('click', e => {
      if (!e.shiftKey) return;
      const r = hero.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      e.preventDefault();
      SMOKE.origin.x = +((e.clientX - r.left) / r.width).toFixed(2);
      SMOKE.origin.y = +((e.clientY - r.top) / r.height).toFixed(2);
      measure();
      const msg = `origin: { x: ${SMOKE.origin.x}, y: ${SMOKE.origin.y} }`;
      console.log('Smoke → ' + msg);
      const t = document.createElement('div');
      t.textContent = 'Smoke origin: ' + msg + ' (copy into SMOKE)';
      t.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:60;background:#0f172a;color:#fff;font:13px system-ui,sans-serif;padding:8px 14px;border-radius:8px';
      document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
    }, true);

    if (reduce) {   // image fixe, redessinée au défilement
      for (let i = 0; i < 600; i++) step(1 / 60);
      draw();
      addEventListener('scroll', () => { measure(); draw(); }, { passive: true });
      return;
    }

    let last = performance.now();
    (function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      if (document.hidden) return;
      measure();
      if (!vis) { ctx.clearRect(0, 0, VW, VH); return; }   // en pause quand la photo est loin de l'écran
      step(dt); draw();
    })(last);
  }
})();
