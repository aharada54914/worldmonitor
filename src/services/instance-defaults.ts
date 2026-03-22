import { getApiBaseUrl, isDesktopRuntime } from './runtime';

export type InstanceThemePreference = 'auto' | 'dark' | 'light';
export type InstanceFontFamily = 'mono' | 'system';
export type InstanceMapProvider = 'auto' | 'pmtiles' | 'openfreemap' | 'carto';
export type InstanceGlobeVisualPreset = 'classic' | 'enhanced';
export type InstanceStreamQuality = 'auto' | 'small' | 'medium' | 'large' | 'hd720';
export type InstanceAlertSensitivity = 'critical-only' | 'critical-and-high';

export interface InstanceDefaults {
  themePreference?: InstanceThemePreference;
  fontFamily?: InstanceFontFamily;
  mapProvider?: InstanceMapProvider;
  mapTheme?: string;
  globeVisualPreset?: InstanceGlobeVisualPreset;
  language?: string;
  streamQuality?: InstanceStreamQuality;
  liveStreamsAlwaysOn?: boolean;
  mapNewsFlash?: boolean;
  headlineMemory?: boolean;
  badgeAnimation?: boolean;
  cloudLlm?: boolean;
  browserModel?: boolean;
  breakingAlertsEnabled?: boolean;
  breakingAlertsSound?: boolean;
  breakingAlertsDesktopNotifications?: boolean;
  breakingAlertsSensitivity?: InstanceAlertSensitivity;
}

type InstanceDefaultsResponse = {
  defaults?: Partial<InstanceDefaults>;
};

const EMPTY_DEFAULTS: InstanceDefaults = {};

const allowedThemePreferences = new Set<InstanceThemePreference>(['auto', 'dark', 'light']);
const allowedFontFamilies = new Set<InstanceFontFamily>(['mono', 'system']);
const allowedMapProviders = new Set<InstanceMapProvider>(['auto', 'pmtiles', 'openfreemap', 'carto']);
const allowedGlobePresets = new Set<InstanceGlobeVisualPreset>(['classic', 'enhanced']);
const allowedStreamQualities = new Set<InstanceStreamQuality>(['auto', 'small', 'medium', 'large', 'hd720']);
const allowedAlertSensitivity = new Set<InstanceAlertSensitivity>(['critical-only', 'critical-and-high']);
const allowedLanguages = new Set([
  'en', 'bg', 'cs', 'fr', 'de', 'el', 'es', 'it', 'pl', 'pt', 'nl', 'sv', 'ru',
  'ar', 'zh', 'ja', 'ko', 'ro', 'tr', 'th', 'vi',
]);

let instanceDefaults: InstanceDefaults = { ...EMPTY_DEFAULTS };
let loadPromise: Promise<void> | null = null;

