// A small on-screen log of what the multiplayer sync engine is doing
// (polls, uploads, conflicts, seat corrections) — toggled from the menu,
// persisted across reloads so it stays open while debugging a live issue.
import { create } from 'zustand'

const DEBUG_KEY = 'word-croosh-network-debug-visible'
const MAX_LINES = 50

interface NetworkDebugStore {
  visible: boolean
  lines: string[]
  toggle: () => void
}

export const useNetworkDebugStore = create<NetworkDebugStore>((set) => ({
  visible: localStorage.getItem(DEBUG_KEY) === '1',
  lines: [],
  toggle: () =>
    set((s) => {
      localStorage.setItem(DEBUG_KEY, !s.visible ? '1' : '0')
      return { visible: !s.visible }
    }),
}))

// Called throughout the multiplayer sync engine to narrate what it's doing.
export function pushNetworkDebug(line: string) {
  useNetworkDebugStore.setState((s) => ({
    lines: [...s.lines, `[${new Date().toLocaleTimeString()}] ${line}`].slice(
      -MAX_LINES,
    ),
  }))
}
