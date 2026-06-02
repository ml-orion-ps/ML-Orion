import os
from datetime import datetime


def create_output_directory(directory: str):
    os.makedirs(directory, exist_ok=True)


def generate_output_filename(prefix: str) -> str:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{prefix}_{timestamp}.csv"
