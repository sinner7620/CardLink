import { SavedStroke } from '../types';

/**
 * Serialize stroke array to JSON string
 */
export function serializeStrokes(strokes: SavedStroke[]): string {
  return JSON.stringify({
    version: '1.0.0',
    generator: 'goodnotes-ink',
    timestamp: Date.now(),
    strokeCount: strokes.length,
    strokes
  }, null, 2);
}

/**
 * Deserialize strokes from JSON string
 */
export function deserializeStrokes(jsonStr: string): SavedStroke[] {
  try {
    const data = JSON.parse(jsonStr);
    if (Array.isArray(data)) {
      return data;
    }
    if (data && Array.isArray(data.strokes)) {
      return data.strokes;
    }
    return [];
  } catch (err) {
    console.error('[goodnotes-ink] Failed to parse JSON strokes:', err);
    return [];
  }
}
