import sys
import json
import pandas as pd

from pipeline import run_price_elasticity_pipeline


def main():

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    # read input
    with open(input_path, "r") as f:
        payload = json.load(f)

    data = payload["data"]

    df = pd.DataFrame(data)

    # run pipeline
    result = run_price_elasticity_pipeline(df)

    # save output
    with open(output_path, "w") as f:
        json.dump(result, f, default=str)


if __name__ == "__main__":
    main()