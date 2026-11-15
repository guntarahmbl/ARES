import { useSettingsStore } from '../settingsStore'
import { Button } from './ui/button'
import { Sheet } from './ui/sheet'

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <strong className="block text-[13px] font-medium text-ink">{label}</strong>
        <small className="text-xs text-ink-3">{hint}</small>
      </span>
      <input className="check" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

export function AppSettings() {
  const open = useSettingsStore((state) => state.settingsOpen)
  const setOpen = useSettingsStore((state) => state.setSettingsOpen)
  const invertLookX = useSettingsStore((state) => state.invertLookX)
  const invertLookY = useSettingsStore((state) => state.invertLookY)
  const joystickSide = useSettingsStore((state) => state.joystickSide)
  const update = useSettingsStore((state) => state.set)
  const startTutorial = useSettingsStore((state) => state.startTutorial)

  return (
    <Sheet open={open} onOpenChange={setOpen} title="App settings">
      <div className="space-y-6">
        <section>
          <h3 className="label text-ink">Free Marswalk camera</h3>
          <div className="mt-1 divide-y divide-rule border-y border-rule">
            <Toggle label="Invert horizontal (X)" hint="Dragging right turns the view left" checked={invertLookX} onChange={(value) => update({ invertLookX: value })} />
            <Toggle label="Invert vertical (Y)" hint="Dragging down tilts the view up" checked={invertLookY} onChange={(value) => update({ invertLookY: value })} />
          </div>
        </section>

        <section>
          <h3 className="label text-ink">Touch joystick</h3>
          <div className="mt-2 flex rounded border border-ink" role="radiogroup" aria-label="Joystick side">
            {(['left', 'right'] as const).map((side) => (
              <button
                key={side}
                role="radio"
                aria-checked={joystickSide === side}
                className={`h-9 flex-1 text-[13px] font-medium capitalize first:rounded-l-[3px] last:rounded-r-[3px] ${joystickSide === side ? 'bg-ink text-panel' : 'text-ink-2 hover:text-ink'}`}
                onClick={() => update({ joystickSide: side })}
              >
                {side}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-3">Shown in Free Walk on touch screens.</p>
        </section>

        <section>
          <h3 className="label text-ink">Help</h3>
          <Button variant="secondary" className="mt-2 w-full" onClick={startTutorial}>Replay tutorial</Button>
        </section>
      </div>
    </Sheet>
  )
}
