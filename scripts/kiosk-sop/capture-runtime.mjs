export const generatorVersion = '1.2.0';

export const chromiumLaunchOptions = Object.freeze({
  headless: true,
  args: Object.freeze([
    '--disable-gpu',
    '--disable-skia-runtime-opts',
    '--disable-lcd-text',
    '--disable-font-subpixel-positioning',
    '--font-render-hinting=none',
    '--force-color-profile=srgb'
  ])
});
