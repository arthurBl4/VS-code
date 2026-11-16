let rawData = [];       // Stocke l'intégralité du dataset chargé
let currentChart = null;  // Instance du graphique Chart.js
let currentSortColumn = null;
let currentSortAsc = true;

document.addEventListener("DOMContentLoaded", () => {
    // Charger le fichier JSON généré par Python
    fetch('../data/protests_stats_by_country.json')
        .then(response => {
            if (!response.ok) throw new Error("Fichier JSON introuvable");
            return response.json();
        })
        .then(data => {
            rawData = data;

            // Trier initialement les pays par nombre total de manifestations (du plus grand au plus petit)
            rawData.sort((a, b) => b.total_events - a.total_events);

            // Initialiser les éléments de l'interface
            populateCountryDropdown(rawData);
            initDashboard('ALL');
            setupInteractions();
        })
        .catch(error => {
            console.error("Erreur :", error);
            document.getElementById('tableBody').innerHTML = `
                <tr><td colspan="7" class="py-6 px-6 text-center text-rose-600">
                    Impossible de charger <code>../data/protests_stats_by_country.json</code>. Vérifiez que le script Python a bien été exécuté.
                </td></tr>`;
        });
});

// Remplir le menu déroulant des pays
function populateCountryDropdown(data) {
    const select = document.getElementById('countrySelect');
    // Trier les pays par ordre alphabétique
    const sortedCountries = [...data].sort((a, b) => a.country.localeCompare(b.country));

    sortedCountries.forEach(row => {
        const option = document.createElement('option');
        option.value = row.country;
        option.textContent = row.country;
        select.appendChild(option);
    });
}

// Initialiser ou rafraîchir tout le tableau de bord selon le filtre pays
function initDashboard(selectedCountry) {
    let datasetToDisplay = rawData;
    let badgeText = "Europe";

    if (selectedCountry !== 'ALL') {
        datasetToDisplay = rawData.filter(d => d.country === selectedCountry);
        badgeText = selectedCountry;
    }

    // 1. Mettre à jour le badge de la carte KPI
    document.getElementById('kpiScopeBadge').textContent = badgeText;

    // 2. Calculer et afficher les KPIs (sur le périmètre sélectionné)
    updateKPIs(datasetToDisplay);

    // 3. Dessiner le graphique (Top 12 selon le critère de tri sélectionné)
    updateAndRenderChart();

    // 4. Remplir le tableau
    populateTable(datasetToDisplay);
}

// 1. Calculer et afficher les 3 grands chiffres
function updateKPIs(data) {
    let totalAll = 0, totalPeaceful = 0, totalIntervention = 0, totalViolent = 0;

    data.forEach(d => {
        totalAll += d.total_events || 0;
        totalPeaceful += d['Peaceful protest'] || 0;
        totalIntervention += d['Protest with intervention'] || 0;
        totalViolent += d['Violent demonstration'] || 0;
    });

    if (totalAll > 0) {
        // Règle de calcul validée : Part des pacifiques sur le total général
        document.getElementById('kpiPeaceful').textContent = ((totalPeaceful / totalAll) * 100).toFixed(1) + ' %';
        
        // Taux d'intervention sur les événements non-violents recensés ou ajusté
        const denominatorIntervention = (totalPeaceful + totalIntervention) > 0 ? (totalPeaceful + totalIntervention) : totalAll;
        document.getElementById('kpiIntervention').textContent = ((totalIntervention / denominatorIntervention) * 100).toFixed(1) + ' %';
        
        document.getElementById('kpiViolent').textContent = ((totalViolent / totalAll) * 100).toFixed(1) + ' %';
    } else {
        document.getElementById('kpiPeaceful').textContent = '0.0 %';
        document.getElementById('kpiIntervention').textContent = '0.0 %';
        document.getElementById('kpiViolent').textContent = '0.0 %';
    }
}

// 2. Gérer et dessiner le graphique comparatif avec Chart.js
function updateAndRenderChart() {
    const sortCriteria = document.getElementById('chartSortSelect').value;
    
    // Copie pour le tri du graphique
    let chartData = [...rawData];

    if (sortCriteria === 'total') {
        chartData.sort((a, b) => b.total_events - a.total_events);
        document.getElementById('chartTitle').textContent = "Comparaison des doctrines : Top 12 par volume total d'événements";
    } else if (sortCriteria === 'interventionRate') {
        chartData.sort((a, b) => b.police_intervention_rate - a.police_intervention_rate);
        document.getElementById('chartTitle').textContent = "Comparaison des doctrines : Top 12 par taux d'intervention policière";
    } else if (sortCriteria === 'violenceRate') {
        chartData.sort((a, b) => b.violence_rate - a.violence_rate);
        document.getElementById('chartTitle').textContent = "Comparaison des doctrines : Top 12 par taux de manifestations violentes";
    }

    const top12 = chartData.slice(0, 12);
    const ctx = document.getElementById('protestsChart').getContext('2d');

    if (currentChart) {
        currentChart.destroy(); // Détruire l'ancienne instance pour éviter les superpositions
    }
    
    currentChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top12.map(d => d.country),
            datasets: [
                {
                    label: "Taux d'intervention policière (%)",
                    data: top12.map(d => d.police_intervention_rate),
                    backgroundColor: '#d97706', // Ambre
                    borderRadius: 4
                },
                {
                    label: 'Taux de violence manifestants (%)',
                    data: top12.map(d => d.violence_rate),
                    backgroundColor: '#e11d48', // Rouge brique
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Pourcentage (%)' }
                }
            }
        }
    });
}

