import { signal, onDestroy } from "./signals.js";

let refreshCurrent = async () => { throw new Error("Page refresh is only available after hydration"); };

export function configureRefresh(handler) {
  refreshCurrent = handler;
}

export function pageRefresh() {
  const state = signal({ status: "idle", error: null });
  let controller = null;
  let disposed = false;
  onDestroy(() => { disposed = true; controller?.abort(); });
  return {
    get pending() { return state.get().status === "pending"; },
    get status() { return state.get().status; },
    get error() { return state.get().error; },
    reset() {
      controller?.abort();
      controller = null;
      state.set({ status: "idle", error: null });
    },
    async refresh() {
      if (disposed || controller) return false;
      const active = new AbortController();
      controller = active;
      state.set({ status: "pending", error: null });
      try {
        const applied = await refreshCurrent(active.signal);
        if (disposed || controller !== active) return false;
        state.set({ status: applied ? "success" : "idle", error: null });
        return applied;
      } catch {
        if (!disposed && controller === active) state.set({ status: "error", error: "Page data could not be refreshed. Try again." });
        return false;
      } finally {
        if (controller === active) controller = null;
      }
    },
  };
}