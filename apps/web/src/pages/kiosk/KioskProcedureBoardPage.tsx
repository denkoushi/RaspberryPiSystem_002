import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { ProcedureBoard } from '../../features/procedure-board/ProcedureBoard';
import { procedureBoardApi, useProcedureBoardAccess } from '../../features/procedure-board/procedureBoardApi';

function OpenBoard({ procedureId, title }: { procedureId: string; title: string }) {
  const materials = useQuery({ queryKey: ['procedure-board', procedureId, 'materials'],
    queryFn: () => procedureBoardApi.materials(procedureId), retry: false, refetchInterval: 5000, refetchIntervalInBackground: false });
  if (materials.error && !materials.data) return <p role="alert">素材を読み込めませんでした</p>;
  if (!materials.data) return <p role="status">読み込み中…</p>;
  return <ProcedureBoard key={procedureId} procedureId={procedureId} title={title} materials={materials.data} materialError={materials.error} />;
}
export function KioskProcedureBoardPage() {
  const { procedureId } = useParams(); const access = useProcedureBoardAccess();
  const procedures = useInfiniteQuery({ queryKey: ['procedure-board-procedures'], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => procedureBoardApi.procedures(pageParam), getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: access.data === true, retry: false });
  if (access.isPending) return <p role="status">読み込み中…</p>;
  if (access.data !== true) return <p role="alert">手順づくりは無効です</p>;
  const entries = procedures.data?.pages.flatMap(page => page.procedures) ?? [];
  if (procedureId) return <OpenBoard key={procedureId} procedureId={procedureId} title={entries.find(p => p.procedureId === procedureId)?.title ?? '手順づくり'} />;
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto bg-inv-bg text-inv-text">
    <h1 className="text-xl font-bold">手順づくり</h1>
    {procedures.error && <p role="alert">案件を読み込めませんでした</p>}
    {entries.map(procedure => <Link key={procedure.procedureId} to={`/kiosk/procedure-board/${encodeURIComponent(procedure.procedureId)}`}
      className="w-fit rounded border border-inv-line2 bg-inv-s2 px-4 py-3 text-lg">{procedure.title}</Link>)}
    {procedures.hasNextPage && <button type="button" className="w-fit border border-inv-line2 px-4 py-3" aria-label="続きを読み込む"
      disabled={procedures.isFetchingNextPage} onClick={() => void procedures.fetchNextPage()}>…</button>}
  </div>;
}
