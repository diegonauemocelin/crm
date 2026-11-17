import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm";
import { formatDateTime } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";

export interface NumberRef {
  id: string;
  name: string;
  phone: string | null;
  status: string;
}

export interface SendRow {
  prospectId: string;
  status: "FILA" | "ENVIANDO" | "ENVIADA" | "PULADA" | "ERRO" | "CANCELADA";
  error: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  optedOut: boolean;
  conversationId: string | null;
}

export interface Campaign {
  id: string;
  status: "RODANDO" | "PAUSADA" | "CONCLUIDA" | "CANCELADA";
  error: string | null;
  nextAt: string;
  gapMin: number;
  gapMax: number;
  dailyMax: number;
  createdBy: string | null;
  createdAt: string;
  number: { id: string; name: string; status: string } | null;
  total: number;
  sent: number;
  sentToday: number;
  queued: number;
  failed: number;
  replied: number;
  optedOut: number;
  sends: SendRow[];
}

export const SEND_LABEL: Record<SendRow["status"], string> = {
  FILA: "na fila",
  ENVIANDO: "enviando",
  ENVIADA: "mensagem enviada",
  PULADA: "não enviada",
  ERRO: "erro no envio",
  CANCELADA: "envio cancelado",
};

export function useNumbers() {
  return useQuery({
    queryKey: ["prospeccao-numeros"],
    queryFn: () => api.get<NumberRef[]>("/prospeccao/numeros"),
    staleTime: 60_000,
  });
}

export function useCampaigns(searchId: string) {
  return useQuery({
    queryKey: ["prospeccao-envios", searchId],
    queryFn: () => api.get<Campaign[]>(`/prospeccao/buscas/${searchId}/envios`),
    refetchInterval: (q) =>
      q.state.data?.some((c) => c.status === "RODANDO") ? 20_000 : false,
  });
}

const STATUS: Record<Campaign["status"], string> = {
  RODANDO: "enviando",
  PAUSADA: "pausado",
  CONCLUIDA: "concluído",
  CANCELADA: "cancelado",
};

