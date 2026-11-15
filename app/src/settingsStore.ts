import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type SettingsStore = {
  /** Free Marswalk camera drag: flip the horizontal / vertical axis independently. */
  invertLookX: boolean
  invertLookY: boolean
  joystickSide: 'left' | 'right'
  tutorialSeen: boolean
  tutorialOpen: boolean
  settingsOpen: boolean
  set: (patch: Partial<Pick<SettingsStore, 'invertLookX' | 'invertLookY' | 'joystickSide'>>) => void
  setSettingsOpen: (open: boolean) => void
  startTutorial: () => void
  finishTutorial: () => void
}

export const useSettingsStore = create<SettingsStore>()(persist((set) => ({
  invertLookX: false,
  invertLookY: false,
  joystickSide: 'left',
  tutorialSeen: false,
  tutorialOpen: false,
  settingsOpen: false,
  set: (patch) => set(patch),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  startTutorial: () => set({ tutorialOpen: true, settingsOpen: false }),
  finishTutorial: () => set({ tutorialOpen: false, tutorialSeen: true }),
}), {
  name: 'ares-settings',
  partialize: ({ invertLookX, invertLookY, joystickSide, tutorialSeen }) => ({ invertLookX, invertLookY, joystickSide, tutorialSeen }),
}))
