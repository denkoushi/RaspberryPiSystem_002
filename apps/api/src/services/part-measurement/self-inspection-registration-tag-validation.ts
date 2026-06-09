import { ApiError } from '../../lib/errors.js';

import { resolveSelfInspectionNfcTagUid } from './self-inspection-nfc-tag-resolve.js';

const DUPLICATE_TAG_MESSAGE =
  '同一タグが社員と計測機器の両方に登録されています。管理データを修正してください。';
const SAME_TAG_MESSAGE = '測定者と測定機器に同じNFCタグは使用できません';

/** createEntry / updateEntry が resolve API と同じ NFC 不変条件を満たすことを保証する */
export async function assertSelfInspectionEntryRegistrationTagUids(input: {
  employeeTagUid?: string | null;
  measuringInstrumentTagUid?: string | null;
}): Promise<void> {
  const employeeTag = (input.employeeTagUid ?? '').trim();
  const instrumentTag = (input.measuringInstrumentTagUid ?? '').trim();

  if (!employeeTag && !instrumentTag) {
    return;
  }

  if (employeeTag && instrumentTag && employeeTag === instrumentTag) {
    const duplicate = await resolveSelfInspectionNfcTagUid(employeeTag);
    if (duplicate.kind === 'duplicate') {
      throw new ApiError(400, DUPLICATE_TAG_MESSAGE);
    }
    throw new ApiError(400, SAME_TAG_MESSAGE);
  }

  if (employeeTag) {
    await assertEmployeeRegistrationTagUid(employeeTag);
  }
  if (instrumentTag) {
    await assertMeasuringInstrumentRegistrationTagUid(instrumentTag);
  }
}

async function assertEmployeeRegistrationTagUid(uid: string): Promise<void> {
  const result = await resolveSelfInspectionNfcTagUid(uid);
  if (result.kind === 'duplicate') {
    throw new ApiError(400, DUPLICATE_TAG_MESSAGE);
  }
  if (result.kind === 'unknown') {
    throw new ApiError(404, '従業員が登録されていません');
  }
  if (result.kind === 'instrument' || result.kind === 'instrument_unavailable') {
    throw new ApiError(400, '測定者タグとして計測機器タグが指定されています');
  }
}

async function assertMeasuringInstrumentRegistrationTagUid(uid: string): Promise<void> {
  const result = await resolveSelfInspectionNfcTagUid(uid);
  if (result.kind === 'duplicate') {
    throw new ApiError(400, DUPLICATE_TAG_MESSAGE);
  }
  if (result.kind === 'unknown') {
    throw new ApiError(404, '計測機器が登録されていません');
  }
  if (result.kind === 'employee') {
    throw new ApiError(400, '測定機器タグとして社員タグが指定されています');
  }
  if (result.kind === 'instrument_unavailable') {
    throw new ApiError(400, '廃棄済みの計測機器は自主検査に使用できません');
  }
}
