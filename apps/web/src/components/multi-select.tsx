import { CheckIcon, ChevronsUpDownIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface Item {
  id: string
  name: string
  active?: boolean
}

/** Seleção múltipla com busca (Popover + Command do shadcn). Itens desativados só aparecem se já estiverem marcados. */
export function MultiSelect({
  id,
  items,
  value,
  onChange,
  placeholder = 'Selecione',
  disabled,
}: {
  id?: string
  items: Item[]
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const visible = items.filter((i) => i.active !== false || value.includes(i.id))
  const selected = value.map((v) => items.find((i) => i.id === v)).filter((i): i is Item => !!i)
  const toggle = (itemId: string) => onChange(value.includes(itemId) ? value.filter((v) => v !== itemId) : [...value, itemId])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto min-h-9 w-full justify-between px-2.5 py-1.5 font-normal"
        >
          <span className="flex flex-1 flex-wrap gap-1">
            {selected.length === 0 && <span className="text-muted-foreground">{placeholder}</span>}
            {selected.map((s) => (
              <Badge key={s.id} variant="secondary" className="gap-1 pr-1">
                {s.name}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Remover ${s.name}`}
                  className="rounded-sm hover:bg-muted-foreground/20"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggle(s.id)
                  }}
                >
                  <XIcon className="size-3" />
                </span>
              </Badge>
            ))}
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar…" />
          <CommandList>
            <CommandEmpty>Nada encontrado.</CommandEmpty>
            <CommandGroup>
              {visible.map((i) => (
                <CommandItem key={i.id} value={i.name} onSelect={() => toggle(i.id)}>
                  <CheckIcon className={cn('size-4', value.includes(i.id) ? 'opacity-100' : 'opacity-0')} />
                  {i.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
