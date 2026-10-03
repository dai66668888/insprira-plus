// ============= LocalStorage 封装 =============
export const LS = {
  get(key, def) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? def;
    } catch {
      return def;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.warn('localStorage set failed:', e.message);
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

// ============= 最小状态管理 =============
class AppState {
  constructor() {
    this._state = new Map();
    this._listeners = new Map();
  }

  get(key, def) {
    if (this._state.has(key)) return this._state.get(key);
    return def;
  }

  set(key, value) {
    this._state.set(key, value);
    this._notify(key, value);
  }

  update(key, updater, def) {
    const current = this.get(key, def);
    const next = typeof updater === 'function' ? updater(current) : updater;
    this.set(key, next);
    return next;
  }

  subscribe(key, callback) {
    if (!this._listeners.has(key)) this._listeners.set(key, new Set());
    this._listeners.get(key).add(callback);
    return () => this._listeners.get(key).delete(callback);
  }

  _notify(key, value) {
    const listeners = this._listeners.get(key);
    if (!listeners) return;
    listeners.forEach(cb => {
      try { cb(value, key); } catch (e) { console.error('State listener error:', e); }
    });
  }
}

export const state = new AppState();

export let currentPage = 'dashboard';
export function setCurrentPage(page) { currentPage = page; }

// ============= Tracker 排序 =============
export function getSortedTrackers() {
  const trackers = LS.get('trackers', []);
  const order = LS.get('trackerOrder', []);
  if (!order.length) return trackers;
  const orderMap = new Map(order.map((id, i) => [String(id), i]));
  return [...trackers].sort((a, b) => {
    const ia = orderMap.get(String(a.id));
    const ib = orderMap.get(String(b.id));
    const va = ia == null ? Number.MAX_SAFE_INTEGER : ia;
    const vb = ib == null ? Number.MAX_SAFE_INTEGER : ib;
    return va - vb;
  });
}

export function setTrackerOrder(ids) {
  LS.set('trackerOrder', ids.map(String));
}
