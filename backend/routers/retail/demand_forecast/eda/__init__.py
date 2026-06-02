from . import forecast_eda


def run_eda(usecase: str, df) -> dict:
    if usecase == "retail_demand_forecast":
        return forecast_eda.run(df)
    return forecast_eda.run(df)
