import sys
import os
sys.path.insert(0, r"c:\Users\rishabh.goyal\Downloads\DS\Orion_Usecase\New_ML\ML-Orion\backend")

from database import SessionLocal
import storage
import pandas as pd
from services.custom_features import (
    apply_custom_features,
    get_dataset_rows,
    get_dataset_custom_features,
)

# ─── Config ────────────────────────────────────────────────────────────────────
DATASET_ID = 8         # change to your dataset ID
OUTPUT_FILE = r"c:\Users\rishabh.goyal\Downloads\dataset_with_features.xlsx"
# ───────────────────────────────────────────────────────────────────────────────

def main():
    db = SessionLocal()
    try:
        ds = storage.get_dataset(db, DATASET_ID)
        if not ds:
            print(f"Dataset {DATASET_ID} not found.")
            return

        print(f"Dataset: {ds.name}  ({ds.row_count} rows)")

        rows = get_dataset_rows(ds)
        print(f"Rows loaded: {len(rows)}")

        custom_features = get_dataset_custom_features(ds)
        if not custom_features:
            print("No custom features saved on this dataset yet.")
            print("Add at least one feature from the UI first, then re-run.")
            return

        print(f"Custom features found ({len(custom_features)}):")
        for f in custom_features:
            print(f"  • {f.get('name')} [{f.get('type')}]  formula: {f.get('formula')}")

        print("\nApplying features...")
        enriched_rows = apply_custom_features(rows, custom_features)

        df = pd.DataFrame(enriched_rows)
        print(f"DataFrame shape: {df.shape}")

        # Show a quick preview of the new columns
        new_cols = [f.get("name") for f in custom_features if f.get("name") in df.columns]
        print(f"\nNew feature columns preview (first 5 rows):")
        print(df[new_cols].head())

        df.to_excel(OUTPUT_FILE, index=False)
        print(f"\nSaved to: {OUTPUT_FILE}")

    finally:
        db.close()

if __name__ == "__main__":
    main()
