import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, MailIcon, SendIcon } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Can } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { TableSkeleton, ErrorState } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { UF_LIST } from "@/lib/atendimento";
import { dateTime, money, num, pct } from "@/lib/format";
import { fmtNum } from "@/lib/fretes";
import { cn } from "@/lib/utils";

interface Rank {
  name: string;
  ctes: number;
  cobrado: number;
  nota: number;
  kg: number;
  pctNota: number | null;
}

interface Gerencial {
  tolerance: number;
  totals: {
    ctes: number;
    cobrado: number;
    esperado: number;
    comReferencia: number;
    acimaTabela: number;
    acimaTabelaCtes: number;
    divergentes: number;
    conciliados: number;
    credito: number;
    kg: number;
    porKg: number | null;
    pctDivergente: number | null;
  };
  nota: {
    ctes: number;
    nota: number;
    cte: number;
    menos: number;
    menosValor: number;
    mais: number;
    maisValor: number;
    iguais: number;
    resultado: number;
    pctMenos: number | null;
  };
  months: { month: string; cobrado: number; nota: number; esperado: number }[];
  carriers: {
    name: string;
    ctes: number;
    cobrado: number;
    nota: number;
    acimaTabela: number;
    divergentes: number;
    pctDivergente: number;
  }[];
  sellers: {
    name: string;
    ctes: number;
    nota: number;
    cte: number;
    menos: number;
    menosValor: number;
    mais: number;
    maisValor: number;
    resultado: number;
  }[];
  ufs: Rank[];
  cities: Rank[];
  customers: Rank[];
}

const chart = {
  cobrado: { label: "Cobrado no CT-e", color: "var(--chart-1)" },
  nota: { label: "Cobrado nas notas CIF", color: "var(--chart-3)" },
  esperado: { label: "Esperado (cotação/tabela)", color: "var(--chart-2)" },
} satisfies ChartConfig;

