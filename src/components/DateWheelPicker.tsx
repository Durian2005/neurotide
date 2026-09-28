import { useMemo } from 'react'

interface DateWheelPickerProps {
  value: Date
  onChange: (value: Date) => void
  minYear?: number
  maxYear?: number
}

interface WheelColumnProps {
  label: string
  value: number
  values: number[]
  formatValue: (value: number) => string
  onChange: (value: number) => void
}

const VISIBLE_OFFSETS = [-2, -1, 0, 1, 2]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function WheelColumn({ label, value, values, formatValue, onChange }: WheelColumnProps) {
  const currentIndex = Math.max(0, values.indexOf(value))
  const visibleValues = useMemo(
    () => VISIBLE_OFFSETS.map((offset) => values[clamp(currentIndex + offset, 0, values.length - 1)]),
    [currentIndex, values],
  )

  const move = (delta: number) => {
    const nextIndex = clamp(currentIndex + delta, 0, values.length - 1)
    onChange(values[nextIndex])
  }

  return (
    <div
      className="min-w-0 flex-1"
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onWheel={(event) => {
        event.preventDefault()
        move(event.deltaY > 0 ? 1 : -1)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault()
          move(1)
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault()
          move(-1)
        }
      }}
    >
      <p className="mb-1 text-center text-[10px] text-slate-500">{label}</p>
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-slate-950/45 py-1 outline-none focus-within:border-cyan-300/50 focus-within:ring-2 focus-within:ring-cyan-300/10">
        <div className="pointer-events-none absolute inset-x-1 top-1/2 z-10 h-8 -translate-y-1/2 rounded-lg border border-cyan-300/20 bg-cyan-300/10" />
        <div className="relative z-20 space-y-0.5">
          {visibleValues.map((item, index) => {
            const selected = index === 2
            return (
              <button
                key={`${label}-${item}-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onChange(item)}
                className={`relative block h-8 w-full text-center text-xs tabular-nums transition-colors ${
                  selected ? 'font-semibold text-cyan-200' : 'text-slate-600 hover:text-slate-300'
                }`}
              >
                {formatValue(item)}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function DateWheelPicker({ value, onChange, minYear = 2000, maxYear = 2035 }: DateWheelPickerProps) {
  const year = value.getFullYear()
  const month = value.getMonth() + 1
  const day = value.getDate()
  const years = useMemo(() => Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index), [maxYear, minYear])
  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => index + 1), [])
  const days = useMemo(() => Array.from({ length: daysInMonth(year, month) }, (_, index) => index + 1), [month, year])

  const update = (nextYear: number, nextMonth: number, nextDay: number) => {
    const safeDay = clamp(nextDay, 1, daysInMonth(nextYear, nextMonth))
    onChange(new Date(nextYear, nextMonth - 1, safeDay))
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">用鼠标滚轮选择，键盘方向键也可调整</span>
        <span className="text-[11px] font-medium tabular-nums text-cyan-300">
          {year}年{month}月{day}日
        </span>
      </div>
      <div className="flex gap-2" aria-label="截图日期滚轮选择器">
        <WheelColumn
          label="年"
          value={year}
          values={years}
          formatValue={(item) => `${item}年`}
          onChange={(item) => update(item, month, day)}
        />
        <WheelColumn
          label="月"
          value={month}
          values={months}
          formatValue={(item) => `${item}月`}
          onChange={(item) => update(year, item, day)}
        />
        <WheelColumn
          label="日"
          value={day}
          values={days}
          formatValue={(item) => `${item}日`}
          onChange={(item) => update(year, month, item)}
        />
      </div>
    </div>
  )
}
