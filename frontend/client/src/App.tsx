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
import LandingPage from "@/pages/landing";
import UseCaseDemo from "@/pages/use-case-demo";
import DemoOrionPage from "@/pages/demo-orion";

function SidebarRouter() {
  return (
    <Switch>
      <Route path="/demo/:industry/:useCase/orion/:page" component={DemoOrionPage} />
      <Route path="/demo/:industry/:useCase/:section" component={UseCaseDemo} />
      <Route path="/demo/:industry/:useCase" component={UseCaseDemo} />
      <Route path="/tmt/customer-churn" component={Dashboard} />
      <Route path="/tmt/customer-churn/churn-diagnostics/:tab?" component={ChurnDiagnostics} />
      <Route path="/tmt/customer-churn/risk-intelligence/:tab?" component={RiskIntelligence} />
      <Route path="/tmt/customer-churn/retention/:tab?" component={RetentionCenter} />
      <Route path="/tmt/customer-churn/business-impact/:tab?" component={BusinessImpact} />
      <Route path="/tmt/customer-churn/strategy/:tab?" component={StrategyInsights} />
      <Route path="/tmt/customer-churn/orion/overview" component={OrionOverview} />
      <Route path="/tmt/customer-churn/orion/data" component={OrionData} />
      <Route path="/tmt/customer-churn/orion/experiments" component={OrionExperiments} />
      <Route path="/tmt/customer-churn/orion/deploy" component={OrionDeploy} />
      <Route path="/tmt/customer-churn/orion/outcomes" component={OrionOutcomes} />
      <Route path="/tmt/customer-churn/orion/governance" component={OrionGovernance} />
      <Route path="/cpg/baseline-modelling" component = {BaselineDashboard} />
      <Route path="/cpg/baseline-modelling/baseline-diagnostics/:tab?" component={BaselineDiagnostics} />
      <Route path="/cpg/baseline-modelling/risk-intelligence/:tab?" component={BaselineRiskIntelligence} />
      <Route path="/cpg/baseline-modelling/retention/:tab?" component={BaselineRetentionCenter} />
      <Route path="/cpg/baseline-modelling/business-impact/:tab?" component={BaselineBusinessImpact} />
      <Route path="/cpg/baseline-modelling/strategy/:tab?" component={BaselineStrategyInsights} />
      <Route path="/cpg/baseline-modelling/orion/overview" component={BaselineOrionOverview} />
      <Route path="/cpg/baseline-modelling/orion/data" component={BaselineOrionData} />
      <Route path="/cpg/baseline-modelling/orion/experiments" component={BaselineOrionExperiments} />
      <Route path="/cpg/baseline-modelling/orion/deploy" component={BaselineOrionDeploy} />
      <Route path="/cpg/baseline-modelling/orion/outcomes" component={BaselineOrionOutcomes} />
      <Route path="/cpg/baseline-modelling/orion/governance" component={BaselineOrionGovernance} />

      <Route component={NotFound} />
    </Switch>
  );
}

const sidebarStyle = { "--sidebar-width": "17rem", "--sidebar-width-icon": "3rem" };

function HeaderLabel() {
  const [location] = useLocation();
  if (location.startsWith("/demo/")) return <span className="text-xs text-muted-foreground">ML Orion — Use Case Intelligence</span>;
  if (location.startsWith("/orion/")) return <span className="text-xs text-muted-foreground">ML Orion — ML Factory</span>;
  return <span className="text-xs text-muted-foreground">ML Orion — Customer Churn Intelligence</span>;
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