const MONTHS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
const monthLabel = (m: string) =>
  `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

/**
 * Painel gerencial dos fretes (para a direção): CT-es do período com o frete cobrado nas notas CIF e o esperado pela
 * tabela, por mês, transportadora, vendedor, estado, cidade e cliente.
 */
export function FreightManagement({
  from,
  to,
  unitId,
  carriers,
}: {
  from: string;
  to: string;
  unitId: string | null;
  carriers: { id: string; name: string }[];
}) {
  const [carrier, setCarrier] = useState("");
  const [uf, setUf] = useState("");
  const qs = new URLSearchParams({ de: from, ate: to });
  if (unitId) qs.set("filial", unitId);
  if (carrier) qs.set("transportadora", carrier);
  if (uf) qs.set("uf", uf);
  const q = useQuery({
    queryKey: ["fretes", "gerencial", qs.toString()],
    queryFn: () => api.get<Gerencial>(`/fretes/gerencial?${qs}`),
  });
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select
          value={carrier || "__todas__"}
          onValueChange={(v) => setCarrier(v === "__todas__" ? "" : v)}
        >
          <SelectTrigger className="w-60" aria-label="Transportadora">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__todas__">Todas as transportadoras</SelectItem>
            {carriers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={uf || "__todos__"}
          onValueChange={(v) => setUf(v === "__todos__" ? "" : v)}
        >
          <SelectTrigger className="w-44" aria-label="Estado de destino">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__todos__">Todos os estados</SelectItem>
            {UF_LIST.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {q.isLoading ? (
        <TableSkeleton />
      ) : q.error || !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Cobrado nos CT-es"
              value={money(d.totals.cobrado)}
              hint={`${num(d.totals.ctes)} CT-es · ${d.totals.porKg === null ? "—" : `${money(d.totals.porKg)}/kg`}`}
            />
            <Kpi
              label="Cobrado nas notas CIF"
              value={money(d.nota.nota)}
              hint={`${num(d.nota.ctes)} CT-es com nota CIF · CT-e delas ${money(d.nota.cte)}`}
            />
            <Kpi
              label="Resultado nota − CT-e"
              value={money(d.nota.resultado)}
              tone={d.nota.resultado < 0 ? "bad" : "good"}
              hint="Frete cobrado do cliente menos o pago à transportadora (notas CIF)"
            />
            <Kpi
              label="Acima da tabela"
              value={money(d.totals.acimaTabela)}
              tone={d.totals.acimaTabela > 0 ? "bad" : undefined}
              hint={`${num(d.totals.acimaTabelaCtes)} CT-es cobraram mais que o esperado`}
            />
            <Kpi
              label="Notas cobradas a menos"
              value={money(d.nota.menosValor)}
              tone={d.nota.menosValor > 0 ? "bad" : undefined}
              hint={`${num(d.nota.menos)} notas (${pct(d.nota.pctMenos)} das CIF) abaixo do CT-e`}
            />
            <Kpi
              label="Notas cobradas a mais"
              value={money(d.nota.maisValor)}
              hint={`${num(d.nota.mais)} notas acima do CT-e`}
            />
            <Kpi
              label="CT-es com divergência"
              value={num(d.totals.divergentes)}
              hint={`${pct(d.totals.pctDivergente)} · ${num(d.totals.conciliados)} conciliados sem divergência`}
            />
            <Kpi
              label="Crédito recuperado"
              value={money(d.totals.credito)}
              hint={`Esperado no período ${money(d.totals.esperado)}`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Por mês</CardTitle>
              <CardDescription>
                Cobrado nos CT-es, cobrado nas notas CIF e o esperado pela
                cotação ou tabela (CT-es pela data de emissão).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {d.months.length ? (
                <ChartContainer config={chart} className="h-72 w-full">
                  <BarChart
                    data={d.months.map((m) => ({
                      ...m,
                      label: monthLabel(m.month),
                    }))}
                    barGap={2}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={80}
                      tickFormatter={(v: number) =>
                        money(v).replace(/,\d\d$/, "")
                      }
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(v, name) =>
                            `${chart[name as keyof typeof chart]?.label ?? name}: ${money(Number(v))}`
                          }
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar
                      dataKey="cobrado"
                      fill="var(--color-cobrado)"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="nota"
                      fill="var(--color-nota)"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="esperado"
                      fill="var(--color-esperado)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum CT-e no período.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <RankCard
              title="Vendedores: frete cobrado a menos na nota"
              description="Notas CIF em que o frete da nota ficou abaixo do CT-e (além da folga). Vendedor dos dados adicionais da nota."
              head={[
                "Vendedor",
                "Notas",
                "A menos",
                "Valor a menos",
                "Nota − CT-e",
              ]}
              rows={d.sellers
                .slice(0, 15)
                .map((s) => [
                  s.name,
                  num(s.ctes),
                  num(s.menos),
                  money(s.menosValor),
                  money(s.resultado),
                ])}
              bad={d.sellers.slice(0, 15).map((s) => s.resultado < 0)}
            />
            <RankCard
              title="Transportadoras"
              description="Gasto, frete cobrado nas notas CIF dos CT-es dela e o que passou da tabela."
              head={[
                "Transportadora",
                "CT-es",
                "Cobrado",
                "Na nota",
                "Acima tabela",
                "% diverg.",
              ]}
              rows={d.carriers
                .slice(0, 15)
                .map((c) => [
                  c.name,
                  num(c.ctes),
                  money(c.cobrado),
                  money(c.nota),
                  money(c.acimaTabela),
                  pct(c.pctDivergente),
                ])}
            />
            <RankCard
              title="Estados de destino"
              head={["UF", "CT-es", "Cobrado", "Na nota", "Peso (kg)"]}
              rows={d.ufs.map((r) => [
                r.name,
                num(r.ctes),
                money(r.cobrado),
                money(r.nota),
                fmtNum(r.kg, 0),
              ])}
            />
            <RankCard
              title="Cidades com mais frete"
              head={["Cidade", "CT-es", "Cobrado", "Na nota", "Peso (kg)"]}
              rows={d.cities.map((r) => [
                r.name,
                num(r.ctes),
                money(r.cobrado),
                money(r.nota),
                fmtNum(r.kg, 0),
              ])}
            />
            <RankCard
              title="Clientes com mais frete"
              description="Destinatário do CT-e."
              head={["Cliente", "CT-es", "Cobrado", "Na nota", "Peso (kg)"]}
              rows={d.customers.map((r) => [
                r.name,
                num(r.ctes),
                money(r.cobrado),
                money(r.nota),
                fmtNum(r.kg, 0),
              ])}
            />
            <WeeklyEmail />
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "bad" && "text-destructive",
          tone === "good" && "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function RankCard({
  title,
  description,
  head,
  rows,
  bad,
}: {
  title: string;
  description?: string;
  head: string[];
  rows: string[][];
  bad?: boolean[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {head.map((h, i) => (
                    <TableHead key={h} className={i ? "text-right" : undefined}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    {r.map((c, j) => (
                      <TableCell
                        key={j}
                        className={cn(
                          j
                            ? "text-right tabular-nums"
                            : "max-w-56 truncate text-sm",
                          j === r.length - 1 && bad?.[i] && "text-destructive",
                        )}
                        title={j ? undefined : c}
                      >
                        {c}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sem dados no período.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

interface WeeklyCfg {
  active: boolean;
  weekday: number;
  hour: number;
  emails: string[];
  unitId: string | null;
  lastSent: string | null;
  lastError: string | null;
}

/** Resumo semanal por e-mail: dia, hora e destinatários. */
function WeeklyEmail() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["fretes", "resumo-semanal"],
    queryFn: () => api.get<WeeklyCfg>("/fretes/resumo-semanal"),
  });
  const [form, setForm] = useState<{
    active: boolean;
    weekday: number;
    hour: number;
    emails: string;
  } | null>(null);
  const cur =
    form ??
    (q.data
      ? {
          active: q.data.active,
          weekday: q.data.weekday,
          hour: q.data.hour,
          emails: q.data.emails.join("\n"),
        }
      : null);
  const save = useMutation({
    mutationFn: () =>
      api.put<WeeklyCfg>("/fretes/resumo-semanal", {
        active: cur!.active,
        weekday: cur!.weekday,
        hour: cur!.hour,
        emails: cur!.emails.split(/[\s,;]+/).filter(Boolean),
        unitId: q.data?.unitId ?? null,
      }),
    onSuccess: (r) => {
      qc.setQueryData(["fretes", "resumo-semanal"], r);
      setForm(null);
      toast.success(
        r.active
          ? `Resumo semanal ligado: ${WEEKDAYS[r.weekday]}, ${r.hour}h, para ${r.emails.length} e-mail(s).`
          : "Resumo semanal desligado.",
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const send = useMutation({
    mutationFn: () =>
      api.post<{ sent: number; ctes: number }>(
        "/fretes/resumo-semanal/enviar",
        {},
      ),
    onSuccess: (r) => {
      toast.success(
        `Resumo enviado para ${r.sent} e-mail(s) (${r.ctes} CT-es nos últimos 7 dias).`,
      );
      qc.invalidateQueries({ queryKey: ["fretes", "resumo-semanal"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MailIcon className="size-4" aria-hidden /> Resumo semanal por e-mail
        </CardTitle>
        <CardDescription>
          Toda semana, os CT-es dos 7 dias anteriores: com e sem divergência,
          acima da tabela, notas cobradas a mais e a menos, vendedores e
          transportadoras.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!cur ? (
          <Loader2Icon className="animate-spin" aria-hidden />
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={cur.active}
                onCheckedChange={(c) => setForm({ ...cur, active: c === true })}
              />{" "}
              Enviar toda semana
            </label>
            <div className="flex flex-wrap gap-2">
              <Select
                value={String(cur.weekday)}
                onValueChange={(v) => setForm({ ...cur, weekday: Number(v) })}
              >
                <SelectTrigger className="w-44" aria-label="Dia da semana">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((w, i) => (
                    <SelectItem key={w} value={String(i)}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1 text-sm">
                a partir das
                <Input
                  className="w-16"
                  type="number"
                  min={0}
                  max={23}
                  aria-label="Hora"
                  value={cur.hour}
                  onChange={(e) =>
                    setForm({
                      ...cur,
                      hour: Math.max(
                        0,
                        Math.min(23, Number(e.target.value) || 0),
                      ),
                    })
                  }
                />
                h
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs-emails">E-mails (um por linha)</Label>
              <Textarea
                id="rs-emails"
                rows={3}
                value={cur.emails}
                onChange={(e) => setForm({ ...cur, emails: e.target.value })}
                placeholder="diretoria@empresa.com.br"
              />
            </div>
            {q.data?.lastSent && (
              <p className="text-xs text-muted-foreground">
                Último envio: {dateTime(q.data.lastSent)}.
              </p>
            )}
            {q.data?.lastError && (
              <p className="text-xs text-destructive">
                Último envio falhou: {q.data.lastError}
              </p>
            )}
            <Can module="fretes_cte" action="edit">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!form || save.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending && (
                    <Loader2Icon className="animate-spin" aria-hidden />
                  )}{" "}
                  Salvar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!form || send.isPending || !q.data?.emails.length}
                  onClick={() => send.mutate()}
                  title={form ? "Salve antes de enviar" : undefined}
                >
                  {send.isPending ? (
                    <Loader2Icon className="animate-spin" aria-hidden />
                  ) : (
                    <SendIcon aria-hidden />
                  )}{" "}
                  Enviar agora
                </Button>
              </div>
            </Can>
          </>
        )}
      </CardContent>
    </Card>
  );
}
