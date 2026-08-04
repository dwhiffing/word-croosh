import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../utils'

export function Dropdown({
  className,
  label,
  items,
}: {
  className?: string
  label: ReactNode
  items: {
    label: ReactNode
    onClick: () => void
    onLongClick?: () => void
    active?: boolean
    disabled?: boolean
  }[]
}) {
  const [open, setOpen] = useState(false)
  const [isTouch] = useState(
    () => window.matchMedia('(pointer: coarse)').matches,
  )
  const ref = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const didLongPress = useRef(false)

  useEffect(() => {
    if (!open || isTouch) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, isTouch])

  const menuItems = items.map((item, i) => (
    <button
      key={i}
      disabled={item.disabled}
      className={cn(
        'button w-full px-4 py-2 whitespace-nowrap rounded-none text-right',
        item.disabled
          ? 'text-white/30 cursor-not-allowed'
          : 'touch:active:bg-on-surface hover:bg-on-surface-active',
        item.active
          ? 'bg-on-surface-active touch:bg-on-surface'
          : 'bg-transparent',
        isTouch && i < items.length - 1 && 'border-b border-on-surface-active',
      )}
      onClick={() => {
        if (didLongPress.current) {
          didLongPress.current = false
          return
        }
        setOpen(false)
        item.onClick()
      }}
      onPointerDown={() => {
        if (!item.onLongClick) return
        didLongPress.current = false
        longPressTimer.current = setTimeout(() => {
          didLongPress.current = true
          setOpen(false)
          item.onLongClick!()
        }, 1000)
      }}
      onPointerUp={() => {
        if (longPressTimer.current) clearTimeout(longPressTimer.current)
      }}
      onPointerCancel={() => {
        if (longPressTimer.current) clearTimeout(longPressTimer.current)
      }}>
      {item.label}
    </button>
  ))

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        className="button w-full h-8 lg:h-10"
        onClick={() => setOpen(!open)}>
        {label}
      </button>

      {isTouch ? (
        createPortal(
          <div
            className={cn(
              'fixed inset-0 z-modal flex items-center justify-center transition-opacity duration-300 bg-backdrop',
              open ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
            onClick={() => setOpen(false)}>
            <div
              className="bg-surface rounded shadow-lg overflow-hidden min-w-[80vw] text-lg"
              onClick={(e) => e.stopPropagation()}>
              {menuItems}
            </div>
          </div>,
          document.body,
        )
      ) : (
        <div
          className={cn(
            'absolute right-0 top-full mt-2 bg-on-surface rounded shadow-lg min-w-full overflow-hidden transition-opacity duration-300',
            open ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}>
          {menuItems}
        </div>
      )}
    </div>
  )
}
