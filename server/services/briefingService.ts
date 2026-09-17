import OpenAI from 'openai';
import { storage } from '../storage';
import { chargeCredits } from './credits';
import type { SubscriptionEpisode, UserInterest, InsertEpisodeBriefing } from '@shared/schema';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "sk-not-configured",
});

interface BriefingContent {
  summary: string;
  keyTakeaways: string[];
  relevantQuotes: string[];
  personalInsights: string[];
  matchedInterests: string[];
  relevanceScore: number;
}

export async function generateBriefing(
  episode: SubscriptionEpisode,
  userInterests: UserInterest[],
  transcript: string
): Promise<BriefingContent> {
  const interestTopics = userInterests
    .filter(i => i.isActive)
    .map(i => ({
      topic: i.topic,
      keywords: i.keywords || [],
      priority: i.priority,
    }));

  const prompt = `You are an expert podcast analyst. Analyze this podcast episode transcript and create a personalized briefing for the user.

USER'S INTERESTS (topics they want to track):
${interestTopics.map(i => `- ${i.topic} (${i.priority} priority): Keywords: ${i.keywords.join(', ')}`).join('\n')}

EPISODE: "${episode.title}"
TRANSCRIPT:
${transcript.slice(0, 15000)} ${transcript.length > 15000 ? '...[truncated]' : ''}

Create a briefing with:
1. SUMMARY: A concise 2-3 paragraph summary of the episode's main points
2. KEY_TAKEAWAYS: 5-7 bullet points of the most important insights (no timestamps)
3. RELEVANT_QUOTES: 3-5 notable direct quotes from the speakers that are insightful or memorable
4. PERSONAL_INSIGHTS: 3-5 insights specifically relevant to the user's interests listed above
5. MATCHED_INTERESTS: List which of the user's interest topics were discussed in this episode
6. RELEVANCE_SCORE: A score from 0-100 indicating how relevant this episode is to the user's interests

Respond in this exact JSON format:
{
  "summary": "...",
  "keyTakeaways": ["...", "..."],
  "relevantQuotes": ["...", "..."],
  "personalInsights": ["...", "..."],
  "matchedInterests": ["...", "..."],
  "relevanceScore": 85
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const parsed = JSON.parse(content) as BriefingContent;
    return parsed;
  } catch (error) {
    console.error('Error generating briefing:', error);
    throw error;
  }
}

export async function processEpisodeBriefing(episodeId: string, userId: string): Promise<void> {
  try {
    const episode = await storage.getSubscriptionEpisode(episodeId);
    if (!episode || episode.userId !== userId) {
      throw new Error('Episode not found');
    }

    if (!episode.transcript) {
      throw new Error('Episode has no transcript');
    }

    // Update status to processing
    await storage.updateSubscriptionEpisode(episodeId, { briefingStatus: 'processing' });

    // Get user interests
    const userInterests = await storage.getUserInterests(userId);

    // Generate briefing
    const briefingContent = await generateBriefing(episode, userInterests, episode.transcript);
    await chargeCredits(episode.userId, 'briefing', { label: episode.title, resourceType: 'episode', resourceId: episodeId });

    // Save briefing
    await storage.createEpisodeBriefing({
      episodeId,
      userId,
      summary: briefingContent.summary,
      keyTakeaways: briefingContent.keyTakeaways,
      relevantQuotes: briefingContent.relevantQuotes,
      personalInsights: briefingContent.personalInsights,
      matchedInterests: briefingContent.matchedInterests,
      relevanceScore: briefingContent.relevanceScore,
      isBookmarked: false,
    });

    // Update episode status
    await storage.updateSubscriptionEpisode(episodeId, { briefingStatus: 'completed' });

    // Create notification
    await storage.createNotification({
      userId,
      type: 'briefing_ready',
      title: 'New Briefing Ready',
      message: `Your briefing for "${episode.title}" is ready to view.`,
      resourceType: 'episode',
      resourceId: episodeId,
      isRead: false,
      emailSent: false,
    });

  } catch (error) {
    console.error('Error processing episode briefing:', error);
    await storage.updateSubscriptionEpisode(episodeId, { briefingStatus: 'failed' });
    throw error;
  }
}

export interface TranscribeProgress {
  status: 'completed' | 'processing';
  partsDone: number;
  partsTotal: number;
  transcript: string;
}

// One serverless invocation gets 300s. Stop starting new Whisper parts once
// this much of that budget is spent, so the response always comes back and the
// caller can resume the remaining parts in a follow-up request.
const TRANSCRIBE_BUDGET_MS = 190_000;

export async function transcribeEpisode(
  episodeId: string,
  userId: string,
  options: { budgetMs?: number } = {},
): Promise<TranscribeProgress> {
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? TRANSCRIBE_BUDGET_MS;
  try {
    // Check OpenAI API key first
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      await storage.updateSubscriptionEpisode(episodeId, { transcriptStatus: 'failed' });
      throw new Error('OpenAI API key not configured');
    }

    const episode = await storage.getSubscriptionEpisode(episodeId);
    if (!episode || episode.userId !== userId) {
      throw new Error('Episode not found');
    }

    if (!episode.audioUrl) {
      throw new Error('Episode has no audio URL');
    }

    // Update status to processing
    await storage.updateSubscriptionEpisode(episodeId, { transcriptStatus: 'processing' });

    // Download audio file. Podcast enclosures sit behind tracking redirects
    // (podtrac → swap.fm → omny…) and CDNs that reject bare fetches, so send a
    // real UA and follow the chain; then say *why* a download failed instead of
    // a generic message — "failed" on a 5-minute episode was usually a dead URL.
    console.log(`Downloading audio from: ${episode.audioUrl}`);
    const audioResponse = await fetch(episode.audioUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Podlogix/1.0 (+https://podlogix.io)', Accept: 'audio/*,*/*;q=0.8' },
    });
    if (!audioResponse.ok) {
      console.error(`Failed to download audio: ${audioResponse.status} ${audioResponse.statusText}`);
      if (audioResponse.status === 404 || audioResponse.status === 410) {
        throw new Error('The audio is no longer available at the source (the feed points to a file that was removed).');
      }
      throw new Error(`Couldn't download the audio (source returned HTTP ${audioResponse.status}).`);
    }
    const contentType = (audioResponse.headers.get('content-type') || '').toLowerCase();
    if (contentType.startsWith('text/html')) {
      throw new Error('The audio link returned a web page instead of an audio file.');
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    console.log(`Audio downloaded, size: ${audioBuffer.byteLength} bytes (${contentType || 'unknown type'})`);

    // Whisper takes at most 25MB per request. A 40-minute MP3 at 128kbps is
    // ~38MB, so most full episodes used to fail here outright. MP3 frames are
    // self-synchronising, so a plain byte split transcribes cleanly (a word at
    // each boundary can smear; acceptable for search). Other containers (m4a)
    // can't be split this way, so those stay capped.
    const WHISPER_MAX = 25 * 1024 * 1024;
    const CHUNK_BYTES = 20 * 1024 * 1024;
    const HARD_CAP = 250 * 1024 * 1024;
    if (audioBuffer.byteLength > HARD_CAP) {
      throw new Error('Audio is over 250MB — too large to transcribe in one job.');
    }
    const looksLikeMp3 = contentType.includes('mpeg') || contentType.includes('mp3') || /\.mp3(\?|$)/i.test(episode.audioUrl);
    if (audioBuffer.byteLength > WHISPER_MAX && !looksLikeMp3) {
      throw new Error('Audio is over 25MB and not an MP3, so it can\'t be split for transcription.');
    }

    const chunks: ArrayBuffer[] = [];
    if (audioBuffer.byteLength <= WHISPER_MAX) {
      chunks.push(audioBuffer);
    } else {
      for (let offset = 0; offset < audioBuffer.byteLength; offset += CHUNK_BYTES) {
        chunks.push(audioBuffer.slice(offset, Math.min(offset + CHUNK_BYTES, audioBuffer.byteLength)));
      }
    }

    // Resume where the last invocation stopped. The part count depends only on
    // the file's size, so a part index stays valid across calls; if the feed
    // swapped the file for a different length, start over rather than splicing
    // two different recordings together.
    const previousTotal = episode.transcriptPartsTotal ?? null;
    const resumable = previousTotal === chunks.length;
    let partsDone = resumable ? Math.min(episode.transcriptPartsDone ?? 0, chunks.length) : 0;
    const parts: string[] = partsDone > 0 && episode.transcript ? [episode.transcript] : [];
    if (!resumable) partsDone = 0;

    await storage.updateSubscriptionEpisode(episodeId, { transcriptPartsTotal: chunks.length });

    // Transcribe using OpenAI Whisper — sequentially, so one episode can't
    // fan out into a burst of parallel uploads and trip the rate limit.
    console.log(`Whisper transcription: ${chunks.length} part(s), resuming at part ${partsDone + 1}...`);
    let partsThisCall = 0;
    while (partsDone < chunks.length) {
      // Stop only after doing real work in THIS invocation — otherwise a resume
      // that starts with the budget already spent returns without progressing
      // and the caller loops forever.
      if (partsThisCall > 0 && Date.now() - startedAt > budgetMs) {
        const partial = parts.join('\n');
        await storage.updateSubscriptionEpisode(episodeId, {
          transcript: partial,
          transcriptPartsDone: partsDone,
          transcriptStatus: 'processing',
        });
        console.log(`Budget reached after ${partsDone}/${chunks.length} parts — caller should resume.`);
        return { status: 'processing', partsDone, partsTotal: chunks.length, transcript: partial };
      }
      const audioFile = new File([chunks[partsDone]], `audio-${partsDone + 1}.mp3`, { type: 'audio/mpeg' });
      const text = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        response_format: 'text',
      });
      parts.push(String(text).trim());
      partsDone += 1;
      partsThisCall += 1;
      await storage.updateSubscriptionEpisode(episodeId, {
        transcript: parts.join('\n'),
        transcriptPartsDone: partsDone,
      });
    }
    const transcription = parts.join('\n');
    console.log('Transcription completed successfully');

    // Save transcript
    await storage.updateSubscriptionEpisode(episodeId, {
      transcript: transcription,
      transcriptStatus: 'completed',
      transcriptPartsDone: chunks.length,
    });
    await chargeCredits(userId, 'transcript', {
      label: episode.title,
      resourceType: 'episode',
      resourceId: episodeId,
      minutes: episode.duration ? episode.duration / 60 : Math.round(audioBuffer.byteLength / (16 * 1024 * 60)),
      meta: { parts: chunks.length, bytes: audioBuffer.byteLength },
    });

    // Create notification
    await storage.createNotification({
      userId,
      type: 'new_episode',
      title: 'Transcript Ready',
      message: `Transcript for "${episode.title}" is ready. Generate a briefing now!`,
      resourceType: 'episode',
      resourceId: episodeId,
      isRead: false,
      emailSent: false,
    });

    return { status: 'completed', partsDone: chunks.length, partsTotal: chunks.length, transcript: transcription };
  } catch (error: any) {
    console.error('Error transcribing episode:', error);
    
    // Log specific OpenAI error details
    if (error?.status === 429) {
      console.error('OpenAI API quota exceeded or rate limited');
    } else if (error?.status === 401) {
      console.error('OpenAI API key is invalid');
    }
    
    await storage.updateSubscriptionEpisode(episodeId, { transcriptStatus: 'failed' });
    // The route relays this message to the UI toast — make it say something a
    // person can act on rather than an SDK status code.
    if (error?.status === 429) throw new Error('OpenAI is rate-limiting or out of quota — try again in a few minutes.');
    if (error?.status === 401) throw new Error('The OpenAI API key is invalid or missing.');
    throw error;
  }
}
