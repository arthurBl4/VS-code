document.addEventListener("DOMContentLoaded", () => {
    // Charger le fichier JSON généré par Python
    fetch('data/protests_stats_by_country.json')
        .then(response => {
            if (!response.ok) throw new Error("Fichier JSON introuvable");
            return response.json();
        })
        .then(data => {
            // Trier les pays par nombre total de manifestations (du plus grand au plus petit)
            data.sort((a, b) => b.total_events - a.total_events);

            updateKPIs(data);
            renderChart(data.slice(0, 12)); // Afficher les 12 pays les plus actifs dans le graphique
            populateTable(data);
            setupSearch(data);
        })
        .catch(error => {
            console.error("Erreur :", error);
            document.getElementById('tableBody').innerHTML = `
                <tr><td colspan="7" class="py-6 px-6 text-center text-rose-600">
                    Impossible de charger <code>data/protests_stats_by_country.json</code>. Vérifiez que le script Python a bien été exécuté.
                </td></tr>`;
        });
});

// 1. Calculer et afficher les 3 grands chiffres européens
function updateKPIs(data) {
    let totalAll = 0, totalPeaceful = 0, totalIntervention = 0, totalViolent = 0;

    data.forEach(d => {
        totalAll += d.total_events || 0;
        totalPeaceful += d['Peaceful protest'] || 0;
        totalIntervention += d['Protest with intervention'] || 0;
        totalViolent += d['Violent demonstration'] || 0;
    });

    if (totalAll > 0) {
        document.getElementById('kpiPeaceful').textContent = ((totalPeaceful / totalAll) * 100).toFixed(1) + ' %';
        document.getElementById('kpiIntervention').textContent = ((totalIntervention / (totalPeaceful + totalIntervention)) * 100).toFixed(1) + ' %';
        document.getElementById('kpiViolent').textContent = ((totalViolent / totalAll) * 100).toFixed(1) + ' %';
    }
}

// 2. Dessiner le graphique comparatif avec Chart.js
function renderChart(topCountries) {
    const ctx = document.getElementById('protestsChart').getContext('2d');
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: topCountries.map(d => d.country),
            datasets: [
                {
                    label: "Taux d'intervention policière (%)",
                    data: topCountries.map(d => d.police_intervention_rate),
                    backgroundColor: '#d97706', // Ambre
                    borderRadius: 4
                },
                {
                    label: 'Taux de violence manifestants (%)',
                    data: topCountries.map(d => d.violence_rate),
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

    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors";
        tr.innerHTML = `
            <td class="py-3 px-6 font-semibold text-slate-900">${row.country}</td>
            <td class="py-3 px-6 text-right font-medium">${Math.round(row.total_events)}</td>
            <td class="py-3 px-6 text-right text-emerald-700">${Math.round(row['Peaceful protest'])}</td>
            <td class="py-3 px-6 text-right text-amber-700">${Math.round(row['Protest with intervention'])}</td>
            <td class="py-3 px-6 text-right text-rose-700">${Math.round(row['Violent demonstration'])}</td>
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

// 4. Recherche interactive par pays
function setupSearch(data) {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = data.filter(row => row.country.toLowerCase().includes(query));
        populateTable(filtered);
    });
}