function getInstanceDefaultsUrl(): string {
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}/api/local-instance-config` : '/api/local-instance-config';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function asThemePreference(value: unknown): InstanceThemePreference | undefined {
  const normalized = asString(value)?.toLowerCase();
  return normalized && allowedThemePreferences.has(normalized as InstanceThemePreference)
    ? normalized as InstanceThemePreference
    : undefined;
}

function asFontFamily(value: unknown): InstanceFontFamily | undefined {
  const normalized = asString(value)?.toLowerCase();
  return normalized && allowedFontFamilies.has(normalized as InstanceFontFamily)
    ? normalized as InstanceFontFamily
    : undefined;
}

function asMapProvider(value: unknown): InstanceMapProvider | undefined {
  const normalized = asString(value)?.toLowerCase();
  return normalized && allowedMapProviders.has(normalized as InstanceMapProvider)
    ? normalized as InstanceMapProvider
    : undefined;
}

function asGlobePreset(value: unknown): InstanceGlobeVisualPreset | undefined {
  const normalized = asString(value)?.toLowerCase();
  return normalized && allowedGlobePresets.has(normalized as InstanceGlobeVisualPreset)
    ? normalized as InstanceGlobeVisualPreset
    : undefined;
}

function asStreamQuality(value: unknown): InstanceStreamQuality | undefined {
  const normalized = asString(value)?.toLowerCase();
  return normalized && allowedStreamQualities.has(normalized as InstanceStreamQuality)
    ? normalized as InstanceStreamQuality
    : undefined;
}

function asAlertSensitivity(value: unknown): InstanceAlertSensitivity | undefined {
  const normalized = asString(value)?.toLowerCase();
  return normalized && allowedAlertSensitivity.has(normalized as InstanceAlertSensitivity)
    ? normalized as InstanceAlertSensitivity
    : undefined;
}

function asLanguage(value: unknown): string | undefined {
  const normalized = asString(value)?.toLowerCase().split('-')[0];
  return normalized && allowedLanguages.has(normalized) ? normalized : undefined;
}

function sanitizeDefaults(raw: Partial<InstanceDefaults> | null | undefined): InstanceDefaults {
  if (!raw) return { ...EMPTY_DEFAULTS };
  const sanitized: InstanceDefaults = {};

  const themePreference = asThemePreference(raw.themePreference);
  if (themePreference) sanitized.themePreference = themePreference;

  const fontFamily = asFontFamily(raw.fontFamily);
  if (fontFamily) sanitized.fontFamily = fontFamily;

  const mapProvider = asMapProvider(raw.mapProvider);
  if (mapProvider) sanitized.mapProvider = mapProvider;

  const mapTheme = asString(raw.mapTheme);
  if (mapTheme) sanitized.mapTheme = mapTheme;

  const globeVisualPreset = asGlobePreset(raw.globeVisualPreset);
  if (globeVisualPreset) sanitized.globeVisualPreset = globeVisualPreset;

  const language = asLanguage(raw.language);
  if (language) sanitized.language = language;

  const streamQuality = asStreamQuality(raw.streamQuality);
  if (streamQuality) sanitized.streamQuality = streamQuality;

  const liveStreamsAlwaysOn = asBoolean(raw.liveStreamsAlwaysOn);
  if (liveStreamsAlwaysOn !== undefined) sanitized.liveStreamsAlwaysOn = liveStreamsAlwaysOn;

  const mapNewsFlash = asBoolean(raw.mapNewsFlash);
  if (mapNewsFlash !== undefined) sanitized.mapNewsFlash = mapNewsFlash;

  const headlineMemory = asBoolean(raw.headlineMemory);
  if (headlineMemory !== undefined) sanitized.headlineMemory = headlineMemory;

  const badgeAnimation = asBoolean(raw.badgeAnimation);
  if (badgeAnimation !== undefined) sanitized.badgeAnimation = badgeAnimation;

  const cloudLlm = asBoolean(raw.cloudLlm);
  if (cloudLlm !== undefined) sanitized.cloudLlm = cloudLlm;

  const browserModel = asBoolean(raw.browserModel);
  if (browserModel !== undefined) sanitized.browserModel = browserModel;

  const breakingAlertsEnabled = asBoolean(raw.breakingAlertsEnabled);
  if (breakingAlertsEnabled !== undefined) sanitized.breakingAlertsEnabled = breakingAlertsEnabled;

  const breakingAlertsSound = asBoolean(raw.breakingAlertsSound);
  if (breakingAlertsSound !== undefined) sanitized.breakingAlertsSound = breakingAlertsSound;

  const breakingAlertsDesktopNotifications = asBoolean(raw.breakingAlertsDesktopNotifications);
  if (breakingAlertsDesktopNotifications !== undefined) {
    sanitized.breakingAlertsDesktopNotifications = breakingAlertsDesktopNotifications;
  }

  const breakingAlertsSensitivity = asAlertSensitivity(raw.breakingAlertsSensitivity);
  if (breakingAlertsSensitivity) sanitized.breakingAlertsSensitivity = breakingAlertsSensitivity;

  return sanitized;
}

function seedLanguageDefault(defaults: InstanceDefaults): void {
  if (typeof window === 'undefined' || !defaults.language) return;
  try {
    if (!localStorage.getItem('i18nextLng')) {
      localStorage.setItem('i18nextLng', defaults.language);
    }
  } catch {
    // ignore
  }
}

export function seedInstanceDefaults(raw: Partial<InstanceDefaults> | null | undefined): void {
  instanceDefaults = sanitizeDefaults(raw);
  seedLanguageDefault(instanceDefaults);
}

export function getInstanceDefaults(): InstanceDefaults {
  return { ...instanceDefaults };
}

export async function loadInstanceDefaults(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const response = await fetch(getInstanceDefaultsUrl(), {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;
      const payload = await response.json() as InstanceDefaultsResponse;
      seedInstanceDefaults(payload.defaults);
    } catch {
      if (!isDesktopRuntime()) {
        seedInstanceDefaults(null);
      }
    }
  })();

  await loadPromise;
}
