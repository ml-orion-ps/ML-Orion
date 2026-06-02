export type AppStatus = "live" | "coming-soon";

export interface AppDef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  industry: string;
  route: string;
  color: string;
  status: AppStatus;
}

export const APPS: AppDef[] = [
  {
    id: "tmt-copper-churn",
    name: "Copper Churn Intelligence",
    tagline: "Customer Churn Prediction & Retention",
    description: "End-to-end churn ML factory for copper telecom customers — risk scoring, retention actions, and business impact tracking.",
    industry: "TMT",
    route: "/tmt/customer-churn",
    color: "blue",
    status: "live",
  },
  {
    id: "cpg-baseline-modelling",
    name: "Baseline Modelling",
    tagline: "Promo Baseline & Uplift Measurement",
    description: "Statistical baseline modelling for CPG trade promotions — isolate true incremental lift from seasonal and trend effects.",
    industry: "CPG",
    route: "/cpg/baseline-modelling",
    color: "green",
    status: "coming-soon",
  },
  {
    id: "retail-demand-forecasting",
    name: "Demand Forecasting",
    tagline: "SKU-Level Demand Prediction",
    description: "ML-powered demand forecasting across SKUs, stores, and time horizons to reduce stockouts and overstock.",
    industry: "Retail",
    route: "/retail/demand_forecast",
    color: "orange",
    status: "live",
  },
];
