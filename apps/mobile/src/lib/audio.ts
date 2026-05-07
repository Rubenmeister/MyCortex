import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

export type RecordingHandle = {
  recording: Audio.Recording;
};

/**
 * Set up audio session + permissions. Call once at app start, or right
 * before the first recording.
 */
export async function ensureAudioReady(): Promise<{ ok: boolean; error?: string }> {
  const perm = await Audio.requestPermissionsAsync();
  if (!perm.granted) return { ok: false, error: 'permission_denied' };
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
  });
  return { ok: true };
}

export async function startRecording(): Promise<RecordingHandle> {
  const { recording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY,
  );
  return { recording };
}

export async function stopRecording(
  handle: RecordingHandle,
): Promise<{ uri: string; mimeType: string; durationMs: number; sizeBytes: number }> {
  await handle.recording.stopAndUnloadAsync();
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

  const uri = handle.recording.getURI();
  if (!uri) throw new Error('recording_uri_null');

  const status = await handle.recording.getStatusAsync();
  const durationMs = status.durationMillis ?? 0;
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  const sizeBytes = info.exists ? (info as { size: number }).size : 0;

  // Prefer the URI's actual extension; default to m4a (Expo's iOS+Android default).
  const ext = uri.split('.').pop()?.toLowerCase() ?? 'm4a';
  const mimeType = ext === 'caf' ? 'audio/x-caf' : `audio/${ext === 'mp4' ? 'm4a' : ext}`;

  return { uri, mimeType, durationMs, sizeBytes };
}

export async function readAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}
