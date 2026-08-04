import debounce from 'lodash/debounce'
import { useShallow } from 'zustand/react/shallow'
import { useForceUpdate, useWindowEvent } from '../utils'
import { BOARD_SIZE, FIRST_SQUARE_PILE, RACK_PILE } from '../utils/constants'
import { useGameStore } from '../utils/gameStore'
import { useMultiplayerStore } from '../utils/multiplayerStore'
import Tile from './Card'
import { GameOverModal } from './GameOverModal'
import { Header } from './Header'
import { InstructionsModal } from './InstructionsModal'
import { LobbyModal } from './LobbyModal'
import { NetworkDebugPanel } from './NetworkDebugPanel'
import { Rack, Square } from './Pile'

function App() {
  const { showLobbyModal, openLobby, hostGame, peerConnected } =
    useMultiplayerStore()
  const state = useGameStore(
    useShallow((s) => ({
      cardCount: s.cards.length,
      onMouseUp: s.onMouseUp,
      onMouseDown: s.onMouseDown,
      onMouseMove: s.onMouseMove,
      localPlayerIndex: s.localPlayerIndex,
      currentPlayerIndex: s.currentPlayerIndex,
      scores: s.scores,
      pending: s.pending,
      message: s.message,
      gameOver: s.gameOver,
      submitTurn: s.submitTurn,
      recallTiles: s.recallTiles,
      passTurn: s.passTurn,
    })),
  )

  useWindowEvent('resize', debounce(useForceUpdate(), 100))
  useWindowEvent('pointerup', state.onMouseUp)
  useWindowEvent('pointerdown', state.onMouseDown)
  useWindowEvent('pointermove', state.onMouseMove)

  const lp = state.localPlayerIndex
  const myTurn = state.currentPlayerIndex === lp && !state.gameOver
  const started = state.cardCount > 0
  const oppRack = RACK_PILE[lp === 0 ? 1 : 0]
  const ownRack = RACK_PILE[lp]

  return (
    <div className="bg-surface absolute inset-0">
      <div id="ui" className="absolute inset-0 flex flex-col">
        <Header />

        {started && (
          <div className="flex-1 flex flex-col items-center justify-between min-h-0 py-2">
            {/* Opponent rack (face down) */}
            <div className="score-row">
              <span className={!myTurn ? 'active-player' : ''}>
                Opponent: {state.scores[lp === 0 ? 1 : 0]}
              </span>
            </div>
            <div className="rack-wrap opp">
              <Rack pileIndex={oppRack} />
            </div>

            {/* Board */}
            <div
              className="board"
              style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }}>
              {Array.from({ length: BOARD_SIZE * BOARD_SIZE }).map((_, i) => (
                <Square key={i} pileIndex={FIRST_SQUARE_PILE + i} />
              ))}
            </div>

            {/* Status + controls */}
            <div className="status-row">
              {state.message && <span className="msg">{state.message}</span>}
              {myTurn && (
                <div className="controls">
                  <button
                    className="button px-3 py-1"
                    onClick={state.submitTurn}
                    disabled={state.pending.length === 0}>
                    Submit
                  </button>
                  <button
                    className="button px-3 py-1"
                    onClick={state.recallTiles}
                    disabled={state.pending.length === 0}>
                    Recall
                  </button>
                  <button
                    className="button px-3 py-1"
                    onClick={state.passTurn}>
                    Pass
                  </button>
                </div>
              )}
              {!myTurn && !state.gameOver && (
                <span className="msg">Opponent's turn…</span>
              )}
            </div>

            {/* Own rack (fanned face up) */}
            <div className="score-row">
              <span className={myTurn ? 'active-player' : ''}>
                You: {state.scores[lp]}
              </span>
            </div>
            <div className="rack-wrap own">
              <Rack pileIndex={ownRack} />
            </div>
          </div>
        )}
      </div>

      {/* Tile layer */}
      <div
        id="cards"
        className="fixed inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: state.cardCount }).map((_, cardId) => (
          <Tile key={`tile-${cardId}`} cardId={cardId} />
        ))}
      </div>

      {/* Landing screen */}
      {!started && !peerConnected && (
        <div className="flex flex-col justify-center items-center h-full gap-4 absolute inset-0 text-2xl">
          <h1 className="text-4xl font-bold mb-4">Scrabble</h1>
          <button
            className="button font-medium px-4 py-3"
            onClick={() => {
              openLobby('hosting')
              hostGame()
            }}>
            Host Game
          </button>
          <button
            className="button font-medium px-4 py-3"
            onClick={() => openLobby('joining')}>
            Join Game
          </button>
        </div>
      )}

      <InstructionsModal />
      <GameOverModal />
      <LobbyModal key={showLobbyModal ? 'show' : 'hide'} />
      <NetworkDebugPanel />
    </div>
  )
}

export default App
