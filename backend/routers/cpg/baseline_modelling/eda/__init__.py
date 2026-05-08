from . import churn, baseline


def run_eda(usecase: str, df) -> dict:
    if usecase == "baseline":
        return baseline.run(df)
    return churn.run(df)
