export const ORDER_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const COLOR_PALETTE = [
  { border: 'border-red-400', bgStrong: 'bg-red-400', bgSoft: 'bg-red-400/15', text: 'text-red-100' },
  { border: 'border-orange-400', bgStrong: 'bg-orange-400', bgSoft: 'bg-orange-400/15', text: 'text-orange-100' },
  { border: 'border-amber-400', bgStrong: 'bg-amber-400', bgSoft: 'bg-amber-400/15', text: 'text-amber-100' },
  { border: 'border-lime-400', bgStrong: 'bg-lime-400', bgSoft: 'bg-lime-400/15', text: 'text-lime-100' },
  { border: 'border-emerald-400', bgStrong: 'bg-emerald-400', bgSoft: 'bg-emerald-400/15', text: 'text-emerald-100' },
  { border: 'border-teal-400', bgStrong: 'bg-teal-400', bgSoft: 'bg-teal-400/15', text: 'text-teal-100' },
  { border: 'border-cyan-400', bgStrong: 'bg-cyan-400', bgSoft: 'bg-cyan-400/15', text: 'text-cyan-100' },
  { border: 'border-sky-400', bgStrong: 'bg-sky-400', bgSoft: 'bg-sky-400/15', text: 'text-sky-100' },
  { border: 'border-blue-400', bgStrong: 'bg-blue-400', bgSoft: 'bg-blue-400/15', text: 'text-blue-100' },
  { border: 'border-indigo-400', bgStrong: 'bg-indigo-400', bgSoft: 'bg-indigo-400/15', text: 'text-indigo-100' },
  { border: 'border-violet-400', bgStrong: 'bg-violet-400', bgSoft: 'bg-violet-400/15', text: 'text-violet-100' },
  { border: 'border-fuchsia-400', bgStrong: 'bg-fuchsia-400', bgSoft: 'bg-fuchsia-400/15', text: 'text-fuchsia-100' },
];

const hashResource = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 2147483647;
  }
  return hash;
};

export const getResourceColorClasses = (resourceCd: string) => {
  if (!resourceCd || resourceCd.trim().length === 0) {
    return {
      border: 'border-white/20',
      bgStrong: 'bg-white/20',
      bgSoft: 'bg-white/10',
      text: 'text-white'
    };
  }
  const index = hashResource(resourceCd) % COLOR_PALETTE.length;
  return COLOR_PALETTE[index];
};
