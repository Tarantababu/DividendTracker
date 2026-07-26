"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Radix gives us the things a hand-rolled modal misses: focus trap, restore on
// close, scroll lock, Escape, and correct aria wiring.
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogTitle = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title className={cn("text-base font-semibold leading-tight tracking-tight", className)} {...props} />
);
const DialogDescription = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description className={cn("text-xs text-muted-2", className)} {...props} />
);

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="dialog-overlay" className="fixed inset-0 z-50 bg-[rgba(14,17,23,0.45)] backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-card p-4 shadow-lg sm:p-5",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-3 top-3 rounded-md p-1 text-muted-2 transition-colors hover:bg-card-hover hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogTitle, DialogDescription };
