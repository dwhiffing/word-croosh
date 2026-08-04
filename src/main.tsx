import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import GameBoard from './components/GameBoard.tsx'
import './index.css'
import { autoConnect } from './utils/multiplayerStore.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameBoard />
  </StrictMode>,
)

autoConnect()
