-- 振り直しで古くなった製造オーダー番号の印。印の付け直しは取り込み後処理が行う(この移行では列を足すだけ)。
ALTER TABLE "CsvDashboardRow" ADD COLUMN "supersededAt" TIMESTAMP(3);