/** Andamento dos envios da busca, com pausar, retomar e cancelar. */
export function EnviosPainel({
  searchId,
  edit,
}: {
  searchId: string;
  edit: boolean;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useCampaigns(searchId);
  const act = useMutation({
    mutationFn: ({
      id,
      acao,
    }: {
      id: string;
      acao: "pausar" | "retomar" | "cancelar";
    }) => api.post(`/prospeccao/envios/${id}/${acao}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["prospeccao-envios", searchId] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!q.data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SendIcon className="size-4" aria-hidden /> Envios pelo WhatsApp
        </CardTitle>
        <CardDescription>
          Uma mensagem de cada vez, com intervalo aleatório, só no horário
          comercial e com limite por dia, para o número não ser bloqueado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {q.data.map((c) => (
          <div key={c.id} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {c.number?.name ?? "Número excluído"}
              </span>
              <Badge variant={c.status === "RODANDO" ? "default" : "secondary"}>
                {STATUS[c.status]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                por {c.createdBy ?? "—"} em {formatDateTime(c.createdAt)} · de{" "}
                {c.gapMin} a {c.gapMax} min entre mensagens · até {c.dailyMax}{" "}
                por dia
              </span>
              {edit && (c.status === "RODANDO" || c.status === "PAUSADA") && (
                <div className="ml-auto flex gap-1.5">
                  {c.status === "RODANDO" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ id: c.id, acao: "pausar" })}
                    >
                      <PauseIcon aria-hidden /> Pausar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ id: c.id, acao: "retomar" })}
                    >
                      <PlayIcon aria-hidden /> Retomar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={act.isPending}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: "Cancelar o envio?",
                          description: `As ${c.queued} mensagem(ns) que ainda estão na fila não serão enviadas.`,
                          confirmLabel: "Cancelar envio",
                        })
                      )
                        act.mutate({ id: c.id, acao: "cancelar" });
                    }}
                  >
                    <XIcon aria-hidden /> Cancelar
                  </Button>
                </div>
              )}
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={c.total}
              aria-valuenow={c.sent}
            >
              <div
                className="h-full bg-primary"
                style={{
                  width: `${c.total ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {c.sent} de {c.total} enviada(s) · {c.sentToday} hoje · {c.queued}{" "}
              na fila · {c.replied} respondeu(ram)
              {c.optedOut ? ` · ${c.optedOut} pediu(ram) para sair` : ""}
              {c.failed ? ` · ${c.failed} não enviada(s)` : ""}
              {c.status === "RODANDO" && c.queued
                ? ` · próxima por volta de ${formatDateTime(c.nextAt)}`
                : ""}
            </p>
            {c.error && c.status !== "CONCLUIDA" && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {c.error}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function NumberSelect({
  numbers,
  value,
  onChange,
}: {
  numbers: NumberRef[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Escolha o número" />
      </SelectTrigger>
      <SelectContent>
        {numbers.map((n) => (
          <SelectItem
            key={n.id}
            value={n.id}
            disabled={n.status !== "CONECTADO"}
          >
            {n.name}
            {n.status !== "CONECTADO" ? " (desconectado)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Chamar no WhatsApp: escolhe o número (se tiver mais de um) e abre a conversa no chat. */
export function ChamarDialog({
  prospect,
  onClose,
}: {
  prospect: { id: string; name: string };
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const numbers = useNumbers();
  const usable = (numbers.data ?? []).filter((n) => n.status === "CONECTADO");
  const [numberId, setNumberId] = useState("");
  const chosen = numberId || (usable.length === 1 ? usable[0]!.id : "");
  const open = useMutation({
    mutationFn: () =>
      api.post<{ conversationId: string }>(
        `/prospeccao/empresas/${prospect.id}/chat`,
        { numberId: chosen },
      ),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["prospeccao"] });
      navigate(`/chat?conversa=${r.conversationId}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chamar {prospect.name} no WhatsApp</DialogTitle>
          <DialogDescription>
            A empresa vira lead (origem Prospecção) e a conversa abre no chat,
            para você escrever.
          </DialogDescription>
        </DialogHeader>
        {numbers.isLoading ? (
          <p className="text-sm text-muted-foreground">
            Carregando os números…
          </p>
        ) : !numbers.data?.length ? (
          <p className="text-sm text-destructive">
            Você não tem número de WhatsApp para iniciar conversas.
          </p>
        ) : (
          <div className="space-y-1.5">
            <Label>Número que vai chamar</Label>
            <NumberSelect
              numbers={numbers.data}
              value={chosen}
              onChange={setNumberId}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!chosen || open.isPending}
            onClick={() => open.mutate()}
          >
            {open.isPending && (
              <Loader2Icon className="animate-spin" aria-hidden />
            )}{" "}
            Abrir conversa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const VARIABLES =
  "{empresa} nome da empresa · {vendedor} seu primeiro nome · {cidade} · {segmento}";

/** Envio em fila para as empresas marcadas: mensagem (escrita pela IA ou à mão), número, intervalo e limite por dia. */
export function EnvioDialog({
  searchId,
  prospects,
  onClose,
  onDone,
}: {
  searchId: string;
  prospects: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const prospectIds = prospects.map((p) => p.id);
  const numbers = useNumbers();
  const usable = (numbers.data ?? []).filter((n) => n.status === "CONECTADO");
  const [numberId, setNumberId] = useState("");
  const chosen = numberId || (usable.length === 1 ? usable[0]!.id : "");
  const [offer, setOffer] = useState("");
  const [messages, setMessages] = useState<string[]>([""]);
  const [gapMin, setGapMin] = useState(2);
  const [gapMax, setGapMax] = useState(10);
  const [dailyMax, setDailyMax] = useState(30);
  const [optOut, setOptOut] = useState(true);
  // Uma mensagem diferente para cada empresa (Gemini gratuito), revisada aqui antes de ir para a fila.
  const [unique, setUnique] = useState(prospects.length <= 50);
  const [perProspect, setPerProspect] = useState<Record<string, string>>({});
  const writeUnique = useMutation({
    mutationFn: () =>
      api.post<{ messages: Record<string, string>; missing: string[] }>(
        `/prospeccao/buscas/${searchId}/mensagens-unicas`,
        { offer, prospectIds },
      ),
    onSuccess: (r) => {
      setPerProspect(r.messages);
      if (r.missing.length)
        toast.warning(
          `${r.missing.length} empresa(s) ficaram sem mensagem: escreva à mão ou gere de novo.`,
        );
      else
        toast.success(
          `${Object.keys(r.messages).length} mensagens escritas, uma para cada empresa. Revise antes de enviar.`,
        );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const write = useMutation({
    mutationFn: () =>
      api.post<{ variations: string[] }>(
        `/prospeccao/buscas/${searchId}/mensagem`,
        { offer },
      ),
    onSuccess: (r) => (
      setMessages(r.variations),
      toast.success(
        `${r.variations.length} variação(ões) escrita(s). Revise antes de enviar.`,
      )
    ),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const send = useMutation({
    mutationFn: () =>
      api.post<{ queued: number; skipped: number }>(
        `/prospeccao/buscas/${searchId}/envios`,
        {
          numberId: chosen,
          prospectIds,
          messages: unique ? [] : messages.filter((m) => m.trim()),
          perProspect: unique ? perProspect : {},
          gapMin,
          gapMax,
          dailyMax,
          optOut,
        },
      ),
    onSuccess: (r) => {
      toast.success(
        `${r.queued} empresa(s) na fila de envio${r.skipped ? ` (${r.skipped} sem celular ou já recebeu)` : ""}.`,
      );
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const textsOk = unique
    ? prospects.every((p) => (perProspect[p.id] ?? "").trim().length >= 10)
    : messages.some((m) => m.trim().length >= 10);
  const valid =
    chosen && textsOk && gapMin >= 1 && gapMax >= gapMin && dailyMax >= 1;
  const days = Math.ceil(prospectIds.length / Math.max(1, dailyMax));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Enviar mensagem para {prospectIds.length} empresa(s)
          </DialogTitle>
          <DialogDescription>
            Uma de cada vez, com intervalo aleatório, só no horário comercial.
            Cada empresa que recebe vira lead (origem Prospecção) e a resposta
            cai no chat.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-1 text-sm">
          <div className="space-y-1.5">
            <Label>Número que vai enviar</Label>
            {numbers.data && !numbers.data.length ? (
              <p className="text-destructive">
                Você não tem número de WhatsApp para iniciar conversas.
              </p>
            ) : (
              <NumberSelect
                numbers={numbers.data ?? []}
                value={chosen}
                onChange={setNumberId}
              />
            )}
          </div>
          <label className="flex items-start justify-between gap-3 rounded-md border p-3">
            <span>
              Uma mensagem diferente para cada empresa
              <span className="block text-xs text-muted-foreground">
                O Gemini (plano gratuito do Google) escreve uma mensagem para
                cada empresa, com o nome, o segmento e a cidade dela. Até 50
                empresas por vez. Desligado: as mesmas variações para todas.
              </span>
            </span>
            <Switch
              checked={unique}
              onCheckedChange={setUnique}
              disabled={prospects.length > 50}
            />
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="pe-offer">O que você oferece</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="pe-offer"
                placeholder="Ex.: peças e filtros para escavadeiras, com entrega para todo o Brasil"
                value={offer}
                maxLength={600}
                onChange={(e) => setOffer(e.target.value)}
              />
              {unique ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={offer.trim().length < 10 || writeUnique.isPending}
                  onClick={() => writeUnique.mutate()}
                >
                  {writeUnique.isPending ? (
                    <Loader2Icon className="animate-spin" aria-hidden />
                  ) : (
                    <SparklesIcon aria-hidden />
                  )}{" "}
                  Gerar {prospects.length} mensagens
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={offer.trim().length < 10 || write.isPending}
                  onClick={() => write.mutate()}
                >
                  {write.isPending ? (
                    <Loader2Icon className="animate-spin" aria-hidden />
                  ) : (
                    <SparklesIcon aria-hidden />
                  )}{" "}
                  Gerar mensagem
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              A IA não inventa preço, prazo nem promoção. Revise antes de
              enviar.
            </p>
          </div>
          {unique ? (
            <div className="space-y-2">
              <Label>Mensagem de cada empresa</Label>
              {prospects.map((p) => (
                <div key={p.id} className="space-y-1">
                  <p className="text-xs font-medium">{p.name}</p>
                  <Textarea
                    rows={3}
                    maxLength={1500}
                    value={perProspect[p.id] ?? ""}
                    placeholder="Clique em Gerar mensagens ou escreva aqui."
                    onChange={(e) =>
                      setPerProspect((m) => ({ ...m, [p.id]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <Label>
                Mensagem (cada empresa recebe uma das variações, ao acaso)
              </Label>
              {messages.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <Textarea
                    rows={3}
                    maxLength={1500}
                    value={m}
                    placeholder="Olá, {empresa}! Aqui é {vendedor}…"
                    onChange={(e) =>
                      setMessages((xs) =>
                        xs.map((x, j) => (j === i ? e.target.value : x)),
                      )
                    }
                  />
                  {messages.length > 1 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Tirar esta variação"
                      onClick={() =>
                        setMessages((xs) => xs.filter((_, j) => j !== i))
                      }
                    >
                      <XIcon aria-hidden />
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                {messages.length < 5 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setMessages((xs) => [...xs, ""])}
                  >
                    <PlusIcon aria-hidden /> Nova variação
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  {VARIABLES}
                </span>
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="pe-min">Intervalo mínimo (min)</Label>
              <Input
                id="pe-min"
                type="number"
                min={1}
                max={120}
                value={gapMin}
                onChange={(e) => setGapMin(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe-max">Intervalo máximo (min)</Label>
              <Input
                id="pe-max"
                type="number"
                min={1}
                max={120}
                value={gapMax}
                onChange={(e) => setGapMax(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe-day">Máximo por dia</Label>
              <Input
                id="pe-day"
                type="number"
                min={1}
                max={100}
                value={dailyMax}
                onChange={(e) => setDailyMax(Number(e.target.value))}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Com {prospectIds.length} empresa(s) e até {dailyMax} por dia,
            termina em cerca de {days} dia(s) útil(eis). Números novos ou pouco
            usados: comece com poucas por dia (10 a 20) e intervalo maior.
          </p>
          <label className="flex items-start justify-between gap-3 rounded-md border p-3">
            <span>
              Avisar como sair da lista
              <span className="block text-xs text-muted-foreground">
                Acrescenta “Se não quiser receber mensagens nossas, é só
                responder SAIR.” Quem responder SAIR (ou “não tenho interesse”)
                vira “não contatar”.
              </span>
            </span>
            <Switch checked={optOut} onCheckedChange={setOptOut} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!valid || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <SendIcon aria-hidden />
            )}{" "}
            Colocar na fila
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
