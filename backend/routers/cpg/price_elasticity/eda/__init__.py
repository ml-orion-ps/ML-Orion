from . import price_elasticity


def run_eda(usecase: str, df) -> dict:
    return price_elasticity.run(df)
