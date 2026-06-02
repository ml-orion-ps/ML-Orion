import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { CheckCircle2, XCircle, ShieldCheck, Database, Clock, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const CPG_BASE = "/cpg/price-elasticity/orion";
const API_BASE = "/api/cpg/price_elasticity";

function CompliancePip({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
    : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
}

export default function OrionGovernancePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"registry" | "audit" | "compliance">("registry");

  const { data: gov, isLoading } = useQuery<any>({
    queryKey: [`${API_BASE}/orion/governance`],
  });

  const registry: any[] = gov?.registry ?? [];
  const auditEntries: any[] = gov?.auditLog ?? [];
  const summary = gov?.summary ?? {};

  const compliantCount = registry.filter(r =>
    Object.values(r.complianceChecks || {}).every(Boolean)
  ).length;

  const deployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${API_BASE}/models/${id}/deploy`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`${API_BASE}/orion/governance`] });
      qc.invalidateQueries({ queryKey: [`${API_BASE}/models`] });
      toast({ title: "Model deployed" });
    },
  });

  return (
    <OrionLayout
      title="Governance"
      subtitle="Model registry, compliance, and audit trail"
      isLoading={isLoading}
    >
      <div className="space-y-4">
        <OrionNav current={`${CPG_BASE}/governance`} basePath={CPG_BASE} />

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <KpiCard label="Total Models" value={summary.totalModels ?? 0} />
          <KpiCard label="Deployed" value={summary.deployed ?? 0} color="green" />
          <KpiCard label="Approved" value={summary.approved ?? 0} color="green" />
          <KpiCard
            label="Pending Approval"
            value={summary.pendingApproval ?? 0}
            color={summary.pendingApproval > 0 ? "amber" : "green"}
          />
          <KpiCard
            label="Compliant"
            value={compliantCount}
            color={compliantCount === registry.length && registry.length > 0 ? "green" : "amber"}
            sub={`of ${registry.length} models`}
          />
          <KpiCard label="Audit Events" value={auditEntries.length} color="blue" />
        </div>

        {/* Tab Nav */}
        <div className="flex gap-1 border-b">
          {(["registry", "audit", "compliance"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs font-medium capitalize border-b-2 transition-colors ${
                tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "audit" ? "Audit Log" : t === "compliance" ? "Compliance Checks" : "Model Registry"}
            </button>
          ))}
        </div>

        {/* ── MODEL REGISTRY ── */}
        {tab === "registry" && (
          <div className="bg-card border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Database className="w-4 h-4 text-primary" /> Model Registry
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Complete lineage: training date, deployment status, and compliance
              </p>
            </div>
            {registry.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs">
                No models registered. Run an experiment first.
                <div className="mt-2">
                  <a href={`${CPG_BASE}/experiments`} className="text-primary underline">
                    Go to Experiments →
                  </a>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {["Model", "Algorithm", "Global Elasticity", "Converged", "Brands", "Status", "Trained", "Deployed", "Compliant", "Actions"].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {registry.map((m: any) => {
                      const allPassing = Object.values(m.complianceChecks || {}).every(Boolean);
                      return (
                        <tr key={m.id} className="border-b hover:bg-muted/10">
                          <td className="px-3 py-2">
                            <p className="font-medium max-w-[150px] truncate">{m.name}</p>
                            <p className="text-[9px] text-muted-foreground">ID: {m.id}</p>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
                          <td
                            className="px-3 py-2 font-mono font-bold"
                            style={{
                              color: m.globalPriceElasticity == null ? undefined
                                : m.globalPriceElasticity < -1 ? "#dc2626"
                                : m.globalPriceElasticity < 0 ? "#2563eb"
                                : "#16a34a",
                            }}
                          >
                            {m.globalPriceElasticity != null ? Number(m.globalPriceElasticity).toFixed(3) : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {m.modelConverged == null
                              ? "—"
                              : m.modelConverged
                              ? <span className="text-green-600 font-medium">Yes</span>
                              : <span className="text-amber-600 font-medium">No</span>}
                          </td>
                          <td className="px-3 py-2 font-mono">{m.brandsScored ?? "—"}</td>
                          <td className="px-3 py-2">
                            <StatusBadge status={m.isDeployed ? "deployed" : m.status} />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5 shrink-0" />
                              {m.trainedAt ? new Date(m.trainedAt).toLocaleDateString() : "—"}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                            {m.deployedAt
                              ? <span className="text-emerald-400">{new Date(m.deployedAt).toLocaleDateString()}</span>
                              : <span className="text-muted-foreground/50">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            {allPassing
                              ? <span className="text-[10px] text-emerald-500 font-medium flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Pass</span>
                              : <span className="text-[10px] text-amber-400 font-medium">⚠ Partial</span>}
                          </td>
                          <td className="px-3 py-2">
                            {!m.isDeployed && (
                              <Button
                                size="sm"
                                className="h-6 text-[10px] gap-1"
                                onClick={() => deployMut.mutate(m.id)}
                                disabled={deployMut.isPending}
                              >
                                🚀 Deploy
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── AUDIT LOG ── */}
        {tab === "audit" && (
          <div className="space-y-3">
            <div className="bg-card border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-500" /> Audit Log
                </h3>
                <span className="text-[10px] text-muted-foreground">{auditEntries.length} events</span>
              </div>
              {auditEntries.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-xs">
                  No audit events recorded yet. Events will be logged automatically when you train, deploy, or delete models.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        {["Timestamp", "Action", "Entity", "Detail", "Status"].map(h => (
                          <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {auditEntries.map((e: any) => (
                        <tr key={e.id} className="border-b hover:bg-muted/10">
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono text-[10px]">
                            {e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"}
                          </td>
                          <td className="px-3 py-2 font-medium">{e.action}</td>
                          <td className="px-3 py-2 max-w-[140px] truncate">{e.entityName ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground max-w-[240px] truncate">{e.detail ?? "—"}</td>
                          <td className="px-3 py-2">
                            <StatusBadge status={e.status === "success" ? "Pass" : "Fail"} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── COMPLIANCE ── */}
        {tab === "compliance" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard
                label="Fully Compliant"
                value={compliantCount}
                color={compliantCount === registry.length && registry.length > 0 ? "green" : "amber"}
                sub={`of ${registry.length} models`}
              />
              <KpiCard
                label="Data Lineage Pass"
                value={registry.filter((r: any) => r.complianceChecks?.dataLineage).length}
                color="green"
              />
              <KpiCard
                label="Metrics Recorded"
                value={registry.filter((r: any) => r.complianceChecks?.metricsRecorded).length}
                color="green"
              />
              <KpiCard
                label="Features Documented"
                value={registry.filter((r: any) => r.complianceChecks?.featureDocumented).length}
                color="green"
              />
            </div>

            <div className="bg-card border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" /> Compliance Matrix
                </h3>
              </div>
              {registry.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-xs">No models to evaluate.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-3 py-2 text-muted-foreground font-medium">Model</th>
                        <th className="text-center px-3 py-2 text-muted-foreground font-medium">Data Lineage</th>
                        <th className="text-center px-3 py-2 text-muted-foreground font-medium">Metrics</th>
                        <th className="text-center px-3 py-2 text-muted-foreground font-medium">Brand Results</th>
                        <th className="text-center px-3 py-2 text-muted-foreground font-medium">Convergence</th>
                        <th className="text-center px-3 py-2 text-muted-foreground font-medium">Overall</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registry.map((m: any) => {
                        const cc = m.complianceChecks ?? {};
                        const allPass = cc.dataLineage && cc.metricsRecorded && cc.featureDocumented && cc.hyperparamsLogged;
                        return (
                          <tr key={m.id} className="border-b hover:bg-muted/10">
                            <td className="px-3 py-2">
                              <p className="font-medium max-w-[160px] truncate">{m.name}</p>
                              <p className="text-[9px] text-muted-foreground">{m.algorithm}</p>
                            </td>
                            <td className="px-3 py-2 text-center"><CompliancePip ok={!!cc.dataLineage} /></td>
                            <td className="px-3 py-2 text-center"><CompliancePip ok={!!cc.metricsRecorded} /></td>
                            <td className="px-3 py-2 text-center"><CompliancePip ok={!!cc.featureDocumented} /></td>
                            <td className="px-3 py-2 text-center"><CompliancePip ok={!!cc.hyperparamsLogged} /></td>
                            <td className="px-3 py-2 text-center">
                              {allPass
                                ? <span className="text-[10px] text-emerald-500 font-medium">✓ Pass</span>
                                : <span className="text-[10px] text-amber-400 font-medium">⚠ Partial</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-card border rounded-lg p-4">
              <h4 className="text-xs font-semibold mb-3 text-muted-foreground uppercase">Compliance Legend</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {[
                  { label: "Data Lineage", desc: "Dataset linked and traceable" },
                  { label: "Metrics Recorded", desc: "Global price elasticity available" },
                  { label: "Brand Results", desc: "Brand-level elasticity summary generated" },
                  { label: "Convergence", desc: "Model convergence status logged" },
                ].map(item => (
                  <div key={item.label} className="border rounded p-2 space-y-0.5">
                    <p className="font-medium">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </OrionLayout>
  );
}
