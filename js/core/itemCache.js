const _itemCache = new Map();
const CACHE_LIMIT = 1000;
let _handlers = {};

function setCache(key, value) {
  if (_itemCache.has(key)) _itemCache.delete(key);
  _itemCache.set(key, value);
  while (_itemCache.size > CACHE_LIMIT) {
    const oldest = _itemCache.keys().next().value;
    _itemCache.delete(oldest);
  }
}

export function cacheItem(item) {
  if (!item || !item.plat || !item.workId) return '';
  const key = `${item.plat}:${item.workId}`;
  setCache(key, item);
  return key;
}

export function cacheKbEntry(entry, index) {
  const key = `kb:${index}`;
  setCache(key, entry);
  return key;
}

export function registerItemCacheHandlers(handlers) {
  _handlers = handlers;
}

export function addToLibraryByKey(key) {
  const item = _itemCache.get(key);
  if (item && _handlers.addToLibrary) _handlers.addToLibrary(item);
}

export function sendToCreatorByKey(key) {
  const item = _itemCache.get(key);
  if (item && _handlers.sendToCreator) _handlers.sendToCreator(item);
}

export function sendKbToCreatorByKey(key) {
  const entry = _itemCache.get(key);
  if (entry && _handlers.sendKbToCreator) _handlers.sendKbToCreator(entry);
}
