import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyTorqueWrenchSettingAssistant } from './AssemblyTorqueWrenchSettingAssistant';

import type { AssemblyDraftBolt } from './assemblyTemplateDraft';
import type {
  TorqueWrenchCapabilityGroupApi,
  TorqueWrenchModelApi,
  TorqueWrenchProfileApi,
  TorqueWrenchSettingApi
} from '../../api/domains/torque-wrenches';

function makeModel(overrides: Partial<TorqueWrenchModelApi> = {}): TorqueWrenchModelApi {
  return {
    id: 'model-1',
    manufacturer: 'ACME',
    modelNumber: 'TW-100',
    torqueMinNm: '10',
    torqueMaxNm: '200',
    resolutionNm: '0.1',
    communicationType: 'USB',
    outputProfile: null,
    settingVerificationMode: 'REGISTERED_SETTING',
    isActive: true,
    ...overrides
  };
}

function makeSetting(overrides: Partial<TorqueWrenchSettingApi> = {}): TorqueWrenchSettingApi {
  return {
    id: 'setting-1',
    lowerLimit: '81.25',
    nominalTorque: '90.25',
    upperLimit: '99.25',
    unit: 'N·m',
    lowerLimitNm: '81.25',
    nominalTorqueNm: '90.25',
    upperLimitNm: '99.25',
    effectiveAt: '2026-09-03T01:02:03.000Z',
    reason: null,
    ...overrides
  };
}

function makeProfile(
  model: TorqueWrenchModelApi,
  overrides: Partial<TorqueWrenchProfileApi> = {}
): TorqueWrenchProfileApi {
  return {
    id: `profile-${model.id}`,
    modelId: model.id,
    serialNumber: `SN-${model.id}`,
    measuringInstrument: {
      id: `instrument-${model.id}`,
      name: 'トルクレンチ',
      managementNumber: `MG-${model.id}`,
      storageLocation: null,
      calibrationExpiryDate: null,
      status: 'AVAILABLE'
    },
    model,
    settingHistories: [makeSetting()],
    ...overrides
  };
}

function makeGroup(models: TorqueWrenchModelApi[]): TorqueWrenchCapabilityGroupApi {
  return {
    id: 'group-1',
    name: 'M6 標準',
    nominalDiameter: 'M6',
    boltLengthMm: '30',
    material: 'SCM435',
    strengthClass: '10.9',
    isActive: true,
    models: models.map((model) => ({ modelId: model.id, model }))
  };
}

function makeBolt(overrides: Partial<AssemblyDraftBolt> = {}): AssemblyDraftBolt {
  return {
    id: 'bolt-1',
    sortOrder: 0,
    tighteningId: '',
    markerNo: 1,
    xRatio: 0.1,
    yRatio: 0.1,
    calloutTipXRatio: null,
    calloutTipYRatio: null,
    boltSpecMode: 'auto',
    boltSpecCustom: '',
    nominalDiameter: '',
    boltLengthMm: null,
    material: '',
    strengthClass: '',
    capabilityGroupId: null,
    nominalTorque: null,
    lowerLimit: null,
    upperLimit: null,
    unit: '',
    ...overrides
  };
}

function AssistantHarness({
  initialBolt = makeBolt(),
  capabilityGroups,
  profiles,
  profilesStatus = 'ready',
  onPatch
}: {
  initialBolt?: AssemblyDraftBolt;
  capabilityGroups: TorqueWrenchCapabilityGroupApi[];
  profiles: TorqueWrenchProfileApi[];
  profilesStatus?: 'loading' | 'ready' | 'error';
  onPatch: (boltId: string, patch: Partial<AssemblyDraftBolt>) => void;
}) {
  const [bolt, setBolt] = useState(initialBolt);
  return (
    <AssemblyTorqueWrenchSettingAssistant
      bolt={bolt}
      capabilityGroups={capabilityGroups}
      capabilityCatalogStatus="ready"
      torqueWrenchProfiles={profiles}
      torqueWrenchProfilesStatus={profilesStatus}
      disabled={false}
      onPatch={(boltId, patch) => {
        onPatch(boltId, patch);
        setBolt((current) => ({ ...current, ...patch }));
      }}
      onRetryCapabilityCatalog={vi.fn()}
      onRetryTorqueWrenchProfiles={vi.fn()}
    />
  );
}

function selectGroupByName(name: string) {
  fireEvent.click(screen.getByRole('button', { name: '適合トルクレンチグループを検索の候補を表示' }));
  fireEvent.click(screen.getByRole('option', { name: new RegExp(name) }));
}

