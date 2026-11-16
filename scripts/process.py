import pandas as pd
import os

# 1. Chemin vers le fichier CSV avec encodage gérant le BOM
csv_path = '../data/acled_europe.csv'
df = pd.read_csv(csv_path, encoding='utf-8-sig')

# Afficher les colonnes détectées pour vérification
print("Colonnes détectées :", df.columns.tolist())

# 2. Nettoyage des noms de colonnes
df.columns = df.columns.str.strip().str.lower()

# 3. Traitement et agrégation
df_grouped = df.groupby(['country', 'sub_event_type'])['events'].sum().reset_index()

# 4. Exportation du résultat au format JSON
output_dir = '../data'
os.makedirs(output_dir, exist_ok=True)
output_path = os.path.join(output_dir, 'protests_stats_by_country.json')

df_grouped.to_json(output_path, orient='records', force_ascii=False, indent=4)

print(f"Traitement réussi ! Fichier '{os.path.basename(output_path)}' généré dans {output_dir}.")