import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Database, AlertTriangle, Activity, Zap, Plus, ChevronDown, ChevronRight, Upload, Wifi, ShieldCheck, ShieldAlert, TrendingUp, BarChart2, CheckCircle2, XCircle, AlertCircle, Sparkles, Brain, ArrowUpRight, BookOpen } from "lucide-react";
import type { CustomFeatureDefinition, Dataset } from "@shared/schema";

const EDA_TABS = ["Overview", "Univariate", "Bivariate", "Multivariate", "Time Trends", "Correlation", "Data Risks"] as const;
type EdaTab = typeof EDA_TABS[number];

type FeatureTypeOption = {
  label: string;
  value: CustomFeatureDefinition["type"];
  description: string;
  example: string;
};

type FeatureDraft = {
  id?: string;
  name: string;
  type: CustomFeatureDefinition["type"];
  entityKey: string;
  timeColumn: string;
  sortDirection: "asc" | "desc";
  sourceColumn: string;
  periods: string;
  window: string;
  aggregation: "mean" | "sum" | "min" | "max" | "std";
  numeratorColumn: string;
  denominatorColumn: string;
  comparator: "gt" | "gte" | "lt" | "lte" | "eq" | "ne" | "contains" | "not_contains";
  compareValue: string;
  leftColumn: string;
  rightColumn: string;
  interactionOperator: "multiply" | "divide" | "add" | "subtract";
};

const FEATURE_TYPE_OPTIONS: FeatureTypeOption[] = [
  {
    label: "Rolling Aggregation",
    value: "rolling",
    description: "Compute avg/sum/min/max over a time window (e.g. 3-month rolling avg revenue).",
    example: "avg(monthly_revenue, window=3mo)",
  },
  {
    label: "Lag Feature",
    value: "lag",
    description: "Shift a metric backward N periods to capture temporal patterns.",
    example: "lag(outage_count, periods=1)",
  },
  {
    label: "Trend Feature",
    value: "trend",
    description: "Calculate slope or direction of change over a window.",
    example: "trend_slope(ticket_count, window=6mo)",
  },
  {
    label: "Ratio Feature",
    value: "ratio",
    description: "Divide two numeric columns to create a relative measure.",
    example: "actual_speed / provisioned_speed",
  },
  {
    label: "Flag Feature",
    value: "flag",
    description: "Convert a threshold rule into a binary 0/1 indicator.",
    example: "outage_count > 3 -> 1",
  },
  {
    label: "Segment Tag",
    value: "segment_tag",
    description: "Assign customers into a rule-based segment flag.",
    example: "tenure_months < 6 -> new_customer",
  },
  {
    label: "Interaction Feature",
    value: "interaction",
    description: "Combine two columns to capture joint effects.",
    example: "tenure_months x monthly_revenue",
  },
];

function createFeatureDraft(type: CustomFeatureDefinition["type"] = "rolling"): FeatureDraft {
  return {
    name: "",
    type,
    entityKey: "account_number",
    timeColumn: "snapshot_month",
    sortDirection: "asc",
    sourceColumn: "",
    periods: "1",
    window: "3",
    aggregation: "mean",
    numeratorColumn: "",
    denominatorColumn: "",
    comparator: "gt",
    compareValue: "",
    leftColumn: "",
    rightColumn: "",
    interactionOperator: "multiply",
  };
}

function parseCompareValue(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;
  if (trimmed.toLowerCase() === "null") return null;
  const asNumber = Number(trimmed);
  return Number.isNaN(asNumber) ? trimmed : asNumber;
}

function buildFeaturePayload(draft: FeatureDraft): Partial<CustomFeatureDefinition> {
  return {
    id: draft.id,
    name: draft.name.trim(),
    type: draft.type,
    entityKey: draft.entityKey || undefined,
    timeColumn: draft.timeColumn || undefined,
    sortDirection: draft.sortDirection,
    sourceColumn: draft.sourceColumn || undefined,
    periods: draft.periods ? Number(draft.periods) : undefined,
    window: draft.window ? Number(draft.window) : undefined,
    aggregation: draft.aggregation,
    numeratorColumn: draft.numeratorColumn || undefined,
    denominatorColumn: draft.denominatorColumn || undefined,
    comparator: draft.comparator,
    compareValue: draft.compareValue === "" ? undefined : parseCompareValue(draft.compareValue),
    leftColumn: draft.leftColumn || undefined,
    rightColumn: draft.rightColumn || undefined,
    interactionOperator: draft.interactionOperator,
  };
}

function draftFromFeature(feature: CustomFeatureDefinition): FeatureDraft {
  return {
    id: feature.id,
    name: feature.name,
    type: feature.type,
    entityKey: feature.entityKey || "account_number",
    timeColumn: feature.timeColumn || "snapshot_month",
    sortDirection: feature.sortDirection || "asc",
    sourceColumn: feature.sourceColumn || "",
    periods: feature.periods != null ? String(feature.periods) : "1",
    window: feature.window != null ? String(feature.window) : "3",
    aggregation: feature.aggregation || "mean",
    numeratorColumn: feature.numeratorColumn || "",
    denominatorColumn: feature.denominatorColumn || "",
    comparator: feature.comparator || "gt",
    compareValue: feature.compareValue == null ? "" : String(feature.compareValue),
    leftColumn: feature.leftColumn || "",
    rightColumn: feature.rightColumn || "",
    interactionOperator: feature.interactionOperator || "multiply",
  };
}

