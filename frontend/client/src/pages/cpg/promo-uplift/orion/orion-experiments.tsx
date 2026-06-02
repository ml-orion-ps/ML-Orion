import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid,
} from "recharts";
import {
  FlaskConical, CheckCircle2, Trash2, Rocket, CircleSlash,
  TrendingUp, BarChart2, Zap,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type PromoSummary = Record<string, { activeRows: number; totalUpliftUnits: number; avgPctUplift: number }>;

type PromoUpliftResult = {
  success: boolean;
  modelId?: number;
  modelName?: string;
  datasetId?: number;
  datasetName?: string;
  summary: {
    algorithm: string;
    rowCount: number;
    featureCount: number;
    promoColumnsUsed: string[];
    metrics: { mae?: number; rmse?: number; r2?: number };
    promoSummary: PromoSummary;
    totals: Record<string, number>;
  };
  predictions: any[];
};

type UpliftModel = {
  id: number;
  name: string;
  datasetId: number;
  algorithm: string;
  status: string;
  isDeployed: boolean;
  auc: number | null;          // we store R2 in the auc column
  hyperparameters: { alpha?: number } | null;
  modelWeights: {
    modelType?: string;
    summary?: PromoUpliftResult["summary"];
  } | null;
  trainedAt: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const ALGORITHMS = [
  { value: "Ridge",            label: "Ridge",             group: "Linear",  desc: "L2 regularization — fast, stable baseline" },
  { value: "Lasso",            label: "Lasso",             group: "Linear",  desc: "L1 regularization — automatic feature selection" },
  { value: "ElasticNet",       label: "ElasticNet",        group: "Linear",  desc: "L1+L2 mix — good for collinear promo features" },
  { value: "RandomForest",     label: "Random Forest",     group: "Tree",    desc: "Bagged trees — handles non-linear promo effects" },
  { value: "XGBoost",          label: "XGBoost",           group: "Tree",    desc: "Gradient boosting — high accuracy, slower" },
  { value: "GradientBoosting", label: "Gradient Boosting", group: "Tree",    desc: "Sklearn GBDT — robust to outliers" },
  { value: "LightGBM",         label: "LightGBM",          group: "Tree",    desc: "Fast gradient boosting — best for large datasets" },
] as const;

type AlgorithmValue = (typeof ALGORITHMS)[number]["value"];

const MODEL_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

const ALGO_COLOR: Record<string, string> = {
  Ridge: "#3b82f6", Lasso: "#8b5cf6", ElasticNet: "#06b6d4",
  RandomForest: "#10b981", XGBoost: "#f59e0b",
  GradientBoosting: "#ef4444", LightGBM: "#84cc16",
};

// ── Formatters ────────────────────────────────────────────────────────────────

const asNumber  = (v: any) => v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-";
const asFrac    = (v: any) => v != null ? Number(v).toFixed(3) : "-";
const asPct     = (v: any) => v != null ? `${(Number(v) * 100).toFixed(1)}%` : "-";

// ── Component ─────────────────────────────────────────────────────────────────

export default function OrionExperiments() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [name,              setName]              = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [algorithm,         setAlgorithm]         = useState<AlgorithmValue>("Ridge");
  const [alpha,             setAlpha]             = useState("1.0");
  const [progress,          setProgress]          = useState(0);
  const [isRunning,         setIsRunning]         = useState(false);
  const [latestResult,      setLatestResult]      = useState<PromoUpliftResult | null>(null);
  const [deleteTarget,      setDeleteTarget]      = useState<UpliftModel | null>(null);
  const [chartMetric,       setChartMetric]       = useState<"R2" | "MAE" | "RMSE">("R2");

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: datasets = [] } = useQuery<any[]>({ queryKey: ["/api/cpg/promoUplift/datasets"] });
  const trainableDatasets = (datasets as any[]).filter((d: any) => d.rowCount > 0);

  const { data: allModels = [] } = useQuery<UpliftModel[]>({
    queryKey: ["/api/cpg/promoUplift/models"],
    refetchOnWindowFocus: false,
  });

  const upliftModels: UpliftModel[] = (allModels as UpliftModel[]).filter(
    (m) => m.modelWeights?.modelType === "promo_uplift"
  );

  const deployedCount = upliftModels.filter((m) => m.isDeployed).length;
  const bestModel = upliftModels.length > 0
    ? upliftModels.reduce((b, m) => ((m.auc ?? -Infinity) > (b.auc ?? -Infinity) ? m : b))
    : null;

  // ── Mutations ──────────────────────────────────────────────────────────────

  const runMut = useMutation({
    mutationFn: async ({ datasetId, algorithmVal, alphaVal, runName }: {
      datasetId: number; algorithmVal: string; alphaVal: number; runName: string;
    }) => {
      const res = await apiRequest("POST", `/api/cpg/promoUplift/datasets/${datasetId}/promo-uplift`, {
        algorithm: algorithmVal,
        alpha: alphaVal,
        name: runName,
      });
      return res.json() as Promise<PromoUpliftResult>;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/models"] });
      setLatestResult(result);
      toast({
        title: "Promo uplift complete",
        description: `[${result.summary.algorithm}] R²=${asFrac(result.summary.metrics?.r2)} — ${result.summary.promoColumnsUsed.length} mechanic(s)`,
      });
    },
    onError: (e: any) => toast({ title: "Promo uplift failed", description: e.message, variant: "destructive" }),
  });

  const deployMut = useMutation({
    mutationFn: async (modelId: number) => {
      const res = await apiRequest("POST", `/api/cpg/promoUplift/models/${modelId}/deploy`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/models"] });
      toast({ title: "Model deployed" });
    },
    onError: (e: any) => toast({ title: "Deploy failed", description: e.message, variant: "destructive" }),
  });

  const undeployMut = useMutation({
    mutationFn: async (modelId: number) => {
      const res = await apiRequest("POST", `/api/cpg/promoUplift/models/${modelId}/undeploy`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/models"] });
      toast({ title: "Model undeployed" });
    },
    onError: (e: any) => toast({ title: "Undeploy failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (modelId: number) => {
      await apiRequest("DELETE", `/api/cpg/promoUplift/models/${modelId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/models"] });
      setDeleteTarget(null);
      toast({ title: "Experiment deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  // ── Run handler ────────────────────────────────────────────────────────────

  const handleRun = async () => {
    if (!selectedDatasetId) return toast({ title: "Select a dataset", variant: "destructive" });
    setIsRunning(true);
    setProgress(0);
    setLatestResult(null);
    const iv = setInterval(() => setProgress(p => (p >= 92 ? (clearInterval(iv), p) : p + Math.random() * 10)), 250);
    try {
      await runMut.mutateAsync({
        datasetId: Number(selectedDatasetId),
        algorithmVal: algorithm,
        alphaVal: parseFloat(alpha) || 1.0,
        runName: name.trim(),
      });
    } finally {
      clearInterval(iv);
      setProgress(100);
      setTimeout(() => { setIsRunning(false); setProgress(0); }, 800);
    }
  };

  // ── Chart data ─────────────────────────────────────────────────────────────

  const last8 = upliftModels.slice(-8);
  const chartData = last8.map((m, i) => {
    const s = m.modelWeights?.summary;
    return {
      name: `#${upliftModels.indexOf(m) + 1} ${m.algorithm}`,
      R2:   s?.metrics?.r2   != null ? Number(s.metrics.r2)   : 0,
      MAE:  s?.metrics?.mae  != null ? Number(s.metrics.mae)  : 0,
      RMSE: s?.metrics?.rmse != null ? Number(s.metrics.rmse) : 0,
      fill: ALGO_COLOR[m.algorithm] ?? MODEL_COLORS[i % MODEL_COLORS.length],
    };
  });

  const isLinear = ["Ridge", "Lasso", "ElasticNet"].includes(algorithm);
  const algoInfo = ALGORITHMS.find(a => a.value === algorithm);

  // ── Saved result from the selected dataset ─────────────────────────────────
  const savedResult = (() => {
    const ds = trainableDatasets.find((d: any) => d.id === Number(selectedDatasetId));
    const saved = ds?.featureReport?.promoUplift ?? ds?.feature_report?.promoUplift;
    if (saved?.summary) return { success: true, summary: saved.summary, predictions: saved.preview || [] } as PromoUpliftResult;
    return null;
  })();

  const visibleResult = latestResult ?? savedResult;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <OrionLayout title="Experiment Lab" subtitle="Run promo uplift counterfactual experiments">
      <div className="mb-4"><OrionNav current="/cpg/promo-uplift/orion/experiments" basePath="/cpg/promo-uplift/orion" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* ── LEFT: Run Panel ──────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <FlaskConical className="w-4 h-4" /> New Experiment
            </h3>

            <div className="space-y-4">

              {/* Experiment type badge */}
              <div>
                <Label className="text-xs font-medium">Experiment Type</Label>
                <button className="mt-2 p-3 rounded-lg border border-primary bg-primary/5 text-left w-full">
                  <FlaskConical className="w-4 h-4 mb-1 text-primary" />
                  <div className="text-xs font-medium">Promo Uplift</div>
                  <div className="text-[10px] text-muted-foreground">Counterfactual uplift</div>
                </button>
              </div>

              {/* Experiment name */}
              <div>
                <Label className="text-xs font-medium">Experiment Name</Label>
                <Input
                  className="mt-1 h-8 text-xs"
                  placeholder="e.g. Promo Uplift Q1 2026"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              {/* Dataset */}
              <div>
                <Label className="text-xs font-medium">Promo Dataset</Label>
                <Select value={selectedDatasetId} onValueChange={setSelectedDatasetId}>
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue placeholder="Choose dataset..." />
                  </SelectTrigger>
                  <SelectContent>
                    {trainableDatasets.length === 0 && (
                      <SelectItem value="_none" disabled>No datasets uploaded yet</SelectItem>
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

              {/* Algorithm selector */}
              <div>
                <Label className="text-xs font-medium">Algorithm</Label>
                <Select value={algorithm} onValueChange={v => setAlgorithm(v as AlgorithmValue)}>
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Linear Models</div>
                    {ALGORITHMS.filter(a => a.group === "Linear").map(a => (
                      <SelectItem key={a.value} value={a.value}>
                        <span className="font-medium">{a.label}</span>
                        <span className="text-[10px] text-muted-foreground ml-2">— {a.desc}</span>
                      </SelectItem>
                    ))}
                    <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-1">Tree Models</div>
                    {ALGORITHMS.filter(a => a.group === "Tree").map(a => (
                      <SelectItem key={a.value} value={a.value}>
                        <span className="font-medium">{a.label}</span>
                        <span className="text-[10px] text-muted-foreground ml-2">— {a.desc}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {algoInfo && (
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                    <Badge variant="outline" className="text-[9px] px-1 py-0">{algoInfo.group}</Badge>
                    {algoInfo.desc}
                  </p>
                )}
              </div>

              {/* Alpha — only for linear models */}
              {isLinear && (
                <div>
                  <Label className="text-xs font-medium">
                    Alpha (regularization strength)
                  </Label>
                  <Input
                    className="mt-1 h-8 text-xs font-mono"
                    placeholder="1.0"
                    value={alpha}
                    onChange={e => setAlpha(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    L2 penalty for Ridge/ElasticNet or L1 for Lasso. Higher = stronger regularization.
                  </p>
                </div>
              )}

              {/* Progress */}
              {isRunning && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="animate-pulse">Running [{algorithm}] uplift analysis…</span>
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

              <Button className="w-full" onClick={handleRun} disabled={isRunning}>
                {isRunning ? `Running ${algorithm}…` : "Run Promo Uplift"}
              </Button>
            </div>
          </div>

          {/* Result card */}
          {visibleResult && (
            <div className="border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-1.5 text-green-700">
                  <CheckCircle2 className="w-4 h-4" /> Uplift Complete
                </h3>
                <div className="flex gap-1">
                  <Badge
                    variant="outline"
                    className="text-[10px]"
                    style={{ borderColor: ALGO_COLOR[visibleResult.summary.algorithm] ?? undefined, color: ALGO_COLOR[visibleResult.summary.algorithm] ?? undefined }}
                  >
                    {visibleResult.summary.algorithm}
                  </Badge>
                  {visibleResult.modelId && (
                    <Badge variant="secondary" className="text-[10px]">ID #{visibleResult.modelId}</Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { label: "Rows",      value: asNumber(visibleResult.summary.rowCount) },
                  { label: "Features",  value: asNumber(visibleResult.summary.featureCount) },
                  { label: "R²",        value: asFrac(visibleResult.summary.metrics?.r2) },
                  { label: "MAE",       value: asNumber(visibleResult.summary.metrics?.mae) },
                  { label: "RMSE",      value: asNumber(visibleResult.summary.metrics?.rmse) },
                  { label: "Mechanics", value: String(visibleResult.summary.promoColumnsUsed?.length ?? 0) },
                ].map(m => (
                  <div key={m.label} className="bg-muted/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{m.label}</div>
                    <div className="text-sm font-bold text-primary">{m.value}</div>
                  </div>
                ))}
              </div>

              {Object.keys(visibleResult.summary.promoSummary ?? {}).length > 0 && (
                <div className="space-y-2 mt-3">
                  <div className="text-xs font-medium">Uplift by Mechanic</div>
                  {Object.entries(visibleResult.summary.promoSummary).map(([mech, stats]) => (
                    <div key={mech} className="bg-muted/20 rounded p-2 text-xs">
                      <div className="flex justify-between mb-0.5">
                        <span className="font-mono font-medium">{mech}</span>
                        <Badge variant="secondary" className="text-[10px]">{stats.activeRows?.toLocaleString()} rows</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        <div><span className="text-muted-foreground">Total uplift: </span><span className="font-semibold">{asNumber(stats.totalUpliftUnits)}</span></div>
                        <div><span className="text-muted-foreground">Avg % uplift: </span><span className="font-semibold text-green-700">{asPct(stats.avgPctUplift)}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(visibleResult.summary.promoColumnsUsed?.length ?? 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {visibleResult.summary.promoColumnsUsed.map(col => (
                    <Badge key={col} variant="secondary" className="text-[10px]">{col}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Charts & Table ─────────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Experiments" value={upliftModels.length} />
            <KpiCard label="Best R²" value={bestModel?.auc != null ? Number(bestModel.auc).toFixed(3) : "-"} />
            <KpiCard label="Best Algorithm" value={bestModel?.algorithm ?? "-"} />
            <KpiCard label="Deployed" value={deployedCount} />
          </div>

          {/* Comparison chart */}
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <BarChart2 className="w-4 h-4" /> Model Comparison (last 8)
              </h3>
              <div className="flex gap-1">
                {(["R2", "MAE", "RMSE"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setChartMetric(m)}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${chartMetric === m ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {upliftModels.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Train your first model to see comparisons.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis
                    domain={chartMetric === "R2" ? [0, 1] : ["auto", "auto"]}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    formatter={(v: any) => [Number(v).toFixed(3), chartMetric]}
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Bar
                    dataKey={chartMetric}
                    radius={[3, 3, 0, 0]}
                    fill="#3b82f6"
                    label={{ position: "top", fontSize: 9, formatter: (v: any) => Number(v).toFixed(2) }}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Algorithm distribution mini-chart */}
          {upliftModels.length > 0 && (
            <div className="border rounded-lg p-4 bg-card">
              <h3 className="text-xs font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5" /> Algorithm Distribution
              </h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(
                  upliftModels.reduce<Record<string, number>>((acc, m) => {
                    acc[m.algorithm] = (acc[m.algorithm] ?? 0) + 1;
                    return acc;
                  }, {})
                ).map(([algo, count]) => (
                  <div
                    key={algo}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs"
                    style={{ borderColor: ALGO_COLOR[algo] ?? "#94a3b8", color: ALGO_COLOR[algo] ?? "#94a3b8" }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: ALGO_COLOR[algo] ?? "#94a3b8" }} />
                    {algo} <span className="font-bold">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Experiments table */}
          <div className="border rounded-lg bg-card">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4" /> All Experiments
              </h3>
              <Badge variant="outline">{upliftModels.length} total</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {["Run Name", "Dataset", "Algorithm", "R²", "MAE", "RMSE", "Mechanics", "Status", "Actions"].map(h => (
                      <th key={h} className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {upliftModels.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-6 text-center text-muted-foreground">
                        No experiments yet. Train your first model above.
                      </td>
                    </tr>
                  )}
                  {upliftModels.map(model => {
                    const s = model.modelWeights?.summary;
                    const mechanics = s?.promoColumnsUsed ?? [];
                    return (
                      <tr key={model.id} className="border-t hover:bg-muted/30 transition-colors">
                        <td className="p-3 font-medium max-w-[130px] truncate" title={model.name}>
                          <div className="flex items-center gap-1">
                            {model.isDeployed && <Rocket className="w-3 h-3 text-green-600 flex-shrink-0" />}
                            <span>{model.name}</span>
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground max-w-[90px] truncate">
                          DS #{model.datasetId}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className="text-[10px]"
                            style={{ borderColor: ALGO_COLOR[model.algorithm] ?? undefined, color: ALGO_COLOR[model.algorithm] ?? undefined }}
                          >
                            {model.algorithm}
                          </Badge>
                        </td>
                        <td className="p-3 font-semibold font-mono" style={{ color: ALGO_COLOR[model.algorithm] ?? "#3b82f6" }}>
                          {asFrac(s?.metrics?.r2)}
                        </td>
                        <td className="p-3 font-mono">{asNumber(s?.metrics?.mae)}</td>
                        <td className="p-3 font-mono">{asNumber(s?.metrics?.rmse)}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {mechanics.map((c: string) => (
                              <Badge key={c} variant="secondary" className="text-[9px] px-1">
                                {c.replace(/_flag|_depth/g, "")}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="p-3">
                          <StatusBadge status={model.isDeployed ? "Deployed" : model.status} />
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            {model.isDeployed ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] gap-1 px-2 text-amber-600 hover:bg-amber-50 border-amber-200"
                                onClick={() => undeployMut.mutate(model.id)}
                                disabled={undeployMut.isPending}
                                title="Undeploy"
                              >
                                <CircleSlash className="w-3 h-3" />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] gap-1 px-2 text-green-600 hover:bg-green-50 border-green-200"
                                onClick={() => deployMut.mutate(model.id)}
                                disabled={deployMut.isPending}
                                title="Deploy"
                              >
                                <Rocket className="w-3 h-3" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] gap-1 px-2 text-red-600 hover:bg-red-50 border-red-200"
                              onClick={() => setDeleteTarget(model)}
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
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

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this experiment?</AlertDialogTitle>
            <AlertDialogDescription>
              "<span className="font-semibold">{deleteTarget?.name}</span>" will be permanently removed from the registry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OrionLayout>
  );
}
