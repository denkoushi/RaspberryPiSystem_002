import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { AssemblyMachineNamePickerDialog } from '../AssemblyMachineNamePickerDialog';
import { AssemblyTemplateDocumentLibraryDialog } from '../AssemblyTemplateDocumentLibraryDialog';

import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';
import { AssemblyTemplateRecoveryDialog } from './AssemblyTemplateRecoveryDialog';

export function AssemblyTemplateEditorDialogs() {
  const {
    addDocument: addProcedureDocument,
    addingDocumentId,
    busy,
    changeModelCode,
    confirmDeleteArea,
    confirmDeleteMarker,
    documentLibraryOpen,
    documentSearch,
    documents,
    machineNamePickerOpen,
    modelCode,
    pendingAreaDelete,
    pendingMarkerDelete,
    procedureItems,
    readOnly,
    recoveryPending,
    restoreRecovery,
    discardRecovery,
    setDocumentLibraryOpen,
    setDocumentSearch,
    setMachineNamePickerOpen,
    setPendingAreaDelete,
    setPendingMarkerDelete
  } = useAssemblyTemplateEditor();
  return (
    <>
      <AssemblyTemplateRecoveryDialog
        pending={recoveryPending}
        onRestore={restoreRecovery}
        onDiscard={discardRecovery}
      />
      <AssemblyTemplateDocumentLibraryDialog
        open={documentLibraryOpen}
        documents={documents}
        procedureItems={procedureItems}
        addingDocumentId={addingDocumentId}
        search={documentSearch}
        readOnly={readOnly || busy}
        onSearchChange={setDocumentSearch}
        onAdd={addProcedureDocument}
        onClose={() => setDocumentLibraryOpen(false)}
      />
      <ConfirmDialog
        isOpen={pendingAreaDelete != null}
        title={`工程「${pendingAreaDelete?.label ?? ''}」を削除`}
        description={
          pendingAreaDelete
            ? pendingAreaDelete.boltCount > 0
              ? `この工程に含まれる締付点${pendingAreaDelete.boltCount}件も、すべての表示手順から削除されます。`
              : 'この工程を削除します。'
            : undefined
        }
        confirmLabel="工程を削除"
        cancelLabel="キャンセル"
        tone="danger"
        onConfirm={confirmDeleteArea}
        onCancel={() => setPendingAreaDelete(null)}
      />
      <ConfirmDialog
        isOpen={pendingMarkerDelete != null}
        title={
          pendingMarkerDelete?.kind === 'bolt'
            ? `丸数字${pendingMarkerDelete.markerNo}を削除`
            : `チェック${pendingMarkerDelete?.markerNo ?? ''}を削除`
        }
        description={
          pendingMarkerDelete
            ? `このマーカーは元ページの共通マーカーです。全体・矩形${pendingMarkerDelete.affectedStepCount}件から削除されます。`
            : undefined
        }
        confirmLabel="すべてから削除"
        cancelLabel="キャンセル"
        tone="danger"
        onConfirm={confirmDeleteMarker}
        onCancel={() => setPendingMarkerDelete(null)}
      />
      <AssemblyMachineNamePickerDialog
        isOpen={machineNamePickerOpen}
        currentValue={modelCode}
        disabled={busy}
        onCancel={() => setMachineNamePickerOpen(false)}
        onConfirm={(machineName) => {
          changeModelCode(machineName);
          setMachineNamePickerOpen(false);
        }}
      />
    </>
  );
}