function HistogramBar({ label, count, max, churnCount }: { label: string; count: number; max: number; churnCount?: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  const churnPct = count > 0 && churnCount !== undefined ? (churnCount / count) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-20 text-right text-muted-foreground truncate">{label}</span>
      <div className="flex-1 h-4 bg-muted rounded overflow-hidden relative">
        <div className="h-full bg-primary/40 rounded" style={{ width: `${pct}%` }} />
        {churnCount !== undefined && (
          <div className="absolute top-0 left-0 h-full bg-red-500/50 rounded" style={{ width: `${pct * churnPct / 100}%` }} />
        )}
      </div>
      <span className="w-10 text-muted-foreground">{count}</span>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex justify-between text-xs py-0.5 border-b border-border/30">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

export default function BaselineOrionDataPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"ingest" | "registry" | "eda" | "quality" | "features">("ingest");
  const [qualitySource, setQualitySource] = useState<"live" | number>("live");
  const [ingestTab, setIngestTab] = useState<"file" | "db" | "live">("file");
  const [edaTab, setEdaTab] = useState<EdaTab>("Overview");
  const [edaSource, setEdaSource] = useState<"live" | number>("live");
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null);
  const [selectedNumCol, setSelectedNumCol] = useState<string>("tenureMonths");
  const [selectedCatCol, setSelectedCatCol] = useState<string>("region");
  const [expandedFeature, setExpandedFeature] = useState<CustomFeatureDefinition["type"] | null>(null);
  const [featureDraft, setFeatureDraft] = useState<FeatureDraft>(createFeatureDraft());
  const [featureSubTab, setFeatureSubTab] = useState<"model" | "suggestions" | "builder">("model");
  const [stagedFeatures, setStagedFeatures] = useState<Set<string>>(new Set());
  const [selectedFeatureDataset, setSelectedFeatureDataset] = useState<number | null>(null);
  const [selectedFeatureModelId, setSelectedFeatureModelId] = useState<number | null>(null);
  const [featurePreview, setFeaturePreview] = useState<Array<Record<string, any>>>([]);
  const [featureFormula, setFeatureFormula] = useState<string>("");
  const [featureWarnings, setFeatureWarnings] = useState<string[]>([]);
  const [uploadName, setUploadName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [dbForm, setDbForm] = useState({ host: "", port: "5432", dbname: "", user: "", password: "" });

  const { data: datasets = [] } = useQuery<Dataset[]>({ queryKey: ["/api/retail/kpiAnomaly/datasets"] });
  const { data: eda, isLoading: edaLoading } = useQuery<any>({
    queryKey: ["/api/retail/kpiAnomaly/orion/eda-live"],
    enabled: false,
    staleTime: 60000,
  });

  // Fetch feature importance from dataset's trained model (only when dataset is selected)
  const { data: allModels = [] } = useQuery<any[]>({ queryKey: ["/api/retail/kpiAnomaly/models"] });

  // Models that were trained on the currently selected dataset
  const datasetsModels = selectedFeatureDataset
    ? (allModels as any[]).filter((m: any) => m.datasetId === selectedFeatureDataset && m.featureImportance)
    : [];

  const { data: modelFeatures, isLoading: featuresLoading } = useQuery<any>({
    queryKey: ["/api/retail/kpiAnomaly/models/latest/features", selectedFeatureDataset, selectedFeatureModelId],
    queryFn: async () => {
      if (selectedFeatureDataset === null) return null;
      const params = selectedFeatureModelId
        ? `modelId=${selectedFeatureModelId}`
        : `datasetId=${selectedFeatureDataset}`;
      const url = `/api/retail/kpiAnomaly/models/latest/features?${params}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: selectedFeatureDataset !== null,
    staleTime: 60000,
  });

  const { data: featureSelection } = useQuery<any>({
    queryKey: ["/api/retail/kpiAnomaly/datasets", selectedFeatureDataset, "feature-selection"],
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/retail/kpiAnomaly/datasets/${selectedFeatureDataset}/feature-selection`);
      return res.json();
    },
    enabled: selectedFeatureDataset !== null,
    staleTime: 60000,
  });

  const featureDataset = (datasets as any[]).find((d: any) => d.id === selectedFeatureDataset);
  const builderColumns: any[] = featureDataset?.columns || [];
  const hasAccountNumber = builderColumns.some((c: any) => c.name === "account_number");
  const suggestedFeatures: any[] = featureSelection?.recommendedKpis?.map((k: string) => ({ name: k, type: "kpi" })) ?? [];
  const suggestionsLoading = false;

  const { data: builtFeatures = [] } = useQuery<any[]>({
    queryKey: ["/api/retail/kpiAnomaly/features", selectedFeatureDataset],
    queryFn: async () => {
      const res = await fetch(`/api/retail/kpiAnomaly/features?datasetId=${selectedFeatureDataset}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: selectedFeatureDataset !== null,
  });

  useEffect(() => {
    setFeaturePreview([]);
    setFeatureFormula("");
    setFeatureWarnings([]);
  }, [selectedFeatureDataset]);

  useEffect(() => {
    const t   = featureDraft.type;
    const src = featureDraft.sourceColumn || "…";
    let formula = "";
    if (t === "lag")
      formula = `lag(${src}, periods=${featureDraft.periods || 1})`;
    else if (t === "rolling")
      formula = `${featureDraft.aggregation}(${src}, window=${featureDraft.window || 3})`;
    else if (t === "trend")
      formula = `trend_slope(${src}, window=${featureDraft.window || 3})`;
    else if (t === "ratio")
      formula = `${featureDraft.numeratorColumn || "…"} / ${featureDraft.denominatorColumn || "…"}`;
    else if (t === "flag") {
      const ops: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "==", ne: "!=", contains: "contains", not_contains: "not_contains" };
      formula = `${src} ${ops[featureDraft.comparator] || ">"} ${featureDraft.compareValue || 0}`;
    } else if (t === "segment_tag")
      formula = `segment(${src})`;
    else if (t === "interaction") {
      const ops: Record<string, string> = { multiply: "×", divide: "÷", add: "+", subtract: "-" };
      formula = `${featureDraft.leftColumn || "…"} ${ops[featureDraft.interactionOperator] || "×"} ${featureDraft.rightColumn || "…"}`;
    }
    setFeatureFormula(formula);
  }, [featureDraft]);

  const previewFeatureMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/retail/kpiAnomaly/features/preview", {
        datasetId: selectedFeatureDataset,
        feature:   buildFeaturePayload(featureDraft),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.rows)     setFeaturePreview(data.rows);
      if (data?.warnings) setFeatureWarnings(data.warnings ?? []);
      if (data?.formula)  setFeatureFormula(data.formula);
    },
  });

  const saveFeatureMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/retail/kpiAnomaly/features", {
        datasetId: selectedFeatureDataset,
        feature:   buildFeaturePayload(featureDraft),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/features", selectedFeatureDataset] });
      setFeatureDraft(createFeatureDraft(featureDraft.type));
      setFeaturePreview([]);
      setFeatureFormula("");
      setFeatureWarnings([]);
    },
  });

  const deleteFeatureMut = useMutation({
    mutationFn: async (featureId: string) => {
      const res = await fetch(`/api/retail/kpiAnomaly/features/${featureId}?datasetId=${selectedFeatureDataset}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/features", selectedFeatureDataset] });
    },
  });

  const saveSuggestedFeatureMut = useMutation({
    mutationFn: async (sug: any) => {
      const feature = { name: sug.name, type: sug.type === "kpi" ? "rolling" : sug.type, formula: sug.formula, status: "active" };
      const res = await apiRequest("POST", "/api/retail/kpiAnomaly/features", {
        datasetId: selectedFeatureDataset,
        feature,
      });
      return { data: await res.json(), sug };
    },
    onSuccess: ({ sug }: any) => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/features", selectedFeatureDataset] });
      setStagedFeatures(prev => new Set([...prev, sug.id]));
    },
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", uploadName || file.name.replace(".csv", ""));
      const r = await fetch("/api/retail/kpiAnomaly/datasets/upload", { method: "POST", body: fd });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/datasets"] });
      setActiveTab("registry");
      toast({ title: "Dataset uploaded", description: `${d.rowCount.toLocaleString()} rows ingested` });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/retail/kpiAnomaly/datasets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/datasets"] });
      toast({ title: "Dataset deleted" });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const edaMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/retail/kpiAnomaly/datasets/${id}/eda`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/datasets"] });
      toast({ title: "EDA complete", description: "Analysis has been generated for this dataset." });
    },
    onError: (e: any) => toast({ title: "EDA failed", description: e.message, variant: "destructive" }),
  });

  const selectedDataset = edaSource !== "live" ? datasets.find(d => d.id === edaSource) ?? null : null;
  const dsEda = selectedDataset ? (selectedDataset as any).edaReport as any : null;
  const dsQuality = selectedDataset ? (selectedDataset as any).qualityReport as any : null;
  const activeEda = edaSource === "live" ? eda : dsEda;
  const isActiveEdaPending = edaSource === "live" ? edaLoading : edaMut.isPending;
  const hasActiveEda = Boolean(activeEda);
  const sourceLabel = edaSource === "live" ? "Customers" : "Rows";

  function handleFileDrop(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.endsWith(".csv")) { toast({ title: "CSV files only", variant: "destructive" }); return; }
    uploadMut.mutate(file);
  }

  const numCols = activeEda?.numericStats ? Object.keys(activeEda.numericStats) : [];
  const catCols = activeEda?.catStats ? Object.keys(activeEda.catStats) : [];
  const selectedNum = activeEda?.numericStats?.[selectedNumCol];
  const selectedCat = activeEda?.catStats?.[selectedCatCol];

  useEffect(() => {
    if (numCols.length && !numCols.includes(selectedNumCol)) {
      setSelectedNumCol(numCols[0]);
    }
    if (catCols.length && !catCols.includes(selectedCatCol)) {
      setSelectedCatCol(catCols[0]);
    }
  }, [activeEda, catCols.length, numCols.length, selectedCatCol, selectedNumCol]);

  // Use model features from API (sorted by importance), or fallback to empty array
  const MODEL_FEATURES = modelFeatures?.features || [];

  const toPositiveNumber = (value: any) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  const modelFeatureMaxImportance = MODEL_FEATURES.length > 0
    ? Math.max(...MODEL_FEATURES.map((feature: any) => toPositiveNumber(feature.importance)))
    : 1;

  const SUGGESTED_FEATURES = suggestedFeatures;

  const suggestedFeatureMaxGain = Math.max(
    1,
    ...SUGGESTED_FEATURES.map((feature) => toPositiveNumber(feature.importanceGain)),
  );
  const currentFeatureType = FEATURE_TYPE_OPTIONS.find((option) => option.value === featureDraft.type) || FEATURE_TYPE_OPTIONS[0];

  return (
    <OrionLayout title="Data Hub" subtitle="Dataset registry, EDA, and Feature Engineering" isLoading={edaLoading}>
      <div className="space-y-4">
        <OrionNav current="/retail/kpi-anomaly/orion/data" basePath="/retail/kpi-anomaly/orion" />

        <div className="flex gap-1 border-b">
          {(["ingest", "registry", "eda", "quality", "features"] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              data-testid={`tab-${t}`}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "ingest" ? "Ingest Data" : t === "eda" ? "EDA / Analysis" : t === "features" ? "Feature Builder" : t === "quality" ? "Data Quality" : "Dataset Registry"}
            </button>
          ))}
        </div>

        {/* INGEST DATA */}
        {activeTab === "ingest" && (
          <div className="space-y-4">
            <div className="flex gap-1 border-b">
              {(["file", "db", "live"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setIngestTab(t)}
                  data-testid={`tab-ingest-${t}`}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                    ingestTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "file" && <Upload className="w-3 h-3" />}
                  {t === "db" && <Database className="w-3 h-3" />}
                  {t === "live" && <Wifi className="w-3 h-3" />}
                  {t === "file" ? "File Upload" : t === "db" ? "Database Connect" : "Live Feed"}
                </button>
              ))}
            </div>

            {ingestTab === "file" && (
              <div className="max-w-xl space-y-4">
                <div>
                  <Label className="text-xs">Dataset Name (optional)</Label>
                  <Input
                    className="mt-1 h-8 text-xs"
                    placeholder="e.g. KPI Anomaly Q1 2026"
                    value={uploadName}
                    onChange={e => setUploadName(e.target.value)}
                    data-testid="input-dataset-name"
                  />
                </div>
                <div
                  className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                    dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  }`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleFileDrop(e.dataTransfer.files); }}
                  onClick={() => fileRef.current?.click()}
                  data-testid="dropzone-upload"
                >
                  <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm font-medium">Drop CSV file here or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Supports .csv files up to 50 MB</p>
                  {uploadMut.isPending && (
                    <p className="text-xs text-primary mt-2 animate-pulse">Uploading and processing...</p>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleFileDrop(e.target.files)} />
                <p className="text-xs text-muted-foreground">After upload, the dataset will appear in the Dataset Registry with automatic row/column profiling.</p>
              </div>
            )}

            {ingestTab === "db" && (
              <div className="max-w-xl border rounded-lg p-5 bg-card space-y-4">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Database className="w-4 h-4 text-primary" />External Database Connection</h3>
                <p className="text-xs text-muted-foreground">Connect to an external PostgreSQL, MySQL, or Snowflake database to import training data.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Host</Label>
                    <Input className="mt-1 h-8 text-xs" placeholder="db.example.com" value={dbForm.host} onChange={e => setDbForm(p => ({ ...p, host: e.target.value }))} data-testid="input-db-host" />
                  </div>
                  <div>
                    <Label className="text-xs">Port</Label>
                    <Input className="mt-1 h-8 text-xs" value={dbForm.port} onChange={e => setDbForm(p => ({ ...p, port: e.target.value }))} data-testid="input-db-port" />
                  </div>
                  <div>
                    <Label className="text-xs">Database</Label>
                    <Input className="mt-1 h-8 text-xs" placeholder="churn_db" value={dbForm.dbname} onChange={e => setDbForm(p => ({ ...p, dbname: e.target.value }))} data-testid="input-db-name" />
                  </div>
                  <div>
                    <Label className="text-xs">Username</Label>
                    <Input className="mt-1 h-8 text-xs" value={dbForm.user} onChange={e => setDbForm(p => ({ ...p, user: e.target.value }))} data-testid="input-db-user" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Password</Label>
                    <Input type="password" className="mt-1 h-8 text-xs" value={dbForm.password} onChange={e => setDbForm(p => ({ ...p, password: e.target.value }))} data-testid="input-db-password" />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="text-xs" data-testid="button-test-connection">Test Connection</Button>
                  <Button size="sm" className="text-xs" disabled={!dbForm.host || !dbForm.dbname} data-testid="button-import-db">Import Schema</Button>
                </div>
                <p className="text-xs text-muted-foreground">Note: For live Orion training, use the Experiment Lab's "Live Customer DB" option which connects directly to the platform database.</p>
              </div>
            )}

            {ingestTab === "live" && (
              <div className="max-w-xl border rounded-lg p-5 bg-card space-y-4">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Wifi className="w-4 h-4 text-primary" />Live Data Feed</h3>
                <p className="text-xs text-muted-foreground">Configure a streaming connection for continuous model retraining on fresh data.</p>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Feed Type</Label>
                    <Select defaultValue="kafka">
                      <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-feed-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="kafka">Apache Kafka</SelectItem>
                        <SelectItem value="rest">REST Webhook</SelectItem>
                        <SelectItem value="ws">WebSocket</SelectItem>
                        <SelectItem value="kinesis">AWS Kinesis</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Endpoint / Broker URL</Label>
                    <Input className="mt-1 h-8 text-xs" placeholder="kafka://broker:9092/churn-events" data-testid="input-feed-url" />
                  </div>
                  <div>
                    <Label className="text-xs">Topic / Path</Label>
                    <Input className="mt-1 h-8 text-xs" placeholder="churn-events" data-testid="input-feed-topic" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-xs text-muted-foreground">Not connected — configure connection above</span>
                  </div>
                  <Button size="sm" className="text-xs" data-testid="button-connect-feed">Connect Feed</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* DATASET REGISTRY */}
        {activeTab === "registry" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Total Datasets" value={datasets.length} color="blue" />
              <KpiCard label="Total Rows" value={(datasets.reduce((s, d) => s + d.rowCount, 0)).toLocaleString()} />
              <KpiCard label="Processed" value={datasets.filter(d => d.status !== "uploaded").length} color="green" />
              <KpiCard label="Avg Columns" value={datasets.length ? Math.round(datasets.reduce((s, d) => s + d.columnCount, 0) / datasets.length) : 0} />
            </div>
            <div className="bg-card border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Database className="w-4 h-4 text-primary" />Dataset Registry</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {["Name", "File", "Rows", "Cols", "Status", "Uploaded", ""].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datasets.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No datasets yet. Train a live model to auto-create one.</td></tr>
                    )}
                    {datasets.map(ds => (
                      <tr key={ds.id} className="border-b hover:bg-muted/10" data-testid={`row-dataset-${ds.id}`}>
                        <td className="px-3 py-2 font-medium">{ds.name}</td>
                        <td className="px-3 py-2 text-muted-foreground font-mono text-[10px]">{ds.fileName}</td>
                        <td className="px-3 py-2 font-mono">{ds.rowCount.toLocaleString()}</td>
                        <td className="px-3 py-2 font-mono">{ds.columnCount}</td>
                        <td className="px-3 py-2"><StatusBadge status={ds.status} /></td>
                        <td className="px-3 py-2 text-muted-foreground">{ds.uploadedAt ? new Date(ds.uploadedAt).toLocaleDateString() : "—"}</td>
                        <td className="px-3 py-2">
                          <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                            onClick={() => setDeleteTarget(ds)} data-testid={`button-delete-dataset-${ds.id}`}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {datasets.filter(ds => ds.featureReport).map(ds => (
              <div key={ds.id} className="bg-card border rounded-lg p-4">
                <h4 className="text-xs font-semibold mb-3 text-muted-foreground uppercase">Feature Report — {ds.name}</h4>
                <div className="flex gap-4 text-xs mb-3">
                  <span>Total: <strong>{(ds.featureReport as any)?.totalFeatures}</strong></span>
                  <span>Selected: <strong className="text-primary">{(ds.featureReport as any)?.selectedFeatures}</strong></span>
                </div>
                <div className="space-y-1">
                  {((ds.featureReport as any)?.featureScores || []).slice(0, 12).map((f: any) => (
                    <div key={f.feature} className="flex items-center gap-2 text-[10px]">
                      <span className="w-40 truncate text-muted-foreground">{f.feature}</span>
                      <div className="flex-1 h-2.5 bg-muted rounded overflow-hidden">
                        <div className={`h-full rounded ${f.selected ? "bg-primary" : "bg-muted-foreground/30"}`}
                          style={{ width: `${Math.min(f.normalizedScore, 100)}%` }} />
                      </div>
                      <span className="w-10 font-mono">{f.normalizedScore?.toFixed(1)}</span>
                      <span className={`text-[9px] ${f.selected ? "text-emerald-500" : "text-muted-foreground"}`}>{f.selected ? "✓" : "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* EDA */}
        {activeTab === "eda" && (
          <div className="space-y-4">

            {/* DATA SOURCE SELECTOR */}
            <div className="flex items-center gap-3 bg-muted/40 border rounded-lg px-4 py-3">
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Data Source:</span>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setEdaSource("live")}
                  data-testid="eda-source-live"
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border transition-colors ${edaSource === "live" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:border-primary/50"}`}
                >
                  <Activity className="w-3 h-3" /> Live Customer DB
                </button>
                {datasets.map(ds => (
                  <button
                    key={ds.id}
                    onClick={() => setEdaSource(ds.id)}
                    data-testid={`eda-source-dataset-${ds.id}`}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border transition-colors ${edaSource === ds.id ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:border-primary/50"}`}
                  >
                    <Database className="w-3 h-3" /> {ds.name}
                    <span className="opacity-60">({ds.rowCount.toLocaleString()} rows)</span>
                  </button>
                ))}
                {datasets.length === 0 && (
                  <span className="text-xs text-muted-foreground italic">Upload a dataset in Ingest Data to analyse it here</span>
                )}
              </div>
            </div>

            {/* Dataset header + Run EDA — dataset sources only */}
            {edaSource !== "live" && selectedDataset && (
              <div className="flex items-center justify-between bg-card border rounded-lg px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold">{selectedDataset.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedDataset.rowCount.toLocaleString()} rows · {selectedDataset.columnCount} columns
                    · Status: <span className="font-medium capitalize">{selectedDataset.status.replace(/_/g, " ")}</span>
                  </p>
                </div>
                <Button size="sm" className="text-xs" onClick={() => edaMut.mutate(selectedDataset.id)} disabled={edaMut.isPending} data-testid="button-run-eda">
                  {edaMut.isPending ? "Running…" : dsEda ? "Re-run EDA" : "Run EDA Analysis"}
                </Button>
              </div>
            )}

            {/* No EDA placeholder */}
            {edaSource !== "live" && selectedDataset && !dsEda && !edaMut.isPending && (
              <div className="border border-dashed rounded-lg p-10 text-center text-muted-foreground text-sm space-y-2">
                <AlertTriangle className="w-8 h-8 mx-auto opacity-40" />
                <p>No EDA report yet for this dataset.</p>
                <p className="text-xs">Click <strong>Run EDA Analysis</strong> above to generate feature distributions, correlations, and category breakdowns.</p>
              </div>
            )}

            {/* Unified tab buttons — live or dataset with EDA */}
            {(edaSource === "live" || dsEda) && !edaMut.isPending && (
              <div className="flex gap-1 flex-wrap">
                {EDA_TABS.map(t => (
                  <button key={t} onClick={() => setEdaTab(t)} data-testid={`tab-eda-${t.toLowerCase().replace(/\s+/g, "-")}`}
                    className={`px-3 py-1.5 text-[11px] rounded font-medium transition-colors ${edaTab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                    {t}
                  </button>
                ))}
              </div>
            )}
            {isActiveEdaPending && <div className="text-center py-12 text-muted-foreground text-sm">Analyzing {edaSource === "live" ? "live customer database" : selectedDataset?.name}…</div>}
            {!isActiveEdaPending && activeEda && (
              <>
                {edaTab === "Overview" && activeEda.overview && (
                  <div className="space-y-4">
                    {/* Key Insights — dataset EDA only */}
                    {edaSource !== "live" && activeEda.insights && activeEda.insights.length > 0 && (
                      <div className="bg-card border rounded-lg p-4">
                        <h4 className="text-xs font-semibold mb-3 uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-amber-400" />Key Insights
                        </h4>
                        <ul className="space-y-1.5">
                          {activeEda.insights.map((ins: string, i: number) => (
                            <li key={i} className="flex gap-2 text-xs">
                              <Zap className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                              <span>{ins}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <KpiCard label={`Total ${sourceLabel}`} value={(activeEda.overview?.totalRows ?? 0).toLocaleString()} color="blue" />
                      <KpiCard label="Numeric KPIs" value={activeEda.overview?.numericFeatures ?? 0} sub="KPI columns detected" color="amber" />
                      <KpiCard label="Categorical" value={activeEda.overview?.categoricalFeatures ?? 0} sub="non-numeric columns" color="blue" />
                      <KpiCard label="Features" value={activeEda.overview?.features ?? 0} sub={`${activeEda.overview?.numericFeatures ?? 0} numeric · ${activeEda.overview?.categoricalFeatures ?? 0} categorical`} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-card border rounded-lg p-4">
                        <h4 className="text-xs font-semibold mb-4 uppercase tracking-wider text-muted-foreground">KPI Column Overview</h4>
                        <div className="space-y-2">
                          {Object.entries(activeEda.numericStats || {}).slice(0, 5).map(([col, s]: [string, any]) => {
                            const mx = Math.max(...Object.values(activeEda.numericStats || {}).map((x: any) => x.max ?? 0));
                            const pct = mx > 0 ? Math.min(100, ((s.mean ?? 0) / mx) * 100) : 0;
                            return (
                              <div key={col} className="flex items-center gap-2 text-xs">
                                <span className="w-32 text-muted-foreground truncate">{col}</span>
                                <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                                  <div className="h-full bg-blue-500 rounded opacity-70" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="font-mono text-[10px] w-16 text-right">{(s.mean ?? 0).toFixed(1)} avg</span>
                              </div>
                            );
                          })}
                          {activeEda.kpiOverview?.dateRange && (
                            <p className="text-[10px] text-muted-foreground mt-2">Date range: {activeEda.kpiOverview.dateRange}</p>
                          )}
                        </div>
                      </div>
                      <div className="bg-card border rounded-lg p-4">
                        <h4 className="text-xs font-semibold mb-3 uppercase tracking-wider text-muted-foreground">Completeness by Field</h4>
                        <div className="space-y-2">
                          {Object.entries(activeEda.numericStats || {}).slice(0, 7).map(([col, s]: [string, any]) => (
                            <div key={col} className="flex items-center gap-2 text-xs">
                              <span className="w-32 text-muted-foreground truncate">{col}</span>
                              <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded" style={{ width: `${s.completeness}%` }} />
                              </div>
                              <span className="font-mono text-[10px] w-10 text-right">{s.completeness}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {edaTab === "Univariate" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-card border rounded-lg p-4">
                        <label className="text-[10px] text-muted-foreground uppercase">Numeric Feature</label>
                        <select className="mt-1 w-full text-xs bg-background border rounded px-2 py-1"
                          value={selectedNumCol} onChange={e => setSelectedNumCol(e.target.value)} data-testid="select-numeric-col">
                          {numCols.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {selectedNum && (
                          <div className="mt-3 space-y-0.5">
                            <StatRow label="Mean" value={selectedNum.mean} />
                            <StatRow label="Median" value={selectedNum.median} />
                            <StatRow label="Std Dev" value={selectedNum.stdDev} />
                            <StatRow label="Min / Max" value={`${selectedNum.min} / ${selectedNum.max}`} />
                            <StatRow label="Q1 / Q3" value={`${selectedNum.q1} / ${selectedNum.q3}`} />
                            <StatRow label="Missing" value={`${selectedNum.nullCount ?? 0} (${(100 - (selectedNum.completeness ?? 100)).toFixed(1)}%)`} />
                            <StatRow label="Completeness" value={`${selectedNum.completeness ?? 100}%`} />
                          </div>
                        )}
                      </div>
                      <div className="bg-card border rounded-lg p-4">
                        <h4 className="text-[10px] text-muted-foreground uppercase mb-3">Distribution — {selectedNumCol}</h4>
                        {selectedNum?.histogram && (
                          <div className="space-y-1">
                            {selectedNum.histogram.map((b: any, i: number) => {
                              const mx = Math.max(...selectedNum.histogram.map((x: any) => x.count));
                              return <HistogramBar key={i} label={b.label} count={b.count} max={mx} />;
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="bg-card border rounded-lg p-4">
                      <label className="text-[10px] text-muted-foreground uppercase">Categorical Feature</label>
                      <select className="mt-1 w-full text-xs bg-background border rounded px-2 py-1"
                        value={selectedCatCol} onChange={e => setSelectedCatCol(e.target.value)} data-testid="select-cat-col">
                        {catCols.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {selectedCat && (
                        <div className="mt-3 space-y-1">
                          {selectedCat.top?.map((item: any) => {
                            const mx = selectedCat.top[0]?.count || 1;
                            return <HistogramBar key={item.label} label={item.label} count={item.count} max={mx} churnCount={item.churnCount} />;
                          })}
                          <p className="text-[9px] text-muted-foreground mt-2">Red fill = churned proportion within bar</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {edaTab === "Bivariate" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-card border rounded-lg p-4">
                      <h4 className="text-xs font-semibold mb-3 text-muted-foreground uppercase">Top Correlated KPI Pairs</h4>
                      <p className="text-[10px] text-muted-foreground mb-3">Pearson correlation between numeric KPI columns · Blue = positive · Red = negative</p>
                      <div className="space-y-2">
                        {(activeEda.correlationMatrix || []).slice(0, 8).length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No significant correlations found (|r| &gt; 0.2)</p>
                        ) : (
                          (activeEda.correlationMatrix || []).slice(0, 8).map((c: any) => {
                            const abs  = Math.abs(c.corr);
                            const isPos = c.corr >= 0;
                            return (
                              <div key={`${c.col1}-${c.col2}`} className="space-y-0.5">
                                <div className="flex justify-between text-[10px]">
                                  <span className="text-muted-foreground truncate max-w-[160px]">{c.col1} ↔ {c.col2}</span>
                                  <span className={`font-mono font-bold ${isPos ? "text-blue-500" : "text-red-500"}`}>{c.corr > 0 ? "+" : ""}{c.corr.toFixed(3)}</span>
                                </div>
                                <div className="h-2 bg-muted rounded overflow-hidden">
                                  <div className={`h-full rounded ${isPos ? "bg-blue-500" : "bg-red-500"}`} style={{ width: `${abs * 100}%` }} />
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <div className="bg-card border rounded-lg p-4">
                      <h4 className="text-xs font-semibold mb-3 text-muted-foreground uppercase">Outlier Summary by KPI</h4>
                      <p className="text-[10px] text-muted-foreground mb-3">Columns where &gt;5% of rows are IQR outliers</p>
                      <div className="space-y-2">
                        {(activeEda.dataRisks?.outliers || []).length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No columns exceed 5% outlier threshold</p>
                        ) : (
                          (activeEda.dataRisks?.outliers || []).map((o: any) => (
                            <div key={o.column} className="space-y-0.5">
                              <div className="flex justify-between text-[10px]">
                                <span className="text-muted-foreground truncate max-w-[160px]">{o.column}</span>
                                <span className="font-mono font-bold text-amber-500">{o.percent}% outliers</span>
                              </div>
                              <div className="h-2 bg-muted rounded overflow-hidden">
                                <div className="h-full bg-amber-500 rounded" style={{ width: `${Math.min(o.percent, 100)}%` }} />
                              </div>
                              <span className="text-[9px] text-muted-foreground">{o.outlierCount} rows flagged</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {edaTab === "Multivariate" && (
                  <div className="bg-card border rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b">
                      <h4 className="text-xs font-semibold">KPI Statistics Summary</h4>
                      <p className="text-[10px] text-muted-foreground mt-0.5">All numeric KPI columns — mean, spread, completeness, and outlier exposure</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            {["KPI Column", "Mean", "Median", "Std Dev", "Min", "Max", "Completeness", "Outliers"].map(h => (
                              <th key={h} className="text-left px-3 py-2 text-muted-foreground">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(activeEda.numericStats || {}).length === 0 ? (
                            <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No numeric KPI columns found</td></tr>
                          ) : (
                            Object.entries(activeEda.numericStats || {}).map(([col, s]: [string, any]) => {
                              const outlierRow = (activeEda.dataRisks?.outliers || []).find((o: any) => o.column === col);
                              const completeness = s.completeness ?? 100;
                              return (
                                <tr key={col} className="border-b hover:bg-muted/10">
                                  <td className="px-3 py-2 font-medium max-w-[140px] truncate">{col}</td>
                                  <td className="px-3 py-2 font-mono">{(s.mean ?? 0).toFixed(2)}</td>
                                  <td className="px-3 py-2 font-mono">{(s.median ?? 0).toFixed(2)}</td>
                                  <td className="px-3 py-2 font-mono text-muted-foreground">{(s.stdDev ?? 0).toFixed(2)}</td>
                                  <td className="px-3 py-2 font-mono text-blue-500">{(s.min ?? 0).toFixed(2)}</td>
                                  <td className="px-3 py-2 font-mono text-purple-500">{(s.max ?? 0).toFixed(2)}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-1.5">
                                      <div className="h-1.5 w-14 bg-muted rounded overflow-hidden">
                                        <div className="h-full bg-emerald-500 rounded" style={{ width: `${completeness}%` }} />
                                      </div>
                                      <span className={`font-mono ${completeness < 80 ? "text-red-500" : "text-emerald-600"}`}>{completeness}%</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 font-mono">
                                    {outlierRow ? (
                                      <span className="text-amber-500">{outlierRow.percent}%</span>
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {edaTab === "Time Trends" && (
                  <div className="space-y-4">
                    <div className="bg-card border rounded-lg p-4">
                      <h4 className="text-xs font-semibold mb-3 text-muted-foreground uppercase">Date Column Coverage</h4>
                      <div className="flex flex-wrap gap-6 text-xs">
                        <div>
                          <span className="text-muted-foreground">Date Column</span>
                          <p className="font-mono font-semibold mt-0.5">{activeEda.kpiOverview?.dateColumn ?? "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Date Range</span>
                          <p className="font-mono font-semibold mt-0.5">{activeEda.kpiOverview?.dateRange ?? "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Total Rows</span>
                          <p className="font-mono font-semibold mt-0.5">{(activeEda.overview?.totalRows ?? 0).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-card border rounded-lg p-4">
                      <h4 className="text-xs font-semibold mb-3 text-muted-foreground uppercase">KPI Value Distributions (Top 6)</h4>
                      <p className="text-[10px] text-muted-foreground mb-4">Histogram of values across all rows — shows spread and skew per KPI</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {Object.entries(activeEda.numericStats || {}).slice(0, 6).map(([col, s]: [string, any]) => (
                          <div key={col}>
                            <p className="text-[10px] font-semibold mb-1.5 truncate">{col}
                              <span className="text-muted-foreground font-normal ml-2">mean {(s.mean ?? 0).toFixed(1)} · std {(s.stdDev ?? 0).toFixed(1)}</span>
                            </p>
                            <div className="space-y-0.5">
                              {(s.histogram || []).slice(0, 10).map((b: any, i: number) => {
                                const mx = Math.max(...(s.histogram || []).map((x: any) => x.count), 1);
                                return (
                                  <div key={i} className="flex items-center gap-1.5 text-[9px]">
                                    <span className="text-muted-foreground w-20 truncate text-right">{b.label}</span>
                                    <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                                      <div className="h-full bg-blue-500 rounded opacity-70" style={{ width: `${(b.count / mx) * 100}%` }} />
                                    </div>
                                    <span className="font-mono w-8 text-right">{b.count}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-card border rounded-lg p-4">
                      <h4 className="text-xs font-semibold mb-3 text-muted-foreground uppercase">Missing Values Over KPIs</h4>
                      <div className="space-y-2">
                        {(activeEda.dataRisks?.nullRisks || []).length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No missing values detected in any column</p>
                        ) : (
                          (activeEda.dataRisks?.nullRisks || []).map((n: any) => (
                            <div key={n.column} className="flex items-center gap-2 text-xs">
                              <span className="w-36 text-muted-foreground truncate">{n.column}</span>
                              <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                                <div className="h-full bg-red-400 rounded" style={{ width: `${Math.min(n.nullPercent, 100)}%` }} />
                              </div>
                              <span className="font-mono text-red-400 w-14 text-right">{n.nullPercent}% null</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {edaTab === "Correlation" && (
                  <div className="bg-card border rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b">
                      <h4 className="text-xs font-semibold">Pearson Correlation — Top Feature Pairs</h4>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Blue = positive · Red = negative</p>
                    </div>
                    <div className="p-4 space-y-2">
                      {(activeEda.correlationMatrix || []).slice(0, 21).map((c: any) => {
                        const abs = Math.abs(c.corr);
                        const isPos = c.corr >= 0;
                        return (
                          <div key={`${c.col1}-${c.col2}`} className="flex items-center gap-2">
                            <span className="w-28 text-right text-muted-foreground truncate text-[10px]">{c.col1}</span>
                            <span className="text-muted-foreground/40 text-[10px]">↔</span>
                            <span className="w-28 text-muted-foreground truncate text-[10px]">{c.col2}</span>
                            <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                              <div className={`h-full ${isPos ? "bg-blue-500" : "bg-red-500"} opacity-70 rounded`} style={{ width: `${abs * 100}%` }} />
                            </div>
                            <span className={`w-14 text-right font-mono font-bold text-[10px] ${isPos ? "text-blue-500" : "text-red-500"}`}>
                              {isPos ? "+" : ""}{c.corr.toFixed(3)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {edaTab === "Data Risks" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <KpiCard label="Class Imbalance" value={`${activeEda.dataRisks?.classImbalance ?? 0}%`} color={(activeEda.dataRisks?.classImbalance ?? 0) > 30 ? "amber" : "green"} sub="positive class rate" />
                      <KpiCard label="Duplicates" value={activeEda.dataRisks?.duplicates ?? 0} color={(activeEda.dataRisks?.duplicates ?? 0) > 0 ? "red" : "green"} />
                      <KpiCard label="Fields w/ Nulls" value={activeEda.dataRisks?.nullRisks?.length ?? 0} color={(activeEda.dataRisks?.nullRisks?.length ?? 0) > 3 ? "amber" : "green"} />
                      <KpiCard label="Outlier Columns" value={activeEda.dataRisks?.outliers?.length ?? 0} color={(activeEda.dataRisks?.outliers?.length ?? 0) > 0 ? "amber" : "green"} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-card border rounded-lg p-4">
                        <h4 className="text-xs font-semibold mb-3 text-muted-foreground uppercase flex items-center gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />Null / Missing Data
                        </h4>
                        <div className="space-y-1.5">
                          {(activeEda.dataRisks?.nullRisks || []).map((r: any) => (
                            <div key={r.column} className="flex justify-between items-center text-xs">
                              <span>{r.column}</span>
                              <div className="flex items-center gap-2">
                                <div className="w-20 h-2 bg-muted rounded overflow-hidden">
                                  <div className="h-full bg-amber-500 rounded" style={{ width: `${r.nullPercent ?? 0}%` }} />
                                </div>
                                <span className="text-amber-500 font-mono">{r.nullCount} nulls ({r.nullPercent}%)</span>
                              </div>
                            </div>
                          ))}
                          {(activeEda.dataRisks?.nullRisks?.length ?? 0) === 0 && (
                            <p className="text-xs text-emerald-500">✓ No missing values detected.</p>
                          )}
                        </div>
                      </div>
                      <div className="bg-card border rounded-lg p-4">
                        <h4 className="text-xs font-semibold mb-3 text-muted-foreground uppercase flex items-center gap-2">
                          <Activity className="w-3.5 h-3.5 text-red-500" />Outliers {"&"} Low Variance
                        </h4>
                        <div className="space-y-1.5">
                          {(activeEda.dataRisks?.outliers || []).map((o: any) => (
                            <div key={o.column} className="flex items-center gap-2 text-xs">
                              <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                              <span className="font-medium">{o.column}</span>
                              <span className="text-muted-foreground">{o.outlierCount} outliers ({o.percent}%)</span>
                            </div>
                          ))}
                          {(activeEda.dataRisks?.lowVariance || []).map((o: any) => (
                            <div key={o.column} className="flex items-center gap-2 text-xs">
                              <AlertTriangle className="w-3 h-3 text-blue-500 shrink-0" />
                              <span className="font-medium">{o.column}</span>
                              <span className="text-muted-foreground">Low variance (std: {o.std})</span>
                            </div>
                          ))}
                          {(activeEda.dataRisks?.outliers?.length ?? 0) === 0 && (activeEda.dataRisks?.lowVariance?.length ?? 0) === 0 && (
                            <p className="text-xs text-emerald-500">✓ No outliers or low-variance features detected.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* DATA QUALITY */}
        {activeTab === "quality" && (() => {
          const numericCols = eda?.numericStats ? Object.entries(eda.numericStats as Record<string, any>) : [];
          const catColsMap = eda?.catStats ? Object.entries(eda.catStats as Record<string, any>) : [];
          const allColsLive = [
            ...numericCols.map(([col, s]) => ({ name: col, type: "numeric", nullCount: s.nullCount ?? 0, nullPercent: s.completeness != null ? (100 - s.completeness).toFixed(1) : "0.0", uniqueCount: s.uniqueCount ?? "—", completeness: s.completeness ?? 100, histogram: s.histogram })),
            ...catColsMap.map(([col, s]) => ({ name: col, type: "categorical", nullCount: s.nullCount ?? 0, nullPercent: "—", uniqueCount: s.uniqueCount ?? "—", completeness: s.nullCount === 0 ? 100 : parseFloat((100 - (s.nullCount / (eda.overview?.totalCustomers || 500)) * 100).toFixed(1)), histogram: null })),
          ];
          const avgCompletenessLive = numericCols.length > 0
            ? Math.round(numericCols.reduce((a, [, s]) => a + (s.completeness ?? 100), 0) / numericCols.length)
            : 100;
          const totalNullsLive = numericCols.reduce((a, [, s]) => a + (s.nullCount ?? 0), 0) + catColsMap.reduce((a, [, s]) => a + (s.nullCount ?? 0), 0);
          const risks = eda?.dataRisks ?? {};
          const classImbalance = risks.classImbalance ?? {};
          const outliers = risks.outliers ?? [];
          const nullRisks = risks.nullRisks ?? [];
          const duplicates = risks.duplicates ?? 0;
          const lowVariance = risks.lowVariance ?? [];

          const qualityScoreLive = Math.round(
            avgCompletenessLive * 0.5 +
            (duplicates === 0 ? 100 : Math.max(0, 100 - duplicates * 5)) * 0.2 +
            (outliers.length === 0 ? 100 : Math.max(0, 100 - outliers.length * 10)) * 0.15 +
            (nullRisks.length === 0 ? 100 : Math.max(0, 100 - nullRisks.length * 8)) * 0.15
          );

          const qsDs = qualitySource !== "live" ? datasets.find((d: any) => d.id === qualitySource) : null;
          const dsCols = (qsDs?.columns as any[]) ?? [];
          const dsReport = qsDs?.qualityReport as any;
          const dsCompleteness = dsCols.length > 0
            ? Math.round(dsCols.reduce((a: number, c: any) => a + (100 - parseFloat(c.nullPercent ?? "0")), 0) / dsCols.length)
            : (dsReport?.overallScore ?? 100);

          return (
            <div className="space-y-4">
              {/* Source Picker */}
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-muted-foreground mr-1">Source:</span>
                <button
                  onClick={() => setQualitySource("live")}
                  data-testid="quality-source-live"
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${qualitySource === "live" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  <span className="flex items-center gap-1.5"><Database className="w-3 h-3" />Live Customer DB</span>
                </button>
                {datasets.map((ds: any) => (
                  <button
                    key={ds.id}
                    onClick={() => setQualitySource(ds.id)}
                    data-testid={`quality-source-ds-${ds.id}`}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${qualitySource === ds.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {ds.name}
                  </button>
                ))}
              </div>

              {/* ── LIVE DB QUALITY ── */}
              {qualitySource === "live" && (
                <div className="space-y-4">
                  {/* KPI row */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="bg-card border rounded-lg p-4 flex flex-col items-center justify-center">
                      <div className={`text-3xl font-bold ${qualityScoreLive >= 90 ? "text-green-400" : qualityScoreLive >= 70 ? "text-amber-400" : "text-red-400"}`}>{qualityScoreLive}</div>
                      <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">Quality Score</div>
                      <div className="mt-2 w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${qualityScoreLive >= 90 ? "bg-green-500" : qualityScoreLive >= 70 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${qualityScoreLive}%` }} />
                      </div>
                    </div>
                    <KpiCard label="Total Records" value={(eda?.overview?.totalRows ?? 0).toLocaleString()} />
                    <KpiCard label="Completeness" value={`${avgCompletenessLive}%`} color={avgCompletenessLive >= 95 ? "green" : "amber"} />
                    <KpiCard label="Missing Values" value={totalNullsLive.toLocaleString()} color={totalNullsLive === 0 ? "green" : "amber"} />
                    <KpiCard label="Duplicate Rows" value={duplicates} color={duplicates === 0 ? "green" : "red"} />
                  </div>

                  {/* KPI Column Summary + Risks */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* KPI Column Summary */}
                    <div className="bg-card border rounded-lg p-4 space-y-3">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><BarChart2 className="w-3.5 h-3.5" />KPI Column Summary</h4>
                      {(() => {
                        const total = eda?.overview?.totalRows ?? 0;
                        const numeric = eda?.overview?.numericFeatures ?? 0;
                        const categorical = eda?.overview?.categoricalFeatures ?? 0;
                        const features = eda?.overview?.features ?? 0;
                        const numericPct = features > 0 ? Math.round((numeric / features) * 100) : 0;
                        return (
                          <div className="space-y-2">
                            <div>
                              <div className="flex justify-between text-[10px] mb-0.5"><span className="text-muted-foreground">Numeric KPIs</span><span className="font-mono">{numeric} ({numericPct}%)</span></div>
                              <div className="h-3 bg-muted rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${numericPct}%` }} /></div>
                            </div>
                            <div>
                              <div className="flex justify-between text-[10px] mb-0.5"><span className="text-muted-foreground">Categorical</span><span className="font-mono">{categorical} ({100 - numericPct}%)</span></div>
                              <div className="h-3 bg-muted rounded-full overflow-hidden"><div className="h-full bg-purple-500 rounded-full" style={{ width: `${100 - numericPct}%` }} /></div>
                            </div>
                            <div className="mt-3 p-2 rounded text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              {total.toLocaleString()} rows · {features} columns · {numeric} KPI signals
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Data Risks */}
                    <div className="bg-card border rounded-lg p-4 space-y-2 md:col-span-2">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" />Data Risk Alerts</h4>
                      {nullRisks.length === 0 && outliers.length === 0 && duplicates === 0 && lowVariance.length === 0 ? (
                        <div className="flex items-center gap-2 text-xs text-green-400 py-2"><CheckCircle2 className="w-4 h-4" />No data quality issues detected — dataset is clean.</div>
                      ) : (
                        <div className="space-y-1.5">
                          {duplicates > 0 && (
                            <div className="flex items-start gap-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-[10px]">
                              <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                              <div><span className="text-red-400 font-medium">Duplicate Rows:</span> <span className="text-muted-foreground">{duplicates} duplicate records found — deduplication recommended</span></div>
                            </div>
                          )}
                          {nullRisks.map((r: any) => (
                            <div key={r.col} className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[10px]">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                              <div><span className="text-amber-400 font-medium">{r.col}:</span> <span className="text-muted-foreground">{r.nullCount} missing values ({(100 - r.completeness).toFixed(1)}% null rate)</span></div>
                            </div>
                          ))}
                          {outliers.map((item: any) => {
                            const colName = typeof item === "string" ? item : item.col;
                            return (
                              <div key={colName} className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[10px]">
                                <TrendingUp className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                                <div><span className="text-amber-400 font-medium">{colName}:</span> <span className="text-muted-foreground">Potential outliers detected — review distribution</span></div>
                              </div>
                            );
                          })}
                          {lowVariance.map((item: any) => {
                            const colName = typeof item === "string" ? item : item.col;
                            return (
                              <div key={colName} className="flex items-start gap-2 p-2 rounded bg-blue-500/10 border border-blue-500/20 text-[10px]">
                                <AlertCircle className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
                                <div><span className="text-blue-400 font-medium">{colName}:</span> <span className="text-muted-foreground">Near-zero variance — consider dropping from feature set</span></div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Per-feature Quality Table + Distribution */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-card border rounded-lg overflow-hidden">
                      <div className="px-4 py-3 border-b">
                        <h4 className="text-xs font-semibold flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-primary" />Per-Feature Quality</h4>
                      </div>
                      <div className="overflow-auto max-h-64">
                        <table className="w-full text-[10px]">
                          <thead className="sticky top-0">
                            <tr className="border-b bg-muted/40">
                              {["Feature", "Type", "Nulls", "Null %", "Completeness"].map(h => (
                                <th key={h} className="px-3 py-2 text-left text-muted-foreground font-medium">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {allColsLive.map(col => (
                              <tr key={col.name} className="border-b hover:bg-muted/10" data-testid={`quality-row-live-${col.name}`}>
                                <td className="px-3 py-1.5 font-mono text-primary">{col.name}</td>
                                <td className="px-3 py-1.5 text-muted-foreground">{col.type}</td>
                                <td className="px-3 py-1.5">{col.nullCount}</td>
                                <td className="px-3 py-1.5">{col.nullCount === 0 ? "0.0" : col.nullPercent}%</td>
                                <td className="px-3 py-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full ${col.completeness >= 95 ? "bg-green-500" : col.completeness >= 80 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${col.completeness}%` }} />
                                    </div>
                                    <span className="w-8 text-right">{col.completeness}%</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Key Feature Distributions */}
                    <div className="bg-card border rounded-lg overflow-hidden">
                      <div className="px-4 py-3 border-b flex items-center justify-between">
                        <h4 className="text-xs font-semibold flex items-center gap-2"><BarChart2 className="w-3.5 h-3.5 text-primary" />Feature Distributions</h4>
                      </div>
                      <div className="p-4 space-y-4 overflow-auto max-h-64">
                        {numericCols.slice(0, 4).map(([col, s]) => {
                          const hist = s.histogram as { label: string; count: number; churnCount?: number }[] | undefined;
                          if (!hist || hist.length === 0) return null;
                          const maxCount = Math.max(...hist.map((b: any) => b.count));
                          return (
                            <div key={col}>
                              <div className="text-[10px] font-medium text-muted-foreground mb-1">{col}</div>
                              <div className="space-y-0.5">
                                {hist.map((bin: any, i: number) => (
                                  <HistogramBar key={i} label={bin.label} count={bin.count} max={maxCount} churnCount={bin.churnCount} />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── UPLOADED DATASET QUALITY ── */}
              {qualitySource !== "live" && (() => {
                if (!qsDs) return <div className="text-xs text-muted-foreground p-6 text-center">Select a dataset above.</div>;
                const numericDsCols = dsCols.filter((c: any) => c.type === "numeric" || c.type === "number");
                const catDsCols = dsCols.filter((c: any) => c.type !== "numeric" && c.type !== "number");
                const totalNullsDs = dsCols.reduce((a: number, c: any) => a + (c.nullCount ?? 0), 0);
                const qualityScoreDs = dsReport?.overallScore ?? dsCompleteness;
                const issueCount = dsReport?.totalIssues ?? dsCols.filter((c: any) => parseFloat(c.nullPercent ?? "0") > 0).length;

                return (
                  <div className="space-y-4">
                    {/* KPI row */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="bg-card border rounded-lg p-4 flex flex-col items-center justify-center">
                        <div className={`text-3xl font-bold ${qualityScoreDs >= 90 ? "text-green-400" : qualityScoreDs >= 70 ? "text-amber-400" : "text-red-400"}`}>{qualityScoreDs}</div>
                        <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">Quality Score</div>
                        <div className="mt-2 w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${qualityScoreDs >= 90 ? "bg-green-500" : qualityScoreDs >= 70 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${qualityScoreDs}%` }} />
                        </div>
                      </div>
                      <KpiCard label="Row Count" value={(qsDs.rowCount ?? 0).toLocaleString()} />
                      <KpiCard label="Columns" value={dsCols.length || (qsDs as any).columnCount || "—"} />
                      <KpiCard label="Completeness" value={`${dsCompleteness}%`} color={dsCompleteness >= 95 ? "green" : "amber"} />
                      <KpiCard label="Issues Found" value={issueCount} color={issueCount === 0 ? "green" : issueCount <= 3 ? "amber" : "red"} />
                    </div>

                    {/* Issues + Type breakdown */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-card border rounded-lg p-4 space-y-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><BarChart2 className="w-3.5 h-3.5" />Schema Overview</h4>
                        <div className="space-y-1.5 text-[10px]">
                          <StatRow label="Dataset Name" value={qsDs.name} />
                          <StatRow label="Total Rows" value={(qsDs.rowCount ?? 0).toLocaleString()} />
                          <StatRow label="Total Columns" value={dsCols.length || (qsDs as any).columnCount || "—"} />
                          <StatRow label="Numeric Cols" value={numericDsCols.length} />
                          <StatRow label="Categorical Cols" value={catDsCols.length} />
                          <StatRow label="Total Nulls" value={totalNullsDs} />
                          <StatRow label="Status" value={(qsDs as any).status ?? "uploaded"} />
                        </div>
                      </div>

                      <div className="bg-card border rounded-lg p-4 space-y-2 md:col-span-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" />Quality Issues</h4>
                        {(() => {
                          const issues: any[] = dsReport?.issues ?? dsCols.filter((c: any) => parseFloat(c.nullPercent ?? "0") > 0).map((c: any) => ({
                            severity: parseFloat(c.nullPercent) > 20 ? "high" : "medium",
                            type: "Missing Values",
                            column: c.name,
                            description: `${c.nullPercent}% missing values (${c.nullCount} of ${qsDs.rowCount} records)`,
                          }));
                          if (issues.length === 0) return <div className="flex items-center gap-2 text-xs text-green-400 py-2"><CheckCircle2 className="w-4 h-4" />No quality issues found — dataset is clean.</div>;
                          return (
                            <div className="space-y-1.5 overflow-auto max-h-48">
                              {issues.map((iss: any, i: number) => (
                                <div key={i} className={`flex items-start gap-2 p-2 rounded text-[10px] ${iss.severity === "high" ? "bg-red-500/10 border border-red-500/20" : iss.severity === "medium" ? "bg-amber-500/10 border border-amber-500/20" : "bg-blue-500/10 border border-blue-500/20"}`}>
                                  {iss.severity === "high" ? <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />}
                                  <div>
                                    <span className={`font-medium ${iss.severity === "high" ? "text-red-400" : "text-amber-400"}`}>{iss.column ?? iss.type}:</span>{" "}
                                    <span className="text-muted-foreground">{iss.description}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Per-column table + distribution */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-card border rounded-lg overflow-hidden">
                        <div className="px-4 py-3 border-b">
                          <h4 className="text-xs font-semibold flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-primary" />Per-Column Quality</h4>
                        </div>
                        {dsCols.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">No column metadata available for this dataset.</div>
                        ) : (
                          <div className="overflow-auto max-h-64">
                            <table className="w-full text-[10px]">
                              <thead className="sticky top-0">
                                <tr className="border-b bg-muted/40">
                                  {["Column", "Type", "Nulls", "Null %", "Unique", "Completeness"].map(h => (
                                    <th key={h} className="px-3 py-2 text-left text-muted-foreground font-medium">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {dsCols.map((col: any) => {
                                  const comp = parseFloat(col.nullPercent ?? "0") > 0 ? Math.round(100 - parseFloat(col.nullPercent)) : 100;
                                  return (
                                    <tr key={col.name} className="border-b hover:bg-muted/10" data-testid={`quality-row-ds-${col.name}`}>
                                      <td className="px-3 py-1.5 font-mono text-primary">{col.name}</td>
                                      <td className="px-3 py-1.5 text-muted-foreground">{col.type}</td>
                                      <td className="px-3 py-1.5">{col.nullCount ?? 0}</td>
                                      <td className="px-3 py-1.5">{col.nullPercent ?? "0.0"}%</td>
                                      <td className="px-3 py-1.5">{col.uniqueCount ?? "—"}</td>
                                      <td className="px-3 py-1.5">
                                        <div className="flex items-center gap-1.5">
                                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full ${comp >= 95 ? "bg-green-500" : comp >= 80 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${comp}%` }} />
                                          </div>
                                          <span className="w-8 text-right">{comp}%</span>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* Column distribution bars */}
                      <div className="bg-card border rounded-lg overflow-hidden">
                        <div className="px-4 py-3 border-b">
                          <h4 className="text-xs font-semibold flex items-center gap-2"><BarChart2 className="w-3.5 h-3.5 text-primary" />Data Distribution</h4>
                        </div>
                        <div className="p-4 space-y-4 overflow-auto max-h-64">
                          {dsCols.length === 0 ? (
                            <div className="text-xs text-muted-foreground text-center py-4">No distribution data available.</div>
                          ) : (
                            dsCols.slice(0, 5).map((col: any) => {
                              if (col.type === "numeric" || col.type === "number") {
                                const ns = col.numericStats;
                                if (!ns) return null;
                                return (
                                  <div key={col.name}>
                                    <div className="text-[10px] font-medium text-muted-foreground mb-1">{col.name} <span className="opacity-50">(min {ns.min?.toFixed(1)} / max {ns.max?.toFixed(1)} / mean {ns.mean?.toFixed(1)})</span></div>
                                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                      <div className="h-full bg-primary/60 rounded-full" style={{ width: "100%" }} />
                                    </div>
                                    {ns.histogram && (
                                      <div className="mt-1 space-y-0.5">
                                        {(ns.histogram as any[]).map((b: any, i: number) => (
                                          <HistogramBar key={i} label={b.label} count={b.count} max={Math.max(...(ns.histogram as any[]).map((x: any) => x.count))} />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              } else {
                                const cs = col.categoricalStats;
                                if (!cs?.top) return (
                                  <div key={col.name}>
                                    <div className="text-[10px] font-medium text-muted-foreground mb-1">{col.name} <span className="opacity-50">({col.uniqueCount} unique)</span></div>
                                    <div className="text-[10px] text-muted-foreground">No distribution detail available.</div>
                                  </div>
                                );
                                const maxCat = Math.max(...Object.values(cs.top as Record<string, number>));
                                return (
                                  <div key={col.name}>
                                    <div className="text-[10px] font-medium text-muted-foreground mb-1">{col.name} <span className="opacity-50">({col.uniqueCount} unique values)</span></div>
                                    <div className="space-y-0.5">
                                      {Object.entries(cs.top as Record<string, number>).slice(0, 5).map(([val, cnt]) => (
                                        <HistogramBar key={val} label={val} count={cnt} max={maxCat} />
                                      ))}
                                    </div>
                                  </div>
                                );
                              }
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {/* FEATURE INTELLIGENCE */}
        {activeTab === "features" && (
          <div className="space-y-4">
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Model Features" value={MODEL_FEATURES.length} color="blue" />
              <KpiCard label="Suggested Transforms" value={SUGGESTED_FEATURES.length} color="amber" />
              <KpiCard label="Staged for Model" value={stagedFeatures.size} color="green" />
              <KpiCard label="Custom Built" value={builtFeatures.length} />
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-1 border-b">
              {([
                { id: "model", label: "Model Features", icon: Brain },
                { id: "suggestions", label: "Suggested Transforms", icon: Sparkles },
                { id: "builder", label: "Custom Builder", icon: Zap },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setFeatureSubTab(id)}
                  data-testid={`tab-feature-${id}`}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                    featureSubTab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />{label}
                  {id === "suggestions" && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[9px] font-bold">{SUGGESTED_FEATURES.length}</span>}
                  {id === "model" && stagedFeatures.size > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 text-[9px] font-bold">+{stagedFeatures.size}</span>}
                </button>
              ))}
            </div>

            {/* ── MODEL FEATURES sub-tab ── */}
            {featureSubTab === "model" && (
              <div className="space-y-4">
                {/* Dataset Selection */}
                <div className="bg-muted/50 border rounded-lg px-4 py-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <Database className="w-4 h-4 text-primary" />
                    <div className="flex-1">
                      <Label className="text-xs font-medium">Select Dataset</Label>
                      <Select 
                        value={selectedFeatureDataset?.toString() || ""} 
                        onValueChange={(val) => {
                          setSelectedFeatureDataset(val ? parseInt(val) : null);
                          setSelectedFeatureModelId(null);
                        }}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs bg-background">
                          <SelectValue placeholder="Choose a trained dataset to view features..." />
                        </SelectTrigger>
                        <SelectContent>
                          {datasets.length === 0 && (
                            <SelectItem value="_none" disabled>No datasets available</SelectItem>
                          )}
                          {datasets.map(ds => (
                            <SelectItem key={ds.id} value={String(ds.id)}>
                              {ds.name} ({ds.rowCount?.toLocaleString()} rows)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {selectedFeatureDataset && datasetsModels.length > 0 && (
                    <div className="flex items-center gap-3">
                      <Brain className="w-4 h-4 text-primary" />
                      <div className="flex-1">
                        <Label className="text-xs font-medium">Select Model</Label>
                        <Select
                          value={selectedFeatureModelId?.toString() || "__default__"}
                          onValueChange={(val) => setSelectedFeatureModelId(val === "__default__" ? null : parseInt(val))}
                        >
                          <SelectTrigger className="mt-1 h-8 text-xs bg-background">
                            <SelectValue placeholder="Latest / deployed model (default)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default__">Latest / deployed model (default)</SelectItem>
                            {datasetsModels.map((m: any) => (
                              <SelectItem key={m.id} value={String(m.id)}>
                                {m.name} — {m.algorithm} {m.isDeployed ? "(deployed)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {selectedFeatureDataset && (
                    <p className="text-[10px] text-muted-foreground">
                      Features are sorted by importance from the selected model
                    </p>
                  )}
                </div>

                {/* Loading State */}
                {featuresLoading && selectedFeatureDataset && (
                  <div className="bg-card border rounded-lg px-4 py-12 text-center">
                    <p className="text-xs text-muted-foreground animate-pulse">Loading features from trained models...</p>
                  </div>
                )}

                {/* No Dataset Selected */}
                {!selectedFeatureDataset && (
                  <div className="bg-card border border-dashed rounded-lg px-4 py-12 text-center">
                    <Brain className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-40" />
                    <p className="text-sm font-medium text-muted-foreground">Select a dataset to view feature importance</p>
                    <p className="text-xs text-muted-foreground mt-1">Choose a dataset above that has been used for model training</p>
                  </div>
                )}

                {/* No Models for Selected Dataset */}
                {!featuresLoading && selectedFeatureDataset && MODEL_FEATURES.length === 0 && (
                  <div className="bg-card border border-dashed rounded-lg px-4 py-12 text-center">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-500 opacity-60" />
                    <p className="text-sm font-medium text-muted-foreground">No trained models for this dataset</p>
                    <p className="text-xs text-muted-foreground mt-1">Train a model on this dataset in the Experiments Lab first</p>
                  </div>
                )}

                {/* Model Info Badge */}
                {modelFeatures && MODEL_FEATURES.length > 0 && (
                  <div className="bg-muted/50 border border-primary/20 rounded-lg px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      <div>
                        <p className="text-xs font-semibold">Features from: {modelFeatures.modelName}</p>
                        <p className="text-[10px] text-muted-foreground">Algorithm: {modelFeatures.algorithm} · Model ID: {modelFeatures.modelId}</p>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground italic">Sorted by importance (highest first)</div>
                  </div>
                )}

                {/* Feature List */}
                {!featuresLoading && MODEL_FEATURES.length > 0 && (
                <div className="bg-card border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b flex items-center justify-between">
                    <h4 className="text-xs font-semibold flex items-center gap-2">
                      <Brain className="w-3.5 h-3.5 text-primary" />
                      Model Features — Importance Scores
                    </h4>
                    <span className="text-[10px] text-muted-foreground">{MODEL_FEATURES.length} features</span>
                  </div>
                  <div className="p-4 space-y-2.5">
                    {MODEL_FEATURES.map((f: any, i: number) => (
                      <div key={f.name} className="group" data-testid={`feature-row-${f.name}`}>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-muted-foreground w-4 text-right">{i + 1}</span>
                          <span className="font-mono text-[11px] text-blue-400 w-52 truncate">{f.name}</span>
                          <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, (toPositiveNumber(f.importance) / modelFeatureMaxImportance) * 100)}%`,
                                background: "#3b82f6",
                              }}
                            />
                          </div>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border w-16 text-center ${
                            f.type === "numeric" ? "border-blue-500/30 text-blue-400 bg-blue-500/10" :
                            f.type === "categorical" ? "border-violet-500/30 text-violet-400 bg-violet-500/10" :
                            "border-amber-500/30 text-amber-400 bg-amber-500/10"
                          }`}>{f.type}</span>
                        </div>
                        <div className="ml-7 text-[10px] text-muted-foreground mt-0.5">{f.description}</div>
                      </div>
                    ))}
                    {/* Staged (newly added) features */}
                    {Array.from(stagedFeatures).map(sid => {
                      const sug = SUGGESTED_FEATURES.find(s => s.id === sid);
                      if (!sug) return null;
                      return (
                        <div key={sug.id} className="rounded border border-green-500/20 bg-green-500/5 px-3 py-2">
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-green-400">★</span>
                            <span className="font-mono text-[11px] text-green-400 w-52 truncate">{sug.name}</span>
                            <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-blue-500"
                                style={{ width: `${Math.min(100, (toPositiveNumber(sug.importanceGain) / suggestedFeatureMaxGain) * 100)}%` }}
                              />
                            </div>
                            <span className="text-[9px] px-1.5 py-0.5 rounded border border-green-500/30 text-green-400 bg-green-500/10 w-16 text-center">staged</span>
                            <Button size="icon" variant="ghost" className="h-5 w-5 hover:text-red-500"
                              onClick={() => setStagedFeatures(prev => { const s = new Set(prev); s.delete(sug.id); return s; })}
                              data-testid={`button-remove-staged-${sug.id}`}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                          <div className="ml-7 text-[10px] text-muted-foreground mt-0.5 font-mono">{sug.formula}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                )}

                {/* Staged features notification */}
                {stagedFeatures.size > 0 && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-green-500/20 bg-green-500/5">
                    <div className="flex items-center gap-2 text-xs">
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      <span className="text-green-300">{stagedFeatures.size} new feature{stagedFeatures.size > 1 ? "s" : ""} staged — retrain the model in Experiment Lab to apply.</span>
                    </div>
                    <Button size="sm" className="text-xs h-7 bg-green-600 hover:bg-green-700 text-white" data-testid="button-go-to-experiments">
                      Go to Experiment Lab →
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* ── SUGGESTED TRANSFORMS sub-tab ── */}
            {featureSubTab === "suggestions" && (
              <div className="space-y-3">
                <div className="bg-muted/50 border rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3 mb-3">
                    <Database className="w-4 h-4 text-primary" />
                    <div className="flex-1">
                      <Label className="text-xs font-medium">Select Dataset for Suggestions</Label>
                      <Select
                        value={selectedFeatureDataset?.toString() || ""}
                        onValueChange={(val) => setSelectedFeatureDataset(val ? parseInt(val) : null)}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs bg-background">
                          <SelectValue placeholder="Choose a dataset to generate feature ideas..." />
                        </SelectTrigger>
                        <SelectContent>
                          {datasets.length === 0 && (
                            <SelectItem value="_none" disabled>No datasets available</SelectItem>
                          )}
                          {datasets.map(ds => (
                            <SelectItem key={ds.id} value={String(ds.id)}>{ds.name} ({ds.rowCount?.toLocaleString()} rows)</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Generate suggested features using the selected dataset and the Groq model key.
                  </p>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
                  <Sparkles className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <p className="text-[11px] text-amber-300/90">
                    ML Orion analysed the current model's residuals and feature correlations to suggest high-impact re-engineering opportunities.
                    Add any to the model and retrain in Experiment Lab.
                  </p>
                </div>
                {selectedFeatureDataset === null ? (
                  <div className="bg-card border border-dashed rounded-lg px-4 py-12 text-center">
                    <Sparkles className="w-8 h-8 mx-auto mb-3 text-amber-400 opacity-40" />
                    <p className="text-sm font-medium text-muted-foreground">Select a dataset to load suggestions</p>
                    <p className="text-xs text-muted-foreground mt-1">Suggested feature ideas depend on dataset context and will be generated by Groq.</p>
                  </div>
                ) : suggestionsLoading ? (
                  <div className="bg-card border rounded-lg px-4 py-12 text-center">
                    <p className="text-xs text-muted-foreground animate-pulse">Generating suggested features from dataset...</p>
                  </div>
                ) : SUGGESTED_FEATURES.map(sug => {
                  const isSaved = builtFeatures.some((feature: any) => feature.name === sug.name);
                  const isStaged = stagedFeatures.has(sug.id) || isSaved;
                  return (
                    <div key={sug.id} className={`bg-card border rounded-lg p-4 transition-colors ${isStaged ? "border-green-500/30 bg-green-500/5" : "border-border hover:border-border/80"}`}
                      data-testid={`suggested-feature-${sug.id}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="font-mono text-sm text-primary">{sug.name}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                              sug.priority === "high" ? "border-red-500/30 text-red-400 bg-red-500/10" :
                              sug.priority === "medium" ? "border-amber-500/30 text-amber-400 bg-amber-500/10" :
                              "border-border text-muted-foreground"
                            }`}>{sug.priority} priority</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded border border-violet-500/30 text-violet-400 bg-violet-500/10">{sug.type}</span>
                          </div>
                          <div className="font-mono text-[10px] text-amber-400/80 mb-2 bg-black/20 px-2 py-1 rounded">{sug.formula}</div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">{sug.reason}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          <div className="text-right">
                            <div className="text-[10px] text-muted-foreground">Predicted Importance Gain</div>
                            <div className="text-lg font-bold text-green-400">+{sug.importanceGain.toFixed(3)}</div>
                          </div>
                          {/* Gain bar */}
                          <div className="w-28 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-green-500"
                              style={{ width: `${Math.min(100, (toPositiveNumber(sug.importanceGain) / suggestedFeatureMaxGain) * 100)}%` }}
                            />
                          </div>
                          <Button
                            size="sm"
                            disabled={isSaved || saveSuggestedFeatureMut.isLoading}
                            className={`text-xs h-7 mt-1 ${isStaged ? "bg-green-600/20 text-green-400 border border-green-500/30" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
                            onClick={() => {
                              if (isSaved) return;
                              saveSuggestedFeatureMut.mutate(sug);
                            }}
                            data-testid={`button-stage-feature-${sug.id}`}
                          >
                            {isSaved ? <><CheckCircle2 className="w-3 h-3 mr-1" />Saved</> : <><ArrowUpRight className="w-3 h-3 mr-1" />Add to Model</>}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {stagedFeatures.size > 0 && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-green-500/20 bg-green-500/5">
                    <div className="flex items-center gap-2 text-xs">
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      <span className="text-green-300">{stagedFeatures.size} feature{stagedFeatures.size > 1 ? "s" : ""} added — go to Experiment Lab to retrain with these new features.</span>
                    </div>
                    <Button size="sm" className="text-xs h-7 bg-green-600 hover:bg-green-700 text-white" data-testid="button-go-to-experiments-2">
                      Go to Experiment Lab →
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* ── CUSTOM BUILDER sub-tab ── */}
            {featureSubTab === "builder" && (
              <div className="space-y-4">
                <div className="bg-muted/50 border rounded-lg px-4 py-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <Database className="w-4 h-4 text-primary" />
                    <div className="flex-1">
                      <Label className="text-xs font-medium">Dataset for Custom Features</Label>
                      <Select
                        value={selectedFeatureDataset?.toString() || ""}
                        onValueChange={(val) => {
                          setSelectedFeatureDataset(val ? parseInt(val) : null);
                          setSelectedFeatureModelId(null);
                        }}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs bg-background">
                          <SelectValue placeholder="Choose an uploaded dataset..." />
                        </SelectTrigger>
                        <SelectContent>
                          {datasets.map(ds => (
                            <SelectItem key={ds.id} value={String(ds.id)}>
                              {ds.name} ({ds.rowCount?.toLocaleString()} rows)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Saved custom features are persisted on the dataset and automatically applied the next time you train a model on it.
                  </p>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="bg-card border rounded-lg p-4">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5" />Feature Type Library
                    </h4>
                    <div className="space-y-1.5">
                      {FEATURE_TYPE_OPTIONS.map((option) => (
                        <div key={option.value} className="border rounded overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 hover:bg-muted/20 transition-colors">
                            <button
                              className="flex-1 text-left"
                              onClick={() => setExpandedFeature(expandedFeature === option.value ? null : option.value)}
                              data-testid={`toggle-feature-${option.value}`}
                            >
                              <div className="flex items-center gap-2 text-xs font-medium">
                                {expandedFeature === option.value ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                {option.label}
                              </div>
                            </button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 hover:bg-primary/10 hover:text-primary"
                              onClick={() => {
                                setExpandedFeature(option.value);
                                setFeatureDraft(createFeatureDraft(option.value));
                                setFeatureFormula("");
                                setFeaturePreview([]);
                                setFeatureWarnings([]);
                              }}
                              data-testid={`button-add-feature-${option.value}`}
                            >
                              <Plus className="w-3 h-3" />
                            </Button>
                          </div>
                          {expandedFeature === option.value && (
                            <div className="px-3 pb-2 text-[10px] text-muted-foreground bg-muted/10 border-t">
                              <p className="pt-2">{option.description}</p>
                              <p className="mt-1 font-mono text-primary/70">{option.example}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-card border rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-semibold flex items-center gap-2"><Zap className="w-3.5 h-3.5 text-primary" />Feature Editor</h4>
                        <p className="text-[10px] text-muted-foreground mt-1">{currentFeatureType.label} configuration</p>
                      </div>
                      {featureDraft.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-7"
                          onClick={() => {
                            setFeatureDraft(createFeatureDraft(featureDraft.type));
                            setFeatureFormula("");
                            setFeaturePreview([]);
                            setFeatureWarnings([]);
                          }}
                        >
                          New
                        </Button>
                      )}
                    </div>

                    <div className="p-4 space-y-3 text-xs">
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Feature Type</Label>
                        <Select value={featureDraft.type} onValueChange={(val: CustomFeatureDefinition["type"]) => setFeatureDraft(createFeatureDraft(val))}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FEATURE_TYPE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Feature Name</Label>
                        <Input
                          value={featureDraft.name}
                          onChange={(e) => setFeatureDraft(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="e.g. revenue_rollmean_3"
                          className="h-8 text-xs font-mono"
                        />
                      </div>

                      {["rolling", "lag", "trend"].includes(featureDraft.type) && (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-[11px]">Entity Key</Label>
                              {hasAccountNumber ? (
                                <div className="h-8 px-3 flex items-center text-xs bg-muted/50 border rounded text-muted-foreground font-mono">
                                  account_number <span className="ml-1.5 text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded">auto</span>
                                </div>
                              ) : (
                                <Select value={featureDraft.entityKey} onValueChange={(val) => setFeatureDraft(prev => ({ ...prev, entityKey: val }))}>
                                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select entity key" /></SelectTrigger>
                                  <SelectContent>
                                    {builderColumns.map((column) => (
                                      <SelectItem key={`entity-${column.name}`} value={column.name}>{column.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[11px]">Time Column</Label>
                              <Select value={featureDraft.timeColumn} onValueChange={(val) => setFeatureDraft(prev => ({ ...prev, timeColumn: val }))}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select time column" /></SelectTrigger>
                                <SelectContent>
                                  {builderColumns.map((column) => (
                                    <SelectItem key={`time-${column.name}`} value={column.name}>{column.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-[11px]">Source Column</Label>
                              <Select value={featureDraft.sourceColumn} onValueChange={(val) => setFeatureDraft(prev => ({ ...prev, sourceColumn: val }))}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select source column" /></SelectTrigger>
                                <SelectContent>
                                  {builderColumns.map((column) => (
                                    <SelectItem key={`source-${column.name}`} value={column.name}>{column.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[11px]">Sort Direction</Label>
                              <Select value={featureDraft.sortDirection} onValueChange={(val: "asc" | "desc") => setFeatureDraft(prev => ({ ...prev, sortDirection: val }))}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="asc">Ascending</SelectItem>
                                  <SelectItem value="desc">Descending</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </>
                      )}

                      {featureDraft.type === "rolling" && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-[11px]">Window</Label>
                            <Input value={featureDraft.window} onChange={(e) => setFeatureDraft(prev => ({ ...prev, window: e.target.value }))} className="h-8 text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[11px]">Aggregation</Label>
                            <Select value={featureDraft.aggregation} onValueChange={(val: FeatureDraft["aggregation"]) => setFeatureDraft(prev => ({ ...prev, aggregation: val }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {["mean", "sum", "min", "max", "std"].map((aggregation) => (
                                  <SelectItem key={aggregation} value={aggregation}>{aggregation}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}

                      {featureDraft.type === "lag" && (
                        <div className="space-y-1.5">
                          <Label className="text-[11px]">Lag Periods</Label>
                          <Input value={featureDraft.periods} onChange={(e) => setFeatureDraft(prev => ({ ...prev, periods: e.target.value }))} className="h-8 text-xs" />
                        </div>
                      )}

                      {featureDraft.type === "trend" && (
                        <div className="space-y-1.5">
                          <Label className="text-[11px]">Trend Window</Label>
                          <Input value={featureDraft.window} onChange={(e) => setFeatureDraft(prev => ({ ...prev, window: e.target.value }))} className="h-8 text-xs" />
                        </div>
                      )}

                      {featureDraft.type === "ratio" && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-[11px]">Numerator Column</Label>
                            <Select value={featureDraft.numeratorColumn} onValueChange={(val) => setFeatureDraft(prev => ({ ...prev, numeratorColumn: val }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select numerator" /></SelectTrigger>
                              <SelectContent>
                                {builderColumns.map((column) => (
                                  <SelectItem key={`num-${column.name}`} value={column.name}>{column.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[11px]">Denominator Column</Label>
                            <Select value={featureDraft.denominatorColumn} onValueChange={(val) => setFeatureDraft(prev => ({ ...prev, denominatorColumn: val }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select denominator" /></SelectTrigger>
                              <SelectContent>
                                {builderColumns.map((column) => (
                                  <SelectItem key={`den-${column.name}`} value={column.name}>{column.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}

                      {["flag", "segment_tag"].includes(featureDraft.type) && (
                        <>
                          <div className="space-y-1.5">
                            <Label className="text-[11px]">Source Column</Label>
                            <Select value={featureDraft.sourceColumn} onValueChange={(val) => setFeatureDraft(prev => ({ ...prev, sourceColumn: val }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select source column" /></SelectTrigger>
                              <SelectContent>
                                {builderColumns.map((column) => (
                                  <SelectItem key={`rule-${column.name}`} value={column.name}>{column.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-[11px]">Comparator</Label>
                              <Select value={featureDraft.comparator} onValueChange={(val: FeatureDraft["comparator"]) => setFeatureDraft(prev => ({ ...prev, comparator: val }))}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="gt">&gt;</SelectItem>
                                  <SelectItem value="gte">&gt;=</SelectItem>
                                  <SelectItem value="lt">&lt;</SelectItem>
                                  <SelectItem value="lte">&lt;=</SelectItem>
                                  <SelectItem value="eq">=</SelectItem>
                                  <SelectItem value="ne">!=</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[11px]">Compare Value</Label>
                              <Input value={featureDraft.compareValue} onChange={(e) => setFeatureDraft(prev => ({ ...prev, compareValue: e.target.value }))} className="h-8 text-xs" />
                            </div>
                          </div>
                        </>
                      )}

                      {featureDraft.type === "interaction" && (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-[11px]">Left Column</Label>
                              <Select value={featureDraft.leftColumn} onValueChange={(val) => setFeatureDraft(prev => ({ ...prev, leftColumn: val }))}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select left column" /></SelectTrigger>
                                <SelectContent>
                                  {builderColumns.map((column) => (
                                    <SelectItem key={`left-${column.name}`} value={column.name}>{column.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[11px]">Right Column</Label>
                              <Select value={featureDraft.rightColumn} onValueChange={(val) => setFeatureDraft(prev => ({ ...prev, rightColumn: val }))}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select right column" /></SelectTrigger>
                                <SelectContent>
                                  {builderColumns.map((column) => (
                                    <SelectItem key={`right-${column.name}`} value={column.name}>{column.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[11px]">Operator</Label>
                            <Select value={featureDraft.interactionOperator} onValueChange={(val: FeatureDraft["interactionOperator"]) => setFeatureDraft(prev => ({ ...prev, interactionOperator: val }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="multiply">Multiply</SelectItem>
                                <SelectItem value="divide">Divide</SelectItem>
                                <SelectItem value="add">Add</SelectItem>
                                <SelectItem value="subtract">Subtract</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}

                      <div className="rounded border bg-muted/20 px-3 py-2">
                        <div className="text-[10px] text-muted-foreground">Generated Formula</div>
                        <div className="font-mono text-[11px] text-primary mt-1 break-all">{featureFormula || currentFeatureType.example}</div>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => previewFeatureMut.mutate()} disabled={selectedFeatureDataset === null || previewFeatureMut.isPending}>
                          Preview
                        </Button>
                        <Button size="sm" className="text-xs h-8" onClick={() => saveFeatureMut.mutate()} disabled={selectedFeatureDataset === null || saveFeatureMut.isPending}>
                          {featureDraft.id ? "Update Feature" : "Save Feature"}
                        </Button>
                      </div>

                      {featureWarnings.length > 0 && (
                        <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-300 space-y-1">
                          {featureWarnings.map((warning) => (
                            <div key={warning}>{warning}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-card border rounded-lg overflow-hidden">
                      <div className="px-4 py-3 border-b flex items-center justify-between">
                        <h4 className="text-xs font-semibold flex items-center gap-2"><Zap className="w-3.5 h-3.5 text-primary" />Saved Features</h4>
                        <span className="text-[10px] text-muted-foreground">{builtFeatures.length} feature{builtFeatures.length !== 1 ? "s" : ""}</span>
                      </div>
                      {selectedFeatureDataset === null ? (
                        <div className="p-8 text-center text-muted-foreground text-xs">Select a dataset to load saved features.</div>
                      ) : builtFeatures.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground text-xs">
                          <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          No custom features saved for this dataset yet.
                        </div>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b bg-muted/30">
                              {["Name", "Type", "Formula", "Status", ""].map(h => (
                                <th key={h} className="text-left px-3 py-2 text-muted-foreground">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {builtFeatures.map((feature) => (
                              <tr key={feature.id} className="border-b hover:bg-muted/10" data-testid={`row-feature-${feature.id}`}>
                                <td className="px-3 py-2 font-mono text-primary text-[10px]">{feature.name}</td>
                                <td className="px-3 py-2 text-muted-foreground">{FEATURE_TYPE_OPTIONS.find((option) => option.value === feature.type)?.label || feature.type}</td>
                                <td className="px-3 py-2 font-mono text-[10px] text-amber-400">{feature.formula}</td>
                                <td className="px-3 py-2"><StatusBadge status={feature.status || "ready"} /></td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1 justify-end">
                                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => {
                                      setFeatureDraft(draftFromFeature(feature));
                                      setFeatureFormula(feature.formula || "");
                                      setFeaturePreview([]);
                                      setFeatureWarnings([]);
                                    }}>
                                      Edit
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-5 w-5 hover:text-red-500" onClick={() => deleteFeatureMut.mutate(feature.id)} data-testid={`button-delete-feature-${feature.id}`}>
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>

                    <div className="bg-card border rounded-lg overflow-hidden">
                      <div className="px-4 py-3 border-b">
                        <h4 className="text-xs font-semibold">Preview Rows</h4>
                      </div>
                      {featurePreview.length === 0 ? (
                        <div className="p-6 text-[11px] text-muted-foreground">Run Preview to inspect the generated values before saving.</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b bg-muted/30">
                                {Object.keys(featurePreview[0]).map((key) => (
                                  <th key={key} className="text-left px-3 py-2 text-muted-foreground">{key}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {featurePreview.map((row, index) => (
                                <tr key={index} className="border-b last:border-b-0">
                                  {Object.entries(row).map(([key, value]) => (
                                    <td key={key} className="px-3 py-2 font-mono text-[10px]">{String(value ?? "")}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Dataset</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.name}</strong> ({deleteTarget?.rowCount?.toLocaleString()} rows)? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}>
              Delete Dataset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OrionLayout>
  );
}
