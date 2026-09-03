import { useEffect, useMemo, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

import { AssemblyCapabilityGroupSelector } from './AssemblyCapabilityGroupSelector';
import {
  buildAssemblyTorqueWrenchPresetCandidates,
  capabilityGroupToAssemblyBoltCondition,
  type AssemblyTorqueWrenchProfileCatalogStatus,
  type AssemblyTorqueWrenchSettingCandidate
} from './assemblyTemplateInputAssistance';

import type { AssemblyDraftBolt } from './assemblyTemplateDraft';
import type {
  TorqueWrenchCapabilityGroupApi,
  TorqueWrenchProfileApi
} from '../../api/domains/torque-wrenches';

type TorqueInputSnapshot = Pick<
  AssemblyDraftBolt,
  'id' | 'capabilityGroupId' | 'lowerLimit' | 'nominalTorque' | 'upperLimit' | 'unit'
>;

type PendingGroupSelection = {
  boltId: string;
  groupId: string;
  current: Pick<TorqueInputSnapshot, 'lowerLimit' | 'nominalTorque' | 'upperLimit' | 'unit'>;
};

type ConfirmationState = {
  boltId: string;
  groupId: string;
  candidateKey: string;
  current: Pick<TorqueInputSnapshot, 'lowerLimit' | 'nominalTorque' | 'upperLimit' | 'unit'>;
};

export type AssemblyTorqueWrenchSettingAssistantProps = {
  bolt: AssemblyDraftBolt;
  capabilityGroups: TorqueWrenchCapabilityGroupApi[];
  capabilityCatalogStatus: 'loading' | 'ready' | 'error';
  torqueWrenchProfiles: TorqueWrenchProfileApi[];
  torqueWrenchProfilesStatus: AssemblyTorqueWrenchProfileCatalogStatus;
  disabled: boolean;
  onPatch: (boltId: string, patch: Partial<AssemblyDraftBolt>) => void;
  onRetryCapabilityCatalog: () => void;
  onRetryTorqueWrenchProfiles: () => void;
};

function hasTorqueNumbers(bolt: AssemblyDraftBolt): boolean {
  return bolt.lowerLimit != null || bolt.nominalTorque != null || bolt.upperLimit != null;
}

function torqueInputSnapshot(bolt: AssemblyDraftBolt) {
  return {
    lowerLimit: bolt.lowerLimit,
    nominalTorque: bolt.nominalTorque,
    upperLimit: bolt.upperLimit,
    unit: bolt.unit
  };
}

function torqueInputMatchesSnapshot(
  bolt: AssemblyDraftBolt,
  snapshot: Pick<TorqueInputSnapshot, 'lowerLimit' | 'nominalTorque' | 'upperLimit' | 'unit'>
): boolean {
  return (
    bolt.lowerLimit === snapshot.lowerLimit &&
    bolt.nominalTorque === snapshot.nominalTorque &&
    bolt.upperLimit === snapshot.upperLimit &&
    bolt.unit === snapshot.unit
  );
}

function candidateLabel(candidate: AssemblyTorqueWrenchSettingCandidate): string {
  return `${candidate.setting.lowerLimit} / ${candidate.setting.nominalTorque} / ${candidate.setting.upperLimit} ${candidate.setting.unit}`;
}

function candidateEffectiveAt(profile: TorqueWrenchProfileApi): string {
  const raw = profile.settingHistories[0]?.effectiveAt ?? '';
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) return raw || '日時不明';
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function candidateProfileLabel(candidate: AssemblyTorqueWrenchSettingCandidate): string {
  return candidate.profiles
    .map((profile) => {
      return `${profile.serialNumber}（${profile.model.modelNumber} / ${candidateEffectiveAt(profile)}）`;
    })
    .join('、');
}

function torquePatch(candidate: AssemblyTorqueWrenchSettingCandidate) {
  return {
    lowerLimit: Number(candidate.setting.lowerLimit),
    nominalTorque: Number(candidate.setting.nominalTorque),
    upperLimit: Number(candidate.setting.upperLimit),
    unit: candidate.setting.unit
  } satisfies Partial<AssemblyDraftBolt>;
}

export function AssemblyTorqueWrenchSettingAssistant({
  bolt,
  capabilityGroups,
  capabilityCatalogStatus,
  torqueWrenchProfiles,
  torqueWrenchProfilesStatus,
  disabled,
  onPatch,
  onRetryCapabilityCatalog,
  onRetryTorqueWrenchProfiles
}: AssemblyTorqueWrenchSettingAssistantProps) {
  const [pendingGroupSelection, setPendingGroupSelection] = useState<PendingGroupSelection | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);
  const [assistantMessage, setAssistantMessage] = useState<string | null>(null);

  useEffect(() => {
    setPendingGroupSelection(null);
    setConfirmation(null);
    setSelectedCandidateKey(null);
    setAssistantMessage(null);
  }, [bolt.id]);

  const selectedGroup = useMemo(
    () => capabilityGroups.find((group) => group.id === bolt.capabilityGroupId) ?? null,
    [bolt.capabilityGroupId, capabilityGroups]
  );
  const resolution = useMemo(
    () => buildAssemblyTorqueWrenchPresetCandidates(selectedGroup, torqueWrenchProfiles),
    [selectedGroup, torqueWrenchProfiles]
  );

  const applyCandidate = (
    candidate: AssemblyTorqueWrenchSettingCandidate,
    group: TorqueWrenchCapabilityGroupApi,
    allowUncommittedGroup = false
  ) => {
    if (disabled || (!allowUncommittedGroup && group.id !== bolt.capabilityGroupId)) return;
    const currentResolution = buildAssemblyTorqueWrenchPresetCandidates(
      group,
      torqueWrenchProfiles
    );
    const currentCandidate = currentResolution.candidates.find(
      (entry) => entry.key === candidate.key
    );
    if (!currentCandidate) {
      setConfirmation(null);
      setSelectedCandidateKey(null);
      setPendingGroupSelection(null);
      setAssistantMessage('登録設定が更新されたため、候補を再選択してください。');
      return;
    }
    onPatch(
      bolt.id,
      allowUncommittedGroup
        ? {
            ...capabilityGroupToAssemblyBoltCondition(group),
            ...torquePatch(currentCandidate)
          }
        : torquePatch(currentCandidate)
    );
    setConfirmation(null);
    setSelectedCandidateKey(null);
    setPendingGroupSelection(null);
    setAssistantMessage(null);
  };

  const requestCandidate = (
    candidate: AssemblyTorqueWrenchSettingCandidate,
    group: TorqueWrenchCapabilityGroupApi,
    allowUncommittedGroup = false
  ) => {
    setSelectedCandidateKey(candidate.key);
    if (hasTorqueNumbers(bolt)) {
      setConfirmation({
        boltId: bolt.id,
        groupId: group.id,
        candidateKey: candidate.key,
        current: torqueInputSnapshot(bolt)
      });
      return;
    }
    applyCandidate(candidate, group, allowUncommittedGroup);
  };

  const processSelectedGroup = (group: TorqueWrenchCapabilityGroupApi) => {
    const current = torqueInputSnapshot(bolt);
    setConfirmation(null);
    setSelectedCandidateKey(null);
    setAssistantMessage(null);

    if (torqueWrenchProfilesStatus !== 'ready') {
      onPatch(bolt.id, capabilityGroupToAssemblyBoltCondition(group));
      setPendingGroupSelection({ boltId: bolt.id, groupId: group.id, current });
      return;
    }

    const nextResolution = buildAssemblyTorqueWrenchPresetCandidates(group, torqueWrenchProfiles);
    const hasSingleRegisteredCandidate =
      nextResolution.candidates.length === 1 && nextResolution.unregisteredProfiles.length === 0;
    if (hasSingleRegisteredCandidate && !hasTorqueNumbers(bolt)) {
      requestCandidate(nextResolution.candidates[0]!, group, true);
      return;
    }

    onPatch(bolt.id, capabilityGroupToAssemblyBoltCondition(group));
    if (hasSingleRegisteredCandidate) {
      requestCandidate(nextResolution.candidates[0]!, group);
      return;
    }
    setPendingGroupSelection(null);
  };

  const reviewPendingGroup = () => {
    if (
      disabled ||
      !pendingGroupSelection ||
      pendingGroupSelection.boltId !== bolt.id ||
      pendingGroupSelection.groupId !== bolt.capabilityGroupId ||
      !torqueInputMatchesSnapshot(bolt, pendingGroupSelection.current) ||
      torqueWrenchProfilesStatus !== 'ready'
    ) {
      return;
    }
    const pendingGroup = capabilityGroups.find(
      (group) => group.id === pendingGroupSelection.groupId
    );
    if (!pendingGroup) return;
    const nextResolution = buildAssemblyTorqueWrenchPresetCandidates(
      pendingGroup,
      torqueWrenchProfiles
    );
    if (nextResolution.candidates.length === 1 && nextResolution.unregisteredProfiles.length === 0) {
      requestCandidate(nextResolution.candidates[0]!, pendingGroup);
      return;
    }
    setPendingGroupSelection(null);
    setSelectedCandidateKey(null);
  };

  const selectedCandidate = resolution.candidates.find(
    (candidate) => candidate.key === selectedCandidateKey
  ) ?? null;
  const confirmationIsCurrent = Boolean(
    confirmation &&
      confirmation.boltId === bolt.id &&
      confirmation.groupId === bolt.capabilityGroupId &&
      torqueInputMatchesSnapshot(bolt, confirmation.current) &&
      selectedCandidate
  );

  return (
    <>
      <AssemblyCapabilityGroupSelector
        boltId={bolt.id}
        selectedGroupId={bolt.capabilityGroupId ?? null}
        storedCondition={bolt}
        groups={capabilityGroups}
        catalogStatus={capabilityCatalogStatus}
        disabled={disabled}
        onSelect={processSelectedGroup}
        onRetry={onRetryCapabilityCatalog}
      />

      {pendingGroupSelection ? (
        <section className="rounded border border-cyan-300/20 bg-cyan-950/20 p-2 text-[0.68rem]">
          {torqueWrenchProfilesStatus === 'loading' ? (
            <p className="text-white/70">登録設定を読込中です。</p>
          ) : torqueWrenchProfilesStatus === 'error' ? (
            <div className="grid gap-2">
              <p className="text-amber-100">登録設定を取得できませんでした。</p>
              <Button
                type="button"
                variant="ghostOnDark"
                className="min-h-9 !px-2 text-xs"
                disabled={disabled}
                onClick={onRetryTorqueWrenchProfiles}
              >
                登録設定を再取得
              </Button>
            </div>
          ) : !torqueInputMatchesSnapshot(bolt, pendingGroupSelection.current) ? (
            <p className="text-amber-100">入力内容が変更されたため、登録設定を再確認してください。</p>
          ) : (
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-9 w-full !px-2 text-xs"
              disabled={disabled}
              onClick={reviewPendingGroup}
            >
              登録設定を確認
            </Button>
          )}
        </section>
      ) : null}

      {selectedGroup && torqueWrenchProfilesStatus === 'ready' && !pendingGroupSelection ? (
        <section className="grid gap-2 rounded border border-white/10 bg-slate-950/35 p-2 text-[0.68rem]">
          {assistantMessage ? <p className="text-amber-100" role="status">{assistantMessage}</p> : null}
          {resolution.unregisteredProfiles.length > 0 ? (
            <p className="text-amber-100">
              適合個体に設定未登録または設定照合対象外があります。登録済み設定を選択してください。
            </p>
          ) : null}
          {resolution.candidates.length > 0 || resolution.unregisteredProfiles.length > 0 ? (
            <div className="grid gap-1.5" aria-label="登録設定候補">
              <div className="font-semibold text-white/70">登録設定候補</div>
              {resolution.candidates.length === 0 ? (
                <p className="text-white/60">利用できる登録設定がありません。</p>
              ) : (
                resolution.candidates.map((candidate) => (
                  <Button
                    key={candidate.key}
                    type="button"
                    variant={selectedCandidateKey === candidate.key ? 'primary' : 'ghostOnDark'}
                    className="grid min-h-10 min-w-0 justify-items-start !px-2 !py-1 text-left text-xs"
                    disabled={disabled}
                    onClick={() => requestCandidate(candidate, selectedGroup)}
                  >
                    <span className="grid w-full min-w-0 gap-1 text-xs" title={candidateLabel(candidate)}>
                      <span className="grid w-full min-w-0 grid-cols-3 gap-1">
                        <span className="grid min-w-0 gap-0.5">
                          <span className="text-[0.62rem] text-white/60">下限</span>
                          <span className="whitespace-nowrap">{candidate.setting.lowerLimit}</span>
                        </span>
                        <span className="grid min-w-0 gap-0.5">
                          <span className="text-[0.62rem] text-white/60">規定</span>
                          <span className="whitespace-nowrap">{candidate.setting.nominalTorque}</span>
                        </span>
                        <span className="grid min-w-0 gap-0.5">
                          <span className="text-[0.62rem] text-white/60">上限</span>
                          <span className="whitespace-nowrap">{candidate.setting.upperLimit}</span>
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-[0.68rem]">単位: {candidate.setting.unit}</span>
                    </span>
                    <span className="grid w-full min-w-0 gap-0.5 text-[0.62rem] font-normal text-white/65">
                      {candidate.profiles.map((profile) => (
                        <span key={profile.id} className="flex min-w-0 items-baseline gap-1">
                          <span className="min-w-0 truncate" title={profile.serialNumber}>
                            {profile.serialNumber}
                          </span>
                          <span className="min-w-0 truncate" title={profile.model.modelNumber}>
                            {profile.model.modelNumber}
                          </span>
                          <span
                            className="shrink-0 text-white/45"
                            title={profile.settingHistories[0]?.effectiveAt ?? undefined}
                          >
                            {candidateEffectiveAt(profile)}
                          </span>
                        </span>
                      ))}
                    </span>
                  </Button>
                ))
              )}
            </div>
          ) : (
            <p className="text-white/60">
              このグループに適合する登録済みレンチ設定がないため、自動入力できません。
            </p>
          )}
        </section>
      ) : null}

      {confirmationIsCurrent && selectedCandidate && selectedGroup ? (
        <ConfirmDialog
          isOpen
          title="登録設定で締付値を置き換えますか？"
          description={`現在の入力済み3値と単位を、${candidateLabel(selectedCandidate)}へ一括置換します。適用元: ${candidateProfileLabel(selectedCandidate)}`}
          confirmLabel="登録設定を取り込む"
          cancelLabel="キャンセル"
          onConfirm={() => applyCandidate(selectedCandidate, selectedGroup)}
          onCancel={() => {
            setConfirmation(null);
            setSelectedCandidateKey(null);
          }}
        />
      ) : null}
    </>
  );
}
