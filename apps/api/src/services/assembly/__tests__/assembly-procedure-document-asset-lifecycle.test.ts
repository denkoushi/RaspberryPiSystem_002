import { describe, expect, it } from 'vitest';

import {
  collectAssemblyProcedureAssetIds,
  findConflictingAssemblyProcedureAssetLease,
  type AssemblyProcedureAssetLease
} from '../assembly-procedure-document-asset-lifecycle.js';

function leasedAsset(
  id: string,
  ownerDocumentId: string | null,
  ownerDocument: AssemblyProcedureAssetLease['ownerDocument']
): AssemblyProcedureAssetLease {
  return { id, ownerDocumentId, ownerDocument };
}

describe('assembly procedure document asset lifecycle', () => {
  it('includes owned upload-only assets when building GC candidates', () => {
    expect(collectAssemblyProcedureAssetIds({
      sourceAssetId: 'source',
      overlayAssetIds: ['overlay', null, 'source'],
      ownedAssetIds: ['pending', 'overlay', undefined]
    })).toEqual(['source', 'overlay', 'pending']);
  });

  it('rejects only a lease held by another active DRAFT', () => {
    expect(findConflictingAssemblyProcedureAssetLease('draft-a', [
      leasedAsset('same-owner', 'draft-a', { id: 'draft-a', status: 'DRAFT', isActive: true }),
      leasedAsset('unowned', null, null),
      leasedAsset('old-draft', 'draft-b', { id: 'draft-b', status: 'DRAFT', isActive: false }),
      leasedAsset('published-owner', 'published-b', { id: 'published-b', status: 'PUBLISHED', isActive: true })
    ])).toBeNull();

    expect(findConflictingAssemblyProcedureAssetLease('draft-a', [
      leasedAsset('conflict', 'draft-b', { id: 'draft-b', status: 'DRAFT', isActive: true })
    ])).toMatchObject({ id: 'conflict', ownerDocumentId: 'draft-b' });
  });
});
