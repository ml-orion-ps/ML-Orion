import { useQuery } from "@tanstack/react-query";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, ReferenceLine, PieChart, Pie } from "recharts";

const API_BASE = "/api/cpg/price_elasticity";
const CPG_BASE = "/cpg/price-elasticity/orion";

const MODEL_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

type ModelType = {
  id: number;
  name: string;
  algorithm: string;
  status: string;
  isDeployed: boolean;
  trainedAt: string;
  rowCount?: number;
  r2?: number;
  modelWeights?: {
    globalPriceElasticity?: number;
    modelConverged?: boolean;
    elasticitySummary?: { name: string; elasticity: number }[];
    rowsProcessed?: number;
  };
};

export default function OrionOutcomes() {
  const { data: models = [], isLoading } = useQuery<ModelType[]>({
    queryKey: [`${API_BASE}/models`],
  });

  const allModels = models as ModelType[];
  const sortedModels = [...allModels].sort(
    (a, b) => new Date(b.trainedAt || 0).getTime() - new Date(a.trainedAt || 0).getTime()
  );
  const deployedModel = allModels.find(m => m.isDeployed) ?? null;

  const brandData = deployedModel?.modelWeights?.elasticitySummary
    ? [...deployedModel.modelWeights.elasticitySummary].sort((a, b) => a.elasticity - b.elasticity)
    : [];

  const highlyElastic = brandData.filter(b => b.elasticity < -1);
  const inelastic = brandData.filter(b => b.elasticity >= -1 && b.elasticity < 0);
  const positive = brandData.filter(b => b.elasticity >= 0);

  const globalElas = deployedModel?.modelWeights?.globalPriceElasticity ?? deployedModel?.r2 ?? null;

  const pieData = [
    { name: "Highly Elastic", value: highlyElastic.length, fill: "#ef4444" },
    { name: "Inelastic", value: inelastic.length, fill: "#3b82f6" },
    { name: "Positive", value: positive.length, fill: "#10b981" },
  ].filter(d => d.value > 0);

  const last8 = [...allModels]
    .sort((a, b) => new Date(a.trainedAt).getTime() - new Date(b.trainedAt).getTime())
    .slice(-8);
  const comparisonData = last8.map((m, i) => ({
    label: m.name?.split(" ").slice(-2).join(" ") || `#${m.id}`,
    elasticity:
      m.modelWeights?.globalPriceElasticity != null
        ? Number(m.modelWeights.globalPriceElasticity)
        : m.r2 != null ? Number(m.r2) : 0,
    fill: MODEL_COLORS[i % MODEL_COLORS.length],
  }));

  const algoMap: Record<string, { count: number; elasSum: number; rowsSum: number }> = {};
  allModels.forEach(m => {
    const algo = m.algorithm || "Mixed LM";
    if (!algoMap[algo]) algoMap[algo] = { count: 0, elasSum: 0, rowsSum: 0 };
    const elas = m.modelWeights?.globalPriceElasticity ?? m.r2 ?? 0;
    algoMap[algo].count += 1;
    algoMap[algo].elasSum += Number(elas);
    algoMap[algo].rowsSum += m.rowCount ?? m.modelWeights?.rowsProcessed ?? 0;
  });
  const algoSummary = Object.entries(algoMap).map(([algo, d]) => ({
    algo,
    avgElasticity: d.count > 0 ? d.elasSum / d.count : 0,
    avgRows: d.count > 0 ? Math.round(d.rowsSum / d.count) : 0,
    runs: d.count,
  }));

  return (
    <OrionLayout
      title="Outcomes & Performance"
      subtitle="Price elasticity results, brand insights, and deployment status"
      isLoading={isLoading}
    >
      <div className="mb-4">
        <OrionNav current={`${CPG_BASE}/outcomes`} basePath={CPG_BASE} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard label="Total Runs" value={allModels.length} />
        <KpiCard label="Deployed" value={deployedModel ? 1 : 0} trend="up" color={deployedModel ? "green" : "amber"} />
        <KpiCard label="Production Elasticity" value={globalElas != null ? Number(globalElas).toFixed(3) : "—"} />
        <KpiCard
          label="Highly Elastic Brands"
          value={deployedModel ? highlyElastic.length : "—"}
          color={highlyElastic.length > 0 ? "amber" : "green"}
        />
        <KpiCard label="Total Brands Scored" value={deployedModel ? brandData.length : "—"} />
        <KpiCard
          label="Rows Processed"
          value={deployedModel
            ? (deployedModel.rowCount ?? deployedModel.modelWeights?.rowsProcessed)?.toLocaleString() ?? "—"
            : "—"}
        />
      </div>

      <Tabs defaultValue="charts">
        <TabsList className="mb-4">
          <TabsTrigger value="charts">Performance Charts</TabsTrigger>
          <TabsTrigger value="results">Model Results</TabsTrigger>
          <TabsTrigger value="deployment">Deployment</TabsTrigger>
        </TabsList>

        {/* ── Performance Charts ── */}
        <TabsContent value="charts">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* Brand Elasticity Distribution donut */}
            <div className="border rounded-lg p-4 bg-card">
              <h3 className="text-sm font-semibold">Brand Elasticity Distribution</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Red = highly elastic (&lt;−1) · Blue = inelastic · Green = positive
              </p>
              {pieData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No deployed model yet — deploy a model to see brand distribution.
                </p>
              ) : (
                <>
                  <div className="relative flex justify-center">
                    <PieChart width={200} height={180}>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: any, name: any) => [`${v} brands`, name]}
                        contentStyle={{ fontSize: 11 }}
                      />
                    </PieChart>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-base font-bold leading-tight">{brandData.length}</span>
                      <span className="text-[9px] text-muted-foreground">brands</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1 mb-3">
                    {[
                      { label: "Highly Elastic", count: highlyElastic.length, fill: "#ef4444" },
                      { label: "Inelastic", count: inelastic.length, fill: "#3b82f6" },
                      { label: "Positive", count: positive.length, fill: "#10b981" },
                    ].map(d => (
                      <span key={d.label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.fill }} />
                        {d.label}
                        <span className="font-medium text-foreground">{d.count}</span>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-4 justify-center text-xs border-t pt-2">
                    <span>Global Elasticity: <strong className={globalElas != null && globalElas < -1 ? "text-red-600" : "text-blue-600"}>{globalElas != null ? Number(globalElas).toFixed(3) : "—"}</strong></span>
                    <span>Brands: <strong>{brandData.length}</strong></span>
                  </div>
                </>
              )}
            </div>

            {/* Global Elasticity Comparison */}
            <div className="border rounded-lg p-4 bg-card">
              <h3 className="text-sm font-semibold">Global Elasticity by Run</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Negative = price reduces demand (expected) · last 8 runs
              </p>
              {comparisonData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No runs yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={comparisonData} margin={{ left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: any) => [Number(v).toFixed(3), "Global Elasticity"]} />
                    <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                    <Bar dataKey="elasticity" radius={[2, 2, 0, 0]}>
                      {comparisonData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Algorithm Summary */}
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-1">Algorithm Performance Summary</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Avg global elasticity and rows processed grouped by algorithm
            </p>
            {algoSummary.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No data yet.</p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {algoSummary.map(d => (
                  <div key={d.algo} className="border rounded-lg p-3 bg-muted/30">
                    <div className="text-xs font-medium text-muted-foreground mb-2">{d.algo}</div>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span
                        className="text-xl font-bold"
                        style={{
                          color: d.avgElasticity < -1 ? "#dc2626" : d.avgElasticity < 0 ? "#2563eb" : "#16a34a",
                        }}
                      >
                        {d.avgElasticity !== 0 ? d.avgElasticity.toFixed(3) : "—"}
                      </span>
                      <span className="text-xs text-muted-foreground">avg elasticity</span>
                    </div>
                    <div className="text-sm">
                      <span className="font-semibold">{d.avgRows.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground ml-1">avg rows</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {d.runs} run{d.runs !== 1 ? "s" : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Model Results ── */}
        <TabsContent value="results">
          <div className="border rounded-lg bg-card">
            <div className="p-4 border-b">
              <h3 className="text-sm font-semibold">All Runs</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sortedModels.length} run{sortedModels.length !== 1 ? "s" : ""} · sorted by training date (newest first)
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {["Run Name", "Algorithm", "Global Elasticity", "Converged", "Brands Scored", "Rows Processed", "Status", "Trained"].map(h => (
                      <th key={h} className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedModels.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-muted-foreground">
                        No runs yet. Run an experiment from the Experiments page.
                      </td>
                    </tr>
                  )}
                  {sortedModels.map(m => {
                    const elas = m.modelWeights?.globalPriceElasticity ?? m.r2 ?? null;
                    return (
                      <tr key={m.id} className="border-t hover:bg-muted/20">
                        <td className="p-3 font-medium max-w-[180px] truncate">{m.name}</td>
                        <td className="p-3 text-muted-foreground">{m.algorithm}</td>
                        <td
                          className="p-3 font-mono font-bold"
                          style={{
                            color: elas == null ? undefined : elas < -1 ? "#dc2626" : elas < 0 ? "#2563eb" : "#16a34a",
                          }}
                        >
                          {elas != null ? Number(elas).toFixed(3) : "—"}
                        </td>
                        <td className="p-3">
                          {m.modelWeights?.modelConverged == null
                            ? "—"
                            : m.modelWeights.modelConverged
                            ? <span className="text-green-600 font-medium">Yes</span>
                            : <span className="text-amber-600 font-medium">No</span>}
                        </td>
                        <td className="p-3 font-mono">{m.modelWeights?.elasticitySummary?.length ?? "—"}</td>
                        <td className="p-3 font-mono">
                          {(m.rowCount ?? m.modelWeights?.rowsProcessed)?.toLocaleString() ?? "—"}
                        </td>
                        <td className="p-3">
                          <StatusBadge status={m.isDeployed ? "Production" : m.status} />
                        </td>
                        <td className="p-3 text-muted-foreground whitespace-nowrap">
                          {m.trainedAt ? new Date(m.trainedAt).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* ── Deployment ── */}
        <TabsContent value="deployment">
          <div className="border rounded-lg bg-card">
            <div className="p-4 border-b">
              <h3 className="text-sm font-semibold">Deployed Model</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {deployedModel ? "1 model currently in production" : "No model deployed yet"}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {["Model", "Algorithm", "Global Elasticity", "Converged", "Brands Scored", "Rows Processed", "Deployed"].map(h => (
                      <th key={h} className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!deployedModel && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground">
                        No model deployed yet. Deploy from the Deploy &amp; Scoring page.
                      </td>
                    </tr>
                  )}
                  {deployedModel && (() => {
                    const elas = deployedModel.modelWeights?.globalPriceElasticity ?? deployedModel.r2 ?? null;
                    return (
                      <tr className="border-t hover:bg-muted/20">
                        <td className="p-3 font-medium max-w-[200px] truncate">{deployedModel.name}</td>
                        <td className="p-3">{deployedModel.algorithm}</td>
                        <td
                          className="p-3 font-mono font-bold"
                          style={{ color: elas == null ? undefined : elas < -1 ? "#dc2626" : elas < 0 ? "#2563eb" : "#16a34a" }}
                        >
                          {elas != null ? Number(elas).toFixed(3) : "—"}
                        </td>
                        <td className="p-3">
                          {deployedModel.modelWeights?.modelConverged
                            ? <span className="text-green-600 font-medium">Yes</span>
                            : <span className="text-amber-600 font-medium">No</span>}
                        </td>
                        <td className="p-3 font-mono">{deployedModel.modelWeights?.elasticitySummary?.length ?? "—"}</td>
                        <td className="p-3 font-mono">
                          {(deployedModel.rowCount ?? deployedModel.modelWeights?.rowsProcessed)?.toLocaleString() ?? "—"}
                        </td>
                        <td className="p-3 text-emerald-600 whitespace-nowrap">
                          {deployedModel.trainedAt ? new Date(deployedModel.trainedAt).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {sortedModels.filter(m => !m.isDeployed).length > 0 && (
            <div className="border rounded-lg bg-card mt-4">
              <div className="p-4 border-b">
                <h3 className="text-sm font-semibold">Trained · Not Deployed</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Available to deploy from the Deploy &amp; Scoring page</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {["Model", "Algorithm", "Global Elasticity", "Converged", "Status", "Trained"].map(h => (
                        <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedModels.filter(m => !m.isDeployed).map(m => {
                      const elas = m.modelWeights?.globalPriceElasticity ?? m.r2 ?? null;
                      return (
                        <tr key={m.id} className="border-t hover:bg-muted/20">
                          <td className="p-3 font-medium max-w-[200px] truncate">{m.name}</td>
                          <td className="p-3 text-muted-foreground">{m.algorithm}</td>
                          <td
                            className="p-3 font-mono"
                            style={{ color: elas == null ? undefined : elas < -1 ? "#dc2626" : elas < 0 ? "#2563eb" : "#16a34a" }}
                          >
                            {elas != null ? Number(elas).toFixed(3) : "—"}
                          </td>
                          <td className="p-3">
                            {m.modelWeights?.modelConverged == null
                              ? "—"
                              : m.modelWeights.modelConverged
                              ? <span className="text-green-600 font-medium">Yes</span>
                              : <span className="text-amber-600 font-medium">No</span>}
                          </td>
                          <td className="p-3"><StatusBadge status={m.status} /></td>
                          <td className="p-3 text-muted-foreground whitespace-nowrap">
                            {m.trainedAt ? new Date(m.trainedAt).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </OrionLayout>
  );
}
