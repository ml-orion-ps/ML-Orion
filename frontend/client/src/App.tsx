import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/tmt/customer_churn/dashboard";
import ChurnDiagnostics from "@/pages/tmt/customer_churn/churn-diagnostics";
import RiskIntelligence from "@/pages/tmt/customer_churn/risk-intelligence";
import RetentionCenter from "@/pages/tmt/customer_churn/retention-center";
import BusinessImpact from "@/pages/tmt/customer_churn/business-impact";
import StrategyInsights from "@/pages/tmt/customer_churn/strategy-insights";
import OrionOverview from "@/pages/tmt/customer_churn/orion/orion-overview";
import OrionData from "@/pages/tmt/customer_churn/orion/orion-data";
import OrionExperiments from "@/pages/tmt/customer_churn/orion/orion-experiments";
import OrionDeploy from "@/pages/tmt/customer_churn/orion/orion-deploy";
import OrionOutcomes from "@/pages/tmt/customer_churn/orion/orion-outcomes";
import OrionGovernance from "@/pages/tmt/customer_churn/orion/orion-governance";
import BaselineDashboard from "@/pages/cpg/baseline_modelling/dashboard";
import BaselineDiagnostics from "@/pages/cpg/baseline_modelling/baseline-diagnostics";
import BaselineRiskIntelligence from "@/pages/cpg/baseline_modelling/risk-intelligence";
import BaselineRetentionCenter from "@/pages/cpg/baseline_modelling/retention-center";
import BaselineBusinessImpact from "@/pages/cpg/baseline_modelling/business-impact";
import BaselineStrategyInsights from "@/pages/cpg/baseline_modelling/strategy-insights";
import BaselineOrionOverview from "@/pages/cpg/baseline_modelling/orion/orion-overview";
import BaselineOrionData from "@/pages/cpg/baseline_modelling/orion/orion-data";
import BaselineOrionExperiments from "@/pages/cpg/baseline_modelling/orion/orion-experiments";
import BaselineOrionDeploy from "@/pages/cpg/baseline_modelling/orion/orion-deploy";
import BaselineOrionOutcomes from "@/pages/cpg/baseline_modelling/orion/orion-outcomes";
import BaselineOrionGovernance from "@/pages/cpg/baseline_modelling/orion/orion-governance";


import PriceDashboard from "@/pages/cpg/price_elasticity/dashboard";
import PriceDiagnostics from "@/pages/cpg/price_elasticity/price-diagnostics";
import PriceRiskIntelligence from "@/pages/cpg/price_elasticity/risk-intelligence";
import PriceRetentionCenter from "@/pages/cpg/price_elasticity/retention-center";
import PriceBusinessImpact from "@/pages/cpg/price_elasticity/business-impact";
import PriceStrategyInsights from "@/pages/cpg/price_elasticity/strategy-insights";
import PriceOrionOverview from "@/pages/cpg/price_elasticity/orion/orion-overview";
import PriceOrionData from "@/pages/cpg/price_elasticity/orion/orion-data";
import PriceOrionExperiments from "@/pages/cpg/price_elasticity/orion/orion-experiments";
import PriceOrionDeploy from "@/pages/cpg/price_elasticity/orion/orion-deploy";
import PriceOrionOutcomes from "@/pages/cpg/price_elasticity/orion/orion-outcomes";
import PriceOrionGovernance from "@/pages/cpg/price_elasticity/orion/orion-governance";

import RetailDemandDashboard from "@/pages/retail/demand_forecast/dashboard";
import RetailDemandDiagnostics from "@/pages/retail/demand_forecast/churn-diagnostics";
import RetailDemandRiskIntelligence from "@/pages/retail/demand_forecast/risk-intelligence";
import RetailDemandRetentionCenter from "@/pages/retail/demand_forecast/retention-center";
import RetailDemandBusinessImpact from "@/pages/retail/demand_forecast/business-impact";
import RetailDemandStrategyInsights from "@/pages/retail/demand_forecast/strategy-insights";
import RetailDemandOrionOverview from "@/pages/retail/demand_forecast/orion/orion-overview";
import RetailDemandOrionData from "@/pages/retail/demand_forecast/orion/orion-data";
import RetailDemandOrionExperiments from "@/pages/retail/demand_forecast/orion/orion-experiments";
import RetailDemandOrionDeploy from "@/pages/retail/demand_forecast/orion/orion-deploy";
import RetailDemandOrionOutcomes from "@/pages/retail/demand_forecast/orion/orion-outcomes";
import RetailDemandOrionGovernance from "@/pages/retail/demand_forecast/orion/orion-governance";

