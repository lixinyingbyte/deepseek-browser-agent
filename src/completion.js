'use strict';

// The mandatory completion token the model must append to a finished task.
const COMPLETE_MARKER = '(complete)';

function hasCompleteMarker(text) {
  if (!text) return false;
  // Accept the marker at the very end of the reply, ignoring trailing
  // whitespace and an optional wrapping line. Case-insensitive.
  return /\(complete\)\s*$/i.test(text.trim());
}

function checkFinalCompletion(content, waitMeta) {
  waitMeta = waitMeta || {};
  var text = (content || '').trim();

  if (!text) return { complete: false, reason: 'empty answer' };
  if (waitMeta.truncated) return { complete: false, reason: 'truncated response' };
  if (waitMeta.stillGenerating) return { complete: false, reason: 'still generating' };

  // Structural guard: an unclosed code fence means the reply was cut off,
  // regardless of whether the marker is present.
  var fence = String.fromCharCode(96, 96, 96);
  if ((text.split(fence).length - 1) % 2 !== 0) {
    return { complete: false, reason: 'unclosed code block' };
  }

  // The explicit completion marker is the primary signal.
  if (hasCompleteMarker(text)) {
    return { complete: true, reason: 'complete marker' };
  }

  return { complete: false, reason: 'missing (complete) marker' };
}

module.exports = { checkFinalCompletion, hasCompleteMarker, COMPLETE_MARKER };
