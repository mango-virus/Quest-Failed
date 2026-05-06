// Central pub/sub. All systems and UI communicate through here — never directly.
// This keeps systems decoupled and makes the newspaper, log, auto-pause, and
// replay ghost trivially easy (they're just subscribers).

class EventBusClass {
  constructor() {
    this._listeners = {}
  }

  on(event, callback, context) {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push({ callback, context: context || null })
    return this
  }

  off(event, callback) {
    if (!this._listeners[event]) return this
    this._listeners[event] = this._listeners[event].filter(l => l.callback !== callback)
    return this
  }

  once(event, callback, context) {
    const wrapper = (data) => {
      callback.call(context || null, data)
      this.off(event, wrapper)
    }
    return this.on(event, wrapper)
  }

  emit(event, data) {
    const listeners = this._listeners[event]
    if (!listeners || listeners.length === 0) return this
    // Copy array before iterating so listeners can safely remove themselves.
    // Each callback is isolated — a throw in one subscriber must not abort
    // the rest, otherwise unrelated systems silently break in lockstep.
    for (const { callback, context } of [...listeners]) {
      try {
        callback.call(context, data)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[EventBus] listener for "${event}" threw:`, err)
      }
    }
    return this
  }

  removeAllListeners(event) {
    if (event) {
      delete this._listeners[event]
    } else {
      this._listeners = {}
    }
    return this
  }
}

export const EventBus = new EventBusClass()
