export function procedureEditHeaders(holderToken?: string | null) {
  return { headers: holderToken ? { 'x-procedure-edit-token': holderToken } : {} };
}
