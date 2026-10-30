export function ShelfKioskHeader({ count, used, total, pending, onBack }: { count: number; used: number; total: number; pending: number; onBack: () => void }) {
  return <header className="sk-bar"><button type="button" aria-label="配膳へ戻る" onClick={onBack}>‹</button><h1>棚マスタ</h1><span className="sk-spacer" /><span><b>{count}</b> 棚</span><span><b>{used}</b>/{total} Zero2W</span>{pending > 0 && <span className="sk-pending">未送信 {pending}</span>}</header>;
}
