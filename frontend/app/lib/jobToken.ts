// Build the storage key for a job token.
export const buildJobTokenKey = (jobId: string) => `kk:job_token:${jobId}`;

// Persist a job token safely in localStorage when available.
export const storeJobToken = (jobId: string, token: string) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(buildJobTokenKey(jobId), token);
  } catch {
    // Ignore storage failures; navigation should still work.
  }
};

// Read a stored job token safely from localStorage.
export const readJobToken = (jobId: string) => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(buildJobTokenKey(jobId));
  } catch {
    return null;
  }
};
