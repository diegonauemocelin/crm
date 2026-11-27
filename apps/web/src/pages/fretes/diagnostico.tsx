import { useQuery } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  MessageSquareWarningIcon,
  SearchCheckIcon,
  StethoscopeIcon,
  WrenchIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { FilialSwitch } from "@/components/fretes/filial-switch";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  RequirePermission,
  TableSkeleton,
} from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useActiveUnit } from "@/lib/fretes";
import { cn } from "@/lib/utils";

type Action = "AJUSTAR" | "PEDIR" | "CONFERIR";
type Finding = {
  code: string;
  action: Action;
  title: string;
  detail: string;
  count: number;
  examples: { id: string; number: string | null }[];
};
type Carrier = {
  carrierId: string | null;
  carrierName: string;
  total: number;
  conciliados: number;
  divergentes: number;
  semReferencia: number;
  acima: number;
  findings: Finding[];
};
type Result = { days: number; analyzed: number; carriers: Carrier[] };

const ACTION: Record<
  Action,
  { label: string; icon: typeof WrenchIcon; cls: string }
> = {
  AJUSTAR: {
    label: "Ajustar no CRM",
    icon: WrenchIcon,
    cls: "border-sky-500/50 text-sky-700 dark:text-sky-300",
  },
  PEDIR: {
    label: "Pedir à transportadora",
    icon: MessageSquareWarningIcon,
    cls: "border-amber-500/50 text-amber-700 dark:text-amber-300",
  },
  CONFERIR: {
    label: "Conferir",
    icon: SearchCheckIcon,
    cls: "border-muted-foreground/40 text-muted-foreground",
  },
};
const PERIODS = [30, 60, 90, 180];

export function FretesDiagnosticoPage() {
  return (
    <RequirePermission module="fretes_cte">
      <Diagnostico />
    </RequirePermission>
  );
}

