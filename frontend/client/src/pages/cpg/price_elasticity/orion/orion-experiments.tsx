import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import {
  FlaskConical, CheckCircle2, Trash2, TrendingDown, ArrowRight, Upload, Zap,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";


const ALGORITHMS_ELASTICITY = [
  { value: "Auto", label: "Auto (Best Model)", desc: "Trains Mixed Linear Model and selects the best performer" },
  { value: "MixedLM", label: "Mixed Linear Model", desc: "Mixed-effects regression — captures SKU/store-level random effects for elasticity estimation" },
];

const API_BASE = "/api/cpg/price_elasticity";

type ModelType = {
  id: number;
  name: string;
  algorithm: string;
  status: string;
  isDeployed: boolean;
  trainedAt: string;
  rowCount?: number;
  r2?: number;
  rmse?: number;
  mae?: number;
  modelWeights?: {
    globalPriceElasticity?: number;
    modelConverged?: boolean;
    elasticitySummary?: { name: string; elasticity: number }[];
    rowsProcessed?: number;
    rmse?: number;
    mae?: number;
    r2?: number;
  };
};

type ElasticityResult = {
  status: string;
  rowsProcessed: number;
  outputFile?: string;
  modelConverged: boolean;
  globalPriceElasticity: number | null;
  elasticitySummary: { name: string; elasticity: number }[];
  modelId?: number;
  runName?: string;
};

const asNumber = (v: any) =>
  v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
const asFixed = (v: any, d = 3) =>
  v != null ? Number(v).toFixed(d) : "—";

const getRunGlobalElasticity = (run: ModelType): number | null =>
  run.modelWeights?.globalPriceElasticity ?? run.r2 ?? null;

const getRunRmse = (run: ModelType): number | null =>
  run.rmse ?? run.modelWeights?.rmse ?? null;

const getRunMae = (run: ModelType): number | null =>
  run.mae ?? run.modelWeights?.mae ?? null;

const shortenAlgorithm = (alg: string | undefined): string => {
  if (!alg) return "—";
  const map: Record<string, string> = {
    "Mixed Linear Model": "MixedLM",
    "Auto (Best Model)": "Auto",
    "OLS Regression": "OLS",
  };
  return map[alg] || alg;
};

const getRunR2 = (run: ModelType): number | null =>
  run.r2 ?? run.modelWeights?.r2 ?? null;

const getRunConverged = (run: ModelType): boolean | null =>
  run.modelWeights?.modelConverged ?? null;

const MODEL_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

export default function OrionExperiments() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [name, setName] = useState("");
  const [algorithm, setAlgorithm] = useState("Auto");
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elasticityResult, setElasticityResult] = useState<ElasticityResult | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);

  const { data: models = [] } = useQuery<ModelType[]>({
    queryKey: [`${API_BASE}/models`],
  });

  const { data: datasets = [] } = useQuery<any[]>({
    queryKey: [`${API_BASE}/datasets`],
  });

  const trainableDatasets = (datasets as any[]).filter((d: any) => d.rowCount > 0);

  const runElasticityMut = useMutation({
    mutationFn: async ({ datasetId, runName }: { datasetId: number; runName: string }) => {
      const res = await apiRequest("POST", `${API_BASE}/datasets/run/${datasetId}`, { name: runName });
      return res.json();
    },
    onSuccess: (result: ElasticityResult) => {
      qc.invalidateQueries({ queryKey: [`${API_BASE}/models`] });
      setElasticityResult(result);
      toast({
        title: "Price elasticity analysis complete!",
        description: `${result.rowsProcessed?.toLocaleString()} rows processed — global elasticity: ${result.globalPriceElasticity != null ? Number(result.globalPriceElasticity).toFixed(3) : "—"}`,
      });
    },
    onError: (e: any) =>
      toast({ title: "Analysis failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `${API_BASE}/models/${id}`);
      return res.json();
    },
    onSuccess: (_: any, id: number) => {
      qc.invalidateQueries({ queryKey: [`${API_BASE}/models`] });
      if (elasticityResult?.modelId === id) setElasticityResult(null);
      setDeleteTargetId(null);
      toast({ title: "Run deleted", description: "The experiment run has been removed." });
    },
    onError: (e: any) => {
      setDeleteTargetId(null);
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    },
  });

  const handleRun = async () => {
    if (!selectedDatasetId) return toast({ title: "Select a dataset", variant: "destructive" });
    const ds = trainableDatasets.find((d: any) => d.id === Number(selectedDatasetId));
    if (!ds) return toast({ title: "Dataset not found", variant: "destructive" });

    setIsRunning(true);
    setProgress(0);
    setElasticityResult(null);
    const iv = setInterval(
      () => setProgress(p => (p >= 92 ? (clearInterval(iv), p) : p + Math.random() * 10)),
      250,
    );
    try {
      const runName =
        name || `Price Elasticity — ${ds.name} — ${new Date().toLocaleDateString()}`;
      await runElasticityMut.mutateAsync({ datasetId: Number(selectedDatasetId), runName });
    } finally {
      clearInterval(iv);
      setProgress(100);
      setTimeout(() => { setIsRunning(false); setProgress(0); }, 800);
    }
  };

  const allRuns = [...(models as ModelType[])].sort((a, b) => {
    const aTime = a.trainedAt ? new Date(a.trainedAt).getTime() : 0;
    const bTime = b.trainedAt ? new Date(b.trainedAt).getTime() : 0;
    return bTime - aTime;
  });

  const last8Runs = allRuns.slice(0, 8).reverse();

  const bestRun = allRuns.length > 0
    ? allRuns.reduce((best, r) => {
        const rVal = Math.abs(getRunGlobalElasticity(r) ?? 0);
        const bVal = Math.abs(getRunGlobalElasticity(best) ?? 0);
        return rVal > bVal ? r : best;
      })
    : null;

  const bestRmseRun = allRuns.length > 0
    ? allRuns.reduce((best, r) => {
        const rScore = getRunRmse(r) ?? Infinity;
        const bScore = getRunRmse(best) ?? Infinity;
        return rScore < bScore ? r : best;
      })
    : null;

  const runChartKeys = last8Runs.map((r, i) => `#${allRuns.indexOf(r) + 1} ${r.name.slice(0, 12)}`);

  const comparisonData = last8Runs.map((r, i) => ({
    name: runChartKeys[i],
    rmse: getRunRmse(r) != null ? Number(getRunRmse(r)) : 0,
    elasticity: getRunGlobalElasticity(r) != null ? Number(getRunGlobalElasticity(r)) : 0,
  }));

  const brandElasticityData = elasticityResult?.elasticitySummary
    ? [...elasticityResult.elasticitySummary]
        .sort((a, b) => a.elasticity - b.elasticity)
        .slice(0, 12)
    : [];

  return (
    <OrionLayout title="Experiment Lab" subtitle="Run price elasticity analysis experiments">
      <div className="mb-4">
        <OrionNav
          current="/cpg/price-elasticity/orion/experiments"
          basePath="/cpg/price-elasticity/orion"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── LEFT: Run Panel ── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <FlaskConical className="w-4 h-4" /> New Experiment
            </h3>
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-medium">Experiment Type</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    className="p-3 rounded-lg border border-primary bg-primary/5 text-left"
                    data-testid="button-experiment-elasticity"
                  >
                    <TrendingDown className="w-4 h-4 mb-1 text-primary" />
                    <div className="text-xs font-medium">Price Elasticity Analysis</div>
                    <div className="text-[10px] text-muted-foreground">SKU/store-level elasticity</div>
                  </button>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">Experiment Name</Label>
                <Input
                  className="mt-1 h-8 text-xs"
                  placeholder="e.g. Q1 2026 Elasticity Run"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  data-testid="input-experiment-name"
                />
              </div>

              <div>
                <Label className="text-xs font-medium">Training Data Source</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    className="p-3 rounded-lg border border-primary bg-primary/5 text-left"
                    data-testid="button-source-dataset"
                  >
                    <Upload className="w-4 h-4 mb-1 text-primary" />
                    <div className="text-xs font-medium">Uploaded Dataset</div>
                    <div className="text-[10px] text-muted-foreground">{trainableDatasets.length} ready</div>
                  </button>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">Price Elasticity Dataset</Label>
                <Select value={selectedDatasetId} onValueChange={setSelectedDatasetId}>
                  <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-dataset-train">
                    <SelectValue placeholder="Choose dataset…" />
                  </SelectTrigger>
                  <SelectContent>
                    {trainableDatasets.length === 0 && (
                      <SelectItem value="_none" disabled>
                        No datasets available
                      </SelectItem>
                    )}
                    {trainableDatasets.map((d: any) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.name} ({d.rowCount?.toLocaleString()} rows)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {trainableDatasets.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">Upload a dataset in Data Hub first.</p>
                )}
              </div>

              <div>
                <Label className="text-xs font-medium">Algorithm</Label>
                <Select value={algorithm} onValueChange={setAlgorithm}>
                  <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-algorithm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALGORITHMS_ELASTICITY.map(a => (
                      <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(() => {
                  const algInfo = ALGORITHMS_ELASTICITY.find(a => a.value === algorithm);
                  return algInfo ? (
                    <p className="text-[10px] text-muted-foreground mt-1">{algInfo.desc}</p>
                  ) : null;
                })()}
              </div>

              {isRunning && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="animate-pulse">Running price elasticity analysis…</span>
                    <span>{Math.min(100, Math.round(progress))}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300 rounded-full"
                      style={{ width: `${Math.min(100, progress)}%` }}
                    />
                  </div>
                </div>
              )}

              <Button
                className="w-full"
                onClick={handleRun}
                disabled={isRunning}
                data-testid="button-train"
              >
                {isRunning ? "Running…" : "Run Price Elasticity Analysis"}
              </Button>
            </div>
          </div>

          {/* Result Panel */}
          {elasticityResult && (
            <div className="border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-1.5 text-green-700">
                  <CheckCircle2 className="w-4 h-4" /> Analysis Complete
                </h3>
                <Badge variant="outline" className="text-[10px]">
                  {elasticityResult.modelConverged ? "Converged" : "Not Converged"}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                {[
                  { label: "Rows Processed", v: elasticityResult.rowsProcessed, fmt: asNumber },
                  {
                    label: "Global Elasticity",
                    v: elasticityResult.globalPriceElasticity,
                    fmt: (x: any) => asFixed(x),
                  },
                  {
                    label: "Brands Scored",
                    v: elasticityResult.elasticitySummary?.length,
                    fmt: asNumber,
                  },
                  {
                    label: "Model Status",
                    v: null,
                    fmt: () => (elasticityResult.modelConverged ? "Converged" : "Not converged"),
                  },
                ].map(m => (
                  <div key={m.label} className="bg-muted/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{m.label}</div>
                    <div className="text-sm font-bold text-primary">{m.fmt(m.v)}</div>
                  </div>
                ))}
              </div>

              {brandElasticityData.length > 0 && (
                <div>
                  <div className="text-xs font-medium mb-2">Brand Elasticity Summary</div>
                  <ResponsiveContainer width="100%" height={Math.max(120, brandElasticityData.length * 22)}>
                    <BarChart
                      data={brandElasticityData}
                      layout="vertical"
                      margin={{ left: 60, right: 30 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 9 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={60} />
                      <Tooltip
                        formatter={(v: any) => [Number(v).toFixed(3), "Elasticity"]}
                        contentStyle={{ fontSize: 11 }}
                      />
                      <ReferenceLine x={0} stroke="#666" strokeDasharray="3 3" />
                      <Bar dataKey="elasticity" radius={[0, 3, 3, 0]}>
                        {brandElasticityData.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={entry.elasticity < -1 ? "#ef4444" : entry.elasticity < 0 ? "#3b82f6" : "#10b981"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Red = highly elastic (&lt;−1), Blue = inelastic (−1 to 0)
                  </p>
                </div>
              )}

              <Button
                variant="outline"
                className="w-full gap-2 text-xs mt-3"
                size="sm"
                onClick={() => navigate("/cpg/price-elasticity/orion/deploy")}
              >
                Go to Deploy & Scoring
                <ArrowRight className="w-3 h-3 ml-auto" />
              </Button>
            </div>
          )}
        </div>

        {/* ── RIGHT: Charts & Table ── */}
        <div className="lg:col-span-3 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Experiments" value={allRuns.length} />
            <KpiCard
              label="Best RMSE"
              value={bestRmseRun && getRunRmse(bestRmseRun) != null
                ? Number(getRunRmse(bestRmseRun)).toFixed(3)
                : "—"}
            />
            <KpiCard
              label="Best Model"
              value={bestRmseRun ? shortenAlgorithm(bestRmseRun.algorithm) : "—"}
            />
            <KpiCard
              label="Deployed"
              value={(models as ModelType[]).filter(m => m.isDeployed).length}
            />
          </div>

          {/* Model Comparison Chart */}
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-3">
              Model Comparison (last 8 experiments)
            </h3>
            {allRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Run your first analysis to see comparisons.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={comparisonData} margin={{ left: 0, right: 10 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(1)}
                    label={{ value: "RMSE", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 10 } }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(2)}
                    label={{ value: "Elasticity", angle: 90, position: "insideRight", offset: 10, style: { fontSize: 10 } }}
                  />
                  <Tooltip
                    formatter={(v: any, name: string) => [
                      Number(v).toFixed(3),
                      name === "rmse" ? "RMSE" : "Global Elasticity",
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <ReferenceLine yAxisId="right" y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                  <Bar yAxisId="left" dataKey="rmse" name="rmse" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="right" dataKey="elasticity" name="elasticity" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* All Experiments Table */}
          <div className="border rounded-lg bg-card">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold">All Experiments</h3>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{allRuns.length} total</Badge>
                <button
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  onClick={() => navigate("/cpg/price-elasticity/orion/deploy")}
                >
                  Deploy & Score <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {[
                      "Run Name",
                      "Best Model",
                      "MAE",
                      "RMSE",
                      "R²",
                      "Global Elasticity",
                      "Rows Processed",
                      "Converged",
                      "Status",
                      "Actions",
                    ].map(h => (
                      <th
                        key={h}
                        className="text-left p-3 font-medium text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allRuns.length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-6 text-center text-muted-foreground">
                        No experiments yet. Run your first price elasticity analysis above.
                      </td>
                    </tr>
                  )}
                  {allRuns.map(run => {
                    const elas = getRunGlobalElasticity(run);
                    const converged = getRunConverged(run);
                    return (
                      <tr key={run.id} className="border-t hover:bg-muted/30 transition-colors">
                        <td className="p-3 font-medium max-w-[150px] truncate" title={run.name}>
                          {run.name}
                        </td>
                        <td className="p-3 font-semibold whitespace-nowrap">{run.algorithm || "—"}</td>
                        <td className="p-3 font-semibold text-blue-600 font-mono">
                          {asNumber(getRunMae(run))}
                        </td>
                        <td className="p-3 font-mono">
                          {getRunRmse(run) != null ? Number(getRunRmse(run)).toFixed(3) : "—"}
                        </td>
                        <td className="p-3 font-mono">
                          {getRunR2(run) != null ? Number(getRunR2(run)).toFixed(3) : "—"}
                        </td>
                        <td
                          className={`p-3 font-mono font-semibold ${
                            elas != null && elas < -1
                              ? "text-red-600"
                              : elas != null && elas < 0
                              ? "text-blue-600"
                              : "text-green-600"
                          }`}
                        >
                          {elas != null ? Number(elas).toFixed(3) : "—"}
                        </td>
                        <td className="p-3 font-mono">{asNumber(run.rowCount)}</td>
                        <td className="p-3">
                          {converged === null ? (
                            "—"
                          ) : converged ? (
                            <span className="text-green-600 font-medium">Yes</span>
                          ) : (
                            <span className="text-amber-600 font-medium">No</span>
                          )}
                        </td>
                        <td className="p-3">
                          <StatusBadge status={run.status} />
                        </td>
                        <td className="p-3">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] gap-1 px-2 text-red-600 hover:bg-red-50 border-red-200"
                            onClick={() => setDeleteTargetId(run.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <AlertDialog
        open={deleteTargetId !== null}
        onOpenChange={open => { if (!open) setDeleteTargetId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this experiment run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the experiment run and its results. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTargetId !== null && deleteMut.mutate(deleteTargetId)}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete Run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OrionLayout>
  );
}
