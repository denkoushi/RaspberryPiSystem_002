export function parsePartCandidateId(candidateId: string): {
  fseiban: string;
  productNo: string;
  fhincd: string;
} {
  const [fseiban = '', productNo = '', fhincd = ''] = candidateId.split('\u001f');
  return { fseiban, productNo, fhincd };
}
