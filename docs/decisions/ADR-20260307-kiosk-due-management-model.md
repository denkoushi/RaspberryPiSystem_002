# ADR-20260307: キオスク納期管理の製番中心モデル

- Status: accepted

## Context

- 既存の生産スケジュールは行（部品×工程）中心のデータモデルで、現場リーダーが実施する「製番単位の納期決定」と「部品単位の優先決定」を直接表現できなかった
- 既存画面・既存APIは `ProductionScheduleRowNote.dueDate` を参照しているため、互換性を維持しながら段階移行する必要がある
- 切削カテゴリは現場によって除外コードが異なる（初期値 `10`, `MSZ`）

## Decision

- 製番納期は新規テーブル `ProductionScheduleSeibanDueDate` で管理する
- 製番内部品優先は新規テーブル `ProductionSchedulePartPriority` で管理する
- 切削除外コードは `ProductionScheduleResourceCategoryConfig` でロケーション別管理する
- 製番納期更新時は `DueDateWritebackService` で既存 `ProductionScheduleRowNote.dueDate` へ反映し、既存画面互換を維持する
- UI/APIは用途別に分離し、既存 `/kiosk/production-schedule` 一覧APIへ過積載しない

## Alternatives

- 代替案A: 既存 `ProductionScheduleRowNote` のみ拡張して製番納期を表現  
  - 却下理由: 行中心のままでは製番全体更新と部品優先保持が複雑化し、責務が混在する
- 代替案B: 製番納期のみ追加し、部品優先は `processingOrder` に直接保存  
  - 却下理由: 部品優先と工程順序は意味が異なり、運用上の調整・再計算が困難

## Consequences

- 良い影響
  - 製番単位の納期管理と部品優先管理を明確に分離できる
  - 既存画面互換を維持したまま新画面へ移行できる
  - 切削除外の現場差異を管理コンソールで吸収できる
- 悪い影響
  - テーブル・API・UIが増え、初期実装コストが上がる
  - writeback処理の整合性テストが必須になる

## References

- `docs/knowledge-base/KB-297-kiosk-due-management-workflow.md`
- `apps/api/src/services/production-schedule/due-date-writeback.service.ts`
- `apps/api/src/routes/kiosk/production-schedule/due-management-*.ts`
