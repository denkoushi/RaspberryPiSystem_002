import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Kiosk inventory screens (在庫操作 / 在庫の準備): one dark palette, three signal colours.
        inv: {
          bg: '#090d14',
          s1: '#10161f',
          s2: '#161e2b',
          s3: '#1e2839',
          line: '#263145',
          line2: '#324059',
          text: '#eef2f8',
          muted: '#9aa7ba',
          faint: '#76839a',
          cyan: '#39d0f0',
          'cyan-ink': '#032a33',
          amber: '#f5b544',
          'amber-ink': '#2e1d00',
          green: '#35d895',
          'green-ink': '#03281a',
          red: '#ff6e6e',
        },
      },
    }
  },
  plugins: []
} satisfies Config;