function Diagnostico() {
  const active = useActiveUnit();
  const [days, setDays] = useState(90);
  const [only, setOnly] = useState<Action | "">("");
  // Transportadoras fechadas: só o resumo; clicar no nome abre os achados.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const qs = new URLSearchParams({ dias: String(days) });
  if (active.unitId) qs.set("filial", active.unitId);
  const q = useQuery({
    queryKey: ["fretes", "diagnostico", qs.toString()],
    queryFn: () => api.get<Result>(`/fretes/ctes/diagnostico?${qs}`),
    enabled: !!active.ctx.data,
  });
  const carriers = q.data?.carriers ?? [];
  const all = carriers.flatMap((c) => c.findings);
  const count = (a: Action) => all.filter((f) => f.action === a).length;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Diagnóstico das tabelas"
        description="Lê os CT-es conciliados e compara com as tabelas do sistema: o que se repete vira um achado, separado entre o que ajustar aqui no CRM e o que pedir à transportadora. Um caso isolado não entra; só padrões (3 CT-es ou mais)."
        actions={<FilialSwitch active={active} />}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm text-muted-foreground">
          CT-es dos últimos
        </span>
        {PERIODS.map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d ? "secondary" : "ghost"}
            onClick={() => setDays(d)}
          >
            {d} dias
          </Button>
        ))}
        <span className="mx-2 h-5 w-px bg-border" aria-hidden />
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setOpen(
              open.size
                ? new Set()
                : new Set(carriers.map((c) => c.carrierId ?? c.carrierName)),
            )
          }
        >
          {open.size ? "Fechar todas" : "Abrir todas"}
        </Button>
        <span className="mx-2 h-5 w-px bg-border" aria-hidden />
        <Button
          size="sm"
          variant={!only ? "secondary" : "ghost"}
          onClick={() => setOnly("")}
        >
          Todos{" "}
          <span className="ml-1 text-xs text-muted-foreground">
            {all.length}
          </span>
        </Button>
        {(Object.keys(ACTION) as Action[]).map((a) => (
          <Button
            key={a}
            size="sm"
            variant={only === a ? "secondary" : "ghost"}
            onClick={() => setOnly(a)}
          >
            {ACTION[a].label}{" "}
            <span className="ml-1 text-xs text-muted-foreground">
              {count(a)}
            </span>
          </Button>
        ))}
      </div>
      {q.isLoading || !active.ctx.data ? (
        <TableSkeleton />
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !carriers.length ? (
        <EmptyState
          icon={StethoscopeIcon}
          title="Nenhum CT-e conciliado no período"
          description="Importe os XMLs dos CT-es (Fretes › CT-e) para o sistema comparar com as tabelas."
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {q.data.analyzed} CT-e(s) analisado(s) de {carriers.length}{" "}
            transportadora(s). Depois de ajustar uma tabela, use "Conciliar
            pendentes de novo" na Conciliação para conferir os CT-es outra vez.
          </p>
          <div className="space-y-3">
            {carriers.map((c) => {
              const list = c.findings.filter((f) => !only || f.action === only);
              if (only && !list.length) return null;
              const k = c.carrierId ?? c.carrierName;
              const isOpen = open.has(k);
              const byAction = (Object.keys(ACTION) as Action[])
                .map(
                  (a) =>
                    [a, list.filter((f) => f.action === a).length] as const,
                )
                .filter(([, n]) => n > 0);
              return (
                <Card key={k}>
                  <CardHeader
                    className={cn(
                      "cursor-pointer select-none",
                      isOpen ? "pb-2" : "pb-4",
                    )}
                    onClick={() => toggle(k)}
                    role="button"
                    aria-expanded={isOpen}
                    tabIndex={0}
                    onKeyDown={(e) =>
                      (e.key === "Enter" || e.key === " ") &&
                      (e.preventDefault(), toggle(k))
                    }
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="flex items-center gap-1.5 text-base">
                          <ChevronDownIcon
                            className={cn(
                              "size-4 shrink-0 transition-transform",
                              !isOpen && "-rotate-90",
                            )}
                            aria-hidden
                          />
                          {c.carrierName}
                        </CardTitle>
                        {!isOpen && (
                          <p className="mt-1 flex flex-wrap gap-x-3 pl-5 text-xs text-muted-foreground">
                            {byAction.length ? (
                              byAction.map(([a, n]) => (
                                <span key={a}>
                                  {n} {ACTION[a].label.toLowerCase()}
                                </span>
                              ))
                            ) : (
                              <span>Nenhum padrão de erro</span>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        <Badge variant="outline">{c.total} CT-e(s)</Badge>
                        <Badge
                          variant="outline"
                          className="border-emerald-500/50 text-emerald-700 dark:text-emerald-300"
                        >
                          {pct(c.conciliados, c.total)} conferem
                        </Badge>
                        {c.divergentes > 0 && (
                          <Badge
                            variant="outline"
                            className="border-rose-500/50 text-rose-700 dark:text-rose-300"
                          >
                            {c.divergentes} divergente(s)
                          </Badge>
                        )}
                        {c.semReferencia > 0 && (
                          <Badge variant="outline">
                            {c.semReferencia} sem referência
                          </Badge>
                        )}
                        {c.acima > 0 && (
                          <Badge variant="outline">
                            {money(c.acima)} cobrados acima
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  {isOpen && (
                    <CardContent className="space-y-2">
                      {!list.length ? (
                        <p className="text-sm text-muted-foreground">
                          Nenhum padrão de erro: a tabela confere com os CT-es
                          (as divergências, se houver, são casos isolados).
                        </p>
                      ) : (
                        list.map((f) => {
                          const A = ACTION[f.action];
                          return (
                            <div key={f.code} className="rounded-lg border p-3">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <p className="font-medium">{f.title}</p>
                                <Badge
                                  variant="outline"
                                  className={cn("shrink-0", A.cls)}
                                >
                                  <A.icon className="size-3.5" aria-hidden />{" "}
                                  {A.label}
                                </Badge>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {f.detail}
                              </p>
                              {f.examples.length > 0 && (
                                <p className="mt-1.5 flex flex-wrap gap-x-2 text-xs">
                                  <span className="text-muted-foreground">
                                    Exemplos:
                                  </span>
                                  {f.examples.map((e) => (
                                    <Link
                                      key={e.id}
                                      to={`/fretes/ctes/${e.id}`}
                                      className="text-primary hover:underline"
                                    >
                                      CT-e {e.number ?? "s/n"}
                                    </Link>
                                  ))}
                                </p>
                              )}
                            </div>
                          );
                        })
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 0}%`;
