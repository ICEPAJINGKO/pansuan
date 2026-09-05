interface Props {
  autosave: boolean
  setAutosave: (on: boolean) => void
}

/**
 * Whether this browser keeps a copy of the graph between visits.
 *
 * It reads as a status light with a caption rather than as a checkbox, because
 * the state it reports — whether there is a copy on this machine right now —
 * matters more than the fact that it can be clicked. Turning it off wipes what
 * is stored, so the label is a statement about the present, not a promise about
 * the next save.
 */
export function SaveToggle({ autosave, setAutosave }: Props) {
  return (
    <button
      className={`save-toggle${autosave ? ' is-on' : ''}`}
      role="switch"
      aria-checked={autosave}
      aria-label="เก็บพอร์ตไว้ในเครื่อง"
      title={
        autosave
          ? 'เก็บพอร์ตไว้ในเครื่อง · เปิดอยู่ — ปิดแท็บแล้วเปิดใหม่จะได้ของเดิม\nกดเพื่อปิด และลบสำเนาที่เก็บไว้ทิ้ง'
          : 'เก็บพอร์ตไว้ในเครื่อง · ปิดอยู่ — ไม่มีสำเนาในเครื่อง ปิดแท็บแล้วหาย\nกดเพื่อเปิดการเก็บอัตโนมัติ'
      }
      onClick={() => setAutosave(!autosave)}
    >
      <span className="save-dot" aria-hidden="true" />
      <span className="save-text">{autosave ? 'เก็บไว้' : 'ไม่เก็บ'}</span>
    </button>
  )
}
