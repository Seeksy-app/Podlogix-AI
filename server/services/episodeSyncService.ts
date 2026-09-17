import { storage } from "../storage";
import { parseFeed, searchRssFeedByName } from "./rssService";
import { transcribeEpisode, processEpisodeBriefing } from "./briefingService";
import type { PodcastSubscription, SubscriptionEpisode } from "@shared/schema";

export async function syncEpisodesForSubscription(subscription: PodcastSubscription): Promise<number> {
  let feedUrl = subscription.feedUrl;
  
  // If no feed URL or it's a Spotify link, try to find the RSS feed
  if (!feedUrl || feedUrl.startsWith('https://open.spotify.com')) {
    console.log(`Looking up RSS feed for "${subscription.title}"...`);
    const discoveredFeed = await searchRssFeedByName(subscription.title);
    if (discoveredFeed) {
      feedUrl = discoveredFeed;
      // Update the subscription with the discovered feed URL
      await storage.updatePodcastSubscription(subscription.id, { feedUrl: discoveredFeed });
      console.log(`Found RSS feed for "${subscription.title}": ${discoveredFeed}`);
    } else {
      console.log(`Could not find RSS feed for "${subscription.title}"`);
      return 0;
    }
  }

  try {
    const feed = await parseFeed(feedUrl);
    const existingEpisodes = await storage.getSubscriptionEpisodesBySubscription(subscription.id);
    const existingGuids = new Set(existingEpisodes.map((e: SubscriptionEpisode) => e.guid));
    
    let newCount = 0;
    for (const episode of feed.episodes.slice(0, 20)) {
      if (!episode.guid || existingGuids.has(episode.guid)) {
        continue;
      }
      
      await storage.createSubscriptionEpisode({
        subscriptionId: subscription.id,
        userId: subscription.userId,
        title: episode.title,
        description: episode.description,
        audioUrl: episode.audioUrl,
        duration: episode.duration,
        publishedAt: episode.publishedAt,
        guid: episode.guid,
      });
      newCount++;
    }

    await storage.updatePodcastSubscription(subscription.id, {
      lastCheckedAt: new Date(),
      latestEpisodeAt: feed.episodes[0]?.publishedAt || undefined,
    });

    return newCount;
  } catch (error) {
    console.error(`Error syncing episodes for ${subscription.title}:`, error);
    return 0;
  }
}

/**
 * Import episodes from a creator's own RSS feed into their podcast's episode
 * list. Dedupes against episodes already stored for this podcast by guid.
 * Imported episodes are marked "published" since they're already live on
 * the podcaster's existing host — this is a catch-up import, not drafting.
 */
export async function syncEpisodesForPodcastFeed(podcastId: string, feedUrl: string): Promise<number> {
  const feed = await parseFeed(feedUrl);
  const existingEpisodes = await storage.getEpisodesByPodcast(podcastId);
  const existingGuids = new Set(existingEpisodes.map((e) => e.guid).filter(Boolean));

  // Backfill the show's own cover art from the feed if it doesn't have one
  // yet — otherwise every episode falls back to a blank placeholder forever.
  if (feed.imageUrl) {
    const podcast = await storage.getPodcast(podcastId);
    if (podcast && !podcast.artworkUrl) {
      await storage.updatePodcast(podcastId, { artworkUrl: feed.imageUrl });
    }
  }

  let newCount = 0;
  for (const episode of feed.episodes) {
    if (!episode.guid || existingGuids.has(episode.guid)) {
      continue;
    }

    const created = await storage.createEpisode({
      podcastId,
      title: episode.title,
      description: episode.description,
      audioUrl: episode.audioUrl,
      durationSeconds: episode.duration,
      guid: episode.guid,
      status: "published",
      // Fall back to the show's cover art when an episode has no unique art
      // of its own — most episodes do (RSS.com generates per-episode covers
      // by default), but this keeps the list from showing blank thumbnails
      // when a host doesn't.
      artworkUrl: episode.imageUrl || feed.imageUrl || null,
    });
    // publishedAt is intentionally excluded from InsertEpisode (it's normally
    // stamped by the publish action) — patch it in so imported episodes keep
    // their real publish date from the source feed instead of showing blank.
    if (episode.publishedAt) {
      await storage.updateEpisode(created.id, { publishedAt: episode.publishedAt });
    }
    newCount++;
  }

  return newCount;
}

export async function syncAllSubscriptionsForUser(userId: string): Promise<{ synced: number; newEpisodes: number }> {
  const subscriptions = await storage.getPodcastSubscriptionsByUserId(userId);
  let totalNew = 0;
  
  for (const sub of subscriptions) {
    if (sub.isActive) {
      const newCount = await syncEpisodesForSubscription(sub);
      totalNew += newCount;
    }
  }
  
  return { synced: subscriptions.length, newEpisodes: totalNew };
}

export async function processAutoBriefingsForUser(userId: string, maxEpisodes = 3): Promise<{ processed: number; briefings: number }> {
  const interests = await storage.getUserInterests(userId);
  if (interests.length === 0) {
    return { processed: 0, briefings: 0 };
  }

  const episodes = await storage.getSubscriptionEpisodesByUser(userId);
  const pendingEpisodes = episodes.filter(
    (e: SubscriptionEpisode) => e.transcriptStatus === 'pending' && e.audioUrl
  ).slice(0, maxEpisodes);

  let processed = 0;
  let briefingsCreated = 0;

  for (const episode of pendingEpisodes) {
    try {
      // Long episodes transcribe across several passes; brief only once the
      // whole transcript exists, and let the next sync resume the rest.
      const result = await transcribeEpisode(episode.id, userId);

      if (result.status === 'completed') {
        processed++;

        await processEpisodeBriefing(episode.id, userId);
        briefingsCreated++;
      }
    } catch (error) {
      console.error(`Error processing episode ${episode.id}:`, error);
    }
  }

  return { processed, briefings: briefingsCreated };
}

export async function runDailyBriefingJob(): Promise<void> {
  console.log('Starting daily briefing job...');
  
  const allSubscriptions = await storage.getAllActiveSubscriptions();
  const userIdSet = new Set<string>();
  for (const sub of allSubscriptions) {
    userIdSet.add(sub.userId);
  }
  const userIds = Array.from(userIdSet);
  
  for (const userId of userIds) {
    try {
      const syncResult = await syncAllSubscriptionsForUser(userId);
      console.log(`User ${userId}: Synced ${syncResult.synced} subscriptions, ${syncResult.newEpisodes} new episodes`);
      
      if (syncResult.newEpisodes > 0) {
        const briefingResult = await processAutoBriefingsForUser(userId);
        console.log(`User ${userId}: Processed ${briefingResult.processed} episodes, ${briefingResult.briefings} briefings`);
      }
    } catch (error) {
      console.error(`Error in daily job for user ${userId}:`, error);
    }
  }
  
  console.log('Daily briefing job completed');
}
