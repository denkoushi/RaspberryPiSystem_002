export function kioskClientStatusColor(temperature: number | null, cpuUsage: number): string {
  if ((temperature !== null && temperature >= 70) || cpuUsage >= 80) return 'bg-inv-red';
  if ((temperature !== null && temperature >= 60) || cpuUsage >= 60) return 'bg-inv-amber';
  return 'bg-inv-green';
}
