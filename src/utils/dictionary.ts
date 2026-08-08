// Loads the bundled word list (public/words.txt) into a Set for O(1) lookup.
// Until it's loaded, isValidWord returns true so play isn't blocked.

let words: Set<string> | null = null
let loading: Promise<void> | null = null

export function loadDictionary(): Promise<void> {
  if (loading) return loading
  loading = fetch(`${import.meta.env.BASE_URL}words.txt`)
    .then((r) => r.text())
    .then((text) => {
      words = new Set(
        text
          .split('\n')
          .map((w) => w.trim())
          .filter(Boolean),
      )
    })
    .catch(() => {
      // If the list fails to load, fall back to accepting all words.
      words = null
    })
  return loading
}

export function isDictionaryReady(): boolean {
  return words !== null
}

export function isValidWord(word: string): boolean {
  if (!words) return true // not loaded yet → don't block play
  return words.has(word.toUpperCase())
}

export function getTwoLetterWords(): string[] {
  if (!words) return []
  return [...words].filter((w) => w.length === 2).sort()
}
