const DEFAULT_ASSETS_PREFIX = "/vendor/onlyoffice";

let assetsPrefix = DEFAULT_ASSETS_PREFIX;

function normalizePrefix(prefix?: string) {
  const trimmed = (prefix ?? "").trim();
  if (!trimmed) return DEFAULT_ASSETS_PREFIX;
  return trimmed.replace(/\/+$/, "");
}

export function setAssetsPrefix(prefix?: string) {
  assetsPrefix = normalizePrefix(prefix);
}

export function getAssetsPrefix() {
  return assetsPrefix;
}

export function resolveAssetPath(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${assetsPrefix}${normalizedPath}`;
}

