import { Card } from '../../components/ui/Card';

/**
 * Employees, tools, measuring instruments, their RFID tags and rigging gear are edited on the
 * kiosk "タグ管理" screen (4-digit operation password), where the NFC reader is.
 */
export function MovedToKioskTagDeskPage({ positionRanks = false }: { positionRanks?: boolean }) {
  return (
    <Card title="キオスクの「タグ管理」に移りました">
      <p className="text-base text-slate-700">
        {positionRanks ? '職位の対応表は、キオスクの「タグ管理」で、社員一覧の上部にある「職位の対応表」から設定します。' : '従業員・工具・計測機器・吊具の登録と、NFCタグの付け外しは、キオスクの「タグ管理」タブで行います。'}
      </p>
      <p className="mt-2 text-sm text-slate-600">開くには4桁の操作パスワード（納期管理・在庫の準備と同じ）が必要です。CSVでの一括登録はこれまでどおり「CSVインポート」から行えます。</p>
    </Card>
  );
}
