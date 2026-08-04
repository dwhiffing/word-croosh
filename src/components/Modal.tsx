import type { ReactNode } from 'react'
import { cn } from '../utils'

export function Modal({
  show,
  onClose,
  children,
}: {
  show: boolean
  onClose?: () => void
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'fixed inset-0 flex items-center justify-center bg-backdrop z-modal transition-opacity duration-300 overflow-hidden',
        !show && 'opacity-0 pointer-events-none',
      )}
      // Dismiss on pointerdown (a fresh tap), not click: modals opened from a
      // pointerup (e.g. the blank-tile picker) would otherwise be closed by
      // the synthesized click that follows the same tap on mobile.
      onPointerDown={onClose}>
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
