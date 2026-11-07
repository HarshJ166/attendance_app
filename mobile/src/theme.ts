// Tokens from ../../DESIGN.md. Change them there first.
export const color = {
  present: '#0B6B4B',
  presentPressed: '#08533A',
  presentTint: '#E3F1EA',
  ink: '#15201B',
  muted: '#52615A',
  mutedTint: '#EEF1EF',
  bg: '#F7F8F6',
  surface: '#FFFFFF',
  line: '#D9E0DC',
  warn: '#8A4B00',
  warnTint: '#FFF1D6',
  danger: '#B3261E',
  dangerTint: '#FDE7E5',
} as const;

export const font = {
  display: 'AnekLatin_600SemiBold',
  displayBold: 'AnekLatin_700Bold',
  body: 'SourceSans3_400Regular',
  bodyBold: 'SourceSans3_600SemiBold',
} as const;

export const size = { body: 18, small: 16, button: 20, status: 32, time: 44, title: 28 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = 12;
