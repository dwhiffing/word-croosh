import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import GameBoard from './components/GameBoard.tsx'
import './index.css'
import { autoConnect } from './utils/multiplayerStore.ts'

// Viewport units lie on mobile (Android Chrome reports 100dvh as the
// URL-bar-hidden height even when the bar is showing), so drive the app
// height from the real innerHeight instead.
const setAppHeight = () =>
  document.documentElement.style.setProperty(
    '--app-height',
    `${window.innerHeight}px`,
  )
setAppHeight()
window.addEventListener('resize', setAppHeight)
window.addEventListener('orientationchange', setAppHeight)
window.visualViewport?.addEventListener('resize', setAppHeight)
// mobile browsers can settle the viewport shortly after load without
// firing a resize event — re-read once things settle
setTimeout(setAppHeight, 300)
setTimeout(setAppHeight, 1000)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameBoard />
  </StrictMode>,
)

autoConnect()
