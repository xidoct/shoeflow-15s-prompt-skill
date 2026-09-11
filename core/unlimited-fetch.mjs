import { Agent, fetch } from 'undici';

export const NO_DEADLINE_OPTIONS = Object.freeze({
  headersTimeout: 0, bodyTimeout: 0, connect: Object.freeze({ timeout: 0 })
});

const agent = new Agent(NO_DEADLINE_OPTIONS);
const dispatcher = {
  dispatch(options, handler) {
    // Override Fetch's per-request defaults as well as the Agent's defaults.
    return agent.dispatch({ ...options, headersTimeout: 0, bodyTimeout: 0 }, handler);
  }
};

// No abort timer and no retry wrapper. Real socket/TLS/HTTP failures still surface.
export function unlimitedFetch(url, options = {}) {
  return fetch(url, { ...options, dispatcher });
}