import PromoUpliftDashboard from "@/pages/cpg/promo-uplift/dashboard";
import PromoUpliftDiagnostics from "@/pages/cpg/promo-uplift/churn-diagnostics";
import PromoUpliftRiskIntelligence from "@/pages/cpg/promo-uplift/risk-intelligence";
import PromoUpliftRetentionCenter from "@/pages/cpg/promo-uplift/retention-center";
import PromoUpliftBusinessImpact from "@/pages/cpg/promo-uplift/business-impact";
import PromoUpliftStrategyInsights from "@/pages/cpg/promo-uplift/strategy-insights";
import PromoUpliftOrionOverview from "@/pages/cpg/promo-uplift/orion/orion-overview";
import PromoUpliftOrionData from "@/pages/cpg/promo-uplift/orion/orion-data";
import PromoUpliftOrionExperiments from "@/pages/cpg/promo-uplift/orion/orion-experiments";
import PromoUpliftOrionDeploy from "@/pages/cpg/promo-uplift/orion/orion-deploy";
import PromoUpliftOrionOutcomes from "@/pages/cpg/promo-uplift/orion/orion-outcomes";
import PromoUpliftOrionGovernance from "@/pages/cpg/promo-uplift/orion/orion-governance";
import KpiAnomalyOrionOverview from "@/pages/retail/KPI_anomaly/orion/orion-overview";
import KpiAnomalyOrionData from "@/pages/retail/KPI_anomaly/orion/orion-data";
import KpiAnomalyOrionExperiments from "@/pages/retail/KPI_anomaly/orion/orion-experiments";
import KpiAnomalyOrionDeploy from "@/pages/retail/KPI_anomaly/orion/orion-deploy";
import KpiAnomalyOrionOutcomes from "@/pages/retail/KPI_anomaly/orion/orion-outcomes";
import KpiAnomalyOrionGovernance from "@/pages/retail/KPI_anomaly/orion/orion-governance";

import LandingPage from "@/pages/landing";
import UseCaseDemo from "@/pages/use-case-demo";
import DemoOrionPage from "@/pages/demo-orion";

// function SidebarRouter() {
//   return (
//     <Switch>
//       <Route path="/demo/:industry/:useCase/orion/:page" component={DemoOrionPage} />
//       <Route path="/demo/:industry/:useCase/:section" component={UseCaseDemo} />
//       <Route path="/demo/:industry/:useCase" component={UseCaseDemo} />
//       <Route path="/tmt/customer-churn" component={Dashboard} />
//       <Route path="/tmt/customer-churn/churn-diagnostics/:tab?" component={ChurnDiagnostics} />
//       <Route path="/tmt/customer-churn/risk-intelligence/:tab?" component={RiskIntelligence} />
//       <Route path="/tmt/customer-churn/retention/:tab?" component={RetentionCenter} />
//       <Route path="/tmt/customer-churn/business-impact/:tab?" component={BusinessImpact} />
//       <Route path="/tmt/customer-churn/strategy/:tab?" component={StrategyInsights} />
//       <Route path="/tmt/customer-churn/orion/overview" component={OrionOverview} />
//       <Route path="/tmt/customer-churn/orion/data" component={OrionData} />
//       <Route path="/tmt/customer-churn/orion/experiments" component={OrionExperiments} />
//       <Route path="/tmt/customer-churn/orion/deploy" component={OrionDeploy} />
//       <Route path="/tmt/customer-churn/orion/outcomes" component={OrionOutcomes} />
//       <Route path="/tmt/customer-churn/orion/governance" component={OrionGovernance} />
//       <Route path="/cpg/baseline-modelling" component = {BaselineDashboard} />
//       <Route path="/cpg/baseline-modelling/baseline-diagnostics/:tab?" component={BaselineDiagnostics} />
//       <Route path="/cpg/baseline-modelling/risk-intelligence/:tab?" component={BaselineRiskIntelligence} />
//       <Route path="/cpg/baseline-modelling/retention/:tab?" component={BaselineRetentionCenter} />
//       <Route path="/cpg/baseline-modelling/business-impact/:tab?" component={BaselineBusinessImpact} />
//       <Route path="/cpg/baseline-modelling/strategy/:tab?" component={BaselineStrategyInsights} />
//       <Route path="/cpg/baseline-modelling/orion/overview" component={BaselineOrionOverview} />
//       <Route path="/cpg/baseline-modelling/orion/data" component={BaselineOrionData} />
//       <Route path="/cpg/baseline-modelling/orion/experiments" component={BaselineOrionExperiments} />
//       <Route path="/cpg/baseline-modelling/orion/deploy" component={BaselineOrionDeploy} />
//       <Route path="/cpg/baseline-modelling/orion/outcomes" component={BaselineOrionOutcomes} />
//       <Route path="/cpg/baseline-modelling/orion/governance" component={BaselineOrionGovernance} />

