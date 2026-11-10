export function isAcceptedVerdict(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  // Filter out LeetCode metadata / stats such as "Accepted 5.4M", "Accepted Solutions", "Accepted (52%)"
  if (/\b(?:Solutions|Rate|Submissions|\d+(?:\.\d+)?[KMkm])\b/i.test(trimmed)) {
    return false;
  }
  // Must be strictly "Accepted", or "Accepted" followed by metrics / testcases (e.g. "Accepted\nRuntime...", "Accepted (15/15 testcases passed)")
  return /^Accepted(?:\s*$|\s*(?:\n|\r|\bat\b|Runtime|Memory|Beats|\(?\d+\s*\/\s*\d+))/i.test(trimmed);
}

export function isFailedVerdict(text) {
  return /\b(?:Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Compilation Error|Compile Error|Runtime Error|Output Limit Exceeded|Internal Error)\b/i.test(text || '');
}

export function parseLeetCodePerformance(text) {
  const runtime = text?.match(/\bRuntime\s*:\s*(\d+(?:\.\d+)?)\s*ms\b/i)?.[1];
  const memory = text?.match(/\bMemory\s*:\s*(\d+(?:\.\d+)?)\s*MB\b/i)?.[1];
  return {
    runtimeMs: runtime == null ? null : Math.round(Number(runtime)),
    memoryMb: memory == null ? null : Number(memory)
  };
}

export function isFreshAcceptedResult({ accepted, resultText, previousResultText, sawResultChange = false }) {
  // A new submission link can appear before LeetCode replaces the previous
  // result panel. Require an observed transition into Accepted; the ID is
  // useful for deduplication, but is not evidence of the displayed verdict.
  if (!accepted || !sawResultChange) return false;
  return !isAcceptedVerdict(previousResultText) && isAcceptedVerdict(resultText);
}
