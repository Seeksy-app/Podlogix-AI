-- Long episodes exceed Whisper's 25MB per-request cap and are transcribed in
-- parts. A single serverless invocation can't always finish them within its
-- time limit, so record how many parts are done and resume there next call.
ALTER TABLE subscription_episodes
  ADD COLUMN IF NOT EXISTS transcript_parts_done integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transcript_parts_total integer;
