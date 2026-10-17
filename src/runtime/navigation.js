import { signal } from "./signals.js";

const navigationState = signal(null);

export function _setNavigation(value) {
  navigationState.set(value);
}

export function pageNavigation() {
  return {
    get pending() { return navigationState.get() !== null; },
    get from() { return navigationState.get()?.from ?? null; },
    get to() { return navigationState.get()?.to ?? null; },
  };
}