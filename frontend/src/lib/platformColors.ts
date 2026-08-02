export const PLATFORM_COLOR: Record<string, string> = {
  TikTok: 'bg-slate-900',
  Instagram: 'bg-pink-500',
  Facebook: 'bg-blue-600',
  Snapchat: 'bg-yellow-400',
  YouTube: 'bg-red-600',
  Discord: 'bg-indigo-500',
  BeReal: 'bg-slate-700',
  'X (Twitter)': 'bg-slate-900',
}

export const PLATFORM_TEXT_COLOR: Record<string, string> = {
  Snapchat: 'text-slate-900',
}

export const PLATFORM_INITIAL: Record<string, string> = {
  TikTok: 'TK',
  Instagram: 'IG',
  Facebook: 'FB',
  Snapchat: 'SC',
  YouTube: 'YT',
  Discord: 'DC',
  BeReal: 'BR',
  'X (Twitter)': 'XTW',
}

export const DEFAULT_PLATFORM_COLOR = 'bg-slate-700'

export function platformColor(platform: string): string {
  return PLATFORM_COLOR[platform] ?? DEFAULT_PLATFORM_COLOR
}

export function platformTextColor(platform: string): string {
  return PLATFORM_TEXT_COLOR[platform] ?? 'text-white'
}

export function platformInitial(platform: string): string {
  return PLATFORM_INITIAL[platform] ?? platform.slice(0, 2).toUpperCase()
}
