import sys
sys.path.insert(0, r"c:\Users\rishabh.goyal\Downloads\DS\Orion_Usecase\New_ML\ML-Orion\backend")

from database import SessionLocal
import storage

def main():
    db = SessionLocal()
    try:
        datasets = storage.get_datasets(db)
        print(f"Total datasets found: {len(datasets)}")
        for ds in datasets:
            # Let's see some basic info: id, name, status, usecase from model weights or feature report if any
            use_case = "unknown"
            if ds.feature_report and isinstance(ds.feature_report, dict):
                # check if there's any use_case info or we can check the ml models trained on this dataset
                pass
            # we can query the database directly or inspect columns to identify CPG / price elasticity datasets
            print(f"ID: {ds.id} | Name: {ds.name} | Row Count: {ds.row_count} | Status: {ds.status}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
