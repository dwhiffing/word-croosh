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
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  )
}