function selectGroup() {
  selectGroupByName('M6 標準');
}

describe('AssemblyTorqueWrenchSettingAssistant', () => {
  it('fills all three blank numbers and unit once after an explicit group selection', () => {
    const model = makeModel();
    const onPatch = vi.fn();
    render(
      <AssistantHarness
        capabilityGroups={[makeGroup([model])]}
        profiles={[makeProfile(model)]}
        onPatch={onPatch}
      />
    );

    selectGroup();

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith('bolt-1', {
      capabilityGroupId: 'group-1',
      nominalDiameter: 'M6',
      boltLengthMm: 30,
      material: 'SCM435',
      strengthClass: '10.9',
      lowerLimit: 81.25,
      nominalTorque: 90.25,
      upperLimit: 99.25,
      unit: 'N·m'
    });
  });

  it('asks before replacing any existing or partially entered torque values', () => {
    const model = makeModel();
    const onPatch = vi.fn();
    render(
      <AssistantHarness
        initialBolt={makeBolt({
          lowerLimit: 80,
          unit: 'N·m',
          boltSpecMode: 'custom',
          boltSpecCustom: '利用者指定のボルト仕様'
        })}
        capabilityGroups={[makeGroup([model])]}
        profiles={[makeProfile(model)]}
        onPatch={onPatch}
      />
    );

    selectGroup();

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: '登録設定で締付値を置き換えますか？' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onPatch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /下限 81\.25.*規定 90\.25.*上限 99\.25.*単位:? N·m/ }));
    fireEvent.click(screen.getByRole('button', { name: '登録設定を取り込む' }));
    expect(onPatch).toHaveBeenLastCalledWith('bolt-1', {
      lowerLimit: 81.25,
      nominalTorque: 90.25,
      upperLimit: 99.25,
      unit: 'N·m'
    });
  });

  it('requires review when a matching profile has no registered setting, even with one registered candidate', () => {
    const model = makeModel();
    const onPatch = vi.fn();
    render(
      <AssistantHarness
        capabilityGroups={[makeGroup([model])]}
        profiles={[
          makeProfile(model, { id: 'profile-registered', serialNumber: 'SN-REGISTERED' }),
          makeProfile(model, { id: 'profile-unregistered', serialNumber: 'SN-UNREGISTERED', settingHistories: [] })
        ]}
        onPatch={onPatch}
      />
    );

    selectGroup();

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/設定未登録/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下限 81\.25.*規定 90\.25.*上限 99\.25.*単位:? N·m/ })).toBeInTheDocument();
    expect(onPatch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /下限 81\.25.*規定 90\.25.*上限 99\.25.*単位:? N·m/ }));
    expect(onPatch).toHaveBeenCalledTimes(2);
    expect(onPatch).toHaveBeenLastCalledWith('bolt-1', expect.objectContaining({
      lowerLimit: 81.25,
      nominalTorque: 90.25,
      upperLimit: 99.25,
      unit: 'N·m'
    }));
  });

  it('uses the newly selected group for first-fill when switching groups', () => {
    const firstModel = makeModel();
    const secondModel = makeModel({ id: 'model-2', modelNumber: 'TW-200' });
    const secondGroup = {
      ...makeGroup([secondModel]),
      id: 'group-2',
      name: 'M8 標準',
      nominalDiameter: 'M8'
    };
    const onPatch = vi.fn();
    render(
      <AssistantHarness
        capabilityGroups={[makeGroup([firstModel]), secondGroup]}
        profiles={[
          makeProfile(firstModel),
          makeProfile(secondModel, {
            id: 'profile-second',
            serialNumber: 'SN-SECOND',
            settingHistories: [makeSetting({ lowerLimit: '101', nominalTorque: '110', upperLimit: '119' })]
          })
        ]}
        onPatch={onPatch}
      />
    );

    selectGroupByName('M8 標準');

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith('bolt-1', {
      capabilityGroupId: 'group-2',
      nominalDiameter: 'M8',
      boltLengthMm: 30,
      material: 'SCM435',
      strengthClass: '10.9',
      lowerLimit: 101,
      nominalTorque: 110,
      upperLimit: 119,
      unit: 'N·m'
    });
  });

  it('shows multiple setting types for explicit selection and imports only torque fields', () => {
    const model = makeModel();
    const onPatch = vi.fn();
    render(
      <AssistantHarness
        capabilityGroups={[makeGroup([model])]}
        profiles={[
          makeProfile(model, { id: 'profile-first', serialNumber: 'SN-FIRST' }),
          makeProfile(model, {
            id: 'profile-second',
            serialNumber: 'SN-SECOND',
            settingHistories: [makeSetting({
              id: 'setting-second',
              lowerLimit: '70',
              nominalTorque: '80',
              upperLimit: '90'
            })]
          })
        ]}
        onPatch={onPatch}
      />
    );

    selectGroup();
    expect(screen.getAllByRole('button', { name: /下限 .*規定 .*上限 .*単位:? N·m/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /下限 70.*規定 80.*上限 90.*単位:? N·m/ }));

    expect(onPatch).toHaveBeenCalledTimes(2);
    expect(onPatch).toHaveBeenLastCalledWith('bolt-1', {
      lowerLimit: 70,
      nominalTorque: 80,
      upperLimit: 90,
      unit: 'N·m'
    });
  });

  it('does not apply a candidate on initial load or profile catalog refresh', () => {
    const model = makeModel();
    const onPatch = vi.fn();
    const bolt = makeBolt({ capabilityGroupId: 'group-1' });
    const props = {
      bolt,
      capabilityGroups: [makeGroup([model])],
      capabilityCatalogStatus: 'ready' as const,
      torqueWrenchProfiles: [makeProfile(model)],
      disabled: false,
      onPatch,
      onRetryCapabilityCatalog: vi.fn(),
      onRetryTorqueWrenchProfiles: vi.fn()
    };
    const view = render(
      <AssemblyTorqueWrenchSettingAssistant
        {...props}
        torqueWrenchProfilesStatus="loading"
      />
    );

    expect(onPatch).not.toHaveBeenCalled();
    view.rerender(<AssemblyTorqueWrenchSettingAssistant {...props} torqueWrenchProfilesStatus="ready" />);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('drops an old replacement confirmation when the bolt group changes', () => {
    const firstModel = makeModel();
    const secondModel = makeModel({ id: 'model-2', modelNumber: 'TW-200' });
    const firstGroup = makeGroup([firstModel]);
    const secondGroup = {
      ...makeGroup([secondModel]),
      id: 'group-2',
      name: 'M8 標準',
      nominalDiameter: 'M8'
    };
    const onPatch = vi.fn();
    const firstBolt = makeBolt({
      capabilityGroupId: firstGroup.id,
      nominalDiameter: 'M6',
      boltLengthMm: 30,
      material: 'SCM435',
      strengthClass: '10.9',
      lowerLimit: 80,
      nominalTorque: 90,
      upperLimit: 100,
      unit: 'N·m'
    });
    const props = {
      bolt: firstBolt,
      capabilityGroups: [firstGroup, secondGroup],
      capabilityCatalogStatus: 'ready' as const,
      torqueWrenchProfiles: [makeProfile(firstModel)],
      torqueWrenchProfilesStatus: 'ready' as const,
      disabled: false,
      onPatch,
      onRetryCapabilityCatalog: vi.fn(),
      onRetryTorqueWrenchProfiles: vi.fn()
    };
    const view = render(<AssemblyTorqueWrenchSettingAssistant {...props} />);

    selectGroupByName('M6 標準');
    expect(screen.getByRole('dialog', { name: '登録設定で締付値を置き換えますか？' })).toBeInTheDocument();

    view.rerender(
      <AssemblyTorqueWrenchSettingAssistant
        {...props}
        bolt={{ ...firstBolt, capabilityGroupId: secondGroup.id, nominalDiameter: 'M8' }}
        torqueWrenchProfiles={[makeProfile(secondModel, { id: 'profile-second' })]}
      />
    );

    expect(screen.queryByRole('dialog', { name: '登録設定で締付値を置き換えますか？' })).not.toBeInTheDocument();
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it('keeps manual torque values when profile retrieval fails after group selection', () => {
    const model = makeModel();
    const onPatch = vi.fn();
    render(
      <AssistantHarness
        initialBolt={makeBolt({ lowerLimit: 80, nominalTorque: 90, upperLimit: 100, unit: 'N·m' })}
        capabilityGroups={[makeGroup([model])]}
        profiles={[]}
        profilesStatus="error"
        onPatch={onPatch}
      />
    );

    selectGroup();

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith('bolt-1', {
      capabilityGroupId: 'group-1',
      nominalDiameter: 'M6',
      boltLengthMm: 30,
      material: 'SCM435',
      strengthClass: '10.9'
    });
    expect(screen.getByText('登録設定を取得できませんでした。')).toBeInTheDocument();
  });
});
