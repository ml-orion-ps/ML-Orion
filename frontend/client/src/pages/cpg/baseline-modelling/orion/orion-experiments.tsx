import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import {
  FlaskConical, Database, Upload, Rocket, Zap, ArrowRight,
  ChevronDown, ChevronUp, CheckCircle2, Trash2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const FALLBACK_ALGORITHMS = [
  { value: "Auto", label: "Auto (Best Model)", desc: "Trains RF, LightGBM, and XGBoost — selects best performer" },
  { value: "Random Forest", label: "Random Forest", desc: "Ensemble of decision trees — robust and interpretable" },
  { value: "XGBoost", label: "XGBoost", desc: "Optimized gradient boosting — industry standard" },
  { value: "LightGBM", label: "LightGBM", desc: "Fast gradient boosting framework — enterprise-grade" },
];

type ModelType = {
  id: number; name: string; algorithm: string; status: string; accuracy: number;
  precision: number; recall: number; f1Score: number; auc: number; isDeployed: boolean;
  featureImportance: any[]; confusionMatrix: any; hyperparameters: any; trainedAt: string;
  modelWeights?: any;
};

type BaselinePredictionResult = {
  success: boolean;
  summary: {
    rowCount: number;
    featureCount: number;
    promoColumnsUsed: string[];
    metrics: { mae?: number; rmse?: number; r2?: number };
    totals: {
      actualUnits?: number;
      base0Units?: number;
      baselineWithoutPromoUnits?: number;
      promoEffectUnits?: number;
      residualUnits?: number;
    };
  };
  predictions: any[];
};

const asPercent = (v: any) => (v != null ? `${(Number(v) * 100).toFixed(1)}%` : "—");
const asFraction = (v: any) => (v != null ? Number(v).toFixed(3) : "—");
const asLift = (v: any) => (v != null ? `${Number(v).toFixed(2)}x` : "—");
const asNumber = (v: any) => (v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "â€”");
const getOosMetric = (m: ModelType, key: string) => {
  const oos = (m.modelWeights as any)?.oosMetrics;
  if (oos && oos[key] != null) return oos[key];
  if (key === "auc") return m.auc;
  if (key === "f1Score") return m.f1Score;
  return null;
};
const getValidationAuc = (m: ModelType) => {
  const cv = (m.modelWeights as any)?.cvSummary;
  if (cv?.meanAUC != null) return Number(cv.meanAUC);
  return null;
};

export default function OrionExperiments() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [experimentType, setExperimentType] = useState<"churn" | "baseline">("churn");
  const [source, setSource] = useState<"live" | "dataset">("live");
  const [algorithm, setAlgorithm] = useState("Auto");
  const [name, setName] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [baselineAlpha, setBaselineAlpha] = useState(100);
  const [baselineResult, setBaselineResult] = useState<BaselinePredictionResult | null>(null);
  const [baselineRuns, setBaselineRuns] = useState<Array<{
    id: number; name: string; alpha: number; status: string;
    mae: number | null; rmse: number | null; r2: number | null;
    baselineUnits: number | null; promoUnits: number | null; residualUnits: number | null;
  }>>([]);
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

  const { data: models = [] } = useQuery<ModelType[]>({ queryKey: ["/api/models"] });
  const { data: datasets = [] } = useQuery<any[]>({ queryKey: ["/api/datasets"] });
  const { data: customerDs } = useQuery<any>({ queryKey: ["/api/orion/customer-dataset"] });
  const { data: dynamicAlgos = [] } = useQuery<any[]>({ queryKey: ["/api/orion/algorithms"] });

  const ALGORITHMS = dynamicAlgos.length > 0 ? dynamicAlgos : FALLBACK_ALGORITHMS;

  // Parse JSON properly in both mutations
  const trainFromDatasetMut = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/models/train", body);
      return res.json();
    },
    onSuccess: (m: ModelType) => {
      qc.invalidateQueries({ queryKey: ["/api/models"] });
      qc.invalidateQueries({ queryKey: ["/api/orion/overview"] });
      qc.invalidateQueries({ queryKey: ["/api/predictions"] });
      qc.invalidateQueries({ queryKey: ["/api/analytics/retention"] });
      qc.invalidateQueries({ queryKey: ["/api/recommendations"] });
      setSelectedModel(m);
      setJustTrainedId(m.id);
      toast({ title: "Training complete!", description: `${m.algorithm} — AUC ${m.auc !== null && m.auc !== undefined ? (m.auc * 100).toFixed(1) : "—"}%` });
    },
    onError: (e: any) => toast({ title: "Training failed", description: e.message, variant: "destructive" }),
  });

  const trainLiveMut = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/models/train-live", body);
      return res.json();
    },
    onSuccess: (m: ModelType) => {
      qc.invalidateQueries({ queryKey: ["/api/models"] });
      qc.invalidateQueries({ queryKey: ["/api/orion/overview"] });
      qc.invalidateQueries({ queryKey: ["/api/predictions"] });
      qc.invalidateQueries({ queryKey: ["/api/analytics/retention"] });
      qc.invalidateQueries({ queryKey: ["/api/recommendations"] });
      setSelectedModel(m);
      setJustTrainedId(m.id);
      toast({ title: "Training complete!", description: `${m.algorithm} — AUC ${m.auc !== null && m.auc !== undefined ? (m.auc * 100).toFixed(1) : "—"}%` });
    },
    onError: (e: any) => toast({ title: "Training failed", description: e.message, variant: "destructive" }),
  });

  const baselinePredictionMut = useMutation({
    mutationFn: async ({ datasetId, alpha }: { datasetId: number; alpha: number }) => {
      const res = await apiRequest("POST", `/api/datasets/${datasetId}/baseline-prediction`, { alpha });
      return res.json();
    },
    onSuccess: (result: BaselinePredictionResult) => {
      qc.invalidateQueries({ queryKey: ["/api/datasets"] });
      setBaselineResult(result);
      setSelectedModel(null);
      setBaselineRuns(prev => [...prev, {
        id: Date.now(),
        name: name.trim() || `Baseline Run ${prev.length + 1}`,
        alpha: baselineAlpha / 100,
        status: "Complete",
        mae: result.summary.metrics?.mae ?? null,
        rmse: result.summary.metrics?.rmse ?? null,
        r2: result.summary.metrics?.r2 ?? null,
        baselineUnits: result.summary.totals?.baselineWithoutPromoUnits ?? null,
        promoUnits: result.summary.totals?.promoEffectUnits ?? null,
        residualUnits: result.summary.totals?.residualUnits ?? null,
      }]);
      toast({
        title: "Baseline prediction complete",
        description: `${result.summary.rowCount.toLocaleString()} rows scored`,
      });
    },
    onError: (e: any) => toast({ title: "Baseline prediction failed", description: e.message, variant: "destructive" }),
  });

  const deployMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/models/${id}/deploy`);
      return res.json();
    },
    onSuccess: (m: ModelType) => {
      qc.invalidateQueries({ queryKey: ["/api/models"] });
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
      const res = await apiRequest("DELETE", `/api/models/${id}`);
      return res.json();
    },
    onSuccess: (_: any, id: number) => {
      qc.invalidateQueries({ queryKey: ["/api/models"] });
      qc.invalidateQueries({ queryKey: ["/api/predictions"] });
      qc.invalidateQueries({ queryKey: ["/api/orion/overview"] });
      if (selectedModel?.id === id) setSelectedModel(null);
      setDeleteTargetId(null);
      toast({ title: "Model deleted", description: "The model and all its predictions have been removed." });
    },
    onError: (e: any) => {
      setDeleteTargetId(null);
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    },
  });

  const getAlgorithmFamily = (alg: string) => {
    if (["Random Forest", "XGBoost", "LightGBM", "Decision Tree"].includes(alg)) return "tree";
    if (["Support Vector Machine"].includes(alg)) return "kernel";
    return "other";
  };

  const handleTrain = async () => {
    const isBaseline = experimentType === "baseline";
    if (!isBaseline && !algorithm) return toast({ title: "Select an algorithm", variant: "destructive" });
    if ((isBaseline || source === "dataset") && !selectedDatasetId) return toast({ title: "Select a dataset", variant: "destructive" });
    if (isBaseline || source === "dataset") {
      const ds = datasets.find((d: any) => d.id === Number(selectedDatasetId));
      if (!ds) return toast({ title: "Dataset not found", variant: "destructive" });
    }

    setIsTraining(true);
    setProgress(0);
    setJustTrainedId(null);
    if (isBaseline) setBaselineResult(null);
    const iv = setInterval(() => setProgress(p => (p >= 92 ? (clearInterval(iv), p) : p + Math.random() * 12)), 200);
    try {
      if (isBaseline) {
        await baselinePredictionMut.mutateAsync({
          datasetId: Number(selectedDatasetId),
          alpha: baselineAlpha / 100,
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
  const algInfo = ALGORITHMS.find(a => a.value === algorithm);
  const selectedDataset = trainableDatasets.find((d: any) => d.id === Number(selectedDatasetId));
  const savedBaselineResult = selectedDataset?.featureReport?.baselinePrediction ?? selectedDataset?.feature_report?.baselinePrediction;
  const visibleBaselineResult = baselineResult ?? (savedBaselineResult?.summary ? {
    success: true,
    summary: savedBaselineResult.summary,
    predictions: savedBaselineResult.preview || [],
  } as BaselinePredictionResult : null);
  const baselinePreview = (visibleBaselineResult?.predictions || []).slice(0, 8);

  const baselineUnitData = visibleBaselineResult ? [
    { metric: "Actual", units: Number(visibleBaselineResult.summary.totals?.actualUnits || 0) },
    { metric: "No Promo", units: Number(visibleBaselineResult.summary.totals?.baselineWithoutPromoUnits || 0) },
    { metric: "Promo Effect", units: Number(visibleBaselineResult.summary.totals?.promoEffectUnits || 0) },
    { metric: "Residual", units: Number(visibleBaselineResult.summary.totals?.residualUnits || 0) },
  ] : [];

  const last8Models = (models as ModelType[]).slice(-8);
  const last8BaselineRuns = baselineRuns.slice(-8);
  const bestBaselineRun = baselineRuns.length > 0
    ? baselineRuns.reduce((b, r) => ((r.r2 ?? -Infinity) > (b.r2 ?? -Infinity) ? r : b))
    : null;
  const baselineRunChartKeys = last8BaselineRuns.map((r, i) => `#${baselineRuns.indexOf(r) + 1} Ridge`);
  const baselineComparisonData = last8BaselineRuns.map((r, i) => ({
    name: baselineRunChartKeys[i],
    "R²": r.r2 != null ? Number(r.r2) : 0,
  }));

  const MODEL_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

  // Short unique label per model: "#1 LightGBM", "#2 XGBoost", etc.
  const modelChartKeys = last8Models.map((m, i) => {
    const alg = m.algorithm.replace("Random Forest", "RF").replace("LightGBM", "LGB").replace("XGBoost", "XGB").replace("Auto (LightGBM)", "Auto-LGB").replace("Auto (Random Forest)", "Auto-RF").replace("Auto (XGBoost)", "Auto-XGB");
    return `#${i + 1} ${alg.split(" ")[0]}`;
  });

  // Group by metric — each row is one metric, columns are models
  const comparisonData = [
    { metric: "Accuracy", ...Object.fromEntries(last8Models.map((m, i) => [modelChartKeys[i], Number(m.accuracy || 0)])) },
    { metric: "AUC",      ...Object.fromEntries(last8Models.map((m, i) => [modelChartKeys[i], Number(getOosMetric(m, "auc") || 0)])) },
    { metric: "F1",       ...Object.fromEntries(last8Models.map((m, i) => [modelChartKeys[i], Number(getOosMetric(m, "f1Score") || 0)])) },
  ];

  const cm = selectedModel?.confusionMatrix as any;
  const bestModel = (models as ModelType[]).length > 0
    ? (models as ModelType[]).reduce((b, m) => (m.auc || 0) > (b.auc || 0) ? m : b)
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
    <OrionLayout title="Experiment Lab" subtitle="Train churn models or run RGM baseline prediction experiments">
      <div className="mb-4"><OrionNav current="/orion/experiments" /></div>
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
                    onClick={() => setExperimentType("churn")}
                    className={`p-3 rounded-lg border text-left transition-all ${experimentType === "churn" ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
                    data-testid="button-experiment-churn"
                  >
                    <FlaskConical className="w-4 h-4 mb-1 text-primary" />
                    <div className="text-xs font-medium">Churn Model</div>
                    <div className="text-[10px] text-muted-foreground">Classification training</div>
                  </button>
                  <button
                    onClick={() => {
                      setExperimentType("baseline");
                      setSource("dataset");
                    }}
                    className={`p-3 rounded-lg border text-left transition-all ${experimentType === "baseline" ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
                    data-testid="button-experiment-baseline"
                  >
                    <Zap className="w-4 h-4 mb-1 text-primary" />
                    <div className="text-xs font-medium">Baseline Prediction</div>
                    <div className="text-[10px] text-muted-foreground">RGM decomposition</div>
                  </button>
                </div>
              </div>

              {experimentType === "churn" && (
              <div>
                <Label className="text-xs font-medium">Experiment Name</Label>
                <Input
                  className="mt-1 h-8 text-xs"
                  placeholder="e.g. XGBoost v3 Q1 2026"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  data-testid="input-experiment-name"
                />
              </div>
              )}

              {experimentType === "churn" && (
              <div>
                <Label className="text-xs font-medium">Training Data Source</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    onClick={() => setSource("live")}
                    className={`p-3 rounded-lg border text-left transition-all ${source === "live" ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
                    data-testid="button-source-live"
                  >
                    <Database className="w-4 h-4 mb-1 text-primary" />
                    <div className="text-xs font-medium">Live Customer DB</div>
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

              {experimentType === "churn" && source === "live" && customerDs && (
                <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-1">
                  <div className="font-medium">Live Customer Database</div>
                  <div className="text-muted-foreground">{customerDs.rowCount?.toLocaleString()} rows · {customerDs.columnCount} features</div>
                  <div className="text-muted-foreground">Target: <span className="font-mono">is_churned</span> — churn rate {customerDs.targetDistribution?.churnRate}%</div>
                  <div className="text-muted-foreground">Quality score: {customerDs.qualityScore}/100</div>
                </div>
              )}

              {(experimentType === "baseline" || source === "dataset") && (
                <div>
                  <Label className="text-xs font-medium">{experimentType === "baseline" ? "RGM Dataset" : "Select Dataset"}</Label>
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

              {experimentType === "churn" && (
              <div>
                <Label className="text-xs font-medium">Algorithm</Label>
                <Select value={algorithm} onValueChange={setAlgorithm}>
                  <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-algorithm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALGORITHMS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {algInfo && <p className="text-[10px] text-muted-foreground mt-1">{algInfo.desc}</p>}
              </div>
              )}

              {experimentType === "baseline" && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <Label className="text-xs font-medium">Ridge Alpha</Label>
                    <span className="font-mono">{(baselineAlpha / 100).toFixed(2)}</span>
                  </div>
                  <Slider value={[baselineAlpha]} onValueChange={([v]) => setBaselineAlpha(v)} min={1} max={500} step={1} />
                </div>
              )}

              {experimentType === "churn" && (
              <div>
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowHyperparams(!showHyperparams)}
                >
                  {showHyperparams ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Hyperparameters
                </button>
                {showHyperparams && (
                  <div className="mt-3 space-y-4 border rounded-lg p-3 bg-muted/20">
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest flex items-center gap-2 mb-2">
                       <Zap className="w-3 h-3" /> {getAlgorithmFamily(algorithm).replace(/-/g, " ")} Parameters
                    </div>
                    
                    {getAlgorithmFamily(algorithm) === "tree" && (
                      <div className="space-y-3">
                        {algorithm !== "Decision Tree" && (
                          <div>
                            <div className="flex justify-between text-xs mb-1"><span>n_estimators</span><span className="font-mono">{nEstimators}</span></div>
                            <Slider value={[nEstimators]} onValueChange={([v]) => setNEstimators(v)} min={50} max={500} step={50} />
                          </div>
                        )}
                        <div>
                          <div className="flex justify-between text-xs mb-1"><span>max_depth</span><span className="font-mono">{maxDepth}</span></div>
                          <Slider value={[maxDepth]} onValueChange={([v]) => setMaxDepth(v)} min={2} max={30} step={1} />
                        </div>
                        {(algorithm === "LightGBM" || algorithm === "XGBoost") && (
                          <div>
                            <div className="flex justify-between text-xs mb-1"><span>learning_rate</span><span className="font-mono">{(learningRate / 100).toFixed(2)}</span></div>
                            <Slider value={[learningRate]} onValueChange={([v]) => setLearningRate(v)} min={1} max={50} step={1} />
                          </div>
                        )}
                        <div>
                          <div className="flex justify-between text-xs mb-1"><span>min_samples_leaf</span><span className="font-mono">{minSamplesLeaf}</span></div>
                          <Slider value={[minSamplesLeaf]} onValueChange={([v]) => setMinSamplesLeaf(v)} min={1} max={100} step={1} />
                        </div>
                      </div>
                    )}

                    {getAlgorithmFamily(algorithm) === "kernel" && (
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-xs mb-1"><span>Cost (C)</span><span className="font-mono">{(svmC / 100).toFixed(2)}</span></div>
                          <Slider value={[svmC]} onValueChange={([v]) => setSvmC(v)} min={1} max={1000} step={1} />
                        </div>
                        <div>
                          <Label className="text-[10px] font-bold text-muted-foreground mb-1 block uppercase">Kernel Logic</Label>
                          <Select value={svmKernel} onValueChange={setSvmKernel}>
                            <SelectTrigger className="mt-1 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="rbf">RBF (Radial Basis)</SelectItem>
                              <SelectItem value="linear">Linear</SelectItem>
                              <SelectItem value="poly">Polynomial</SelectItem>
                              <SelectItem value="sigmoid">Sigmoid</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}

                    {getAlgorithmFamily(algorithm) === "other" && (
                      <div className="text-[10px] italic text-muted-foreground text-center py-4">
                        Self-tuning active for {algorithm}. Parameters managed automatically.
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}

              {isTraining && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="animate-pulse">{experimentType === "baseline" ? "Running baseline prediction..." : `Training ${algorithm}...`}</span>
                    <span>{Math.min(100, Math.round(progress))}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-300 rounded-full" style={{ width: `${Math.min(100, progress)}%` }} />
                  </div>
                </div>
              )}

              <Button className="w-full" onClick={handleTrain} disabled={isTraining} data-testid="button-train">
                {isTraining ? (experimentType === "baseline" ? "Running..." : "Training...") : (experimentType === "baseline" ? "Run Baseline Prediction" : "Train Model")}
              </Button>
            </div>
          </div>

          {/* ── Training Result Panel ── */}
          {false && visibleBaselineResult && (
            <div className="border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-1.5 text-green-700">
                  <CheckCircle2 className="w-4 h-4" /> Baseline Complete
                </h3>
                <Badge variant="outline" className="text-[10px]">RGM</Badge>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { label: "Rows", value: asNumber(visibleBaselineResult.summary.rowCount) },
                  { label: "Features", value: asNumber(visibleBaselineResult.summary.featureCount) },
                  { label: "R2", value: asFraction(visibleBaselineResult.summary.metrics?.r2) },
                  { label: "MAE", value: asNumber(visibleBaselineResult.summary.metrics?.mae) },
                  { label: "RMSE", value: asNumber(visibleBaselineResult.summary.metrics?.rmse) },
                  { label: "Promos", value: asNumber(visibleBaselineResult.summary.promoColumnsUsed?.length || 0) },
                ].map(m => (
                  <div key={m.label} className="bg-muted/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{m.label}</div>
                    <div className="text-sm font-bold text-primary">{m.value}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                {[
                  { label: "Actual Units", value: visibleBaselineResult.summary.totals?.actualUnits },
                  { label: "Baseline No Promo", value: visibleBaselineResult.summary.totals?.baselineWithoutPromoUnits },
                  { label: "Promo Effect", value: visibleBaselineResult.summary.totals?.promoEffectUnits },
                  { label: "Residual Units", value: visibleBaselineResult.summary.totals?.residualUnits },
                ].map(item => (
                  <div key={item.label} className="rounded bg-muted/20 p-2">
                    <div className="text-[10px] text-muted-foreground">{item.label}</div>
                    <div className="font-semibold">{asNumber(item.value)}</div>
                  </div>
                ))}
              </div>

              {visibleBaselineResult.summary.promoColumnsUsed?.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {visibleBaselineResult.summary.promoColumnsUsed.map(col => (
                    <Badge key={col} variant="secondary" className="text-[10px]">{col}</Badge>
                  ))}
                </div>
              )}

              {baselinePreview.length > 0 && (
                <div className="overflow-x-auto border rounded">
                  <table className="w-full text-[10px]">
                    <thead className="bg-muted/50">
                      <tr>
                        {["SKU", "Store", "Week", "Baseline", "Promo Effect", "Residual"].map(h => (
                          <th key={h} className="text-left p-2 font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {baselinePreview.map((row: any, idx: number) => (
                        <tr key={`${row.sku_id || row.item_id || idx}-${row.week_id || idx}`} className="border-t">
                          <td className="p-2 max-w-[100px] truncate" title={row.sku_id || row.item_id || row.product_id}>{row.sku_id || row.item_id || row.product_id || "—"}</td>
                          <td className="p-2">{row.store_id || "—"}</td>
                          <td className="p-2 whitespace-nowrap">{row.week_id || row.date || "—"}</td>
                          <td className="p-2 font-mono">{asNumber(row.baseline_without_promo)}</td>
                          <td className="p-2 font-mono">{asNumber(row.promo_effect_units_sum)}</td>
                          <td className="p-2 font-mono">{asNumber(row.residual_units)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {(selectedModel || (experimentType === "baseline" && visibleBaselineResult)) && (
            <div className="border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">
                  {visibleBaselineResult && experimentType === "baseline" ? (
                    <span className="flex items-center gap-1.5 text-green-700">
                      <CheckCircle2 className="w-4 h-4" /> Baseline Complete
                    </span>
                  ) : justTrainedId === selectedModel?.id ? (
                    <span className="flex items-center gap-1.5 text-green-700">
                      <CheckCircle2 className="w-4 h-4" /> Training Complete
                    </span>
                  ) : (
                    `Result: ${selectedModel?.algorithm}`
                  )}
                </h3>
                {visibleBaselineResult && experimentType === "baseline" && (
                  <Badge variant="outline" className="text-[10px]">RGM</Badge>
                )}
                {selectedModel?.isDeployed && (
                  <Badge className="bg-green-100 text-green-700 text-[10px]">Production</Badge>
                )}
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {(visibleBaselineResult && experimentType === "baseline" ? [
                  { label: "Rows", v: visibleBaselineResult.summary.rowCount, formatter: asNumber },
                  { label: "Features", v: visibleBaselineResult.summary.featureCount, formatter: asNumber },
                  { label: "R2", v: visibleBaselineResult.summary.metrics?.r2, formatter: asFraction },
                  { label: "MAE", v: visibleBaselineResult.summary.metrics?.mae, formatter: asNumber },
                  { label: "RMSE", v: visibleBaselineResult.summary.metrics?.rmse, formatter: asNumber },
                  { label: "Promos", v: visibleBaselineResult.summary.promoColumnsUsed?.length || 0, formatter: asNumber },
                ] : [
                  { label: "Accuracy", v: selectedModel?.accuracy, formatter: asPercent },
                  { label: "AUC (OOS)", v: selectedModel?.auc, formatter: asPercent },
                  { label: "AUC (Validation)", v: selectedModel ? getValidationAuc(selectedModel) : null, formatter: asPercent },
                  { label: "F1 (OOS)", v: selectedModel?.f1Score, formatter: asFraction },
                  { label: "Precision", v: selectedModel?.precision, formatter: asPercent },
                  { label: "Recall", v: selectedModel?.recall, formatter: asPercent },
                ]).map(m => (
                  <div key={m.label} className="bg-muted/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{m.label}</div>
                    <div className="text-sm font-bold text-primary">{m.formatter(m.v)}</div>
                  </div>
                ))}
                {visibleBaselineResult && experimentType === "baseline" ? (
                  <div className="bg-blue-50 rounded p-2 text-center border border-blue-200">
                    <div className="text-[10px] text-blue-700">Baseline</div>
                    <div className="text-xs font-bold text-blue-700">Ridge</div>
                  </div>
                ) : (
                  <div className="bg-blue-50 rounded p-2 text-center border border-blue-200">
                    <div className="text-[10px] text-blue-700">Weights</div>
                    <div className="text-xs font-bold text-blue-700">{selectedModel?.modelWeights ? "Real ML" : "Formula"}</div>
                  </div>
                )}
              </div>

              {/* Confusion Matrix */}
              {cm && (
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
              )}

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
                  onClick={() => navigate("/orion/deploy")}
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
            {experimentType === "baseline" ? (
              <>
                <KpiCard label="Experiments" value={baselineRuns.length} />
                <KpiCard label="Best R²" value={bestBaselineRun?.r2 != null ? Number(bestBaselineRun.r2).toFixed(3) : "—"} />
                <KpiCard label="Best Alpha" value={bestBaselineRun ? bestBaselineRun.alpha.toFixed(2) : "—"} />
                <KpiCard label="Deployed" value={0} />
              </>
            ) : (
              <>
                <KpiCard label="Experiments" value={(models as ModelType[]).length} />
                <KpiCard
                  label="Best AUC"
                  value={bestModel ? `${((bestModel.auc || 0) * 100).toFixed(1)}%` : "—"}
                />
                <KpiCard
                  label="Best Algorithm"
                  value={bestModel ? bestModel.algorithm.split(" ")[0] : "—"}
                />
                <KpiCard label="Deployed" value={(models as ModelType[]).filter(m => m.isDeployed).length} />
              </>
            )}
          </div>

          {/* Model Comparison Bar Chart */}
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-3">Model Comparison (last 8 experiments)</h3>
            {experimentType === "baseline" ? (
              baselineRuns.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Train your first model to see comparisons.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={baselineComparisonData} margin={{ left: -10 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: any) => [Number(v).toFixed(3), "R²"]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {last8BaselineRuns.map((_, i) => (
                      <Bar key={baselineRunChartKeys[i]} dataKey="R²" fill={MODEL_COLORS[i % MODEL_COLORS.length]} radius={[2, 2, 0, 0]} />
                    )).slice(0, 1)}
                  </BarChart>
                </ResponsiveContainer>
              )
            ) : (models as ModelType[]).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Train your first model to see comparisons.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={comparisonData} margin={{ left: -10 }}>
                  <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: any, name: string) => [Number(v).toFixed(3), name]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {modelChartKeys.map((key, i) => (
                    <Bar key={key} dataKey={key} fill={MODEL_COLORS[i % MODEL_COLORS.length]} radius={[2, 2, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Feature Importance */}
          {experimentType === "churn" && modelsWithFeatures.length > 0 && (
            <div className="border rounded-lg bg-card overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center gap-3">
                <h3 className="text-sm font-semibold flex-shrink-0">Feature Importance</h3>
                <div className="flex items-center gap-1 overflow-x-auto min-w-0 flex-1">
                  {modelsWithFeatures.slice(-8).reverse().map(m => (
                    <button
                      key={m.id}
                      onClick={() => setFiSelectedModelId(m.id)}
                      className={`flex-shrink-0 px-2.5 py-1 text-[10px] rounded font-medium transition-colors whitespace-nowrap ${
                        effectiveFiModelId === m.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                      }`}
                      data-testid={`button-fi-model-${m.id}`}
                    >
                      {m.algorithm.split(" ")[0]}
                      {m.isDeployed && <span className="ml-1 text-green-400">●</span>}
                    </button>
                  ))}
                </div>
              </div>

              {fiModel && (
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-3 text-[10px] text-muted-foreground">
                    <span className="font-medium text-foreground text-xs truncate max-w-[220px]" title={fiModel.name}>
                      {fiModel.name}
                    </span>
                    <span className="ml-auto flex-shrink-0">
                      AUC: <strong className="text-primary">{asPercent(fiModel.auc)}</strong>
                    </span>
                    <span className="flex-shrink-0">{fiFeatureData.length} features</span>
                  </div>

                  <ResponsiveContainer width="100%" height={Math.max(180, fiFeatureData.length * 22)}>
                    <BarChart data={fiFeatureData} layout="vertical" margin={{ left: 120, right: 44 }}>
                      <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v: number) => v.toFixed(3)} />
                      <YAxis type="category" dataKey="feature" tick={{ fontSize: 10 }} width={120} />
                      <Tooltip
                        formatter={(v: any) => [Number(v).toFixed(4), "Importance"]}
                        contentStyle={{ fontSize: 11 }}
                      />
                      <Bar dataKey="importance" radius={[0, 3, 3, 0]}>
                        {fiFeatureData.map((_: any, i: number) => (
                          <Cell
                            key={i}
                            fill={i === 0 ? "#1d4ed8" : i < 3 ? "#2563eb" : i < 7 ? "#3b82f6" : "#93c5fd"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* All Experiments Table */}
          <div className="border rounded-lg bg-card">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold">All Experiments</h3>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{experimentType === "baseline" ? `${baselineRuns.length} total` : `${(models as ModelType[]).length} total`}</Badge>
                <button
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  onClick={() => navigate("/orion/deploy")}
                >
                  Deploy & Score <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {(experimentType === "baseline"
                      ? ["Run Name", "Alpha", "MAE", "RMSE", "R²", "Baseline Units", "Promo Units", "Residual Units", "Status", "Actions"]
                      : ["Model", "Algorithm", "AUC (OOS)", "AUC (Val)", "F1 (OOS)", "Recall@10(OOS)", "Precision@10(OOS)", "Lift@10(OOS)", "Status", "Actions"]
                    ).map(h => (
                      <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {experimentType === "baseline" && baselineRuns.length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-6 text-center text-muted-foreground">No experiments yet. Run your first baseline prediction above.</td>
                    </tr>
                  )}
                  {experimentType === "baseline" && baselineRuns.map(run => (
                    <tr key={run.id} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-medium max-w-[150px] truncate" title={run.name}>{run.name}</td>
                      <td className="p-3 whitespace-nowrap">{run.alpha.toFixed(2)}</td>
                      <td className="p-3 font-semibold text-blue-600 font-mono">{asNumber(run.mae)}</td>
                      <td className="p-3 font-mono">{asNumber(run.rmse)}</td>
                      <td className="p-3 font-mono">{run.r2 != null ? Number(run.r2).toFixed(3) : "—"}</td>
                      <td className="p-3 font-mono">{asNumber(run.baselineUnits)}</td>
                      <td className="p-3 font-mono">{asNumber(run.promoUnits)}</td>
                      <td className="p-3 font-mono">{asNumber(run.residualUnits)}</td>
                      <td className="p-3"><StatusBadge status={run.status} /></td>
                      <td className="p-3">
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] gap-1 px-2 text-red-600 hover:bg-red-50 border-red-200"
                            onClick={() => setBaselineRuns(prev => prev.filter(r => r.id !== run.id))}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {experimentType === "churn" && (models as ModelType[]).length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-6 text-center text-muted-foreground">No experiments yet. Train your first model above.</td>
                    </tr>
                  )}
                  {experimentType === "churn" && (models as ModelType[]).map(m => (
                    <tr
                      key={m.id}
                      className={`border-t cursor-pointer transition-colors ${selectedModel?.id === m.id ? "bg-primary/5" : "hover:bg-muted/30"}`}
                      onClick={() => setSelectedModel(m)}
                      data-testid={`row-experiment-${m.id}`}
                    >
                      <td className="p-3 font-medium max-w-[150px] truncate" title={m.name}>{m.name}</td>
                      <td className="p-3 whitespace-nowrap">{m.algorithm}</td>
                      <td className="p-3 font-semibold text-blue-600">{asPercent(getOosMetric(m, "auc"))}</td>
                      <td className="p-3">{asPercent(getValidationAuc(m))}</td>
                      <td className="p-3">{asFraction(getOosMetric(m, "f1Score"))}</td>
                      <td className="p-3">{asPercent(getOosMetric(m, "recallTop10"))}</td>
                      <td className="p-3">{asPercent(getOosMetric(m, "precisionTop10"))}</td>
                      <td className="p-3">{asLift(getOosMetric(m, "liftTop10"))}</td>
                      <td className="p-3"><StatusBadge status={m.isDeployed ? "Production" : m.status} /></td>
                      <td className="p-3">
                        <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                          {!m.isDeployed && (
                            <Button
                              size="sm"
                              className="h-6 text-[10px] gap-1 px-2"
                              onClick={() => deployMut.mutate(m.id)}
                              disabled={deployMut.isPending}
                              data-testid={`button-deploy-row-${m.id}`}
                            >
                              <Rocket className="w-3 h-3" /> Deploy
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] gap-1 px-2"
                            onClick={() => navigate("/orion/deploy")}
                            data-testid={`button-score-row-${m.id}`}
                          >
                            <Zap className="w-3 h-3" /> Score
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] gap-1 px-2 text-red-600 hover:bg-red-50 border-red-200"
                            onClick={() => setDeleteTargetId(m.id)}
                            data-testid={`button-delete-row-${m.id}`}
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
      <AlertDialog open={deleteTargetId !== null} onOpenChange={open => { if (!open) setDeleteTargetId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this model?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the model and all its scoring predictions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTargetId !== null && deleteMut.mutate(deleteTargetId)}
              data-testid="button-confirm-delete"
            >
              {deleteMut.isPending ? "Deleting…" : "Delete Model"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OrionLayout>
  );
}