//       <Route component={NotFound} />
//     </Switch>
//   );
// }

function SidebarRouter() {

  return (

    <Switch>

      {/* DEMO */}

      <Route path="/demo/:industry/:useCase/orion/:page" component={DemoOrionPage} />

      <Route
        path="/demo/:industry/:useCase/:section"
        component={UseCaseDemo}
      />

      <Route
        path="/demo/:industry/:useCase"
        component={UseCaseDemo}
      />


      {/* TMT CUSTOMER CHURN */}

      <Route
        path="/tmt/customer-churn"
        component={Dashboard}
      />

      <Route
        path="/tmt/customer-churn/churn-diagnostics/:tab?"
        component={ChurnDiagnostics}
      />

      <Route
        path="/tmt/customer-churn/risk-intelligence/:tab?"
        component={RiskIntelligence}
      />

      <Route
        path="/tmt/customer-churn/retention/:tab?"
        component={RetentionCenter}
      />

      <Route
        path="/tmt/customer-churn/business-impact/:tab?"
        component={BusinessImpact}
      />

      <Route
        path="/tmt/customer-churn/strategy/:tab?"
        component={StrategyInsights}
      />

      <Route
        path="/tmt/customer-churn/orion/overview"
        component={OrionOverview}
      />

      <Route
        path="/tmt/customer-churn/orion/data"
        component={OrionData}
      />

      <Route
        path="/tmt/customer-churn/orion/experiments"
        component={OrionExperiments}
      />

      <Route
        path="/tmt/customer-churn/orion/deploy"
        component={OrionDeploy}
      />

      <Route
        path="/tmt/customer-churn/orion/outcomes"
        component={OrionOutcomes}
      />

      <Route
        path="/tmt/customer-churn/orion/governance"
        component={OrionGovernance}
      />


      {/* CPG BASELINE MODELLING */}

      <Route
        path="/cpg/baseline-modelling"
        component={BaselineDashboard}
      />

      <Route
        path="/cpg/baseline-modelling/baseline-diagnostics/:tab?"
        component={BaselineDiagnostics}
      />

      <Route
        path="/cpg/baseline-modelling/risk-intelligence/:tab?"
        component={BaselineRiskIntelligence}
      />

      <Route
        path="/cpg/baseline-modelling/retention/:tab?"
        component={BaselineRetentionCenter}
      />

      <Route
        path="/cpg/baseline-modelling/business-impact/:tab?"
        component={BaselineBusinessImpact}
      />

      <Route
        path="/cpg/baseline-modelling/strategy/:tab?"
        component={BaselineStrategyInsights}
      />

      <Route
        path="/cpg/baseline-modelling/orion/overview"
        component={BaselineOrionOverview}
      />

      <Route
        path="/cpg/baseline-modelling/orion/data"
        component={BaselineOrionData}
      />

      <Route
        path="/cpg/baseline-modelling/orion/experiments"
        component={BaselineOrionExperiments}
      />

      <Route
        path="/cpg/baseline-modelling/orion/deploy"
        component={BaselineOrionDeploy}
      />

      <Route
        path="/cpg/baseline-modelling/orion/outcomes"
        component={BaselineOrionOutcomes}
      />

      <Route
        path="/cpg/baseline-modelling/orion/governance"
        component={BaselineOrionGovernance}
      />


      {/* CPG PRICE ELASTICITY */}

      <Route
        path="/cpg/price-elasticity"
        component={PriceDashboard}
      />

      <Route
        path="/cpg/price-elasticity/price-diagnostics/:tab?"
        component={PriceDiagnostics}
      />

      <Route
        path="/cpg/price-elasticity/risk-intelligence/:tab?"
        component={PriceRiskIntelligence}
      />

      <Route
        path="/cpg/price-elasticity/retention/:tab?"
        component={PriceRetentionCenter}
      />

      <Route
        path="/cpg/price-elasticity/business-impact/:tab?"
        component={PriceBusinessImpact}
      />

      <Route
        path="/cpg/price-elasticity/strategy/:tab?"
        component={PriceStrategyInsights}
      />

      <Route
        path="/cpg/price-elasticity/orion/overview"
        component={PriceOrionOverview}
      />

      <Route
        path="/cpg/price-elasticity/orion/data"
        component={PriceOrionData}
      />

      <Route
        path="/cpg/price-elasticity/orion/experiments"
        component={PriceOrionExperiments}
      />

      <Route
        path="/cpg/price-elasticity/orion/deploy"
        component={PriceOrionDeploy}
      />

      <Route
        path="/cpg/price-elasticity/orion/outcomes"
        component={PriceOrionOutcomes}
      />

      <Route
        path="/cpg/price-elasticity/orion/governance"
        component={PriceOrionGovernance}
      />


      {/* RETAIL DEMAND FORECASTING */}

      <Route
        path="/retail/demand_forecast"
        component={RetailDemandDashboard}
      />

      <Route
        path="/retail/demand_forecast/churn-diagnostics/:tab?"
        component={RetailDemandDiagnostics}
      />

      <Route
        path="/retail/demand_forecast/risk-intelligence/:tab?"
        component={RetailDemandRiskIntelligence}
      />

      <Route
        path="/retail/demand_forecast/retention/:tab?"
        component={RetailDemandRetentionCenter}
      />

      <Route
        path="/retail/demand_forecast/business-impact/:tab?"
        component={RetailDemandBusinessImpact}
      />

      <Route
        path="/retail/demand_forecast/strategy/:tab?"
        component={RetailDemandStrategyInsights}
      />

      <Route
        path="/retail/demand_forecast/orion/overview"
        component={RetailDemandOrionOverview}
      />

      <Route
        path="/retail/demand_forecast/orion/data"
        component={RetailDemandOrionData}
      />

      <Route
        path="/retail/demand_forecast/orion/experiments"
        component={RetailDemandOrionExperiments}
      />

      <Route
        path="/retail/demand_forecast/orion/deploy"
        component={RetailDemandOrionDeploy}
      />

      <Route
        path="/retail/demand_forecast/orion/outcomes"
        component={RetailDemandOrionOutcomes}
      />

      <Route
        path="/retail/demand_forecast/orion/governance"
        component={RetailDemandOrionGovernance}
      />

      <Route path="/cpg/promo-uplift" component={PromoUpliftDashboard} />
      <Route path="/cpg/promo-uplift/diagnostics/:tab?" component={PromoUpliftDiagnostics} />
      <Route path="/cpg/promo-uplift/risk-intelligence/:tab?" component={PromoUpliftRiskIntelligence} />
      <Route path="/cpg/promo-uplift/retention/:tab?" component={PromoUpliftRetentionCenter} />
      <Route path="/cpg/promo-uplift/business-impact/:tab?" component={PromoUpliftBusinessImpact} />
      <Route path="/cpg/promo-uplift/strategy/:tab?" component={PromoUpliftStrategyInsights} />
      <Route path="/cpg/promo-uplift/orion/overview" component={PromoUpliftOrionOverview} />
      <Route path="/cpg/promo-uplift/orion/data" component={PromoUpliftOrionData} />
      <Route path="/cpg/promo-uplift/orion/experiments" component={PromoUpliftOrionExperiments} />
      <Route path="/cpg/promo-uplift/orion/deploy" component={PromoUpliftOrionDeploy} />
      <Route path="/cpg/promo-uplift/orion/outcomes" component={PromoUpliftOrionOutcomes} />
      <Route path="/cpg/promo-uplift/orion/governance" component={PromoUpliftOrionGovernance} />
      <Route path="/retail/kpi-anomaly/orion/overview" component={KpiAnomalyOrionOverview} />
      <Route path="/retail/kpi-anomaly/orion/data" component={KpiAnomalyOrionData} />
      <Route path="/retail/kpi-anomaly/orion/experiments" component={KpiAnomalyOrionExperiments} />
      <Route path="/retail/kpi-anomaly/orion/deploy" component={KpiAnomalyOrionDeploy} />
      <Route path="/retail/kpi-anomaly/orion/outcomes" component={KpiAnomalyOrionOutcomes} />
      <Route path="/retail/kpi-anomaly/orion/governance" component={KpiAnomalyOrionGovernance} />




      {/* NOT FOUND */}

      <Route component={NotFound} />

    </Switch>
  );
}

const sidebarStyle = { "--sidebar-width": "17rem", "--sidebar-width-icon": "3rem" };

function HeaderLabel() {
  const [location] = useLocation();
  if (location.startsWith("/demo/")) return <span className="text-xs text-muted-foreground">ML Orion — Use Case Intelligence</span>;
  if (location.startsWith("/orion/")) return <span className="text-xs text-muted-foreground">ML Orion — ML Factory</span>;
  return <span className="text-xs text-muted-foreground">ML Orion</span>;
}

function AppContent() {
  const [location] = useLocation();

  /* ── Platform Center & Landing: no sidebar, full screen ── */
  if (location === "/" || location === "/home") {
    return (
      <div className="h-screen w-full overflow-auto">
        <LandingPage />
      </div>
    );
  }

  /* ── All other routes: sidebar layout ── */
  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center gap-2 p-2 border-b shrink-0">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <HeaderLabel />
          </header>
          <main className="flex-1 overflow-auto">
            <SidebarRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppContent />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
