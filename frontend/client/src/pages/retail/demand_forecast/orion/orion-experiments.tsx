import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// import { Slider } from "@/components/ui/slider";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import {
  FlaskConical, Database, Upload, Rocket, Zap, ArrowRight,
  // ChevronDown, ChevronUp, 
  CheckCircle2, Trash2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const FALLBACK_ALGORITHMS_DEMAND = [
  { value: "Auto", label: "AutoML Forecasting", desc: "Automatically selects the best forecasting model" },
  { value: "Exponential Smoothing", label: "Exponential Smoothing", desc: "Captures level and trend patterns" },
  { value: "SARIMA", label: "SARIMA", desc: "Seasonal autoregressive forecasting model" },
  { value: "SARIMAX", label: "SARIMAX", desc: "SARIMA with exogenous variables like promotions" },
  { value: "XGBoost", label: "XGBoost", desc: "Tree boosting model for demand forecasting" },
  { value: "LightGBM", label: "LightGBM", desc: "Fast, distributed gradient boosting" },
];


type ModelType = {
  id: number; name: string; algorithm: string; status: string; trainedAt: string; isDeployed: boolean;
  
  mape: number; wmape: number; rmse: number; r2: number; 

  actualUnits?: number; forecastUnits?: number; 

  modelWeights?: any;

  featureImportance?: {
    name: string;
    importance: number;
  }[];
};

type DemandForecastResult = {
  success: boolean;
  summary: {
    featureCount: number;
    featuresUsed: string[];
    bestModel: string;
    modelType: string;
    bestParams: Record<string, any>;
    metrics: { WMAPE?: number; MAPE?: number; RMSE?: number; R2?: number };
    totals: {
      actualUnits?: number;
      forecastUnits?: number;
    };
    Feature_Importance: Record<string, number>;
    Fallback_Triggered: boolean;
    predictions: any[]; // 4-row global aggregated series (internal, not shown in table)
  };
  data: any[];              // Style Code / Store level forecast rows — shown in preview table
  unique_combinations?: number;
};


