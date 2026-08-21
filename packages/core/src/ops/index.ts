/**
 * Recording operations, independent of transport. The dev API serves them over
 * HTTP for the studio page; `@open-recording/mcp` exposes the same functions as
 * MCP tools, so an agent and a person drive one implementation — including one
 * recorder state machine.
 */

export type {
  RecordingMeta,
  RecordingStatus,
  Transcript,
  TranscriptSegment,
} from '../files/store.ts';
export type { RecorderState, RecorderStatus } from '../recorder/hub.ts';
export type { WhisperEnvironment } from '../stt/whisper.ts';
export { formatTimestamp } from '../stt/whisper.ts';
export { type ApiContext, type ApiContextOptions, makeContext, OpsError } from './context.ts';
export {
  type Download,
  type DownloadKind,
  deleteRecording,
  downloadPath,
  listRecordings,
  mediaPath,
  type RecordingSummary,
  readNotes,
  readRecording,
  readSubtitles,
  readTranscript,
  renameRecording,
  searchTranscripts,
  type TranscriptHit,
  type TranscriptView,
  tagRecording,
  writeNotes,
} from './recordings.ts';
export {
  cancelRecording,
  pauseRecording,
  reapAbandoned,
  recorderStatus,
  resumeRecording,
  type StartRecordingOptions,
  startRecording,
  stopRecording,
} from './session.ts';
export {
  editTranscriptSegment,
  type TranscribeOptions,
  type TranscribeResult,
  transcribeEnvironment,
  transcribeRecording,
} from './transcribe.ts';
