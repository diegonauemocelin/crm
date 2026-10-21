import * as React from "react"
import { cn } from "cn"
import { Label as LabelPrimitive } from "radix-ui"

/** `required`: marca o campo como obrigatório (asterisco visível e "obrigatório" para leitor de tela). */
function Label({
  className,
  required,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & { required?: boolean }) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      {required && (
        <span className="-ml-1.5 text-destructive" aria-hidden>
          *
        </span>
      )}
      {required && <span className="sr-only">(obrigatório)</span>}
    </LabelPrimitive.Root>
  )
}

export { Label }