const asPercent = (v: any) => (v != null ? `${(Number(v) * 100).toFixed(1)}%` : "—");
const asFraction = (v: any) => (v != null ? Number(v).toFixed(3) : "—");
const asLift = (v: any) => (v != null ? `${Number(v).toFixed(2)}x` : "—");
const asNumber = (v: any) => (v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-");
const cleanModelName = (value: any) => {
  if (!value) return null;
  const text = String(value).trim();
  const autoMatch = text.match(/^Auto\s*\((.+)\)$/i);
  return autoMatch?.[1] || text;
};
const getRunBestModel = (run: any) =>
  cleanModelName(run.bestModel) ||
  cleanModelName(run.modelWeights?.bestModel) ||
  cleanModelName(run.modelWeights?.summary?.bestModel) ||
  cleanModelName(run.algorithm) ||
  "—";
const getRunBaselineUnits = (run: any) =>
  run.baselineUnits ?? run.modelWeights?.totals?.baselineWithoutPromoUnits ?? run.modelWeights?.predictionTotals?.baselineWithoutPromoUnits;
const getRunPromoUnits = (run: any) =>
  run.promoEffectUnits ?? run.promoUnits ?? run.modelWeights?.totals?.promoEffectUnits ?? run.modelWeights?.predictionTotals?.promoEffectUnits;

export default function OrionExperiments() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [experimentType, setExperimentType] = useState<"forecast">("forecast");
  const [source, setSource] = useState<"live" | "dataset">("live");
  const [algorithm, setAlgorithm] = useState("Auto");
  const [name, setName] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [forecastModels, setforecastModels] = useState<string[]>(["Exponential Smoothing", "SARIMA", "SARIMAX", "XGBoost", "LightGBM"]);
  const [forecastResult, setforecastResult] = useState<DemandForecastResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [isTraining, setIsTraining] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelType | null>(null);
  const [justTrainedId, setJustTrainedId] = useState<number | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [showHyperparams, setShowHyperparams] = useState(false);
  const [nEstimators, setNEstimators] = useState(200);
  const [maxDepth, setMaxDepth] = useState(8);
  const [learningRate, setLearningRate] = useState(10);
  const [minSamplesLeaf, setMinSamplesLeaf] = useState(10);
  const [svmC, setSvmC] = useState(100); // UI displays 1.0 (100/100)
  const [svmKernel, setSvmKernel] = useState("rbf");
  const [fiSelectedModelId, setFiSelectedModelId] = useState<number | null>(null);

  // const { data: models = [] } = useQuery<ModelType[]>({ queryKey: [`${API_BASE}/models`] });
  // const { data: datasets = [] } = useQuery<any[]>({ queryKey: [`${API_BASE}/datasets`] });
  // const { data: customerDs } = useQuery<any>({ queryKey: ["/api/cpg/orion/customer-dataset"] });
  // const { data: dynamicAlgos = [] } = useQuery<any[]>({ queryKey: ["/api/cpg/orion/algorithms"] });
  const API_BASE = "/api/retail/demand_forecast";

  const { data: models = [] } = useQuery<ModelType[]>({
    queryKey: [`${API_BASE}/models`],
  });

  const { data: datasets = [] } = useQuery<any[]>({
    queryKey: [`${API_BASE}/datasets`],
  });

  const { data: customerDs } = useQuery<any>({
    queryKey: [`${API_BASE}/orion/customer-dataset`],
  });

  const { data: dynamicAlgos = [] } = useQuery<any[]>({
    queryKey: [`${API_BASE}/orion/algorithms`],
  });

  const ALGORITHMS_DEMAND = dynamicAlgos.length > 0 ? dynamicAlgos : FALLBACK_ALGORITHMS_DEMAND;

  // Parse JSON properly in both mutations
  const trainFromDatasetMut = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", `${API_BASE}/models/train`, body);
      return res.json();
    },
    onSuccess: (m: ModelType) => {
      qc.invalidateQueries({ queryKey: [`${API_BASE}/models`] });
      qc.invalidateQueries({ queryKey: [`${API_BASE}/orion/overview`] });
      qc.invalidateQueries({ queryKey: [`${API_BASE}/predictions`] });
      qc.invalidateQueries({ queryKey: ["/api/retail/analytics/forecast monitoring"] });
      qc.invalidateQueries({ queryKey: ["/api/retail/recommendations"] });
      setSelectedModel(m);
      setJustTrainedId(m.id);
      toast({ title: "Forecasting complete!", description: `${m.algorithm} — WMAPE ${m.wmape !== null && m.wmape !== undefined ? Number(m.wmape).toFixed(1) : "—"}%` });
    },
    onError: (e: any) => toast({ title: "Training failed", description: e.message, variant: "destructive" }),
  });

  const trainLiveMut = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", `${API_BASE}/models/train-live`, body);
      return res.json();
    },
    onSuccess: (m: ModelType) => {
      qc.invalidateQueries({ queryKey: [`${API_BASE}/models`] });
      qc.invalidateQueries({ queryKey: [`${API_BASE}/orion/overview`] });
      qc.invalidateQueries({ queryKey: [`${API_BASE}/predictions`] });
      setSelectedModel(m);
      setJustTrainedId(m.id);
      toast({ title: "Training complete!", description: `${m.algorithm} — WMAPE ${m.wmape !== null && m.wmape !== undefined ? Number(m.wmape).toFixed(1) : "—"}%` });
    },
    onError: (e: any) => toast({ title: "Training failed", description: e.message, variant: "destructive" }),
  });

  const forecastedDemandMut = useMutation({
    mutationFn: async ({ datasetId, modelsToRun, name }: { datasetId: number; modelsToRun: string[]; name?: string }) => {
      const res = await apiRequest("POST", `${API_BASE}/datasets/${datasetId}/demand_forecast`, { modelsToRun, name });
      return res.json();
    },
    onSuccess: (result: DemandForecastResult) => {
      qc.invalidateQueries({ queryKey: [`${API_BASE}/datasets`] });
      qc.invalidateQueries({ queryKey: [`${API_BASE}/models`] });
      qc.invalidateQueries({ queryKey: [`${API_BASE}/orion/overview`] });
      setforecastResult(result);
      setSelectedModel(null);
      toast({
        title: "Demand forecasting complete",
        description: `${result.unique_combinations?.toLocaleString()} rows scored — best model: ${result.summary.bestModel || "Unknown"}`,
      });
    },
    onError: (e: any) => toast({ title: "Demand forecasting failed", description: e.message, variant: "destructive" }),
  });

  const deployMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `${API_BASE}/models/${id}/deploy`);
      return res.json();
    },
    onSuccess: (m: ModelType) => {
      qc.invalidateQueries({ queryKey: [`${API_BASE}/models`] });
      setSelectedModel(prev => prev?.id === m.id ? { ...prev, isDeployed: true, status: "deployed" } : prev);
      toast({
        title: "Model deployed!",
        description: "Navigate to Deploy & Scoring to score all customers.",
      });
    },
    onError: (e: any) => toast({ title: "Deploy failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `${API_BASE}/models/${id}`);
      return res.json();
    },
    onSuccess: (_: any, id: number) => {
      qc.invalidateQueries({ queryKey: [`${API_BASE}/models`] });
      qc.invalidateQueries({ queryKey: [`${API_BASE}/predictions`] });
      qc.invalidateQueries({ queryKey: [`${API_BASE}/orion/overview`] });
      if (selectedModel?.id === id) setSelectedModel(null);
      setDeleteTargetId(null);
      toast({ title: "Model deleted", description: "The model and all its predictions have been removed." });
    },
    onError: (e: any) => {
      setDeleteTargetId(null);
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    },
  });


  const handleTrain = async () => {
    const isBaseline = experimentType === "forecast";
    if (isBaseline && forecastModels.length === 0) return toast({ title: "Select at least one model", variant: "destructive" });
    if (!isBaseline && !algorithm) return toast({ title: "Select an algorithm", variant: "destructive" });
    if ((isBaseline || source === "dataset") && !selectedDatasetId) return toast({ title: "Select a dataset", variant: "destructive" });
    if (isBaseline || source === "dataset") {
      const ds = datasets.find((d: any) => d.id === Number(selectedDatasetId));
      if (!ds) return toast({ title: "Dataset not found", variant: "destructive" });
    }

    setIsTraining(true);
    setProgress(0);
    setJustTrainedId(null);
    if (isBaseline) setforecastResult(null);
    const iv = setInterval(() => setProgress(p => (p >= 92 ? (clearInterval(iv), p) : p + Math.random() * 12)), 200);
    try {
      if (isBaseline) {
        const forecastName = name.trim() || `Demand Forecast – ${algorithm} – ${new Date().toLocaleDateString()}`;
        await forecastedDemandMut.mutateAsync({
          datasetId: Number(selectedDatasetId),
          modelsToRun: forecastModels,
          name: forecastName,
        });
        return;
      }
      const mName = name || `${algorithm} (${source === "live" ? "Live DB" : "Dataset"}) – ${new Date().toLocaleDateString()}`;
      const hyperparameters = !showHyperparams ? null : (
        algorithm === "Support Vector Machine" ? { svm_C: svmC / 100, svm_kernel: svmKernel } :
        algorithm === "Decision Tree" ? { dt_max_depth: maxDepth, dt_min_samples_leaf: minSamplesLeaf } :
        algorithm === "Random Forest" ? { rf_n_estimators: nEstimators, rf_max_depth: maxDepth, rf_min_samples_leaf: minSamplesLeaf } :
        { n_estimators: nEstimators, max_depth: maxDepth, learning_rate: learningRate / 100 }
      );

      if (source === "live") {
        await trainLiveMut.mutateAsync({
          algorithm,
          name: mName,
          hyperparameters,
        });
      } else {
        await trainFromDatasetMut.mutateAsync({
          datasetId: Number(selectedDatasetId),
          algorithm,
          name: mName,
          hyperparameters,
        });
      }
    } finally {
      clearInterval(iv);
      setProgress(100);
      setTimeout(() => { setIsTraining(false); setProgress(0); }, 800);
    }
  };

  const trainableDatasets = datasets.filter((d: any) => d.rowCount > 0);
  const algInfo = ALGORITHMS_DEMAND.find(a => a.value === algorithm);
  const selectedDataset = trainableDatasets.find((d: any) => d.id === Number(selectedDatasetId));
  const savedBaselineResult = selectedDataset?.featureReport?.DemandForecasting ?? selectedDataset?.feature_report?.baselinePrediction;
  const visibleForecastResult = forecastResult ?? (savedBaselineResult?.summary ? {
    success: true,
    summary: savedBaselineResult.summary,
    data: savedBaselineResult.preview || [],          // Style Code-level rows stored in feature_report
    unique_combinations: savedBaselineResult.unique_combinations,
  } as DemandForecastResult : null);
  // Use SKU-level rows (result.data), not the 4-row global aggregated series (summary.predictions)
  const forecastPreview = (visibleForecastResult?.data || []).slice(0, 8);

 
  const last8Models = (models as ModelType[]).slice(-8);
  const forecastRuns = [...(models as any[])].sort((a, b) => {
    const aTime = a.trainedAt ? new Date(a.trainedAt).getTime() : 0;
    const bTime = b.trainedAt ? new Date(b.trainedAt).getTime() : 0;
    return bTime - aTime;
  });
  const last8forecastRuns = forecastRuns.slice(0, 8).reverse();
  const bestforecastRuns = forecastRuns.length > 0
    ? forecastRuns.reduce((b, r) => {
        const rScore = r.wmape != null ? Number(r.wmape) : Infinity;
        const bScore = b.wmape != null ? Number(b.wmape) : Infinity;
        return rScore < bScore ? r : b;
      })
    : null;
  const forecastRunsChartKeys = last8forecastRuns.map((r) => `#${forecastRuns.indexOf(r) + 1} ${getRunBestModel(r)}`);
  const forecastComparisonData = last8forecastRuns.map((r, i) => ({
    name: forecastRunsChartKeys[i],
    WMAPE: r.wmape != null ? Number(r.wmape) : 0,
  }));


  const maxBaselineRmse = Math.max(...forecastComparisonData.map((r) => r.WMAPE), 1.2);

  const MODEL_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

  // Short unique label per model: "#1 LightGBM", "#2 XGBoost", etc.
  const modelChartKeys = last8Models.map((m, i) => {
    const alg = m.algorithm.replace("Random Forest", "RF").replace("LightGBM", "LGB").replace("XGBoost", "XGB").replace("Auto (LightGBM)", "Auto-LGB").replace("Auto (Random Forest)", "Auto-RF").replace("Auto (XGBoost)", "Auto-XGB");
    return `#${i + 1} ${alg.split(" ")[0]}`;
  });


  const bestModel = (models as ModelType[]).length > 0
    ? (models as ModelType[]).reduce((b, m) => (m.wmape || Infinity) < (b.wmape || Infinity) ? m : b)
    : null;

  const modelsWithFeatures = (models as ModelType[]).filter(
    m => Array.isArray(m.featureImportance) && (m.featureImportance as any[]).some((f: any) => Number(f.importance) > 0)
  );

  const effectiveFiModelId =
    fiSelectedModelId ??
    modelsWithFeatures.find(m => m.id === selectedModel?.id)?.id ??
    modelsWithFeatures.find(m => m.id === bestModel?.id)?.id ??
    modelsWithFeatures[0]?.id ??
    null;

  const fiModel = (models as ModelType[]).find(m => m.id === effectiveFiModelId) ?? null;

  const fiFeatureData = fiModel
    ? ((fiModel.featureImportance as any[]) || [])
        .filter((f: any) => Number(f.importance) > 0)
        .slice(0, 15)
        .map((f: any) => ({
          feature: f.name.replace(/_/g, " "),
          importance: Number(f.importance),
        }))
    : [];

  return (
    <OrionLayout title="Experiment Lab" subtitle="Run model to forecast the demand">
      <div className="mb-4"><OrionNav current="/retail/demand_forecast/orion/experiments" basePath="/retail/demand_forecast/orion" /></div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── LEFT: Train Panel ── */}
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
                    onClick={() => {
                      setExperimentType("forecast");
                      setSource("dataset");
                    }}
                    className={`p-3 rounded-lg border text-left transition-all ${experimentType === "forecast" ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
                    data-testid="button-experiment-baseline"
                  >
                    <Zap className="w-4 h-4 mb-1 text-primary" />
                    <div className="text-xs font-medium">Demand Forecasting</div>
                    <div className="text-[10px] text-muted-foreground">Predictive Modelling</div>
                  </button>
                </div>
              </div>

              {}
              {experimentType === "forecast" && (
              <div>
                <Label className="text-xs font-medium">Experiment Name</Label>
                <Input
                  className="mt-1 h-8 text-xs"
                  placeholder="e.g. XGBoost v1"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  data-testid="input-experiment-name"
                />
              </div>
              )}
              {experimentType === "forecast" && (
              <div>
                <Label className="text-xs font-medium">Training Data Source</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    onClick={() => setSource("live")}
                    className={`p-3 rounded-lg border text-left transition-all ${source === "live" ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
                    data-testid="button-source-live"
                  >
                    <Database className="w-4 h-4 mb-1 text-primary" />
                    <div className="text-xs font-medium">Live Retail Demand Dataset</div>
                    <div className="text-[10px] text-muted-foreground">{customerDs?.rowCount?.toLocaleString() || "500"} records</div>
                  </button>
                  <button
                    onClick={() => setSource("dataset")}
                    className={`p-3 rounded-lg border text-left transition-all ${source === "dataset" ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
                    data-testid="button-source-dataset"
                  >
                    <Upload className="w-4 h-4 mb-1 text-primary" />
                    <div className="text-xs font-medium">Uploaded Dataset</div>
                    <div className="text-[10px] text-muted-foreground">{trainableDatasets.length} ready</div>
                  </button>
                </div>
              </div>
              )}
              {experimentType === "forecast" && source === "live" && customerDs && (
                <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-1">
                  <div className="font-medium">Live Customer Database</div>
                  <div className="text-muted-foreground">{customerDs.rowCount?.toLocaleString()} rows · {customerDs.columnCount} features</div>
                  <div className="text-muted-foreground">Target: <span className="font-mono">sales_units</span> — sales revenue {customerDs.targetDistribution?.churnRate}%</div>
                  <div className="text-muted-foreground">Quality score: {customerDs.qualityScore}/100</div>
                </div>
              )}
              {(experimentType === "forecast" || source === "dataset") && (
                <div>
                  <Label className="text-xs font-medium">{experimentType === "forecast" ? "RGM Dataset" : "Select Dataset"}</Label>
                  <Select value={selectedDatasetId} onValueChange={setSelectedDatasetId}>
                    <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-dataset-train">
                      <SelectValue placeholder="Choose dataset…" />
                    </SelectTrigger>
                    <SelectContent>
                      {trainableDatasets.length === 0 && <SelectItem value="_none" disabled>No quality-checked datasets</SelectItem>}
                      {trainableDatasets.map((d: any) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.name} ({d.rowCount?.toLocaleString()} rows)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {trainableDatasets.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">Upload a dataset in Data Hub first.</p>
                  )}
                </div>
              )}
              


              {}

              {experimentType === "forecast" && (
              <div>
                <Label className="text-xs font-medium">Algorithm</Label>
                <Select
                  value={algorithm}
                  onValueChange={(value) => {
                    setAlgorithm(value);
                    const modelMap: Record<string, string[]> = {
                      Auto: ["Exponential Smoothing", "SARIMA", "SARIMAX", "XGBoost","LightGBM"],
                      "Exponential Smoothing": ["Exponential Smoothing"],
                      "SARIMA": ["SARIMA"],
                      "SARIMAX": ["SARIMAX"],
                      "XGBoost": ["XGBoost"],
                      "LightGBM": ["LightGBM"],
                    };
                    setforecastModels(modelMap[value] || ["Exponential Smoothing", "SARIMA", "SARIMAX", "XGBoost", "LightGBM"]);
                  }}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-algorithm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALGORITHMS_DEMAND.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {algInfo && <p className="text-[10px] text-muted-foreground mt-1">{algInfo.desc}</p>}
              </div>
              )}


              {}


              {isTraining && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="animate-pulse">{experimentType === "forecast" ? "Running forecast model(s) ..." : `Training ${algorithm}...`}</span>
                    <span>{Math.min(100, Math.round(progress))}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-300 rounded-full" style={{ width: `${Math.min(100, progress)}%` }} />
                  </div>
                </div>
              )}

              <Button className="w-full" onClick={handleTrain} disabled={isTraining || (experimentType === "forecast" && forecastModels.length === 0)} data-testid="button-train">
                {isTraining ? (experimentType === "forecast" ? "Running..." : "Training...") : (experimentType === "forecast" ? "Run Forecast" : "Train Model")}
              </Button>
            </div>
          </div>

          {/* ── Training Result Panel (disabled/legacy) ── */}
          {false && visibleForecastResult && (
            <div className="border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-1.5 text-green-700">
                  <CheckCircle2 className="w-4 h-4" /> Forecasting Complete
                </h3>
                <Badge variant="outline" className="text-[10px]">RGM</Badge>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { label: "Features", value: asNumber(visibleForecastResult?.summary?.featureCount) },
                  { label: "R²", value: asFraction(visibleForecastResult?.summary?.metrics?.R2) },
                  // { label: "WMAPE", value: asFraction(visibleForecastResult?.summary?.metrics?.WMAPE) },
                  { label: "MAPE", value: asNumber(visibleForecastResult?.summary?.metrics?.MAPE) },
                  { label: "WMAPE", value: asNumber(visibleForecastResult?.summary?.metrics?.WMAPE) },
                  { label: "RMSE", value: asNumber(visibleForecastResult?.summary?.metrics?.RMSE) },
                  { label: "Features", value: asNumber(visibleForecastResult?.summary?.featuresUsed?.length ?? 0) },
                ].map(m => (
                  <div key={m.label} className="bg-muted/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{m.label}</div>
                    <div className="text-sm font-bold text-primary">{m.value}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                {[
                  { label: "Actual Units", value: visibleForecastResult?.summary?.totals?.actualUnits },
                  { label: "Forecasted Units", value: visibleForecastResult?.summary?.totals?.forecastUnits },
                ].map(item => (
                  <div key={item.label} className="rounded bg-muted/20 p-2">
                    <div className="text-[10px] text-muted-foreground">{item.label}</div>
                    <div className="font-semibold">{asNumber(item.value)}</div>
                  </div>
                ))}
              </div>

              {(visibleForecastResult?.summary?.featuresUsed?.length ?? 0) > 0 && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {visibleForecastResult?.summary?.featuresUsed?.map(col => (
                    <Badge key={col} variant="secondary" className="text-[10px]">{col}</Badge>
                  ))}
                </div>
              )}

              {forecastPreview.length > 0 && (
                <div className="overflow-x-auto border rounded">
                  <table className="w-full text-[10px]">
                    <thead className="bg-muted/50">
                      <tr>
                        {["Style Code", "Store", "Week", "Actual Units", "Forecast"].map(h => (
                          <th key={h} className="text-left p-2 font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {forecastPreview.map((row: any, idx: number) => (
                        <tr key={`${row["Style Code"] || idx}-${row.store || idx}-${row.Week_Date || idx}`} className="border-t">
                          <td className="p-2 max-w-[120px] truncate font-mono" title={row["Style Code"]}>{row["Style Code"] || "—"}</td>
                          <td className="p-2">{row.store || "—"}</td>
                          <td className="p-2 whitespace-nowrap">{row.Week_Date || "—"}</td>
                          <td className="p-2 font-mono">{asNumber(row["Net Shipped"])}</td>
                          <td className="p-2 font-mono text-primary">{asNumber(row.Forecast)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {(selectedModel || (experimentType === "forecast" && visibleForecastResult)) && (
            <div className="border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">
                  {visibleForecastResult && experimentType === "forecast" ? (
                    <span className="flex items-center gap-1.5 text-green-700">
                      <CheckCircle2 className="w-4 h-4" /> Forecast Complete
                    </span>
                  ) : justTrainedId === selectedModel?.id ? (
                    <span className="flex items-center gap-1.5 text-green-700">
                      <CheckCircle2 className="w-4 h-4" /> Forecast Complete
                    </span>
                  ) : (
                    `Result: ${selectedModel?.algorithm}`
                  )}
                </h3>
                {visibleForecastResult && experimentType === "forecast" && (
                  <Badge variant="outline" className="text-[10px]">RGM</Badge>
                )}
                {selectedModel?.isDeployed && (
                  <Badge className="bg-green-100 text-green-700 text-[10px]">Production</Badge>
                )}
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {(visibleForecastResult && experimentType === "forecast" ? [
                  { label: "Features", v: visibleForecastResult.summary.featureCount, formatter: asNumber },
                  { label: "R²", v: visibleForecastResult.summary.metrics?.R2, formatter: asFraction },
                  { label: "WMAPE", v: visibleForecastResult.summary.metrics?.WMAPE, formatter: asNumber },
                  { label: "MAPE", v: visibleForecastResult.summary.metrics?.MAPE, formatter: asNumber },
                  { label: "RMSE", v: visibleForecastResult.summary.metrics?.RMSE, formatter: asNumber },
                ] : [
                  { label: "MAPE", v: selectedModel?.mape, formatter: asNumber },
                  { label: "WMAPE", v: selectedModel?.wmape, formatter: asNumber },
                  { label: "R2", v: selectedModel?.r2, formatter: asFraction },
                  { label: "RMSE", v: selectedModel?.rmse, formatter: asNumber },
                ]).map(m => (
                  <div key={m.label} className="bg-muted/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{m.label}</div>
                    <div className="text-sm font-bold text-primary">{m.formatter(m.v)}</div>
                  </div>
                ))}
                {visibleForecastResult && experimentType === "forecast" ? (
                  <div className="bg-blue-50 rounded p-2 text-center border border-blue-200">
                    <div className="text-[10px] text-blue-700">Best Model</div>
                    <div className="text-xs font-bold text-blue-700">{visibleForecastResult.summary.bestModel || "—"}</div>
                  </div>
                ) : (
                  <div className="bg-blue-50 rounded p-2 text-center border border-blue-200">
                    <div className="text-[10px] text-blue-700">Weights</div>
                    <div className="text-xs font-bold text-blue-700">{selectedModel?.modelWeights ? "Real ML" : "Formula"}</div>
                  </div>
                )}
              </div>

              {/* Confusion Matrix */}
              {/* {cm && (
                <div className="mb-3">
                  <div className="text-xs font-medium mb-2">Confusion Matrix (test set)</div>
                  <div className="grid grid-cols-2 gap-1 max-w-[160px]">
                    {[
                      { label: "TP", value: cm.tp, cls: "bg-green-100 text-green-700" },
                      { label: "FP", value: cm.fp, cls: "bg-red-100 text-red-700" },
                      { label: "FN", value: cm.fn, cls: "bg-amber-100 text-amber-700" },
                      { label: "TN", value: cm.tn, cls: "bg-green-100 text-green-700" },
                    ].map(c => (
                      <div key={c.label} className={`rounded p-2 text-center text-xs font-semibold ${c.cls}`}>
                        {c.label}: {c.value}
                      </div>
                    ))}
                  </div>
                </div>
              )} */}

              {/* Action buttons */}
              {selectedModel && (
              <div className="space-y-2">
                {!selectedModel.isDeployed && (
                  <Button
                    className="w-full gap-2 text-xs"
                    size="sm"
                    onClick={() => deployMut.mutate(selectedModel.id)}
                    disabled={deployMut.isPending}
                    data-testid="button-deploy-result"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    {deployMut.isPending ? "Deploying…" : "Deploy to Production"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="w-full gap-2 text-xs"
                  size="sm"
                  onClick={() => navigate("/retail/demand_forecast/orion/deploy")}
                  data-testid="button-goto-deploy"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Go to Deploy & Scoring
                  <ArrowRight className="w-3 h-3 ml-auto" />
                </Button>
              </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Charts & Table ── */}
        <div className="lg:col-span-3 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Experiments" value={forecastRuns.length} />
            <KpiCard label="Best MAPE" value={bestforecastRuns?.rmse != null ? Number(bestforecastRuns.mape).toFixed(3) : "—"} />
            <KpiCard label="Forecast Accuracy" value={bestforecastRuns ? `${(100 - Number(bestforecastRuns.wmape)).toFixed(1)}%` : "—"} />
             <KpiCard label="Deployed" value={(models as ModelType[]).filter(m => m.isDeployed).length} />
          </div>

          {/* Model Comparison Bar Chart */}
          {/* Model Comparison Bar Chart */}
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-3">
              Forecast Model Performance (last 8 experiments)
            </h3>

            {forecastRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Train your first model to see comparisons.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={forecastComparisonData} margin={{ left: -10 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />

                  <YAxis
                  domain={[0, Math.ceil(maxBaselineRmse)]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${v}%`}
                />

                  <Tooltip
                    formatter={(v: any) => [`${Number(v).toFixed(2)}%`, "WMAPE"]}
                  />

                  <Legend wrapperStyle={{ fontSize: 10 }} />

                  <Bar dataKey="WMAPE" radius={[2, 2, 0, 0]}>
                    {forecastComparisonData.map((_, i) => (
                      <Cell key={forecastRunsChartKeys[i]} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {}

      {/* All Experiments Table */}
      <div className="border rounded-lg bg-card">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold">Forecasting Experiments</h3>

          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {forecastRuns.length} total
            </Badge>

            <button
              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
              onClick={() => navigate("/retail/demand_forecast/orion/deploy")}
            >
              Deploy Forecast <ArrowRight className="w-3 h-3" />
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
                  "MAPE",
                  "WMAPE",
                  "RMSE",
                  "R²",
                  "Actual Units",
                  "Forecast Units",
                  "Status",
                  "Action"
                ].map((h) => (
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
              {forecastRuns.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="p-6 text-center text-muted-foreground"
                  >
                    No experiments yet. Run your first demand forecast model above.
                  </td>
                </tr>
              )}

              {forecastRuns.map((run) => (
                <tr
                  key={run.id}
                  className="border-t hover:bg-muted/30 transition-colors"
                >
                  <td
                    className="p-3 font-medium max-w-[150px] truncate"
                    title={run.name}
                  >
                    {run.name}
                  </td>

                  <td className="p-3 whitespace-nowrap font-semibold">
                    {getRunBestModel(run)}
                  </td>

                  <td className="p-3 font-mono">
                    {asNumber(run.mape)}
                  </td>

                  <td className="p-3 font-mono">
                    {asNumber(run.wmape)}
                  </td>

                  <td className="p-3 font-mono">
                    {asNumber(run.rmse)}
                  </td>

                  <td className="p-3 font-mono">
                    {run.r2 != null
                      ? Number(run.r2).toFixed(3)
                      : "—"}
                  </td>

                  <td className="p-3 font-mono">
                    {asNumber(run.actualUnits)}
                  </td>

                  <td className="p-3 font-mono">
                    {asNumber(run.forecastUnits)}
                  </td>

                  <td className="p-3">
                    <StatusBadge status={run.status} />
                  </td>

                  <td className="p-3">
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1 px-2 text-red-600 hover:bg-red-50 border-red-200"
                        onClick={() => setDeleteTargetId(run.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  {/* Delete confirmation dialog */}
  <AlertDialog
    open={deleteTargetId !== null}
    onOpenChange={(open) => {
      if (!open) setDeleteTargetId(null);
    }}
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          Delete this model?
        </AlertDialogTitle>
        <AlertDialogDescription>
          This will permanently delete the model and all its
          scoring predictions. This action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>

      <AlertDialogFooter>
        <AlertDialogCancel>
          Cancel
        </AlertDialogCancel>

        <AlertDialogAction
          className="bg-red-600 hover:bg-red-700"
          onClick={() =>
            deleteTargetId !== null &&
            deleteMut.mutate(deleteTargetId)
          }
          data-testid="button-confirm-delete"
        >
          {deleteMut.isPending
            ? "Deleting…"
            : "Delete Model"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</OrionLayout>
)
}