// 3. Remplir le tableau HTML
function populateTable(data) {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-6 px-6 text-center text-slate-500">Aucun résultat trouvé.</td></tr>`;
        return;
    }

    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors";
        tr.innerHTML = `
            <td class="py-3 px-6 font-semibold text-slate-900">${row.country}</td>
            <td class="py-3 px-6 text-right font-medium">${Math.round(row.total_events)}</td>
            <td class="py-3 px-6 text-right text-emerald-700">${Math.round(row['Peaceful protest'] || 0)}</td>
            <td class="py-3 px-6 text-right text-amber-700">${Math.round(row['Protest with intervention'] || 0)}</td>
            <td class="py-3 px-6 text-right text-rose-700">${Math.round(row['Violent demonstration'] || 0)}</td>
            <td class="py-3 px-6 text-right">
                <span class="px-2 py-1 rounded text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                    ${row.police_intervention_rate} %
                </span>
            </td>
            <td class="py-3 px-6 text-right">
                <span class="px-2 py-1 rounded text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">
                    ${row.violence_rate} %
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// 4. Configurer toutes les interactions et écouteurs d'événements
function setupInteractions() {
    // A. Changement du pays sélectionné
    const countrySelect = document.getElementById('countrySelect');
    countrySelect.addEventListener('change', (e) => {
        initDashboard(e.target.value);
    });

    // B. Changement du critère de tri du graphique
    const chartSortSelect = document.getElementById('chartSortSelect');
    chartSortSelect.addEventListener('change', () => {
        updateAndRenderChart();
    });

    // C. Bouton de réinitialisation globale
    const resetBtn = document.getElementById('resetFiltersBtn');
    resetBtn.addEventListener('click', () => {
        countrySelect.value = 'ALL';
        chartSortSelect.value = 'total';
        document.getElementById('searchInput').value = '';
        initDashboard('ALL');
    });

    // D. Recherche textuelle instantanée
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const selectedCountry = countrySelect.value;
        
        let baseData = rawData;
        if (selectedCountry !== 'ALL') {
            baseData = rawData.filter(d => d.country === selectedCountry);
        }

        const filtered = baseData.filter(row => row.country.toLowerCase().includes(query));
        populateTable(filtered);
    });

    // E. Tri des colonnes du tableau au clic sur les en-têtes
    const headers = document.querySelectorAll('th[data-sort]');
    headers.th = headers;
    headers.forEach(th => {
        th.addEventListener('click', () => {
            const columnKey = th.getAttribute('data-sort');
            
            // Inverser l'ordre si on clique sur la même colonne
            if (currentSortColumn === columnKey) {
                currentSortAsc = !currentSortAsc;
            } else {
                currentSortColumn = columnKey;
                currentSortAsc = true;
            }

            // Appliquer le tri sur rawData (ou données filtrées par pays)
            const selectedCountry = countrySelect.value;
            let targetData = selectedCountry === 'ALL' ? [...rawData] : rawData.filter(d => d.country === selectedCountry);

            targetData.sort((a, b) => {
                let valA = a[columnKey];
                let valB = b[columnKey];

                // Mapping des clés du tableau HTML vers les propriétés du JSON
                if (columnKey === 'total') { valA = a.total_events; valB = b.total_events; }
                if (columnKey === 'peaceful') { valA = a['Peaceful protest']; valB = b['Peaceful protest']; }
                if (columnKey === 'intervention') { valA = a['Protest with intervention']; valB = b['Protest with intervention']; }
                if (columnKey === 'violent') { valA = a['Violent demonstration']; valB = b['Violent demonstration']; }
                if (columnKey === 'interventionRate') { valA = a.police_intervention_rate; valB = b.police_intervention_rate; }
                if (columnKey === 'violenceRate') { valA = a.violence_rate; valB = b.violence_rate; }

                if (typeof valA === 'string') {
                    return currentSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
                } else {
                    return currentSortAsc ? valA - valB : valB - valA;
                }
            });

            populateTable(targetData);
        });
    });
}