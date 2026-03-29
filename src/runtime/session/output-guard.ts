export type OutputGuardDecision = {
  shouldSuppressLeadingNarration: boolean;
  cleanedText: string;
  suppressedPrefix: string;
};

export type StreamingOutputGuardResult = {
  emitText: string;
  suppressedText: string;
};

export type StreamingOutputGuard = {
  push(delta: string): StreamingOutputGuardResult;
  finish(): StreamingOutputGuardResult;
};

const STRONG_NARRATION_PATTERNS = [
  /\blet me review\b/i,
  /\blet me look\b/i,
  /\blet me inspect\b/i,
  /\bnow let me\b/i,
  /\bi can see there'?s already\b/i,
  /\blook at the source files\b/i,
  /\bcomplete picture before\b/i,
  /\bupdating agents\.md\b/i,
] as const;

const LEADING_BUFFER_RELEASE_CHARS = 240;
const MAX_SUPPRESSION_BUFFER_CHARS = 400;

function normalizeGuardText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function looksLikeInternalNarrationStart(text: string): boolean {
  const normalized = normalizeGuardText(text).slice(0, MAX_SUPPRESSION_BUFFER_CHARS);
  const matchCount = STRONG_NARRATION_PATTERNS.filter((pattern) => pattern.test(normalized)).length;
  const mentionsRepoInspection =
    /\b(workspace|codebase|source files|runtime files|agents\.md)\b/i.test(normalized);

  return matchCount >= 2 || (matchCount >= 1 && mentionsRepoInspection);
}

function looksLikeNarrationContinuation(text: string): boolean {
  const normalized = normalizeGuardText(text).slice(0, 160);

  return /^(?:let me|now let me|i can see there'?s already)\b/i.test(normalized) ||
    /^(?:first|next|then)[,:]?\s+(?:i(?:['’]?ll| will)|let me)\b/i.test(normalized) ||
    /^i(?:['’]?ll| will)\s+(?:compare|check|look|review|inspect|analy[sz]e|examine|read|scan|walk|start|open|update|go)\b/i.test(normalized);
}

function findNarrationSplitIndex(text: string): number {
  const boundaryPattern = /[.!?:](?:\s+|$)/g;

  for (const match of text.matchAll(boundaryPattern)) {
    const splitIndex = match.index! + match[0].length;
    const candidatePrefix = text.slice(0, splitIndex).trim();
    const candidateSuffix = text.slice(splitIndex).trimStart();

    if (
      candidateSuffix &&
      looksLikeInternalNarrationStart(candidatePrefix) &&
      !looksLikeNarrationContinuation(candidateSuffix)
    ) {
      return splitIndex;
    }
  }

  return -1;
}

export function cleanOutputText(text: string): OutputGuardDecision {
  if (!text.trim()) {
    return {
      shouldSuppressLeadingNarration: false,
      cleanedText: text,
      suppressedPrefix: "",
    };
  }

  const splitIndex = findNarrationSplitIndex(text);
  const candidatePrefix = splitIndex === -1 ? text.trim() : text.slice(0, splitIndex).trim();

  if (!looksLikeInternalNarrationStart(candidatePrefix)) {
    return {
      shouldSuppressLeadingNarration: false,
      cleanedText: text,
      suppressedPrefix: "",
    };
  }

  if (splitIndex === -1) {
    const firstBoundaryMatch = text.match(/[.!?:](?:\s+|$)/);
    if (firstBoundaryMatch?.index !== undefined) {
      const fallbackSplitIndex = firstBoundaryMatch.index + firstBoundaryMatch[0].length;
      const fallbackSuffix = text.slice(fallbackSplitIndex).trimStart();

      if (fallbackSuffix && !looksLikeNarrationContinuation(fallbackSuffix)) {
        return {
          shouldSuppressLeadingNarration: true,
          cleanedText: fallbackSuffix,
          suppressedPrefix: text.slice(0, fallbackSplitIndex).trim(),
        };
      }
    }
  }

  return {
    shouldSuppressLeadingNarration: true,
    cleanedText: splitIndex === -1 ? "" : text.slice(splitIndex).trimStart(),
    suppressedPrefix: candidatePrefix,
  };
}

export function createOutputGuard(): StreamingOutputGuard {
  let leadingBuffer = "";
  let released = false;
  let suppressing = false;

  return {
    push(delta) {
      if (released) {
        return { emitText: delta, suppressedText: "" };
      }

      leadingBuffer += delta;

      if (!suppressing && looksLikeInternalNarrationStart(leadingBuffer)) {
        suppressing = true;
      }

      if (
        !suppressing &&
        leadingBuffer.length < LEADING_BUFFER_RELEASE_CHARS &&
        !/[.!?:]\s/.test(leadingBuffer)
      ) {
        return { emitText: "", suppressedText: "" };
      }

      if (suppressing) {
        const decision = cleanOutputText(leadingBuffer);
        if (!decision.cleanedText && leadingBuffer.length < MAX_SUPPRESSION_BUFFER_CHARS) {
          return { emitText: "", suppressedText: "" };
        }

        released = true;
        leadingBuffer = "";
        return {
          emitText: decision.cleanedText,
          suppressedText: decision.suppressedPrefix,
        };
      }

      released = true;
      const emitText = leadingBuffer;
      leadingBuffer = "";
      return { emitText, suppressedText: "" };
    },

    finish() {
      if (released || !leadingBuffer) {
        return { emitText: "", suppressedText: "" };
      }

      released = true;
      const decision = cleanOutputText(leadingBuffer);
      leadingBuffer = "";
      return {
        emitText: decision.cleanedText,
        suppressedText: decision.suppressedPrefix,
      };
    },
  };
}
