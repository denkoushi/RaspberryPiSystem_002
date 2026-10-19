import clsx from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { getApiErrorMessage } from '../../api/errors';
import { useMachineSignalAdminOverview, useMachineSignalSensors, useRunMachineSignalGmailImport } from '../../api/hooks';
import { AdminStatusBar } from '../../features/machine-signal/admin/AdminStatusBar';
import { ImportSheet } from '../../features/machine-signal/admin/ImportSheet';
import { FILTER_ALL, SensorBoard } from '../../features/machine-signal/admin/SensorBoard';
import { BulkSensorEditor, SingleSensorEditor } from '../../features/machine-signal/admin/SensorEditor';
import { ThresholdPanel } from '../../features/machine-signal/admin/ThresholdPanel';
import { placeBeside } from '../../features/machine-signal/machineSignalAdminModel';

import '../../features/machine-signal/admin/machineSignalAdmin.css';

const WIDE_SCREEN_MIN_WIDTH = 1_100;
const TOAST_MS = 2_000;

/** 管理画面「設備稼働」。センサーを1画面で見渡し、選んだ行のすぐ隣で設定する。 */
export function MachineSignalAdminPage() {
  const sensorsQuery = useMachineSignalSensors();
  const overview = useMachineSignalAdminOverview();
  const gmail = useRunMachineSignalGmailImport();
  const sensors = useMemo(() => sensorsQuery.data ?? [], [sensorsQuery.data]);
  const sites = useMemo(
    () => [...new Set(sensors.map((sensor) => sensor.site).filter((site): site is string => !!site))].sort(),
    [sensors]
  );

  const [filter, setFilter] = useState(FILTER_ALL);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [anchor, setAnchor] = useState<number | 'todo' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pickTodoRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);
  const saved = (message: string) => {
    close();
    setToast(message);
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 編集パネルを、選んだ行（または「未設定をすべて選ぶ」）のすぐ隣に置く。
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop || selected.size === 0 || anchor === null || window.innerWidth < WIDE_SCREEN_MIN_WIDTH) {
      setPosition(null);
      return;
    }
    const place = () => {
      const target =
        anchor === 'todo' ? pickTodoRef.current : rootRef.current?.querySelector<HTMLElement>(`[data-signal-row="${anchor}"]`);
      if (!target) return;
      setPosition(
        placeBeside(
          target.getBoundingClientRect(),
          { width: pop.offsetWidth, height: pop.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
          anchor === 'todo' ? 'below' : 'beside'
        )
      );
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, selected, sensors]);

  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !importOpen) close();
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.pop, .grid, .bar')) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [selected.size, importOpen, close]);

  const selectedNos = [...selected];
  const single = selected.size === 1 ? sensors.find((sensor) => sensor.signalNo === selectedNos[0]) : undefined;

  return (
    <div className="msa" ref={rootRef}>
      <AdminStatusBar
        overview={overview.data}
        gmailPending={gmail.isPending}
        onRunGmail={() =>
          gmail.mutate(undefined, {
            onSuccess: (summary) => {
              const imported = summary.runs.reduce((sum, run) => sum + run.importedCount, 0);
              setToast(summary.scanned === 0 ? '新しいメールはありません' : `メール ${summary.scanned} 通 ・ ${imported} 件を取り込みました`);
            },
            onError: (error) => setToast(getApiErrorMessage(error, 'Gmailの確認に失敗しました'))
          })
        }
        onOpenImport={() => setImportOpen(true)}
      />

      <main className="work">
        <SensorBoard
          sensors={sensors}
          sites={sites}
          filter={filter}
          onFilter={setFilter}
          selected={selected}
          anchor={anchor}
          pickTodoRef={pickTodoRef}
          onOpen={(signalNo) => {
            setSelected(new Set([signalNo]));
            setAnchor(signalNo);
          }}
          onToggle={(signalNo) => {
            const next = new Set(selected);
            if (next.has(signalNo)) next.delete(signalNo);
            else next.add(signalNo);
            setSelected(next);
            setAnchor(signalNo);
          }}
          onPickTodo={() => {
            setSelected(new Set(sensors.filter((sensor) => !sensor.site).map((sensor) => sensor.signalNo)));
            setAnchor('todo');
          }}
          onClear={close}
        />
        <ThresholdPanel sensors={sensors} onSaved={setToast} />
      </main>

      {selected.size > 0 ? (
        <div
          ref={popRef}
          className={clsx('card pop', selected.size > 1 && 'bulk')}
          role="dialog"
          aria-label="センサーの設定"
          style={position ?? undefined}
        >
          {single ? (
            <SingleSensorEditor key={single.signalNo} sensor={single} sites={sites} onClose={close} onSaved={saved} />
          ) : (
            <BulkSensorEditor key={selectedNos.join(',')} signalNos={selectedNos} sites={sites} onClose={close} onSaved={saved} />
          )}
        </div>
      ) : null}

      {importOpen ? <ImportSheet onClose={() => setImportOpen(false)} /> : null}
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
