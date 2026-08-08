import debounce from 'lodash/debounce'
import { useShallow } from 'zustand/react/shallow'
import { useForceUpdate, useWindowEvent } from '../utils'
import {
  BAG_PILE,
  BOARD_SIZE,
  FIRST_SQUARE_PILE,
  RACK_PILE,
} from '../utils/constants'
import { useGameStore, validatePlay } from '../utils/gameStore'
import { useMultiplayerStore } from '../utils/multiplayerStore'
import { Header } from './Header'
import { MenuDropdown } from './MenuDropdown'
import { BlankTileModal } from './modals/BlankTileModal'
import { GameOverModal } from './modals/GameOverModal'
import { HistoryModal } from './modals/HistoryModal'
import { InstructionsModal } from './modals/InstructionsModal'
import { LobbyModal } from './modals/LobbyModal'
import { TwoLetterWordsModal } from './modals/TwoLetterWordsModal'
import { UnseenTilesModal } from './modals/UnseenTilesModal'
import { NetworkDebugPanel } from './NetworkDebugPanel'
import { Rack, Square } from './Pile'
import Tile from './Tile'

function App() {
  const {
    showLobbyModal,
    openLobby,
    hostGame,
    peerConnected,
    lastGame,
    reconnectLastGame,
  } = useMultiplayerStore()
  const state = useGameStore(
    useShallow((s) => {
      const play =
        s.pending.length > 0 ? validatePlay(s.cards, s.pending) : null
      return {
        cardCount: s.cards.length,
        onMouseUp: s.onMouseUp,
        onMouseDown: s.onMouseDown,
        onMouseMove: s.onMouseMove,
        localPlayerIndex: s.localPlayerIndex,
        currentPlayerIndex: s.currentPlayerIndex,
        scores: s.scores,
        pending: s.pending,
        canSubmit: play?.ok === true,
        pendingScore: play?.ok ? play.score : null,
        lastPlay: s.lastPlay,
        gameOver: s.gameOver,
        submitTurn: s.submitTurn,
        recallTiles: s.recallTiles,
        undoLastTile: s.undoLastTile,
        shuffleRack: s.shuffleRack,
        swapMode: s.swapMode,
        swapCount: s.swapIds.length,
        // swapping on a pass needs at least 8 tiles left in the bag
        canSwap: s.cards.filter((c) => c.pileIndex === BAG_PILE).length >= 8,
        startPass: s.startPass,
        confirmSwap: s.confirmSwap,
        cancelSwap: s.cancelSwap,
        giveUp: s.giveUp,
        givenUpBy: s.givenUpBy,
      }
    }),
  )

  useWindowEvent('resize', debounce(useForceUpdate(), 100))
  useWindowEvent('pointerup', state.onMouseUp)
  useWindowEvent('pointerdown', state.onMouseDown)
  useWindowEvent('pointermove', state.onMouseMove)

  const lp = state.localPlayerIndex
  const myTurn = state.currentPlayerIndex === lp && !state.gameOver
  const started = state.cardCount > 0
  const ownRack = RACK_PILE[lp]
  const lastPlay =
    state.lastPlay && `${state.lastPlay.word} (${state.lastPlay.score}) - `

  return (
    <div className="bg-surface absolute inset-0">
      <div id="ui" className="absolute inset-0 flex flex-col">
        <Header />

        {started && (
          <div className="flex-1 flex flex-col items-center min-h-0 py-2 pb-20 gap-4">
            {/* Scores */}
            <div className="flex flex-col">
              <div className="score-row">
                <span className={myTurn ? 'active-player' : ''}>
                  You: {state.scores[lp]}
                </span>
                <span>/</span>
                <span className={!myTurn ? 'active-player' : ''}>
                  Them: {state.scores[lp === 0 ? 1 : 0]}
                </span>
              </div>
              {!state.gameOver && (
                <div className="turn-row">
                  <>
                    <b>{lastPlay}</b>
                    {state.givenUpBy === lp
                      ? 'You gave up, their turn!'
                      : state.givenUpBy != null
                        ? 'They gave up, your turn!'
                        : myTurn
                          ? 'Your turn!'
                          : 'Their turn!'}
                  </>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-4">
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
                {!state.gameOver && (
                  <div className="controls">
                    {myTurn && state.swapMode && (
                      <>
                        <button onClick={state.confirmSwap}>
                          {state.swapCount > 0
                            ? `Swap ${state.swapCount}`
                            : 'Pass'}
                        </button>
                        <button onClick={state.cancelSwap}>Cancel</button>
                        <button onClick={state.giveUp}>Give Up</button>
                      </>
                    )}
                    {!state.swapMode && (
                      <>
                        {state.pending.length > 0 && (
                          <button
                            onClick={state.submitTurn}
                            disabled={!myTurn || !state.canSubmit}>
                            Submit
                            {state.pendingScore != null &&
                              ` (${state.pendingScore})`}
                          </button>
                        )}
                        {state.pending.length > 0 && (
                          <button onClick={state.recallTiles}>Recall</button>
                        )}
                        {state.pending.length > 0 ? (
                          <button onClick={state.undoLastTile}>Back</button>
                        ) : (
                          myTurn && (
                            <button onClick={state.startPass}>
                              {state.canSwap ? 'Swap' : 'Pass'}
                            </button>
                          )
                        )}
                      </>
                    )}
                    {!state.swapMode && (
                      <>
                        <button className="button" onClick={state.shuffleRack}>
                          Shuffle
                        </button>
                        <MenuDropdown
                          className="self-stretch w-12"
                          triggerClassName="w-full h-full"
                          openUp
                        />
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Own rack (fanned face up) */}
              <div className="rack-wrap own">
                <Rack pileIndex={ownRack} />
              </div>
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
          <h1 className="text-4xl font-bold mb-4">WordCrꚙsh</h1>
          {lastGame && (
            <button
              className="button font-medium px-4 py-3"
              onClick={reconnectLastGame}>
              Reconnect ({lastGame.code})
            </button>
          )}
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
      <BlankTileModal />
      <TwoLetterWordsModal />
      <UnseenTilesModal />
      <GameOverModal />
      <LobbyModal key={showLobbyModal ? 'show' : 'hide'} />
      <HistoryModal />
      <NetworkDebugPanel />
    </div>
  )
}

export default App
