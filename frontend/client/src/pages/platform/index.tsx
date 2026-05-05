import { useLocation } from "wouter";
import { APPS, AppDef } from "@/data/apps-registry";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";

export default function PlatformCenter() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <h1 className="text-2xl font-bold tracking-tight">Polestar AI Platform</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Select a use case to get started
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {APPS.map((app) => (
            <AppCard key={app.id} app={app} onSelect={() => navigate(app.route)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AppCard({ app, onSelect }: { app: AppDef; onSelect: () => void }) {
  const isLive = app.status === "live";

  return (
    <div
      onClick={isLive ? onSelect : undefined}
      className={[
        "group border rounded-xl p-5 flex flex-col gap-3 transition-all duration-150",
        isLive
          ? "cursor-pointer hover:border-primary hover:shadow-md"
          : "opacity-50 cursor-not-allowed",
      ].join(" ")}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            {app.industry}
          </span>
          <span className="text-sm font-semibold">{app.name}</span>
        </div>
        {isLive ? (
          <Badge className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-600 border-green-500/20 hover:bg-green-500/10">
            Live
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
            Coming Soon
          </Badge>
        )}
      </div>

      <div>
        <p className="text-xs font-medium text-primary mb-1">{app.tagline}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{app.description}</p>
      </div>

      {isLive && (
        <div className="flex items-center gap-1 text-xs text-primary mt-auto pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          Open <ChevronRight className="w-3 h-3" />
        </div>
      )}
    </div>
  );
}
