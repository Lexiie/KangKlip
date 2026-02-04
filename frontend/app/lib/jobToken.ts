export const buildJobTokenKey = (jobId: string) => `kk:job_token:${jobId}`;

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
