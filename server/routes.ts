import express, { type Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import crypto from "crypto";
import { isLiveKitConfigured, liveKitUrl, mintRoomToken, roomNameForSession, roomNameForRecording, isEgressConfigured, egressConfigReport, startSessionRecording, startTrackCompositeRecording, stopSessionRecording, recordingFilepath } from "./services/livekitService";
import { searchTranscripts, detectCrisis, CRISIS_RESOURCES } from "./services/transcriptSearchService";
import { chargeCredits, getCreditSummary } from "./services/credits";
import { setupAuth, registerAuthRoutes, isAuthenticated, isAdmin, isSuperAdmin, isBetaTester, authStorage } from "./replit_integrations/auth";
import { registerChatRoutes } from "./replit_integrations/chat";
import { createUploadUrl, publicUrlForKey, isSupabaseStorageConfigured, mirrorExternalMedia, storeImageBuffer, storeVideoBuffer, storeAudioBuffer } from "./services/supabaseStorageService";
import { mintVoiceCertificate, isBlockchainConfigured, getWalletBalance } from "./blockchain";
import { getMetaApiStatus, checkForPotentialImpersonators, isMetaConfigured } from "./services/metaApi";
import { 
  getSpotifyAuthUrl, 
  exchangeCodeForTokens, 
  getSpotifyUserProfile, 
  isSpotifyConnectedForUser, 
  getUserSavedShowsForUser, 
  searchPodcastsForUser, 
  getShowDetailsForUser,
  getRssFeedFromSpotify,
  getPlaylistForUser,
  createOrGetBriefingsPlaylist,
  searchSpotifyEpisode,
  addEpisodeToPlaylist
} from "./services/spotifyService";
import {
  getGoogleCalendarAuthUrl,
  exchangeCodeForTokens as exchangeGoogleCodeForTokens,
  getGoogleUserInfo,
  listUpcomingEvents as listGoogleCalendarEvents,
} from "./services/googleCalendarService";
import { parseFeed, validateFeed, getLatestEpisodes } from "./services/rssService";
import { generatePodcastFeedXml } from "./services/feedService";
import { recordListenEvent, isCountableDownload, getPodcastStats } from "./services/listenAnalytics";
import { insertEpisodeSchema } from "@shared/schema";
import { insertProfileSectionSchema } from "@shared/schema";
import { insertPodcastSubscriptionSchema, insertUserInterestSchema, insertEpisodeBriefingSchema, insertNotificationSchema } from "@shared/schema";
import { transcribeEpisode, processEpisodeBriefing } from "./services/briefingService";
import { syncAllSubscriptionsForUser, processAutoBriefingsForUser, syncEpisodesForPodcastFeed } from "./services/episodeSyncService";
import { 
  isModashConfigured, 
  searchInfluencers, 
  getInfluencerProfile 
} from "./services/modashService";
import { 
  isPhylloConfigured,
  getOrCreatePhylloUser,
  createSDKToken,
  getConnectedSocialAccounts,
  disconnectAccount,
  getPhylloStatus,
  getSupportedPlatforms
} from "./services/phylloService";
import {
  isYouTubeConfigured,
  searchYouTubeChannels,
  getChannelDetails,
  getChannelVideos,
  calculateEngagementRate
} from "./services/youtubeService";
import {
  isInstagramOAuthConfigured,
  getInstagramAuthUrl,
  exchangeCodeForToken,
  getLongLivedToken,
  getInstagramBusinessAccount,
  refreshInstagramAnalytics
} from "./services/instagramOAuth";
import {
  isInstagramLookupConfigured,
  lookupInstagramProfile,
  searchInstagramInfluencers
} from "./services/instagramLookupService";
import {
  discoverInfluencersByHashtag,
  checkHashtagServiceStatus
} from "./services/instagramHashtagService";
import {
  isLinkedInOAuthConfigured,
  getLinkedInAuthUrl,
  exchangeCodeForToken as linkedinExchangeCodeForToken,
  getLinkedInProfile
} from "./services/linkedinOAuth";
import {
  isLinkedInDiscoveryConfigured,
  extractLinkedInProfileInfo,
  extractLinkedInCompanyInfo,
  getLinkedInSearchUrl,
  getLinkedInHashtagUrl,
  generateLinkedInSearchSuggestions
} from "./services/linkedinDiscoveryService";
import { insertSavedInfluencerSchema, insertHashtagMonitorSchema, modashSearchSchema, insertConnectedSocialAccountSchema, clientSavedCreators, adminDevDocuments, teamInvitations } from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { generateEmailWithAI, improveEmailWithAI, generateSubjectLines } from "./services/aiEmailService";
import { sendEmail, isEmailConfigured } from "./services/emailService";
import { analyzeLink, generateBioAndHeadlines, suggestLinksForPodcast, improveBio, quickLinkTemplates } from "./services/aiProfileService";
import { registerConnectorRoutes } from "./connectorRoutes";
import { registerLandingRoutes } from "./landingRoutes";
import { getConnection as getBuzzsproutConnection } from "./services/buzzsproutSyncService";
import { exchangeYouTubeCode, getOwnedChannel, getOwnedVideo, getYouTubeAuthUrl, listOwnedVideos } from "./services/youtubeContentSource";
import {
  getPodcastIndexAuthMode,
  isPodcastIndexConfigured,
  PodcastIndexError,
  probePodcastIndex,
  searchPodcastIndexPersonAppearances,
} from "./services/podcastIndexService";
import {
  getPodchaserCreator,
  getPodchaserGuestAppearances,
  getPodchaserPodcastCredits,
  isPodchaserConfigured,
  PodchaserError,
  probePodchaserGuest,
  searchPodchaserCreators,
  searchPodchaserPodcasts,
  type PodchaserPodcastCandidate,
} from "./services/podchaserGuestService";
import { logPodchaserUsage, getPodchaserUsageBreakdown, getPodchaserUsageByUser } from "./services/podchaserCache";
import { getGuestPodcastPlayback } from "./services/guestPodcastPlaybackService";
import { enrichHandleCached, getCachedEnrichment, saveEnrichment, icEnrichmentEnabled, extractIcAnalytics } from "./services/icEnrichment";
import {
  contactNameParts,
  emailContactCreateInputSchema,
  emailContactUpdateInputSchema,
  guestContactInputSchema,
  normalizedEmailSchema,
} from "./services/contactEmailService";
import type { EmailContact, GuestProspect } from "@shared/schema";

function canonicalGuestMatch(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
}

function guestEnrichmentTarget(socialLinks: Record<string, string>): { platform: string; handle: string } | null {
  const supported = ['instagram', 'youtube', 'tiktok', 'twitter', 'twitch'];
  for (const platform of supported) {
    const value = socialLinks[platform];
    if (!value) continue;
    try {
      const url = new URL(value);
      const raw = url.pathname.split('/').filter(Boolean).at(-1)?.replace(/^@/, '').trim();
      if (raw) return { platform, handle: raw };
    } catch {
      const raw = value.replace(/^@/, '').trim();
      if (raw) return { platform, handle: raw };
    }
  }
  return null;
}

function extractGuestEnrichmentEmail(payload: any): string | null {
  const result = payload?.result ?? payload?.data ?? payload ?? {};
  const candidates = [
    result.email,
    result.contact_email,
    result.business_email,
    result?.contact?.email,
    result?.emails?.[0]?.email,
    result?.emails?.[0],
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim().toLowerCase();
    if (z.string().email().safeParse(normalized).success) return normalized;
  }
  return null;
}

type GuestContactDetails = Partial<Pick<EmailContact, "firstName" | "lastName" | "company" | "title">>;

class GuestContactConflictError extends Error {}

async function ensureOfficialGuestContact(
  userId: string,
  prospect: GuestProspect,
  rawEmail?: string | null,
  details: GuestContactDetails = {},
  sourceNote = "Added from a saved guest prospect.",
) {
  const email = rawEmail ? normalizedEmailSchema.parse(rawEmail) : null;
  let contact = await storage.getEmailContactByGuestProspect(userId, prospect.id);
  const emailContact = email ? await storage.getEmailContactByEmail(userId, email) : undefined;
  if (!contact) contact = emailContact;

  if (contact && emailContact && contact.id !== emailContact.id) {
    if (emailContact.guestProspectId && emailContact.guestProspectId !== prospect.id) {
      throw new GuestContactConflictError("That email is already attached to another guest contact.");
    }
    contact = await storage.mergeEmailContacts(contact.id, emailContact.id, userId, {
      guestProspectId: prospect.id,
      firstName: details.firstName ?? contact.firstName ?? emailContact.firstName,
      lastName: details.lastName ?? contact.lastName ?? emailContact.lastName,
      company: details.company ?? contact.company ?? emailContact.company,
      title: details.title ?? contact.title ?? emailContact.title,
      notes: contact.notes ?? emailContact.notes,
    });
    if (!contact) throw new Error("Unable to merge duplicate master contacts");
  }
  if (contact?.guestProspectId && contact.guestProspectId !== prospect.id) {
    throw new GuestContactConflictError("That contact is already linked to another guest prospect.");
  }

  // Carried onto the contact so it survives even if the prospect research is
  // later deleted, rather than relying only on the live guestProspectId join.
  const researchFields = {
    subtitle: prospect.subtitle,
    location: prospect.location,
    bio: prospect.bio,
    imageUrl: prospect.imageUrl,
    socialLinks: prospect.socialLinks,
    episodeAppearanceCount: prospect.episodeAppearanceCount,
  };

  if (!contact) {
    const fallbackName = contactNameParts(prospect.name);
    contact = await storage.createEmailContact({
      userId,
      guestProspectId: prospect.id,
      email,
      firstName: details.firstName ?? fallbackName.firstName,
      lastName: details.lastName ?? fallbackName.lastName,
      company: details.company,
      title: details.title,
      category: "guest",
      notes: sourceNote,
      isSubscribed: false,
      ...researchFields,
    });
  } else {
    const fallbackName = contactNameParts(prospect.name);
    const updates: Partial<EmailContact> = {
      ...details,
      ...researchFields,
      ...(contact.guestProspectId ? {} : { guestProspectId: prospect.id }),
      ...(email && contact.email?.trim().toLowerCase() !== email ? { email } : {}),
      ...(!contact.firstName && details.firstName === undefined ? { firstName: fallbackName.firstName } : {}),
      ...(!contact.lastName && details.lastName === undefined ? { lastName: fallbackName.lastName } : {}),
    };
    if (Object.keys(updates).length > 0) {
      contact = await storage.updateEmailContact(contact.id, userId, updates) ?? contact;
    }
  }

  const updatedProspect = !email || prospect.email?.trim().toLowerCase() === email
    ? prospect
    : await storage.updateGuestProspect(prospect.id, userId, { email });
  if (!updatedProspect) throw new Error("Guest prospect disappeared while saving contact details");

  const entries = await storage.getGuestPipelineEntriesByProspect(prospect.id);
  await Promise.all(entries
    .filter((entry) => entry.contactId !== contact!.id)
    .map((entry) => storage.updateGuestPipelineEntry(entry.id, { contactId: contact!.id })));

  return { prospect: updatedProspect, contact, email: contact.email };
}

async function sendEmailCampaign(campaignId: string, userId: string, recipientIds?: string[]) {
  // Check if email is configured first
  if (!isEmailConfigured()) {
    throw new Error('Email service is not configured');
  }

  const campaign = await storage.getEmailCampaign(campaignId);
  if (!campaign || campaign.userId !== userId) {
    throw new Error('Campaign not found');
  }

  const contacts = (await storage.getEmailContacts(userId))
    .filter((contact): contact is EmailContact & { email: string } => Boolean(contact.email));
  const recipients = recipientIds 
    ? contacts.filter(c => recipientIds.includes(c.id))
    : contacts.filter(c => c.isSubscribed);

  // Check for empty recipients
  if (recipients.length === 0) {
    throw new Error('No recipients selected for this campaign');
  }

  let successCount = 0;
  let failCount = 0;

  for (const contact of recipients) {
    try {
      let personalizedBody = campaign.body;
      let personalizedSubject = campaign.subject;
      
      // Replace personalization tokens with actual values or remove them
      personalizedBody = personalizedBody
        .replace(/\{\{firstName\}\}/g, contact.firstName || '')
        .replace(/\{\{lastName\}\}/g, contact.lastName || '')
        .replace(/\{\{email\}\}/g, contact.email);
      personalizedSubject = personalizedSubject
        .replace(/\{\{firstName\}\}/g, contact.firstName || '')
        .replace(/\{\{lastName\}\}/g, contact.lastName || '')
        .replace(/\{\{email\}\}/g, contact.email);

      const sent = await sendEmail({
        to: contact.email,
        subject: personalizedSubject,
        text: personalizedBody.replace(/<[^>]*>/g, ''),
        html: personalizedBody,
      });

      if (sent) {
        successCount++;
        await storage.updateEmailContact(contact.id, userId, { lastEmailedAt: new Date() });
      } else {
        failCount++;
      }
    } catch (error) {
      console.error(`Failed to send to ${contact.email}:`, error);
      failCount++;
    }
  }

  // Only mark as sent if at least one email was successful
  if (successCount > 0) {
    await storage.updateEmailCampaign(campaignId, userId, {
      status: 'sent',
      sentAt: new Date(),
      recipientCount: successCount,
    });
  }

  return { success: successCount > 0, sent: successCount, failed: failCount };
}

/**
 * Public base URL for hosted feeds and media enclosures.
 * Set PUBLIC_BASE_URL in production (e.g. https://podlogix.io); falls back to the request host.
 */
function getPublicBaseUrl(req: any): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Health check endpoint for Cloud Run
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Meta/Instagram Webhook verification (GET)
  const META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'podlogix_meta_webhook_2024';
  
  app.get("/api/webhooks/meta", (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === META_WEBHOOK_VERIFY_TOKEN) {
      console.log('Meta webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      console.log('Meta webhook verification failed');
      res.sendStatus(403);
    }
  });

  // Meta/Instagram Webhook events (POST)
  app.post("/api/webhooks/meta", (req, res) => {
    const body = req.body;
    console.log('Meta webhook event received:', JSON.stringify(body, null, 2));
    
    // Process different event types
    if (body.object === 'instagram') {
      // Handle Instagram events (mentions, comments, etc.)
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach((change: any) => {
          console.log('Instagram change:', change.field, change.value);
        });
      });
    }
    
    // Always return 200 to acknowledge receipt
    res.sendStatus(200);
  });

  // Setup auth before other routes
  await setupAuth(app);
  registerAuthRoutes(app);

  // ── User profile self-service routes ──────────────────────────────────────
  // PATCH /api/user/profile — update own name or profileImageUrl
  app.patch("/api/user/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { firstName, lastName, profileImageUrl, phone, zipCode, bio } = req.body ?? {};
      const updated = await authStorage.updateUserProfile(userId, {
        ...(firstName !== undefined ? { firstName } : {}),
        ...(lastName !== undefined ? { lastName } : {}),
        ...(profileImageUrl !== undefined ? { profileImageUrl } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(zipCode !== undefined ? { zipCode } : {}),
        ...(bio !== undefined ? { bio } : {}),
      });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(updated);
    } catch (err) {
      console.error("Error updating user profile:", err);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // PATCH /api/user/podchaser-identity — link or clear which Podchaser
  // creator is "me", so "What shows have I been on" can reuse the existing
  // guest-appearance-history lookup pointed at the user's own person id.
  app.patch("/api/user/podchaser-identity", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { creatorId } = z.object({ creatorId: z.string().trim().min(1).max(80).nullable() }).parse(req.body);
      if (creatorId) {
        // Validate the id actually resolves before saving it — a typo'd or
        // stale id would otherwise silently break the appearances lookup.
        await getPodchaserCreator(creatorId, userId);
      }
      const updated = await authStorage.updateUserProfile(userId, { podchaserPersonId: creatorId });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json({ podchaserPersonId: updated.podchaserPersonId });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Invalid request" });
      }
      return sendPodchaserRouteError(res, error);
    }
  });

  // Register AI chat routes
  registerChatRoutes(app);

  // Register connector routes (Buzzsprout, etc.)
  registerConnectorRoutes(app);
  registerLandingRoutes(app);
  
  // Register object storage routes for file uploads
  // ============ MEDIA UPLOADS (Supabase Storage) ============
  // Same contract the old Replit object storage exposed:
  // returns { uploadURL, objectPath } — client PUTs the file to uploadURL
  // and stores objectPath (now a public Supabase URL) in the database.
  app.post("/api/uploads/request-url", isAuthenticated, async (req: any, res) => {
    try {
      if (!isSupabaseStorageConfigured()) {
        return res.status(503).json({
          error: "File storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        });
      }
      const { name, size, contentType } = req.body ?? {};
      if (!name) {
        return res.status(400).json({ error: "Missing required field: name" });
      }
      const { uploadURL, objectPath } = await createUploadUrl(String(name));
      res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to generate upload URL";
      console.error("Error generating upload URL:", msg);
      res.status(500).json({ error: msg });
    }
  });

  // Legacy compatibility: /objects/<key> paths redirect to the public Supabase URL.
  app.get(/^\/objects\/(.+)$/, async (req, res) => {
    try {
      if (!isSupabaseStorageConfigured()) {
        return res.status(503).json({ error: "File storage is not configured" });
      }
      const objectKey = (req.params as any)[0] as string;
      return res.redirect(302, publicUrlForKey(objectKey));
    } catch (error) {
      console.error("Error resolving object:", error);
      return res.status(404).json({ error: "Object not found" });
    }
  });

  // Subscribers endpoint
  app.post(api.subscribers.create.path, async (req, res) => {
    try {
      const input = api.subscribers.create.input.parse(req.body);
      const subscriber = await storage.createSubscriber(input);
      res.status(201).json(subscriber);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      if (err instanceof Error && 'code' in err && (err as any).code === '23505') {
        return res.status(409).json({ message: "Email already subscribed" });
      }
      throw err;
    }
  });

  // Messages endpoint
  app.post(api.messages.create.path, async (req, res) => {
    try {
      const input = api.messages.create.input.parse(req.body);
      const message = await storage.createMessage(input);
      res.status(201).json(message);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Identity asset creation
  app.post(api.identity.create.path, async (req, res) => {
    try {
      const input = api.identity.create.input.parse(req.body);
      const asset = await storage.createIdentityAsset(input);
      res.status(201).json(asset);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Get identity asset by ID
  app.get(api.identity.get.path, async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const asset = await storage.getIdentityAsset(id);
    if (!asset) {
      return res.status(404).json({ message: 'Certificate not found' });
    }
    res.json(asset);
  });

  // Get identity assets by email
  app.get(api.identity.getByEmail.path, async (req, res) => {
    const email = Array.isArray(req.params.email) ? req.params.email[0] : req.params.email;
    const assets = await storage.getIdentityAssetsByEmail(email);
    res.json(assets);
  });

  // Update identity asset (protected - owner only)
  app.patch("/api/identity/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = req.params.id;
      const userEmail = (req as any).dbUser?.email;
      
      const asset = await storage.getIdentityAsset(id);
      if (!asset) {
        return res.status(404).json({ message: 'Asset not found' });
      }

      // Verify ownership - user can only update their own assets
      if (asset.email !== userEmail) {
        return res.status(403).json({ message: 'You can only update your own assets' });
      }

      const { likenessImages, ...otherUpdates } = req.body;
      const updates: any = { ...otherUpdates };
      
      if (likenessImages) {
        updates.likenessImages = likenessImages;
      }

      const updated = await storage.updateIdentityAsset(id, updates);
      res.json(updated);
    } catch (err) {
      console.error("Error updating identity asset:", err);
      return res.status(500).json({ message: 'Failed to update asset' });
    }
  });

  // Mint voice certificate on Polygon blockchain
  app.post(api.identity.mint.path, isAuthenticated, async (req: any, res) => {
    try {
      const { voiceHash } = api.identity.mint.input.parse(req.body);
      const id = req.params.id;
      const userEmail = (req as any).dbUser?.email;

      const asset = await storage.getIdentityAsset(id);
      if (!asset) {
        return res.status(404).json({ message: 'Asset not found' });
      }

      // Verify ownership - user can only mint their own assets
      if (asset.email !== userEmail) {
        return res.status(403).json({ message: 'You can only mint certificates for your own assets' });
      }

      // Update status to minting
      await storage.updateIdentityAsset(id, { 
        certStatus: 'minting',
        voiceHash 
      });

      // Mint on Polygon blockchain
      const mintResult = await mintVoiceCertificate(
        voiceHash,
        asset.name,
        asset.email
      );

      if (!mintResult.success) {
        await storage.updateIdentityAsset(id, { certStatus: 'failed' });
        return res.status(500).json({ 
          message: mintResult.error || 'Blockchain minting failed' 
        });
      }

      // Update with minted status
      const updated = await storage.updateIdentityAsset(id, {
        certStatus: 'minted',
        certTxHash: mintResult.txHash,
        certTokenId: mintResult.tokenId,
        certExplorerUrl: mintResult.explorerUrl,
        mintedAt: new Date(),
      });

      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      console.error("Minting error:", err);
      await storage.updateIdentityAsset(req.params.id, { certStatus: 'failed' });
      return res.status(500).json({ message: 'Minting failed' });
    }
  });

  // Mint likeness certificate on Polygon blockchain
  app.post("/api/identity/:id/mint-likeness", isAuthenticated, async (req: any, res) => {
    try {
      const { likenessHash } = req.body;
      const id = req.params.id;
      const userEmail = (req as any).dbUser?.email;

      if (!likenessHash) {
        return res.status(400).json({ message: 'Likeness hash is required' });
      }

      const asset = await storage.getIdentityAsset(id);
      if (!asset) {
        return res.status(404).json({ message: 'Asset not found' });
      }

      // Verify ownership - user can only mint their own assets
      if (asset.email !== userEmail) {
        return res.status(403).json({ message: 'You can only mint certificates for your own assets' });
      }

      // Update status to minting
      await storage.updateIdentityAsset(id, { 
        certStatus: 'minting',
        likenessHash 
      });

      // Mint on Polygon blockchain (using same function, different data)
      const mintResult = await mintVoiceCertificate(
        likenessHash,
        asset.name,
        asset.email
      );

      if (!mintResult.success) {
        await storage.updateIdentityAsset(id, { certStatus: 'failed' });
        return res.status(500).json({ 
          message: mintResult.error || 'Blockchain minting failed' 
        });
      }

      // Update with minted status
      const updated = await storage.updateIdentityAsset(id, {
        certStatus: 'minted',
        certTxHash: mintResult.txHash,
        certTokenId: mintResult.tokenId,
        certExplorerUrl: mintResult.explorerUrl,
        mintedAt: new Date(),
      });

      res.json(updated);
    } catch (err) {
      console.error("Likeness minting error:", err);
      await storage.updateIdentityAsset(req.params.id, { certStatus: 'failed' });
      return res.status(500).json({ message: 'Minting failed' });
    }
  });

  // Blockchain status endpoint
  app.get("/api/blockchain/status", async (_req, res) => {
    const configured = isBlockchainConfigured();
    let balance = null;
    
    if (configured) {
      balance = await getWalletBalance();
    }
    
    res.json({
      configured,
      network: configured ? "Polygon Mainnet" : null,
      walletBalance: balance ? `${balance} MATIC` : null,
    });
  });

  // Meta API status endpoint (protected)
  app.get("/api/social/meta/status", isAuthenticated, async (_req, res) => {
    try {
      const status = await getMetaApiStatus();
      res.json(status);
    } catch (error) {
      console.error("Error fetching Meta status:", error);
      res.json({ configured: isMetaConfigured(), connected: false, instagramAccount: null, facebookPages: [] });
    }
  });

  // Check for potential impersonators (protected)
  app.post("/api/social/scan-impersonators", isAuthenticated, async (req: any, res) => {
    try {
      const { userName, userBio } = req.body;
      
      if (!userName) {
        return res.status(400).json({ message: 'User name is required for scanning' });
      }

      const alerts = await checkForPotentialImpersonators(userName, userBio);
      res.json({ alerts, scannedAt: new Date().toISOString() });
    } catch (error) {
      console.error("Error scanning for impersonators:", error);
      res.status(500).json({ message: 'Failed to scan for impersonators' });
    }
  });

  // Phyllo Social Monitoring API routes
  
  // Get Phyllo status and supported platforms (public endpoint - just returns config status)
  app.get("/api/social/phyllo/status", async (_req, res) => {
    try {
      const status = await getPhylloStatus();
      res.json(status);
    } catch (error) {
      console.error("Error fetching Phyllo status:", error);
      res.json({ configured: false, supportedPlatforms: getSupportedPlatforms() });
    }
  });

  // Get SDK token for connecting a social account
  app.post("/api/social/phyllo/sdk-token", isAuthenticated, async (req: any, res) => {
    console.log("=== Phyllo SDK Token Request ===");
    try {
      const userId = req.session.userId!;
      const dbUser = (req as any).dbUser;
      const userName = `${dbUser?.firstName || ''} ${dbUser?.lastName || ''}`.trim() || dbUser?.email || 'User';
      console.log(`Phyllo request for user: ${userId}, name: ${userName}`);
      
      if (!isPhylloConfigured()) {
        console.log("Phyllo not configured");
        return res.status(503).json({ error: 'Social monitoring service not configured' });
      }
      console.log("Phyllo is configured, creating user...");

      const phylloUser = await getOrCreatePhylloUser(userId, userName);
      console.log("Phyllo user result:", phylloUser);
      if (!phylloUser) {
        console.log("Failed to create Phyllo user");
        return res.status(500).json({ error: 'Failed to create monitoring user' });
      }

      const sdkToken = await createSDKToken(phylloUser.id, ['IDENTITY', 'ENGAGEMENT']);
      if (!sdkToken) {
        return res.status(500).json({ error: 'Failed to create SDK token' });
      }

      res.json({
        sdkToken: sdkToken.sdk_token,
        expiresAt: sdkToken.expires_at,
        userId: phylloUser.id,
      });
    } catch (error) {
      console.error("Error creating Phyllo SDK token:", error);
      res.status(500).json({ error: 'Failed to initialize social connection' });
    }
  });

  // Get connected social accounts for the current user
  app.get("/api/social/phyllo/accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      
      // Get from our database
      const accounts = await storage.getConnectedSocialAccountsByUser(userId);
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching connected accounts:", error);
      res.status(500).json({ error: 'Failed to fetch connected accounts' });
    }
  });

  // Save a newly connected social account (called after Phyllo SDK success)
  app.post("/api/social/phyllo/accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const parseResult = insertConnectedSocialAccountSchema.safeParse({ ...req.body, userId });
      
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid account data', details: parseResult.error.issues });
      }

      const account = await storage.createConnectedSocialAccount(parseResult.data);
      res.json(account);
    } catch (error) {
      console.error("Error saving connected account:", error);
      res.status(500).json({ error: 'Failed to save connected account' });
    }
  });

  // Disconnect a social account
  app.delete("/api/social/phyllo/accounts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.session.userId!;
      
      const account = await storage.getConnectedSocialAccount(id);
      if (!account || account.userId !== userId) {
        return res.status(404).json({ error: 'Account not found' });
      }

      // Disconnect from Phyllo if we have the account ID
      if (account.phylloAccountId && isPhylloConfigured()) {
        await disconnectAccount(account.phylloAccountId);
      }

      await storage.deleteConnectedSocialAccount(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error disconnecting account:", error);
      res.status(500).json({ error: 'Failed to disconnect account' });
    }
  });

  // Get monitoring alerts for the current user
  app.get("/api/social/phyllo/alerts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const unresolvedOnly = req.query.unresolvedOnly === 'true';
      
      const alerts = unresolvedOnly 
        ? await storage.getUnresolvedAlertsByUser(userId)
        : await storage.getSocialMonitoringAlertsByUser(userId);
      
      res.json(alerts);
    } catch (error) {
      console.error("Error fetching alerts:", error);
      res.status(500).json({ error: 'Failed to fetch alerts' });
    }
  });

  // Resolve an alert
  app.patch("/api/social/phyllo/alerts/:id/resolve", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.session.userId!;
      
      const alerts = await storage.getSocialMonitoringAlertsByUser(userId);
      const alert = alerts.find(a => a.id === id);
      
      if (!alert) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      const updated = await storage.updateSocialMonitoringAlert(id, {
        isResolved: true,
        resolvedAt: new Date(),
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Error resolving alert:", error);
      res.status(500).json({ error: 'Failed to resolve alert' });
    }
  });

  // Creator Social Profiles (native API integration)
  app.get("/api/creator/social-profiles", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const profiles = await storage.getCreatorSocialProfilesByUser(userId);
      res.json(profiles);
    } catch (error) {
      console.error("Error fetching social profiles:", error);
      res.status(500).json({ error: 'Failed to fetch social profiles' });
    }
  });

  app.post("/api/creator/social-profiles", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { platform, profileUrl } = req.body;

      if (!platform || !profileUrl) {
        return res.status(400).json({ error: 'Platform and profile URL are required' });
      }

      const existing = await storage.getCreatorSocialProfileByPlatform(userId, platform);

      let profileData: any = {
        userId,
        platform,
        profileUrl,
        verified: false,
      };

      if (platform === 'youtube') {
        const { resolveChannelFromUrl } = await import('./services/youtubeService');
        const channel = await resolveChannelFromUrl(profileUrl);
        
        if (channel) {
          profileData = {
            ...profileData,
            username: channel.customUrl || channel.title,
            displayName: channel.title,
            profilePictureUrl: channel.thumbnailUrl,
            youtubeChannelId: channel.channelId,
            subscriberCount: channel.subscriberCount,
            videoCount: channel.videoCount,
            viewCount: channel.viewCount,
            verified: true,
            lastSyncedAt: new Date(),
          };
        }
      } else {
        const urlMatch = profileUrl.match(/(?:@|\/)?([a-zA-Z0-9_.-]+)\/?$/);
        profileData.username = urlMatch?.[1] || profileUrl;
        profileData.verified = true;
      }

      // Upsert: reconnecting a platform updates the existing profile instead
      // of erroring, so users can always refresh/replace a connection.
      const saved = existing
        ? await storage.updateCreatorSocialProfile(existing.id, profileData)
        : await storage.createCreatorSocialProfile(profileData);
      res.json(saved);
    } catch (error) {
      console.error("Error adding social profile:", error);
      res.status(500).json({ error: 'Failed to add social profile' });
    }
  });

  app.post("/api/creator/social-profiles/:id/sync", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      
      const profile = await storage.getCreatorSocialProfile(id);
      if (!profile || profile.userId !== userId) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      if (profile.platform === 'youtube' && profile.youtubeChannelId) {
        const { getChannelDetails } = await import('./services/youtubeService');
        const channel = await getChannelDetails(profile.youtubeChannelId);
        
        if (channel) {
          const updated = await storage.updateCreatorSocialProfile(id, {
            displayName: channel.title,
            profilePictureUrl: channel.thumbnailUrl,
            subscriberCount: channel.subscriberCount,
            videoCount: channel.videoCount,
            viewCount: channel.viewCount,
            lastSyncedAt: new Date(),
          });
          return res.json(updated);
        }
      }

      res.json(profile);
    } catch (error) {
      console.error("Error syncing social profile:", error);
      res.status(500).json({ error: 'Failed to sync social profile' });
    }
  });

  app.delete("/api/creator/social-profiles/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      
      const profile = await storage.getCreatorSocialProfile(id);
      if (!profile || profile.userId !== userId) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      await storage.deleteCreatorSocialProfile(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting social profile:", error);
      res.status(500).json({ error: 'Failed to delete social profile' });
    }
  });

  // Instagram OAuth routes for creator profiles
  app.get("/api/creator/instagram/status", async (req, res) => {
    res.json({
      configured: isInstagramOAuthConfigured(),
    });
  });

  app.get("/api/creator/instagram/auth", isAuthenticated, async (req: any, res) => {
    try {
      console.log("[Instagram Auth] META_APP_ID from env:", process.env.META_APP_ID);
      if (!isInstagramOAuthConfigured()) {
        return res.status(400).json({ error: 'Instagram OAuth not configured' });
      }

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const redirectUri = `${protocol}://${host}/api/creator/instagram/callback`;
      
      const userId = req.session.userId!;
      const timestamp = Date.now();
      const stateData = JSON.stringify({ userId, timestamp });
      const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'instagram-oauth-secret')
        .update(stateData)
        .digest('hex');
      const state = Buffer.from(JSON.stringify({ data: stateData, sig: signature })).toString('base64');
      
      const authUrl = getInstagramAuthUrl(redirectUri, state);
      res.json({ url: authUrl });
    } catch (error) {
      console.error("Error generating Instagram auth URL:", error);
      res.status(500).json({ error: 'Failed to generate auth URL' });
    }
  });

  app.get("/api/creator/instagram/callback", async (req, res) => {
    try {
      const { code, state, error: authError, error_description } = req.query;

      if (authError) {
        console.error("Instagram auth error:", authError, error_description);
        return res.redirect('/connectors?instagram_error=auth_denied');
      }

      if (!code || !state) {
        return res.redirect('/connectors?instagram_error=missing_params');
      }

      let userId: string;
      try {
        const stateObj = JSON.parse(Buffer.from(state as string, 'base64').toString());
        const { data: stateData, sig } = stateObj;
        
        const expectedSig = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'instagram-oauth-secret')
          .update(stateData)
          .digest('hex');
        
        if (sig !== expectedSig) {
          console.error("Instagram OAuth state signature mismatch");
          return res.redirect('/connectors?instagram_error=invalid_state');
        }
        
        const parsed = JSON.parse(stateData);
        userId = parsed.userId;
        
        const stateAge = Date.now() - parsed.timestamp;
        if (stateAge > 10 * 60 * 1000) {
          return res.redirect('/connectors?instagram_error=state_expired');
        }
      } catch (e) {
        console.error("Instagram OAuth state parsing error:", e);
        return res.redirect('/connectors?instagram_error=invalid_state');
      }

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const redirectUri = `${protocol}://${host}/api/creator/instagram/callback`;

      const tokens = await exchangeCodeForToken(code as string, redirectUri);
      if (!tokens) {
        return res.redirect('/connectors?instagram_error=token_exchange_failed');
      }

      const longLivedTokens = await getLongLivedToken(tokens.accessToken);
      const accessToken = longLivedTokens?.accessToken || tokens.accessToken;
      const expiresAt = longLivedTokens?.expiresAt || tokens.expiresAt;

      const instagramAccount = await getInstagramBusinessAccount(accessToken);
      if (!instagramAccount) {
        return res.redirect('/connectors?instagram_error=no_business_account');
      }

      const existingProfiles = await storage.getCreatorSocialProfilesByUser(userId);
      const existingInstagram = existingProfiles.find(p => p.platform === 'instagram');
      
      if (existingInstagram) {
        await storage.updateCreatorSocialProfile(existingInstagram.id, {
          username: instagramAccount.username,
          displayName: instagramAccount.name || instagramAccount.username,
          profilePictureUrl: instagramAccount.profilePictureUrl,
          instagramAccountId: instagramAccount.id,
          instagramAccessToken: accessToken,
          instagramTokenExpiresAt: expiresAt,
          followersCount: instagramAccount.followersCount,
          followingCount: instagramAccount.followingCount,
          mediaCount: instagramAccount.mediaCount,
          verified: true,
          lastSyncedAt: new Date(),
        });
      } else {
        await storage.createCreatorSocialProfile({
          userId,
          platform: 'instagram',
          profileUrl: `https://instagram.com/${instagramAccount.username}`,
          username: instagramAccount.username,
          displayName: instagramAccount.name || instagramAccount.username,
          profilePictureUrl: instagramAccount.profilePictureUrl,
          instagramAccountId: instagramAccount.id,
          instagramAccessToken: accessToken,
          instagramTokenExpiresAt: expiresAt,
          followersCount: instagramAccount.followersCount,
          followingCount: instagramAccount.followingCount,
          mediaCount: instagramAccount.mediaCount,
          verified: true,
          lastSyncedAt: new Date(),
        });
      }

      res.redirect('/connectors?instagram_connected=true');
    } catch (error) {
      console.error("Instagram callback error:", error);
      res.redirect('/connectors?instagram_error=callback_failed');
    }
  });

  app.post("/api/creator/instagram/sync/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.session.userId!;

      const profile = await storage.getCreatorSocialProfile(id);
      if (!profile || profile.userId !== userId) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      if (profile.platform !== 'instagram' || !profile.instagramAccessToken || !profile.instagramAccountId) {
        return res.status(400).json({ error: 'Not an OAuth-connected Instagram profile' });
      }

      const analytics = await refreshInstagramAnalytics(
        profile.instagramAccessToken,
        profile.instagramAccountId
      );

      if (!analytics) {
        return res.status(500).json({ error: 'Failed to refresh analytics' });
      }

      const updated = await storage.updateCreatorSocialProfile(id, {
        followersCount: analytics.followersCount,
        followingCount: analytics.followingCount,
        mediaCount: analytics.mediaCount,
        lastSyncedAt: new Date(),
      });

      res.json(updated);
    } catch (error) {
      console.error("Error syncing Instagram profile:", error);
      res.status(500).json({ error: 'Failed to sync profile' });
    }
  });

  // LinkedIn OAuth routes for creator profiles
  app.get("/api/creator/linkedin/status", async (req, res) => {
    res.json({
      configured: isLinkedInOAuthConfigured(),
    });
  });

  app.get("/api/creator/linkedin/auth", isAuthenticated, async (req: any, res) => {
    try {
      if (!isLinkedInOAuthConfigured()) {
        return res.status(400).json({ error: 'LinkedIn OAuth not configured' });
      }

      const userId = req.session.userId!;
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const redirectUri = `${protocol}://${host}/api/creator/linkedin/callback`;

      const stateData = { userId, timestamp: Date.now() };
      const statePayload = Buffer.from(JSON.stringify(stateData)).toString('base64');
      const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'linkedin-oauth-secret')
        .update(statePayload)
        .digest('hex');
      const state = `${statePayload}.${signature}`;

      const authUrl = getLinkedInAuthUrl(redirectUri, state);
      res.json({ authUrl });
    } catch (error) {
      console.error("Error generating LinkedIn auth URL:", error);
      res.status(500).json({ error: 'Failed to generate auth URL' });
    }
  });

  app.get("/api/creator/linkedin/callback", async (req, res) => {
    try {
      const { code, state, error: authError, error_description } = req.query as Record<string, string>;

      if (authError) {
        console.error("LinkedIn auth error:", authError, error_description);
        return res.redirect('/connectors?linkedin_error=auth_denied');
      }

      if (!code || !state) {
        return res.redirect('/connectors?linkedin_error=missing_params');
      }

      let userId: string;
      try {
        const [statePayload, signature] = state.split('.');
        const expectedSig = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'linkedin-oauth-secret')
          .update(statePayload)
          .digest('hex');

        if (signature !== expectedSig) {
          console.error("LinkedIn OAuth state signature mismatch");
          return res.redirect('/connectors?linkedin_error=invalid_state');
        }

        const stateData = JSON.parse(Buffer.from(statePayload, 'base64').toString());
        
        if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
          return res.redirect('/connectors?linkedin_error=expired');
        }

        userId = stateData.userId;
      } catch (e) {
        console.error("LinkedIn OAuth state parsing error:", e);
        return res.redirect('/connectors?linkedin_error=invalid_state');
      }

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const redirectUri = `${protocol}://${host}/api/creator/linkedin/callback`;

      const tokens = await linkedinExchangeCodeForToken(code, redirectUri);
      if (!tokens) {
        return res.redirect('/connectors?linkedin_error=token_failed');
      }

      const linkedInProfile = await getLinkedInProfile(tokens.accessToken);
      if (!linkedInProfile) {
        return res.redirect('/connectors?linkedin_error=profile_failed');
      }

      const existingProfile = await storage.getCreatorSocialProfileByPlatform(userId, 'linkedin');
      
      const linkedInProfileUrl = linkedInProfile.profileUrl || 
        (linkedInProfile.vanityName ? `https://linkedin.com/in/${linkedInProfile.vanityName}` : `https://linkedin.com/in/${linkedInProfile.id}`);

      if (existingProfile) {
        await storage.updateCreatorSocialProfile(existingProfile.id, {
          profileUrl: linkedInProfileUrl,
          displayName: `${linkedInProfile.firstName} ${linkedInProfile.lastName}`.trim(),
          linkedinAccessToken: tokens.accessToken,
          linkedinTokenExpiresAt: tokens.expiresAt,
          linkedinMemberId: linkedInProfile.id,
          lastSyncedAt: new Date(),
        });
      } else {
        await storage.createCreatorSocialProfile({
          userId,
          platform: 'linkedin',
          profileUrl: linkedInProfileUrl,
          displayName: `${linkedInProfile.firstName} ${linkedInProfile.lastName}`.trim(),
          linkedinAccessToken: tokens.accessToken,
          linkedinTokenExpiresAt: tokens.expiresAt,
          linkedinMemberId: linkedInProfile.id,
        });
      }

      res.redirect('/connectors?linkedin_connected=true');
    } catch (error) {
      console.error("LinkedIn callback error:", error);
      res.redirect('/connectors?linkedin_error=callback_failed');
    }
  });

  // Facebook OAuth routes for creator profiles
  app.get("/api/creator/facebook/status", async (req, res) => {
    const { isFacebookOAuthConfigured } = await import('./services/facebookOAuth');
    res.json({
      configured: isFacebookOAuthConfigured(),
    });
  });

  app.get("/api/creator/facebook/auth", isAuthenticated, async (req: any, res) => {
    try {
      const { isFacebookOAuthConfigured, getFacebookAuthUrl } = await import('./services/facebookOAuth');
      
      if (!isFacebookOAuthConfigured()) {
        return res.status(400).json({ error: 'Facebook OAuth not configured' });
      }

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const redirectUri = `${protocol}://${host}/api/creator/facebook/callback`;
      
      const userId = req.session.userId!;
      const timestamp = Date.now();
      const stateData = JSON.stringify({ userId, timestamp });
      const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'facebook-oauth-secret')
        .update(stateData)
        .digest('hex');
      const state = Buffer.from(JSON.stringify({ data: stateData, sig: signature })).toString('base64');
      
      const authUrl = getFacebookAuthUrl(redirectUri, state);
      res.json({ url: authUrl });
    } catch (error) {
      console.error("Error generating Facebook auth URL:", error);
      res.status(500).json({ error: 'Failed to generate auth URL' });
    }
  });

  app.get("/api/creator/facebook/callback", async (req, res) => {
    try {
      const { code, state, error: authError, error_description } = req.query;

      if (authError) {
        console.error("Facebook auth error:", authError, error_description);
        return res.redirect('/connectors?facebook_error=auth_denied');
      }

      if (!code || !state) {
        return res.redirect('/connectors?facebook_error=missing_params');
      }

      let userId: string;
      try {
        const stateObj = JSON.parse(Buffer.from(state as string, 'base64').toString());
        const { data: stateData, sig } = stateObj;
        
        const expectedSig = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'facebook-oauth-secret')
          .update(stateData)
          .digest('hex');
        
        if (sig !== expectedSig) {
          console.error("Facebook OAuth state signature mismatch");
          return res.redirect('/connectors?facebook_error=invalid_state');
        }
        
        const parsed = JSON.parse(stateData);
        userId = parsed.userId;
        
        const stateAge = Date.now() - parsed.timestamp;
        if (stateAge > 10 * 60 * 1000) {
          return res.redirect('/connectors?facebook_error=state_expired');
        }
      } catch (e) {
        console.error("Facebook OAuth state parsing error:", e);
        return res.redirect('/connectors?facebook_error=invalid_state');
      }

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const redirectUri = `${protocol}://${host}/api/creator/facebook/callback`;

      const { exchangeCodeForToken, getLongLivedToken, getUserPages } = await import('./services/facebookOAuth');

      const tokens = await exchangeCodeForToken(code as string, redirectUri);
      if (!tokens) {
        return res.redirect('/connectors?facebook_error=token_exchange_failed');
      }

      const longLivedTokens = await getLongLivedToken(tokens.accessToken);
      const accessToken = longLivedTokens?.accessToken || tokens.accessToken;
      const expiresAt = longLivedTokens?.expiresAt || tokens.expiresAt;

      const pages = await getUserPages(accessToken);
      if (!pages || pages.length === 0) {
        return res.redirect('/connectors?facebook_error=no_pages');
      }

      // Use the first page for now
      const page = pages[0];

      const existingProfiles = await storage.getCreatorSocialProfilesByUser(userId);
      const existingFacebook = existingProfiles.find(p => p.platform === 'facebook');
      
      if (existingFacebook) {
        await storage.updateCreatorSocialProfile(existingFacebook.id, {
          username: page.name,
          displayName: page.name,
          profilePictureUrl: page.pictureUrl,
          facebookPageId: page.id,
          facebookAccessToken: page.accessToken,
          facebookTokenExpiresAt: expiresAt,
          facebookPageName: page.name,
          facebookFansCount: page.fansCount,
          verified: true,
          lastSyncedAt: new Date(),
        });
      } else {
        await storage.createCreatorSocialProfile({
          userId,
          platform: 'facebook',
          profileUrl: `https://facebook.com/${page.id}`,
          username: page.name,
          displayName: page.name,
          profilePictureUrl: page.pictureUrl,
          facebookPageId: page.id,
          facebookAccessToken: page.accessToken,
          facebookTokenExpiresAt: expiresAt,
          facebookPageName: page.name,
          facebookFansCount: page.fansCount,
          verified: true,
          lastSyncedAt: new Date(),
        });
      }

      res.redirect('/connectors?facebook_connected=true');
    } catch (error) {
      console.error("Facebook callback error:", error);
      res.redirect('/connectors?facebook_error=callback_failed');
    }
  });

  // Dashboard endpoint (protected)
  app.get(api.dashboard.get.path, isAuthenticated, async (req: any, res) => {
    const userId = req.session.userId!;
    const profile = await storage.getProfileByUserId(userId);
    const podcastsList = await storage.getPodcastsByUserId(userId);
    
    let hasRssFeed = false;
    const distributionStatus: Record<string, string> = {};
    
    if (podcastsList.length > 0) {
      const feeds = await storage.getRssFeedsByPodcast(podcastsList[0].id);
      hasRssFeed = feeds.length > 0;
      const submissions = await storage.getChannelSubmissions(podcastsList[0].id);
      submissions.forEach(sub => {
        distributionStatus[sub.channelId] = sub.status;
      });
    }
    
    res.json({ profile, podcasts: podcastsList, hasRssFeed, distributionStatus });
  });

  // Profile endpoints (protected)
  app.get(api.profiles.get.path, isAuthenticated, async (req: any, res) => {
    const userId = req.session.userId!;
    const profile = await storage.getProfileByUserId(userId);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }
    res.json(profile);
  });

  app.post(api.profiles.create.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const input = api.profiles.create.input.parse({ ...req.body, userId });
      const profile = await storage.createProfile(input);
      res.status(201).json(profile);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  app.patch(api.profiles.update.path, isAuthenticated, async (req: any, res) => {
    const userId = req.session.userId!;
    const profile = await storage.getProfileByUserId(userId);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }
    const updated = await storage.updateProfile(profile.id, req.body);
    res.json(updated);
  });

  // Public profile by slug
  app.get(api.profiles.getBySlug.path, async (req, res) => {
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    const profile = await storage.getProfileBySlug(slug);
    if (!profile || !profile.isPublished) {
      return res.status(404).json({ message: 'Profile not found' });
    }
    const links = await storage.getProfileLinks(profile.id);
    const sections = await storage.getProfileSections(profile.id);
    const socialProfiles = await storage.getCreatorSocialProfilesByUser(profile.userId);
    res.json({ profile, links, sections, socialProfiles });
  });

  // Profile Links endpoints (protected)
  app.get(api.profileLinks.list.path, isAuthenticated, async (req: any, res) => {
    const userId = req.session.userId!;
    const profile = await storage.getProfileByUserId(userId);
    if (!profile) return res.json([]);
    const links = await storage.getProfileLinks(profile.id);
    res.json(links);
  });

  app.post(api.profileLinks.create.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const profile = await storage.getProfileByUserId(userId);
      if (!profile) {
        return res.status(400).json({ message: 'Create a profile first' });
      }
      const input = api.profileLinks.create.input.parse({ ...req.body, profileId: profile.id });
      const link = await storage.createProfileLink(input);
      res.status(201).json(link);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  app.patch('/api/profile/links/:id', isAuthenticated, async (req: any, res) => {
    const updated = await storage.updateProfileLink(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ message: 'Link not found' });
    }
    res.json(updated);
  });

  app.delete('/api/profile/links/:id', isAuthenticated, async (req: any, res) => {
    await storage.deleteProfileLink(req.params.id);
    res.status(204).send();
  });

  // Profile Sections endpoints (protected) — content blocks on the page builder
  app.get('/api/profile/sections', isAuthenticated, async (req: any, res) => {
    const userId = req.session.userId!;
    const profile = await storage.getProfileByUserId(userId);
    if (!profile) return res.json([]);
    const sections = await storage.getProfileSections(profile.id);
    res.json(sections);
  });

  app.post('/api/profile/sections', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const profile = await storage.getProfileByUserId(userId);
      if (!profile) {
        return res.status(400).json({ message: 'Create a profile first' });
      }
      const input = insertProfileSectionSchema.parse({ ...req.body, profileId: profile.id });
      const section = await storage.createProfileSection(input);
      res.status(201).json(section);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  app.patch('/api/profile/sections/:id', isAuthenticated, async (req: any, res) => {
    const updated = await storage.updateProfileSection(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ message: 'Section not found' });
    }
    res.json(updated);
  });

  app.delete('/api/profile/sections/:id', isAuthenticated, async (req: any, res) => {
    await storage.deleteProfileSection(req.params.id);
    res.status(204).send();
  });

  // AI Profile Assistant endpoints
  app.post('/api/profile/ai/analyze-link', isAuthenticated, async (req: any, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ message: 'URL is required' });
      }
      const analysis = analyzeLink(url);
      res.json(analysis);
    } catch (error) {
      console.error('Error analyzing link:', error);
      res.status(500).json({ message: 'Failed to analyze link' });
    }
  });

  app.post('/api/profile/ai/generate-bio', isAuthenticated, async (req: any, res) => {
    try {
      const { podcastName, podcastTopic, hostName, existingBio } = req.body;
      const result = await generateBioAndHeadlines({ podcastName, podcastTopic, hostName, existingBio });
      await chargeCredits(req.session.userId, 'ai_profile', { label: 'Bio & headlines' });
      res.json(result);
    } catch (error) {
      console.error('Error generating bio:', error);
      res.status(500).json({ message: 'Failed to generate bio' });
    }
  });

  app.post('/api/profile/ai/improve-bio', isAuthenticated, async (req: any, res) => {
    try {
      const { bio, hostName } = req.body;
      const improved = await improveBio(bio, hostName);
      await chargeCredits(req.session.userId, 'ai_profile', { label: 'Improve bio' });
      res.json({ bio: improved });
    } catch (error) {
      console.error('Error improving bio:', error);
      res.status(500).json({ message: 'Failed to improve bio' });
    }
  });

  app.post('/api/profile/ai/suggest-links', isAuthenticated, async (req: any, res) => {
    try {
      const { podcastName, podcastTopic } = req.body;
      const suggestions = await suggestLinksForPodcast(podcastName, podcastTopic);
      await chargeCredits(req.session.userId, 'ai_profile', { label: 'Link suggestions' });
      res.json({ suggestions });
    } catch (error) {
      console.error('Error suggesting links:', error);
      res.status(500).json({ message: 'Failed to suggest links' });
    }
  });

  app.get('/api/profile/ai/quick-templates', isAuthenticated, async (req: any, res) => {
    res.json({ templates: quickLinkTemplates });
  });

  // Podcasts endpoints (protected)
  app.get(api.podcasts.list.path, isAuthenticated, async (req: any, res) => {
    const userId = req.session.userId!;
    const podcastsList = await storage.getPodcastsByUserId(userId);
    const withEpisodeCounts = await Promise.all(
      podcastsList.map(async (podcast) => ({
        ...podcast,
        episodeCount: (await storage.getEpisodesByPodcast(podcast.id)).length,
      }))
    );
    res.json(withEpisodeCounts);
  });

  app.post(api.podcasts.create.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const input = api.podcasts.create.input.parse({ ...req.body, userId });
      const podcast = await storage.createPodcast(input);
      res.status(201).json(podcast);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  app.get('/api/podcasts/:id', isAuthenticated, async (req: any, res) => {
    const podcast = await storage.getPodcast(req.params.id);
    if (!podcast) return res.status(404).json({ message: 'Podcast not found' });
    if (podcast.userId !== req.session.userId) return res.status(403).json({ message: 'Not your podcast' });
    res.json(podcast);
  });

  app.patch('/api/podcasts/:id', isAuthenticated, async (req: any, res) => {
    const podcast = await storage.getPodcast(req.params.id);
    if (!podcast) return res.status(404).json({ message: 'Podcast not found' });
    if (podcast.userId !== req.session.userId) return res.status(403).json({ message: 'Not your podcast' });
    const updated = await storage.updatePodcast(req.params.id, req.body);
    res.json(updated);
  });

  // RSS endpoints
  app.get('/api/podcasts/:podcastId/rss', isAuthenticated, async (req: any, res) => {
    const podcast = await storage.getPodcast(req.params.podcastId);
    if (!podcast) return res.status(404).json({ message: 'Podcast not found' });
    if (podcast.userId !== req.session.userId) return res.status(403).json({ message: 'Not your podcast' });
    const feeds = await storage.getRssFeedsByPodcast(req.params.podcastId);
    // The hosted feed's URL is derived from wherever this request came in, never
    // from the stored row — a dev server writing to the shared database once
    // persisted a localhost URL that production then displayed.
    const hostedUrl = `${getPublicBaseUrl(req)}/feeds/${req.params.podcastId}/feed.xml`;
    res.json(feeds.map((f) => (f.sourceType === 'podlogix' ? { ...f, feedUrl: hostedUrl } : f)));
  });

  app.post('/api/podcasts/:podcastId/rss', isAuthenticated, async (req: any, res) => {
    try {
      const podcast = await storage.getPodcast(req.params.podcastId);
      if (!podcast) {
        return res.status(404).json({ message: 'Podcast not found' });
      }
      if (podcast.userId !== req.session.userId) {
        return res.status(403).json({ message: 'Not your podcast' });
      }

      const input = api.rss.create.input.parse({ ...req.body, podcastId: req.params.podcastId });
      const feed = await storage.createRssFeed(input);

      // Importing an existing external feed: pull its episodes in now rather
      // than leaving the podcaster with a feed row and no episodes to show.
      let importedEpisodes = 0;
      if (feed.sourceType === 'existing') {
        try {
          importedEpisodes = await syncEpisodesForPodcastFeed(feed.podcastId, feed.feedUrl);
          const totalEpisodes = (await storage.getEpisodesByPodcast(feed.podcastId)).length;
          await storage.updateRssFeed(feed.id, {
            status: 'active',
            lastValidatedAt: new Date(),
            episodeCount: totalEpisodes,
          });
        } catch (syncError) {
          console.error('Error importing episodes from RSS feed:', syncError);
        }
      }

      res.status(201).json({ ...feed, importedEpisodes });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  // Re-pull episodes for a feed added before episode import existed, or to
  // pick up new episodes published since the last sync.
  app.post('/api/podcasts/:podcastId/rss/:feedId/sync', isAuthenticated, async (req: any, res) => {
    const podcast = await storage.getPodcast(req.params.podcastId);
    if (!podcast) {
      return res.status(404).json({ message: 'Podcast not found' });
    }
    if (podcast.userId !== req.session.userId) {
      return res.status(403).json({ message: 'Not your podcast' });
    }
    const feed = (await storage.getRssFeedsByPodcast(req.params.podcastId)).find(
      (f) => f.id === req.params.feedId
    );
    if (!feed) {
      return res.status(404).json({ message: 'Feed not found' });
    }

    try {
      const importedEpisodes = await syncEpisodesForPodcastFeed(feed.podcastId, feed.feedUrl);
      const totalEpisodes = (await storage.getEpisodesByPodcast(feed.podcastId)).length;
      await storage.updateRssFeed(feed.id, {
        status: 'active',
        lastValidatedAt: new Date(),
        episodeCount: totalEpisodes,
      });
      res.json({ importedEpisodes });
    } catch (error) {
      console.error('Error syncing RSS feed:', error);
      res.status(500).json({ message: 'Failed to sync feed' });
    }
  });

  app.post(api.rss.validate.path, async (req, res) => {
    try {
      const { feedUrl } = api.rss.validate.input.parse(req.body);
      // Real validation: fetch and parse the feed
      try {
        const parsed = await parseFeed(feedUrl);
        res.json({ valid: true, episodeCount: parsed.episodes.length, title: parsed.title });
      } catch {
        res.json({ valid: false, episodeCount: 0 });
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  app.post('/api/podcasts/:podcastId/rss/generate', isAuthenticated, async (req: any, res) => {
    const podcastId = req.params.podcastId;
    const podcast = await storage.getPodcast(podcastId);
    if (!podcast) {
      return res.status(404).json({ message: 'Podcast not found' });
    }
    if (podcast.userId !== req.session.userId) {
      return res.status(403).json({ message: 'Not your podcast' });
    }
    // Real Podlogix-hosted RSS URL, served by GET /feeds/:podcastId/feed.xml below
    const baseUrl = getPublicBaseUrl(req);
    const feedUrl = `${baseUrl}/feeds/${podcastId}/feed.xml`;
    const existing = (await storage.getRssFeedsByPodcast(podcastId)).find(f => f.sourceType === 'podlogix');
    if (existing) {
      const updated = await storage.updateRssFeed(existing.id, { feedUrl, status: 'active' });
      return res.status(201).json(updated);
    }
    const feed = await storage.createRssFeed({ podcastId, feedUrl, sourceType: 'podlogix', status: 'active' });
    res.status(201).json(feed);
  });

  // ============ HOSTED PODCAST FEED (public, Apple-spec RSS 2.0) ============
  app.get('/feeds/:podcastId/feed.xml', async (req, res) => {
    const podcast = await storage.getPodcast(req.params.podcastId);
    if (!podcast) {
      return res.status(404).type('text/plain').send('Feed not found');
    }
    recordListenEvent({
      podcastId: podcast.id,
      kind: 'feed',
      ip: req.ip || '',
      userAgent: req.headers['user-agent'],
    });
    const publishedEpisodes = await storage.getPublishedEpisodesByPodcast(podcast.id);
    const xml = generatePodcastFeedXml(podcast, publishedEpisodes, getPublicBaseUrl(req));
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300'); // 5 min — podcast apps poll feeds
    res.send(xml);
  });

  // Tracked enclosure URL — feeds point audio here so every download is logged
  // before redirecting to the actual file. HEAD probes and mid-file range
  // requests from streaming apps are served but not counted.
  app.get('/e/:episodeId/:filename', async (req, res) => {
    const episode = await storage.getEpisode(req.params.episodeId);
    if (!episode?.audioUrl) {
      return res.status(404).type('text/plain').send('Not found');
    }
    if (isCountableDownload(req.method, req.headers.range)) {
      recordListenEvent({
        podcastId: episode.podcastId,
        episodeId: episode.id,
        kind: 'download',
        ip: req.ip || '',
        userAgent: req.headers['user-agent'],
      });
    }
    if (/^https?:\/\//i.test(episode.audioUrl)) {
      return res.redirect(302, episode.audioUrl);
    }
    if (episode.audioUrl.startsWith('/objects/') && isSupabaseStorageConfigured()) {
      return res.redirect(302, publicUrlForKey(episode.audioUrl.slice('/objects/'.length)));
    }
    return res.redirect(302, episode.audioUrl);
  });

  // ============ CREATOR EPISODES (hosted) ============
  const requirePodcastOwnership = async (req: any, res: any): Promise<any | null> => {
    const podcast = await storage.getPodcast(req.params.podcastId);
    if (!podcast) {
      res.status(404).json({ message: 'Podcast not found' });
      return null;
    }
    if (podcast.userId !== req.session.userId) {
      res.status(403).json({ message: 'Not your podcast' });
      return null;
    }
    return podcast;
  };

  app.get('/api/podcasts/:podcastId/episodes', isAuthenticated, async (req: any, res) => {
    const podcast = await requirePodcastOwnership(req, res);
    if (!podcast) return;
    const list = await storage.getEpisodesByPodcast(podcast.id);
    res.json(list);
  });

  app.get('/api/podcasts/:podcastId/stats', isAuthenticated, async (req: any, res) => {
    const podcast = await requirePodcastOwnership(req, res);
    if (!podcast) return;
    const days = Number.parseInt(String(req.query.days), 10) || 30;
    try {
      const stats = await getPodcastStats(podcast.id, days);
      res.json(stats);
    } catch (error) {
      console.error('Error computing podcast stats:', error);
      res.status(500).json({ message: 'Failed to load stats' });
    }
  });

  app.post('/api/podcasts/:podcastId/episodes', isAuthenticated, async (req: any, res) => {
    try {
      const podcast = await requirePodcastOwnership(req, res);
      if (!podcast) return;
      const input = insertEpisodeSchema.parse({ ...req.body, podcastId: podcast.id });
      const episode = await storage.createEpisode(input);
      res.status(201).json(episode);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  const requireEpisodeOwnership = async (req: any, res: any) => {
    const episode = await storage.getEpisode(req.params.id);
    if (!episode) {
      res.status(404).json({ message: 'Episode not found' });
      return null;
    }
    const podcast = await storage.getPodcast(episode.podcastId);
    if (!podcast || podcast.userId !== req.session.userId) {
      res.status(403).json({ message: 'Not your episode' });
      return null;
    }
    return episode;
  };

  app.get('/api/episodes/:id', isAuthenticated, async (req: any, res) => {
    const episode = await requireEpisodeOwnership(req, res);
    if (!episode) return;
    res.json(episode);
  });

  app.patch('/api/episodes/:id', isAuthenticated, async (req: any, res) => {
    const episode = await requireEpisodeOwnership(req, res);
    if (!episode) return;
    // Never allow changing ownership or identity via PATCH
    const { id, podcastId, createdAt, updatedAt, ...updates } = req.body ?? {};
    const updated = await storage.updateEpisode(episode.id, updates);
    res.json(updated);
  });

  app.delete('/api/episodes/:id', isAuthenticated, async (req: any, res) => {
    const episode = await requireEpisodeOwnership(req, res);
    if (!episode) return;
    await storage.deleteEpisode(episode.id);
    res.status(204).end();
  });

  app.post('/api/episodes/:id/publish', isAuthenticated, async (req: any, res) => {
    const episode = await requireEpisodeOwnership(req, res);
    if (!episode) return;
    if (!episode.audioUrl) {
      return res.status(400).json({ message: 'Episode needs an audio file before it can be published' });
    }
    const updated = await storage.updateEpisode(episode.id, {
      status: 'published',
      publishedAt: episode.publishedAt ?? new Date(),
      guid: episode.guid ?? episode.id,
    });
    res.json(updated);
  });

  app.post('/api/episodes/:id/unpublish', isAuthenticated, async (req: any, res) => {
    const episode = await requireEpisodeOwnership(req, res);
    if (!episode) return;
    const updated = await storage.updateEpisode(episode.id, { status: 'draft' });
    res.json(updated);
  });

  // Distribution endpoints
  app.get(api.distribution.channels.path, async (req, res) => {
    const channels = await storage.getDistributionChannels();
    res.json(channels);
  });

  app.get('/api/podcasts/:podcastId/distribution', isAuthenticated, async (req: any, res) => {
    const podcast = await storage.getPodcast(req.params.podcastId);
    if (!podcast) return res.status(404).json({ message: 'Podcast not found' });
    if (podcast.userId !== req.session.userId) return res.status(403).json({ message: 'Not your podcast' });
    const submissions = await storage.getChannelSubmissions(req.params.podcastId);
    res.json(submissions);
  });

  app.post('/api/podcasts/:podcastId/distribution/:channelId', isAuthenticated, async (req: any, res) => {
    const { podcastId, channelId } = req.params;
    const podcast = await storage.getPodcast(podcastId);
    if (!podcast) return res.status(404).json({ message: 'Podcast not found' });
    if (podcast.userId !== req.session.userId) return res.status(403).json({ message: 'Not your podcast' });
    // Create or update submission (simulated)
    const submission = await storage.createChannelSubmission({
      podcastId,
      channelId,
      status: 'pending',
    });
    // Simulate async approval after 2 seconds
    setTimeout(async () => {
      await storage.updateChannelSubmission(submission.id, {
        status: 'submitted',
        submittedAt: new Date(),
      });
    }, 2000);
    res.status(201).json(submission);
  });

  // ===========================================
  // PODCAST LISTENER FEATURES
  // ===========================================

  // Spotify OAuth: Initiate login
  app.get('/api/listener/spotify/auth', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const redirectUri = `${process.env.PUBLIC_BASE_URL || 'https://podlogix.io'}/api/listener/spotify/callback`;
      
      const authUrl = getSpotifyAuthUrl(redirectUri, userId);
      res.json({ authUrl });
    } catch (error) {
      console.error('Error generating Spotify auth URL:', error);
      res.status(500).json({ message: 'Failed to initiate Spotify login' });
    }
  });

  // Spotify OAuth: Callback (validates state matches authenticated user)
  app.get('/api/listener/spotify/callback', async (req: any, res) => {
    try {
      const { code, state } = req.query;
      
      if (!code || !state) {
        return res.redirect('/listener?spotify_error=missing_params');
      }

      const authenticatedUserId = req.session.userId!;
      if (!authenticatedUserId) {
        return res.redirect('/login?return_to=/listener&spotify_error=not_authenticated');
      }

      if (state !== authenticatedUserId) {
        console.error('Spotify OAuth state mismatch - potential CSRF');
        return res.redirect('/listener?spotify_error=auth_failed');
      }

      const redirectUri = `${process.env.PUBLIC_BASE_URL || 'https://podlogix.io'}/api/listener/spotify/callback`;

      const tokens = await exchangeCodeForTokens(code as string, redirectUri);
      const profile = await getSpotifyUserProfile(tokens.accessToken);
      
      const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
      
      await storage.upsertSpotifyConnection({
        userId: authenticatedUserId,
        spotifyUserId: profile.id,
        displayName: profile.displayName,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt,
        scope: tokens.scope,
      });

      res.redirect('/listener?spotify_connected=true');
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('Spotify callback error:', msg);
      const encoded = encodeURIComponent(msg.slice(0, 120));
      res.redirect(`/listener?spotify_error=auth_failed&spotify_error_detail=${encoded}`);
    }
  });

  // Spotify integration status (per-user)
  app.get('/api/listener/spotify/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const connected = await isSpotifyConnectedForUser(userId);
      const connection = connected ? await storage.getSpotifyConnection(userId) : null;
      res.json({ 
        connected, 
        displayName: connection?.displayName || null,
        spotifyUserId: connection?.spotifyUserId || null
      });
    } catch (error) {
      console.error('Spotify connection check error:', error);
      res.json({ connected: false });
    }
  });

  // Disconnect Spotify
  app.delete('/api/listener/spotify/disconnect', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteSpotifyConnection(userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error disconnecting Spotify:', error);
      res.status(500).json({ message: 'Failed to disconnect Spotify' });
    }
  });

  // ==================== YOUTUBE CONTENT SOURCE ====================

  const youtubeRedirectUri = () => `${process.env.PUBLIC_BASE_URL || 'https://podlogix.io'}/api/content-sources/youtube/callback`;

  app.get('/api/content-sources/youtube/auth', isAuthenticated, async (req: any, res) => {
    try {
      const state = crypto.randomBytes(24).toString('hex');
      req.session.youtubeOAuthState = state;
      res.json({ authUrl: getYouTubeAuthUrl(youtubeRedirectUri(), state) });
    } catch (error: any) {
      res.status(503).json({ message: error?.message || 'YouTube OAuth is not configured' });
    }
  });

  app.get('/api/content-sources/youtube/callback', async (req: any, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.redirect('/login?return_to=/connectors');
      if (!req.query.code || !req.session.youtubeOAuthState || req.query.state !== req.session.youtubeOAuthState) {
        return res.redirect('/connectors?youtube_source_error=auth_failed');
      }
      delete req.session.youtubeOAuthState;
      const tokens = await exchangeYouTubeCode(String(req.query.code), youtubeRedirectUri());
      const channel = await getOwnedChannel(tokens.access_token);
      const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const googleUser: any = userResponse.ok ? await userResponse.json() : {};
      const existing = await storage.getYouTubeConnection(userId);
      const refreshToken = tokens.refresh_token || existing?.refreshToken;
      if (!refreshToken) throw new Error('Google did not return a refresh token; reconnect and grant access');
      await storage.upsertYouTubeConnection({
        userId, googleUserId: googleUser.id || null, email: googleUser.email || null,
        channelId: channel.id, channelTitle: channel.title, channelThumbnailUrl: channel.thumbnailUrl,
        accessToken: tokens.access_token, refreshToken,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000), scope: tokens.scope,
      });
      res.redirect('/youtube-import?connected=true');
    } catch (error) {
      console.error('YouTube content source callback failed:', error);
      res.redirect('/connectors?youtube_source_error=auth_failed');
    }
  });

  app.get('/api/content-sources/youtube/status', isAuthenticated, async (req: any, res) => {
    try {
      const connection = await storage.getYouTubeConnection(req.session.userId!);
      res.json({ connected: !!connection, channelTitle: connection?.channelTitle || null, channelThumbnailUrl: connection?.channelThumbnailUrl || null });
    } catch (error) {
      console.error('YouTube status failed:', error);
      res.status(500).json({ message: 'Could not read the YouTube connection' });
    }
  });

  app.delete('/api/content-sources/youtube', isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteYouTubeConnection(req.session.userId!);
      res.json({ success: true });
    } catch (error) {
      console.error('YouTube disconnect failed:', error);
      res.status(500).json({ message: 'Could not disconnect YouTube' });
    }
  });

  app.get('/api/content-sources/youtube/videos', isAuthenticated, async (req: any, res) => {
    try {
      res.json(await listOwnedVideos(req.session.userId!, req.query.pageToken ? String(req.query.pageToken) : undefined));
    } catch (error: any) {
      res.status(502).json({ message: error?.message || 'Could not load YouTube videos' });
    }
  });

  app.post('/api/content-sources/youtube/import', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const input = z.object({
        videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), title: z.string().min(1).max(300),
        description: z.string().max(100000).optional(), thumbnailUrl: z.string().url().nullable().optional(),
        publishedAt: z.string().datetime().nullable().optional(), podcastId: z.string().min(1),
        sourceMediaUrl: z.string().url().optional(), sourceMimeType: z.string().max(100).optional(), sourceSizeBytes: z.number().int().nonnegative().optional(),
      }).parse(req.body);
      const connection = await storage.getYouTubeConnection(userId);
      if (!connection) return res.status(409).json({ message: 'Connect YouTube first' });
      // Ownership is proven per video (uploader channel == connected channel),
      // not by scanning the first page of the uploads playlist — older videos
      // beyond page one verify the same as new ones.
      const verified = await getOwnedVideo(userId, input.videoId);
      if (!verified) return res.status(403).json({ message: 'That video was not found on your connected channel' });
      // Only files that went through our upload flow may become the source —
      // same Supabase-host rule the posting routes enforce.
      if (input.sourceMediaUrl) {
        const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
        if (!supabaseUrl || !input.sourceMediaUrl.startsWith(`${supabaseUrl}/storage/v1/object/public/`)) {
          return res.status(400).json({ message: 'The source file must be uploaded through Podlogix' });
        }
      }
      const podcast = await storage.getPodcast(input.podcastId);
      if (!podcast || podcast.userId !== userId) return res.status(403).json({ message: 'Not your show' });
      const permalink = `https://www.youtube.com/watch?v=${input.videoId}`;
      const existingEpisode = (await storage.getEpisodesByPodcast(podcast.id)).find((episode) => episode.guid === `youtube:${input.videoId}`);
      if (existingEpisode) return res.json({ episode: existingEpisode, media: null, alreadyImported: true, needsSourceUpload: !existingEpisode.audioUrl });
      // One media row per video per user: importing into a second show (or
      // re-importing) reuses the shelf item instead of duplicating it.
      let media = (await storage.getMediaLibraryItemsByUser(userId)).find(
        (item) => item.platform === 'youtube' && item.externalId === input.videoId,
      ) ?? null;
      if (media && input.sourceMediaUrl && !media.mediaUrl) {
        await storage.updateMediaLibraryItemMedia(userId, 'youtube', input.videoId, input.sourceMediaUrl);
        media = { ...media, mediaUrl: input.sourceMediaUrl };
      }
      if (!media) {
        media = (await storage.createMediaLibraryItem({
          userId, platform: 'youtube', externalId: input.videoId, caption: verified.title,
          mediaType: input.sourceMimeType?.startsWith('audio/') ? 'audio' : 'video', mediaUrl: input.sourceMediaUrl || null,
          thumbnailUrl: verified.thumbnailUrl, permalink, postedAt: verified.publishedAt ? new Date(verified.publishedAt) : null,
        })) ?? null;
      }
      const episode = await storage.createEpisode({
        podcastId: podcast.id, title: verified.title, description: verified.description,
        showNotes: verified.description, audioUrl: input.sourceMediaUrl || null,
        fileSizeBytes: input.sourceSizeBytes, mimeType: input.sourceMimeType || (input.sourceMediaUrl ? 'video/mp4' : null),
        artworkUrl: verified.thumbnailUrl, guid: `youtube:${input.videoId}`, status: 'draft',
      });
      res.status(201).json({ episode, media, needsSourceUpload: !input.sourceMediaUrl });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || 'Invalid import' });
      console.error('YouTube import failed:', error);
      res.status(500).json({ message: 'Could not import that video' });
    }
  });

  // ==================== GOOGLE CALENDAR ====================

  app.get('/api/calendar/google/auth', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const redirectUri = `${process.env.PUBLIC_BASE_URL || 'https://podlogix.io'}/api/calendar/google/callback`;
      const authUrl = getGoogleCalendarAuthUrl(redirectUri, userId);
      res.json({ authUrl });
    } catch (error) {
      console.error('Error generating Google Calendar auth URL:', error);
      res.status(500).json({ message: 'Failed to initiate Google Calendar login' });
    }
  });

  // Google Calendar OAuth: Callback (validates state matches authenticated user)
  app.get('/api/calendar/google/callback', async (req: any, res) => {
    try {
      const { code, state } = req.query;

      if (!code || !state) {
        return res.redirect('/connectors?google_calendar_error=missing_params');
      }

      const authenticatedUserId = req.session.userId!;
      if (!authenticatedUserId) {
        return res.redirect('/login?return_to=/connectors&google_calendar_error=not_authenticated');
      }

      if (state !== authenticatedUserId) {
        console.error('Google Calendar OAuth state mismatch - potential CSRF');
        return res.redirect('/connectors?google_calendar_error=auth_failed');
      }

      const redirectUri = `${process.env.PUBLIC_BASE_URL || 'https://podlogix.io'}/api/calendar/google/callback`;

      const tokens = await exchangeGoogleCodeForTokens(code as string, redirectUri);
      const userInfo = await getGoogleUserInfo(tokens.accessToken);

      const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

      await storage.upsertGoogleCalendarConnection({
        userId: authenticatedUserId,
        googleUserId: userInfo.id,
        email: userInfo.email,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt,
        scope: tokens.scope,
      });

      res.redirect('/connectors?google_calendar_connected=true');
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('Google Calendar callback error:', msg);
      const encoded = encodeURIComponent(msg.slice(0, 120));
      res.redirect(`/connectors?google_calendar_error=auth_failed&google_calendar_error_detail=${encoded}`);
    }
  });

  // Google Calendar connection status (per-user)
  app.get('/api/calendar/google/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const connection = await storage.getGoogleCalendarConnection(userId);
      res.json({
        connected: !!connection,
        email: connection?.email || null,
      });
    } catch (error) {
      console.error('Google Calendar connection check error:', error);
      res.json({ connected: false });
    }
  });

  // Disconnect Google Calendar
  app.delete('/api/calendar/google/disconnect', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteGoogleCalendarConnection(userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error disconnecting Google Calendar:', error);
      res.status(500).json({ message: 'Failed to disconnect Google Calendar' });
    }
  });

  // Upcoming events from the connected Google Calendar (per-user)
  app.get('/api/calendar/google/events', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const connection = await storage.getGoogleCalendarConnection(userId);
      if (!connection) {
        return res.json({ connected: false, events: [] });
      }
      const events = await listGoogleCalendarEvents(userId, 5);
      res.json({ connected: true, events });
    } catch (error) {
      console.error('Error fetching Google Calendar events:', error);
      res.status(500).json({ message: 'Failed to fetch calendar events' });
    }
  });

  // Get user's followed podcasts from Spotify (per-user)
  app.get('/api/listener/spotify/shows', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const shows = await getUserSavedShowsForUser(userId);
      res.json(shows);
    } catch (error) {
      console.error('Error fetching Spotify shows:', error);
      res.status(500).json({ message: 'Failed to fetch Spotify shows' });
    }
  });

  // Search podcasts on Spotify (per-user)
  app.get('/api/listener/spotify/search', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ message: 'Search query required' });
      }
      const shows = await searchPodcastsForUser(userId, query);
      res.json(shows);
    } catch (error) {
      console.error('Error searching Spotify:', error);
      res.status(500).json({ message: 'Failed to search podcasts' });
    }
  });

  // Import podcast from Spotify (per-user)
  app.post('/api/listener/spotify/import', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { showId } = req.body;
      
      const show = await getShowDetailsForUser(userId, showId);
      if (!show) {
        return res.status(404).json({ message: 'Show not found' });
      }

      const rssFeed = await getRssFeedFromSpotify(showId);
      
      const subscription = await storage.createPodcastSubscription({
        userId,
        title: show.name,
        author: show.publisher,
        description: show.description,
        artworkUrl: show.imageUrl,
        feedUrl: rssFeed || show.externalUrl,
        spotifyShowId: show.id,
        isActive: true,
      });
      
      res.status(201).json(subscription);
    } catch (error) {
      console.error('Error importing Spotify show:', error);
      res.status(500).json({ message: 'Failed to import podcast' });
    }
  });

  // Sync episodes from all subscriptions
  app.post('/api/listener/sync', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const result = await syncAllSubscriptionsForUser(userId);
      res.json(result);
    } catch (error) {
      console.error('Error syncing episodes:', error);
      res.status(500).json({ message: 'Failed to sync episodes' });
    }
  });

  // Run auto-briefings for pending episodes
  app.post('/api/listener/auto-briefings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const maxEpisodes = req.body.maxEpisodes || 3;
      const result = await processAutoBriefingsForUser(userId, maxEpisodes);
      res.json(result);
    } catch (error) {
      console.error('Error processing auto-briefings:', error);
      res.status(500).json({ message: 'Failed to process briefings' });
    }
  });

  // Get or create Spotify playlist
  app.get('/api/listener/spotify/playlist', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const playlist = await getPlaylistForUser(userId);
      res.json(playlist || { exists: false });
    } catch (error) {
      console.error('Error getting playlist:', error);
      res.status(500).json({ message: 'Failed to get playlist' });
    }
  });

  // Create Spotify playlist
  app.post('/api/listener/spotify/playlist', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const playlist = await createOrGetBriefingsPlaylist(userId);
      res.json(playlist);
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('Error creating playlist:', msg);
      res.status(500).json({ message: msg });
    }
  });

  // Add episode to Spotify playlist
  app.post('/api/listener/spotify/playlist/add', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { episodeId, podcastName, episodeTitle } = req.body;

      const playlist = await createOrGetBriefingsPlaylist(userId);
      if (!playlist) {
        return res.status(500).json({ message: 'Could not get or create your Podlogix Recommendations playlist — try clicking "Create Playlist" first.' });
      }

      const episodeUri = await searchSpotifyEpisode(userId, podcastName, episodeTitle);
      if (!episodeUri) {
        return res.status(404).json({ message: 'Episode not found on Spotify' });
      }

      const added = await addEpisodeToPlaylist(userId, playlist.id, episodeUri);
      if (!added) {
        return res.status(500).json({ message: 'Failed to add episode to playlist' });
      }

      res.json({ success: true, playlistUrl: playlist.externalUrl });
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('Error adding to playlist:', msg);
      res.status(500).json({ message: msg });
    }
  });

  // Add all new episodes to Spotify playlist
  app.post('/api/listener/spotify/playlist/add-new', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;

      const playlist = await createOrGetBriefingsPlaylist(userId);
      if (!playlist) {
        return res.status(500).json({ message: 'Could not get or create your Podlogix Recommendations playlist — try clicking "Create Playlist" first.' });
      }

      // Get all new (unread) episodes with their subscription info
      const episodes = await storage.getSubscriptionEpisodesByUser(userId);
      const subscriptions = await storage.getPodcastSubscriptionsByUserId(userId);
      const subsMap = new Map(subscriptions.map(s => [s.id, s]));
      
      // Filter for new episodes (those that aren't read yet)
      const newEpisodes = episodes.filter(e => !e.isRead).slice(0, 20); // Limit to 20 to avoid rate limits
      
      let addedCount = 0;
      const errors: string[] = [];
      
      for (const episode of newEpisodes) {
        const subscription = subsMap.get(episode.subscriptionId);
        if (!subscription) continue;
        
        try {
          const episodeUri = await searchSpotifyEpisode(userId, subscription.title, episode.title);
          if (episodeUri) {
            const added = await addEpisodeToPlaylist(userId, playlist.id, episodeUri);
            if (added) addedCount++;
          }
        } catch (err) {
          errors.push(episode.title);
        }
      }

      res.json({ 
        success: true, 
        addedCount, 
        totalAttempted: newEpisodes.length,
        playlistUrl: playlist.externalUrl,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('Error adding new episodes to playlist:', msg);
      res.status(500).json({ message: msg });
    }
  });

  // Sync smart playlist: add the latest episode from each marked podcast
  app.post('/api/listener/spotify/playlist/sync-smart', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { subscriptionIds } = req.body;

      if (!subscriptionIds || !Array.isArray(subscriptionIds) || subscriptionIds.length === 0) {
        return res.status(400).json({ message: 'No podcasts selected — mark at least one podcast for the smart playlist' });
      }

      const playlist = await createOrGetBriefingsPlaylist(userId);
      if (!playlist) {
        return res.status(500).json({ message: 'Could not get or create your Podlogix Recommendations playlist — try clicking "Create Playlist" first, then sync again.' });
      }

      const allEpisodes = await storage.getSubscriptionEpisodesByUser(userId);
      const subs = await storage.getPodcastSubscriptionsByUserId(userId);
      const subsMap = new Map(subs.map(s => [s.id, s]));

      let addedCount = 0;

      for (const subId of subscriptionIds) {
        const subscription = subsMap.get(subId);
        if (!subscription) continue;

        // Get the most recent episode for this subscription
        const subEpisodes = allEpisodes
          .filter(e => e.subscriptionId === subId)
          .sort((a, b) => {
            const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
            const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
            return db - da;
          });

        const latestEpisode = subEpisodes[0];
        if (!latestEpisode) continue;

        try {
          const episodeUri = await searchSpotifyEpisode(userId, subscription.title, latestEpisode.title);
          if (episodeUri) {
            const added = await addEpisodeToPlaylist(userId, playlist.id, episodeUri);
            if (added) addedCount++;
          }
        } catch (err) {
          console.error(`Error adding episode for ${subscription.title}:`, err);
        }
      }

      res.json({ success: true, addedCount, playlistUrl: playlist.externalUrl || null });
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('Error syncing smart playlist:', msg);
      res.status(500).json({ message: msg });
    }
  });

  // Podcast-aware AI chat for the listener dashboard
  app.post('/api/listener/chat', isAuthenticated, async (req: any, res) => {
    try {
      const { message, context, history = [] } = req.body;
      if (!message) return res.status(400).json({ message: 'No message provided' });

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ message: 'AI chat is not configured — OPENAI_API_KEY missing' });
      }

      const systemPrompt = `You are Podlogix AI, a helpful assistant for podcast listeners. ${context || ''}
Help users discover insights from their podcasts, summarize topics, suggest new shows, and answer questions about their listening habits.
Keep responses concise and conversational (2-4 sentences max unless more detail is needed).`;

      const messages = [
        { role: 'system', content: systemPrompt },
        ...history.map((m: any) => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
      ];

      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          max_tokens: 400,
          temperature: 0.7,
        }),
      });

      if (!aiRes.ok) {
        const err = await aiRes.text();
        console.error('OpenAI error:', err);
        return res.status(502).json({ message: 'AI service error, please try again' });
      }

      const data = await aiRes.json() as any;
      const response = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
      res.json({ response });
    } catch (error: any) {
      console.error('Listener chat error:', error);
      res.status(500).json({ message: 'Something went wrong' });
    }
  });

  // Get user's podcast subscriptions
  app.get('/api/listener/subscriptions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const subscriptions = await storage.getPodcastSubscriptionsByUserId(userId);
      res.json(subscriptions);
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
      res.status(500).json({ message: 'Failed to fetch subscriptions' });
    }
  });

  // Subscribe to podcast via RSS feed
  app.post('/api/listener/subscriptions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { feedUrl } = req.body;
      
      // Validate and parse the feed
      const feedData = await parseFeed(feedUrl);
      
      const subscription = await storage.createPodcastSubscription({
        userId,
        title: feedData.title,
        author: feedData.author,
        description: feedData.description,
        artworkUrl: feedData.imageUrl,
        feedUrl,
        isActive: true,
      });
      
      // Fetch and store latest episodes
      const episodes = feedData.episodes.slice(0, 10);
      for (const ep of episodes) {
        await storage.createSubscriptionEpisode({
          subscriptionId: subscription.id,
          userId,
          title: ep.title,
          description: ep.description,
          audioUrl: ep.audioUrl,
          duration: ep.duration,
          publishedAt: ep.publishedAt,
          guid: ep.guid,
          transcriptStatus: 'pending',
          briefingStatus: 'pending',
          isRead: false,
        });
      }
      
      res.status(201).json(subscription);
    } catch (error) {
      console.error('Error creating subscription:', error);
      res.status(500).json({ message: 'Failed to subscribe to podcast' });
    }
  });

  // Unsubscribe from podcast
  app.delete('/api/listener/subscriptions/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const sub = await storage.getPodcastSubscription(req.params.id);
      
      if (!sub || sub.userId !== userId) {
        return res.status(404).json({ message: 'Subscription not found' });
      }
      
      await storage.deletePodcastSubscription(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting subscription:', error);
      res.status(500).json({ message: 'Failed to unsubscribe' });
    }
  });

  // Get episodes for user (all subscriptions)
  app.get('/api/listener/episodes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const episodes = await storage.getSubscriptionEpisodesByUser(userId);
      res.json(episodes);
    } catch (error) {
      console.error('Error fetching episodes:', error);
      res.status(500).json({ message: 'Failed to fetch episodes' });
    }
  });

  // Get episodes for specific subscription
  app.get('/api/listener/subscriptions/:id/episodes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const sub = await storage.getPodcastSubscription(req.params.id);
      
      if (!sub || sub.userId !== userId) {
        return res.status(404).json({ message: 'Subscription not found' });
      }
      
      const episodes = await storage.getSubscriptionEpisodesBySubscription(req.params.id);
      res.json(episodes);
    } catch (error) {
      console.error('Error fetching subscription episodes:', error);
      res.status(500).json({ message: 'Failed to fetch episodes' });
    }
  });

  // Mark episode as read
  app.patch('/api/listener/episodes/:id/read', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const episode = await storage.getSubscriptionEpisode(req.params.id);
      
      if (!episode || episode.userId !== userId) {
        return res.status(404).json({ message: 'Episode not found' });
      }
      
      const updated = await storage.updateSubscriptionEpisode(req.params.id, { isRead: true });
      res.json(updated);
    } catch (error) {
      console.error('Error marking episode read:', error);
      res.status(500).json({ message: 'Failed to update episode' });
    }
  });

  // Transcribe episode (uses OpenAI Whisper)
  app.post('/api/listener/episodes/:id/transcribe', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const episode = await storage.getSubscriptionEpisode(req.params.id);
      
      if (!episode || episode.userId !== userId) {
        return res.status(404).json({ message: 'Episode not found' });
      }
      
      if (!episode.audioUrl) {
        return res.status(400).json({ message: 'Episode has no audio URL' });
      }
      
      // Transcription runs inside the request — Vercel kills background tasks
      // once a response is sent. A long episode won't fit in one invocation, so
      // this returns partial progress and the client calls again to resume.
      const result = await transcribeEpisode(req.params.id, userId);
      res.json({
        status: result.status,
        partsDone: result.partsDone,
        partsTotal: result.partsTotal,
        message: result.status === 'completed'
          ? 'Transcription complete'
          : `Transcribed part ${result.partsDone} of ${result.partsTotal}`,
      });
    } catch (error: any) {
      console.error('Error transcribing episode:', error);
      res.status(500).json({ message: error?.message || 'Failed to transcribe episode' });
    }
  });

  // Credits — this month's usage, per-action breakdown, and recent receipts.
  // Admins also get our estimated vendor cost so spend can be reconciled.
  app.get('/api/credits/summary', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const me = await authStorage.getUser(userId).catch(() => null);
      const includeCost = me?.role === 'admin' || me?.role === 'superadmin';
      res.json(await getCreditSummary(userId, { includeCost }));
    } catch (error: any) {
      console.error('Error loading credit summary:', error);
      res.status(500).json({ message: 'Failed to load credits' });
    }
  });

  // Read a finished transcript — JSON for the in-app viewer, or ?format=txt
  // to download it as a plain-text file.
  app.get('/api/listener/episodes/:id/transcript', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const episode = await storage.getSubscriptionEpisode(req.params.id);
      if (!episode || episode.userId !== userId) {
        return res.status(404).json({ message: 'Episode not found' });
      }
      if (!episode.transcript) {
        return res.status(404).json({ message: 'This episode has no transcript yet' });
      }
      if (req.query.format === 'txt') {
        const safeName = episode.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'transcript';
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}-transcript.txt"`);
        return res.send(`${episode.title}\n\n${episode.transcript}`);
      }
      res.json({
        id: episode.id,
        title: episode.title,
        publishedAt: episode.publishedAt,
        transcript: episode.transcript,
        wordCount: episode.transcript.split(/\s+/).filter(Boolean).length,
      });
    } catch (error: any) {
      console.error('Error reading transcript:', error);
      res.status(500).json({ message: 'Failed to load transcript' });
    }
  });

  // Ask one episode a question. The model answers from the transcript only and
  // returns verbatim passages so the client can highlight where in the episode
  // it happened. Crisis language in the question surfaces the resources block
  // first, same as the cross-transcript search.
  app.post('/api/listener/episodes/:id/ask', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const episode = await storage.getSubscriptionEpisode(req.params.id);
      if (!episode || episode.userId !== userId) return res.status(404).json({ message: 'Episode not found' });
      if (!episode.transcript) return res.status(400).json({ message: 'Transcribe this episode first.' });
      const question = String(req.body?.question ?? '').trim();
      if (question.length < 3) return res.status(400).json({ message: 'Ask a question.' });
      if (!process.env.OPENAI_API_KEY) return res.status(503).json({ message: 'AI is not configured.' });

      const crisis = detectCrisis(question) ? CRISIS_RESOURCES : null;
      const transcript = episode.transcript;
      // gpt-4o's context comfortably holds our longest transcripts (~55k chars); cap defensively.
      const excerpt = transcript.slice(0, 120_000);
      const history: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(req.body?.history)
        ? req.body.history.filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string').slice(-6)
        : [];

      const OpenAI = (await import('openai')).default;
      const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.2,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You help a listener find things in ONE podcast episode. Answer only from the transcript below; if it isn't there, say so plainly.
Respond with JSON: {"answer": "<2-4 sentences, specific, in plain language>", "passages": ["<verbatim excerpt copied EXACTLY from the transcript, 15-60 words, that supports the answer>", ...up to 4]}
Passages must be exact substrings of the transcript — do not paraphrase, fix grammar, or add ellipses.

EPISODE: "${episode.title}"
TRANSCRIPT:
${excerpt}`,
          },
          ...history,
          { role: 'user', content: question },
        ],
      });

      let parsed: { answer?: string; passages?: string[] } = {};
      try { parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}'); } catch { parsed = {}; }

      // Verify every passage really appears (the client highlights by string match),
      // and turn its position into an approximate minute mark.
      const lower = transcript.toLowerCase();
      const durationSec = Number(episode.duration) || 0;
      const passages = (parsed.passages ?? [])
        .map((p) => String(p ?? '').trim())
        .filter((p) => p.length >= 20)
        .map((p) => {
          let idx = lower.indexOf(p.toLowerCase());
          let quote = p;
          if (idx < 0) {
            // The model sometimes trims punctuation — fall back to the first ~50 chars.
            const head = p.slice(0, 50).toLowerCase();
            idx = lower.indexOf(head);
            if (idx >= 0) quote = transcript.slice(idx, idx + p.length);
          }
          if (idx < 0) return null;
          const position = idx / Math.max(1, transcript.length);
          return { quote, position, approxMinute: durationSec ? Math.round((position * durationSec) / 60) : null };
        })
        .filter((p): p is { quote: string; position: number; approxMinute: number | null } => p !== null)
        .slice(0, 4);

      res.json({ answer: parsed.answer || "I couldn't find that in this episode.", passages, crisis });
    } catch (error: any) {
      console.error('Error answering episode question:', error?.message || error);
      res.status(500).json({ message: 'The AI could not answer right now — try again.' });
    }
  });

  // Generate briefing for episode
  app.post('/api/listener/episodes/:id/briefing', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const episode = await storage.getSubscriptionEpisode(req.params.id);

      if (!episode || episode.userId !== userId) {
        return res.status(404).json({ message: 'Episode not found' });
      }

      if (!episode.transcript) {
        return res.status(400).json({ message: 'Episode must be transcribed first' });
      }

      // Run briefing synchronously — Vercel kills background tasks after response is sent
      await processEpisodeBriefing(req.params.id, userId);
      const updated = await storage.getSubscriptionEpisode(req.params.id);
      res.json({ message: 'Briefing complete', status: updated?.briefingStatus || 'complete' });
    } catch (error: any) {
      console.error('Error generating briefing:', error);
      res.status(500).json({ message: error?.message || 'Failed to generate briefing' });
    }
  });

  // Get briefing for specific episode
  app.get('/api/listener/episodes/:id/briefing', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const episode = await storage.getSubscriptionEpisode(req.params.id);
      
      if (!episode || episode.userId !== userId) {
        return res.status(404).json({ message: 'Episode not found' });
      }
      
      const briefing = await storage.getEpisodeBriefingByEpisode(req.params.id);
      if (!briefing) {
        return res.status(404).json({ message: 'Briefing not found' });
      }
      
      res.json(briefing);
    } catch (error) {
      console.error('Error fetching episode briefing:', error);
      res.status(500).json({ message: 'Failed to fetch briefing' });
    }
  });

  // ===========================================
  // USER INTERESTS (for personalized briefings)
  // ===========================================

  // Get user interests
  app.get('/api/listener/interests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const interests = await storage.getUserInterests(userId);
      res.json(interests);
    } catch (error) {
      console.error('Error fetching interests:', error);
      res.status(500).json({ message: 'Failed to fetch interests' });
    }
  });

  // Add user interest
  app.post('/api/listener/interests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const input = insertUserInterestSchema.parse({ ...req.body, userId });
      const interest = await storage.createUserInterest(input);
      res.status(201).json(interest);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error('Error creating interest:', error);
      res.status(500).json({ message: 'Failed to create interest' });
    }
  });

  // Update user interest
  app.patch('/api/listener/interests/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const interests = await storage.getUserInterests(userId);
      const interest = interests.find(i => i.id === req.params.id);
      
      if (!interest) {
        return res.status(404).json({ message: 'Interest not found' });
      }
      
      const updated = await storage.updateUserInterest(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      console.error('Error updating interest:', error);
      res.status(500).json({ message: 'Failed to update interest' });
    }
  });

  // Delete user interest
  app.delete('/api/listener/interests/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const interests = await storage.getUserInterests(userId);
      const interest = interests.find(i => i.id === req.params.id);
      
      if (!interest) {
        return res.status(404).json({ message: 'Interest not found' });
      }
      
      await storage.deleteUserInterest(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting interest:', error);
      res.status(500).json({ message: 'Failed to delete interest' });
    }
  });

  // ===========================================
  // EPISODE BRIEFINGS
  // ===========================================

  // Get all briefings for user
  app.get('/api/listener/briefings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const briefings = await storage.getEpisodeBriefingsByUser(userId);
      res.json(briefings);
    } catch (error) {
      console.error('Error fetching briefings:', error);
      res.status(500).json({ message: 'Failed to fetch briefings' });
    }
  });

  // Get specific briefing
  app.get('/api/listener/briefings/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const briefing = await storage.getEpisodeBriefing(req.params.id);
      
      if (!briefing || briefing.userId !== userId) {
        return res.status(404).json({ message: 'Briefing not found' });
      }
      
      res.json(briefing);
    } catch (error) {
      console.error('Error fetching briefing:', error);
      res.status(500).json({ message: 'Failed to fetch briefing' });
    }
  });

  // Toggle bookmark on briefing
  app.patch('/api/listener/briefings/:id/bookmark', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const briefing = await storage.getEpisodeBriefing(req.params.id);
      
      if (!briefing || briefing.userId !== userId) {
        return res.status(404).json({ message: 'Briefing not found' });
      }
      
      const updated = await storage.updateEpisodeBriefing(req.params.id, { 
        isBookmarked: !briefing.isBookmarked 
      });
      res.json(updated);
    } catch (error) {
      console.error('Error updating briefing bookmark:', error);
      res.status(500).json({ message: 'Failed to update briefing' });
    }
  });

  // ===========================================
  // NOTIFICATIONS
  // ===========================================

  // Get all notifications
  app.get('/api/listener/notifications', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const notifications = await storage.getNotificationsByUser(userId);
      res.json(notifications);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ message: 'Failed to fetch notifications' });
    }
  });

  // Get unread notification count
  app.get('/api/listener/notifications/unread', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const notifications = await storage.getUnreadNotifications(userId);
      res.json({ count: notifications.length, notifications });
    } catch (error) {
      console.error('Error fetching unread notifications:', error);
      res.status(500).json({ message: 'Failed to fetch notifications' });
    }
  });

  // Mark notification as read
  app.patch('/api/listener/notifications/:id/read', isAuthenticated, async (req: any, res) => {
    try {
      await storage.markNotificationRead(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error marking notification read:', error);
      res.status(500).json({ message: 'Failed to update notification' });
    }
  });

  // Mark all notifications as read
  app.patch('/api/listener/notifications/read-all', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      await storage.markAllNotificationsRead(userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error marking all notifications read:', error);
      res.status(500).json({ message: 'Failed to update notifications' });
    }
  });

  // ==================== BRAND DASHBOARD ROUTES (MODASH) ====================

  // Check if Modash is configured
  app.get('/api/brand/modash/status', isAuthenticated, async (req: any, res) => {
    res.json({ configured: isModashConfigured() });
  });

  // ==================== YOUTUBE INFLUENCER DISCOVERY (FREE API) ====================

  // Check if YouTube API is configured
  app.get('/api/brand/youtube/status', isAuthenticated, async (req: any, res) => {
    res.json({ configured: isYouTubeConfigured() });
  });

  // Search YouTube channels (admin only)
  app.post('/api/brand/youtube/search', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { query, maxResults, pageToken, order } = req.body;
      
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Query is required' });
      }

      const results = await searchYouTubeChannels(query, {
        maxResults: maxResults || 10,
        pageToken,
        order: order || 'relevance',
      });

      // Transform to influencer-like format for consistent UI
      const influencers = results.channels.map(channel => ({
        userId: channel.channelId,
        username: channel.customUrl?.replace('@', '') || channel.title.toLowerCase().replace(/\s+/g, ''),
        fullName: channel.title,
        profilePicUrl: channel.thumbnailUrl,
        bio: channel.description?.slice(0, 200) || '',
        followerCount: channel.subscriberCount,
        followingCount: 0,
        engagementRate: 0,
        avgLikes: 0,
        avgComments: 0,
        avgViews: Math.round(channel.viewCount / Math.max(channel.videoCount, 1)),
        videoCount: channel.videoCount,
        totalViews: channel.viewCount,
        location: channel.country,
        categories: [],
        platform: 'youtube',
        channelUrl: channel.customUrl 
          ? `https://youtube.com/${channel.customUrl}`
          : `https://youtube.com/channel/${channel.channelId}`,
      }));

      res.json({
        influencers,
        total: results.total,
        nextPageToken: results.nextPageToken,
        hasMore: !!results.nextPageToken,
      });
    } catch (error) {
      console.error('Error searching YouTube channels:', error);
      res.status(500).json({ message: 'Failed to search YouTube channels' });
    }
  });

  // Get YouTube channel details with videos
  app.get('/api/brand/youtube/channel/:channelId', isAuthenticated, async (req: any, res) => {
    try {
      const { channelId } = req.params;
      
      const [channel, videos] = await Promise.all([
        getChannelDetails(channelId),
        getChannelVideos(channelId, 10),
      ]);

      if (!channel) {
        return res.status(404).json({ message: 'Channel not found' });
      }

      // Calculate engagement from recent videos
      let avgViews = 0, avgLikes = 0, avgComments = 0;
      if (videos.length > 0) {
        avgViews = Math.round(videos.reduce((sum, v) => sum + v.viewCount, 0) / videos.length);
        avgLikes = Math.round(videos.reduce((sum, v) => sum + v.likeCount, 0) / videos.length);
        avgComments = Math.round(videos.reduce((sum, v) => sum + v.commentCount, 0) / videos.length);
      }

      const engagementRate = calculateEngagementRate(
        channel.subscriberCount,
        avgViews,
        avgLikes,
        avgComments
      );

      res.json({
        ...channel,
        recentVideos: videos,
        avgViews,
        avgLikes,
        avgComments,
        engagementRate,
      });
    } catch (error) {
      console.error('Error getting YouTube channel:', error);
      res.status(500).json({ message: 'Failed to get channel details' });
    }
  });

  // ==================== INSTAGRAM INFLUENCER DISCOVERY (FREE API) ====================

  // Check if Instagram lookup is configured
  app.get('/api/brand/instagram/status', isAuthenticated, async (req: any, res) => {
    res.json({ configured: isInstagramLookupConfigured() });
  });

  // Lookup Instagram profile by username
  app.post('/api/brand/instagram/lookup', isAuthenticated, async (req: any, res) => {
    try {
      const usernameSchema = z.object({
        username: z.string().min(1, 'Username is required').max(30, 'Username too long'),
      });
      
      const parseResult = usernameSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid username', details: parseResult.error.issues });
      }
      
      const { username } = parseResult.data;

      if (!isInstagramLookupConfigured()) {
        return res.status(503).json({ 
          error: 'Instagram lookup not configured',
          message: 'Please configure META_ACCESS_TOKEN, META_APP_ID, and META_APP_SECRET'
        });
      }

      const result = await lookupInstagramProfile(username);
      
      if (!result.profile) {
        let statusCode: number;
        switch (result.error?.type) {
          case 'not_configured':
          case 'no_ig_account':
            statusCode = 503;
            break;
          case 'api_error':
            statusCode = 500;
            break;
          case 'profile_not_found':
          default:
            statusCode = 404;
            break;
        }
        return res.status(statusCode).json({ 
          error: result.error?.type || 'profile_not_found',
          message: result.error?.message || 'Could not find Instagram profile.'
        });
      }

      const profile = result.profile;

      res.json({
        influencers: [{
          userId: profile.userId,
          username: profile.username,
          fullName: profile.fullName,
          profilePicUrl: profile.profilePicUrl,
          bio: profile.bio,
          followerCount: profile.followerCount,
          followingCount: profile.followingCount,
          engagementRate: 0,
          avgLikes: 0,
          avgComments: 0,
          mediaCount: profile.mediaCount,
          location: null,
          categories: [],
          platform: 'instagram',
          profileUrl: `https://instagram.com/${profile.username}`,
        }],
        total: 1,
        hasMore: false,
      });
    } catch (error) {
      console.error('Error looking up Instagram profile:', error);
      res.status(500).json({ message: 'Failed to lookup Instagram profile' });
    }
  });

  // Instagram hashtag discovery status
  app.get('/api/brand/instagram/hashtag-status', isAuthenticated, async (req: any, res) => {
    try {
      const status = await checkHashtagServiceStatus();
      res.json(status);
    } catch (error) {
      console.error('Error checking hashtag service status:', error);
      res.status(500).json({ message: 'Failed to check hashtag service status' });
    }
  });

  // Instagram hashtag-based post discovery (admin only)
  app.post('/api/brand/instagram/hashtag-search', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const hashtagSchema = z.object({
        hashtag: z.string().min(1, 'Hashtag is required').max(50, 'Hashtag too long'),
      });
      
      const parseResult = hashtagSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid hashtag', details: parseResult.error.issues });
      }
      
      const { hashtag } = parseResult.data;
      const result = await discoverInfluencersByHashtag(hashtag);
      
      if (result.error) {
        let statusCode: number;
        switch (result.error.type) {
          case 'not_configured':
          case 'no_ig_account':
            statusCode = 503;
            break;
          case 'rate_limit':
            statusCode = 429;
            break;
          case 'api_error':
            statusCode = 500;
            break;
          case 'hashtag_not_found':
          default:
            statusCode = 404;
            break;
        }
        return res.status(statusCode).json({ 
          error: result.error.type,
          message: result.error.message,
          hashtag: result.hashtag
        });
      }

      res.json({
        hashtag: result.hashtag,
        hashtagId: result.hashtagId,
        posts: result.posts.map(post => ({
          postId: post.postId,
          caption: post.caption,
          mediaType: post.mediaType,
          likeCount: post.likeCount,
          commentsCount: post.commentsCount,
          engagement: post.engagement,
          timestamp: post.timestamp,
          permalink: post.permalink,
          platform: 'instagram',
        })),
        total: result.total,
      });
    } catch (error) {
      console.error('Error discovering posts by hashtag:', error);
      res.status(500).json({ message: 'Failed to discover posts by hashtag' });
    }
  });

  // LinkedIn Discovery Routes
  app.get('/api/brand/linkedin/status', isAuthenticated, async (req: any, res) => {
    res.json({
      configured: isLinkedInDiscoveryConfigured(),
    });
  });

  app.post('/api/brand/linkedin/lookup', isAuthenticated, async (req: any, res) => {
    try {
      const { url } = req.body;
      
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'LinkedIn URL is required' });
      }

      if (url.includes('/company/')) {
        const company = await extractLinkedInCompanyInfo(url);
        if (company) {
          return res.json({ type: 'company', data: company });
        }
      } else if (url.includes('/in/')) {
        const person = await extractLinkedInProfileInfo(url);
        if (person) {
          return res.json({ type: 'person', data: person });
        }
      }

      res.status(400).json({ error: 'Could not parse LinkedIn URL. Please provide a valid profile or company URL.' });
    } catch (error) {
      console.error('Error looking up LinkedIn profile:', error);
      res.status(500).json({ message: 'Failed to lookup LinkedIn profile' });
    }
  });

  app.get('/api/brand/linkedin/search-url', isAuthenticated, async (req: any, res) => {
    try {
      const { query, type = 'people' } = req.query;
      
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Search query is required' });
      }

      const searchUrl = getLinkedInSearchUrl(query, type as 'people' | 'companies');
      const suggestions = generateLinkedInSearchSuggestions(query);

      res.json({ searchUrl, suggestions });
    } catch (error) {
      console.error('Error generating LinkedIn search URL:', error);
      res.status(500).json({ message: 'Failed to generate search URL' });
    }
  });

  app.get('/api/brand/linkedin/hashtag-url', isAuthenticated, async (req: any, res) => {
    try {
      const { hashtag } = req.query;
      
      if (!hashtag || typeof hashtag !== 'string') {
        return res.status(400).json({ error: 'Hashtag is required' });
      }

      const hashtagUrl = getLinkedInHashtagUrl(hashtag);
      res.json({ hashtagUrl, hashtag: hashtag.replace(/^#/, '') });
    } catch (error) {
      console.error('Error generating LinkedIn hashtag URL:', error);
      res.status(500).json({ message: 'Failed to generate hashtag URL' });
    }
  });

  // Search influencers via Modash
  app.post('/api/brand/influencers/search', isAuthenticated, async (req: any, res) => {
    try {
      const parseResult = modashSearchSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid search parameters', details: parseResult.error.issues });
      }
      
      const { platform, minFollowers, maxFollowers, minEngagement, maxEngagement, location, keywords, hashtags, page } = parseResult.data;
      
      const results = await searchInfluencers({
        platform,
        minFollowers,
        maxFollowers,
        minEngagement,
        maxEngagement,
        location,
        keywords,
        hashtags,
      }, page);
      
      res.json(results);
    } catch (error) {
      console.error('Error searching influencers:', error);
      res.status(500).json({ message: 'Failed to search influencers' });
    }
  });

  // Get influencer profile
  app.get('/api/brand/influencers/profile/:platform/:username', isAuthenticated, async (req: any, res) => {
    try {
      const { platform, username } = req.params;
      const profile = await getInfluencerProfile(platform, username);
      if (!profile) {
        return res.status(404).json({ message: 'Influencer not found' });
      }
      res.json(profile);
    } catch (error) {
      console.error('Error getting influencer profile:', error);
      res.status(500).json({ message: 'Failed to get influencer profile' });
    }
  });

  // Get saved influencers
  app.get('/api/brand/saved-influencers', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const influencers = await storage.getSavedInfluencersByUser(userId);
      res.json(influencers);
    } catch (error) {
      console.error('Error getting saved influencers:', error);
      res.status(500).json({ message: 'Failed to get saved influencers' });
    }
  });

  // Save an influencer
  app.post('/api/brand/saved-influencers', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const data = insertSavedInfluencerSchema.parse({ ...req.body, userId });
      const influencer = await storage.createSavedInfluencer(data);
      res.status(201).json(influencer);
    } catch (error) {
      console.error('Error saving influencer:', error);
      res.status(500).json({ message: 'Failed to save influencer' });
    }
  });

  // Update saved influencer
  app.patch('/api/brand/saved-influencers/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const influencer = await storage.updateSavedInfluencer(id, req.body);
      res.json(influencer);
    } catch (error) {
      console.error('Error updating saved influencer:', error);
      res.status(500).json({ message: 'Failed to update influencer' });
    }
  });

  // Delete saved influencer
  app.delete('/api/brand/saved-influencers/:id', isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteSavedInfluencer(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting saved influencer:', error);
      res.status(500).json({ message: 'Failed to delete influencer' });
    }
  });

  // Get hashtag monitors
  app.get('/api/brand/hashtag-monitors', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const monitors = await storage.getHashtagMonitorsByUser(userId);
      res.json(monitors);
    } catch (error) {
      console.error('Error getting hashtag monitors:', error);
      res.status(500).json({ message: 'Failed to get monitors' });
    }
  });

  // Create hashtag monitor
  app.post('/api/brand/hashtag-monitors', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const data = insertHashtagMonitorSchema.parse({ ...req.body, userId });
      const monitor = await storage.createHashtagMonitor(data);
      res.status(201).json(monitor);
    } catch (error) {
      console.error('Error creating hashtag monitor:', error);
      res.status(500).json({ message: 'Failed to create monitor' });
    }
  });

  // Delete hashtag monitor
  app.delete('/api/brand/hashtag-monitors/:id', isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteHashtagMonitor(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting hashtag monitor:', error);
      res.status(500).json({ message: 'Failed to delete monitor' });
    }
  });

  // ============ ADMIN ROUTES ============

  // Check if current user is admin
  app.get('/api/admin/check', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const user = await authStorage.getUser(userId);
      res.json({ 
        isAdmin: user?.role === 'admin' || user?.role === 'superadmin',
        isSuperAdmin: user?.role === 'superadmin',
        role: user?.role || 'user'
      });
    } catch (error) {
      console.error('Error checking admin status:', error);
      res.status(500).json({ message: 'Failed to check admin status' });
    }
  });


  // Integration status (admin only) — env-key presence check, never returns values
  app.get('/api/admin/integration-status', async (req: any, res) => {
    try {
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      const user = await authStorage.getUser(userId);
      if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
        return res.status(403).json({ message: 'Forbidden: Admin access required' });
      }

      const catalog = [
        { id: "buzzsprout", name: "Buzzsprout", category: "Podcast Hosting", envVars: [], note: "Per-user API token — no server key needed", codeStatus: "ready" },
        { id: "supabase-storage", name: "Supabase Storage (uploads)", category: "Core", envVars: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], note: "Artwork & audio uploads", codeStatus: "ready" },
        { id: "openai", name: "OpenAI (AI features)", category: "AI", envVars: ["OPENAI_API_KEY"], note: "AI Studio, email compose, bio writer, video analysis", codeStatus: "ready" },
        { id: "influencers-club", name: "Influencers.club (Social Analytics)", category: "Analytics", envVars: ["INFLUENCERS_CLUB_API_KEY"], note: "All 7 Social Analytics tabs", codeStatus: "ready" },
        { id: "upload-post", name: "Upload-Post (Social Hub posting)", category: "Social", envVars: ["UPLOAD_POST_API_KEY"], note: "Cross-platform posting", codeStatus: "ready" },
        { id: "spotify", name: "Spotify OAuth", category: "Listener", envVars: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"], note: "Listener show import", codeStatus: "ready" },
        { id: "podcast-index", name: "Podcast Index", category: "Podcast Discovery", envVars: ["PODCAST_INDEX_API_KEY", "PODCAST_INDEX_API_SECRET"], note: "Read-only podcast, episode, and guest-appearance discovery", codeStatus: "ready" },
        { id: "podchaser", name: "Podchaser", category: "Guest Intelligence", envVars: ["PODCHASER_API_KEY"], note: "Structured creator and guest appearance credits", codeStatus: "ready" },
        { id: "youtube", name: "YouTube Data API", category: "Social", envVars: ["YOUTUBE_API_KEY"], note: "Channel stats on creator profiles", codeStatus: "ready" },
        { id: "meta", name: "Instagram / Facebook (Meta)", category: "Social", envVars: ["META_APP_ID", "META_APP_SECRET"], note: "OAuth connections", codeStatus: "ready" },
        { id: "linkedin", name: "LinkedIn OAuth", category: "Social", envVars: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"], note: "Profile connection", codeStatus: "ready" },
        { id: "resend", name: "Resend (email)", category: "Email", envVars: ["RESEND_API_KEY"], note: "Campaign send still uses old Replit connector — needs refactor even with key", codeStatus: "needs-refactor" },
        { id: "phyllo", name: "Phyllo (impersonation monitoring)", category: "Identity", envVars: ["PHYLLO_CLIENT_ID", "PHYLLO_SECRET"], note: "Currently demo mode", codeStatus: "demo" },
        { id: "modash", name: "Modash (brand discovery)", category: "Brand", envVars: ["MODASH_API_KEY"], note: "Currently returns demo influencers", codeStatus: "demo" },
        { id: "blockchain", name: "Polygon (certificates)", category: "Identity", envVars: ["WALLET_PRIVATE_KEY", "INFURA_API_KEY"], note: "Without keys, minting is SIMULATED (fake tx hashes)", codeStatus: "demo" },
        { id: "github", name: "GitHub connector", category: "Legacy", envVars: [], note: "Replit leftover — no routes; should be removed from Connectors UI", codeStatus: "broken" },
      ];

      const integrations = catalog.map((entry) => {
        const missingVars = entry.envVars.filter((v) => !process.env[v] || process.env[v] === '');
        return { ...entry, configured: missingVars.length === 0, missingVars };
      });

      res.json({ integrations });
    } catch (error) {
      console.error('Error checking integration status:', error);
      res.status(500).json({ message: 'Failed to check integration status' });
    }
  });

  // Read-only Podcast Index capability probe (admin only). This deliberately
  // does not persist provider data or expose the configured credential.
  app.get('/api/admin/podcast-index/probe', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      if (!isPodcastIndexConfigured()) {
        return res.status(503).json({
          configured: false,
          message: 'PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET are required',
        });
      }

      const input = z.object({
        q: z.string().trim().min(2).max(120).default('podcasting'),
        person: z.string().trim().min(2).max(120).default('Joe Rogan'),
        max: z.coerce.number().int().min(1).max(10).default(5),
      }).parse(req.query);
      const probe = await probePodcastIndex(input.q, input.person, input.max);
      res.json({ configured: true, ...probe });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid probe query' });
      }
      if (error instanceof PodcastIndexError) {
        const status = error.code === 'AUTH_FAILED' ? 502 : error.code === 'RATE_LIMITED' ? 429 : 502;
        return res.status(status).json({
          configured: isPodcastIndexConfigured(),
          authMode: getPodcastIndexAuthMode(),
          code: error.code,
          message: error.message,
        });
      }
      console.error('Podcast Index probe failed:', error);
      res.status(500).json({ message: 'Podcast Index probe failed' });
    }
  });

  function csvField(value: unknown): string {
    const str = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  // Admin-only bulk export — "download podcast shows" for a topic (Military
  // & Veterans was the first ask). Each page of results is one Podchaser
  // request against the 1,000/month budget, so this is capped and goes
  // through searchPodchaserPodcasts's normal cache chain — a second export
  // of the same topic within 24h costs nothing.
  //
  // Sorted by power_score (Podchaser's engagement/influence metric) rather
  // than relevance, so the strongest shows come back first instead of
  // whatever happens to match the keyword. minEpisodes is the actual filter
  // — a plain text search has no way to exclude dead or test shows at query
  // time, so this drops anything under the threshold after the fact, before
  // it ever reaches the CSV.
  app.get('/api/admin/podcast-export', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        q: z.string().trim().min(2).max(120),
        pages: z.coerce.number().int().min(1).max(10).default(5),
        minEpisodes: z.coerce.number().int().min(0).max(1000).default(3),
      }).parse(req.query);

      const exportUserId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      const seen = new Map<string, PodchaserPodcastCandidate>();
      for (let page = 1; page <= input.pages; page++) {
        const result = await searchPodchaserPodcasts(input.q, 25, page, 'power_score', exportUserId);
        for (const podcast of result.podcastCandidates) seen.set(podcast.id, podcast);
        if (!result.pagination.hasMore) break;
      }

      const rows = Array.from(seen.values()).filter((p) => (p.numberOfEpisodes ?? 0) >= input.minEpisodes);
      const header = ['Title', 'RSS URL', 'Website', 'Description', 'Image URL', 'Categories', 'Episodes', 'Author', 'Author Email'];
      const lines = [header.join(',')];
      for (const podcast of rows) {
        lines.push([
          csvField(podcast.title),
          csvField(podcast.rssUrl),
          csvField(podcast.webUrl),
          csvField((podcast.description || '').replace(/\s+/g, ' ').trim().slice(0, 500)),
          csvField(podcast.imageUrl),
          csvField(podcast.categories.map((c) => c.title).join('; ')),
          csvField(podcast.numberOfEpisodes ?? ''),
          csvField(podcast.author.name),
          csvField(podcast.author.email),
        ].join(','));
      }

      const filename = `${input.q.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-podcasts.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(lines.join('\n'));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid export query' });
      }
      return sendPodchaserRouteError(res, error);
    }
  });

  const guestProbeQuerySchema = z.object({
    person: z.string().trim().min(2).max(120).default('Andrew Huberman'),
    max: z.coerce.number().int().min(1).max(25).default(10),
  });
  const runGuestIntelligenceProbe = async (req: any, res: any) => {
    try {
      if (!isPodchaserConfigured() || !isPodcastIndexConfigured()) {
        return res.status(503).json({
          configured: false,
          podchaserConfigured: isPodchaserConfigured(),
          podcastIndexConfigured: isPodcastIndexConfigured(),
          message: 'Podchaser and Podcast Index credentials are required for comparison',
        });
      }

      const probeUserId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      const input = guestProbeQuerySchema.parse(req.query);
      const [podchaser, podcastIndexAppearances] = await Promise.all([
        probePodchaserGuest(input.person, input.max, probeUserId),
        searchPodcastIndexPersonAppearances(input.person, input.max),
      ]);
      const podchaserEpisodeTitles = new Set(podchaser.guestEpisodes.map((episode) => canonicalGuestMatch(episode.episodeTitle)));
      const overlappingEpisodeTitles = podcastIndexAppearances.filter((episode) => podchaserEpisodeTitles.has(canonicalGuestMatch(episode.title))).length;

      res.json({
        configured: true,
        personQuery: input.person,
        podchaser,
        podcastIndex: {
          matchType: 'unverified person-text search',
          appearances: podcastIndexAppearances,
        },
        comparison: {
          podchaserStructuredGuestEpisodes: podchaser.guestEpisodes.length,
          podchaserStructuredGuestPodcasts: podchaser.guestPodcasts.length,
          podcastIndexUnverifiedMatches: podcastIndexAppearances.length,
          overlappingEpisodeTitles,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid guest probe query' });
      }
      if (error instanceof PodchaserError) {
        const status = error.code === 'RATE_LIMITED' ? 429 : 502;
        return res.status(status).json({ configured: isPodchaserConfigured(), provider: 'podchaser', code: error.code, message: error.message });
      }
      if (error instanceof PodcastIndexError) {
        const status = error.code === 'RATE_LIMITED' ? 429 : 502;
        return res.status(status).json({ configured: isPodcastIndexConfigured(), provider: 'podcast-index', code: error.code, message: error.message });
      }
      console.error('Guest intelligence probe failed:', error);
      res.status(500).json({ message: 'Guest intelligence probe failed' });
    }
  };

  app.get('/api/admin/guest-intelligence/probe', isAuthenticated, isAdmin, runGuestIntelligenceProbe);

  // Get all users (admin only)
  app.get('/api/admin/users', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const users = await authStorage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error('Error getting users:', error);
      res.status(500).json({ message: 'Failed to get users' });
    }
  });

  // Update user role (superadmin only)
  app.patch('/api/admin/users/:id/role', isAuthenticated, isSuperAdmin, async (req: any, res) => {
    try {
      const { role } = req.body;
      if (!['user', 'admin', 'superadmin'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role' });
      }
      const user = await authStorage.updateUserRole(req.params.id, role);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      res.json(user);
    } catch (error) {
      console.error('Error updating user role:', error);
      res.status(500).json({ message: 'Failed to update role' });
    }
  });

  // Update user status (admin only - suspend/activate)
  app.patch('/api/admin/users/:id/status', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { isActive } = req.body;
      if (!['true', 'false'].includes(isActive)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      const user = await authStorage.updateUserStatus(req.params.id, isActive);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      res.json(user);
    } catch (error) {
      console.error('Error updating user status:', error);
      res.status(500).json({ message: 'Failed to update status' });
    }
  });

  // Delete user (superadmin only)
  app.delete('/api/admin/users/:id', isAuthenticated, isSuperAdmin, async (req: any, res) => {
    try {
      const requestingUserId = req.session.userId!;
      if (req.params.id === requestingUserId) {
        return res.status(400).json({ message: 'Cannot delete your own account' });
      }

      // Deleting our user does NOT free their Upload-Post profile slot (25 on
      // the plan) — release it explicitly, best-effort.
      try {
        const key = process.env.UPLOAD_POST_API_KEY;
        if (key) {
          await fetch('https://api.upload-post.com/api/uploadposts/users', {
            method: 'DELETE',
            headers: { 'Authorization': `ApiKey ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: `podlogix_${req.params.id}` }),
          });
        }
      } catch (cleanupError) {
        console.error('Upload-Post profile cleanup failed (slot may leak):', cleanupError);
      }

      await authStorage.deleteUser(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ message: 'Failed to delete user' });
    }
  });

  // Get platform stats (admin only)
  app.get('/api/admin/stats', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const users = await authStorage.getAllUsers();
      const identityAssets = await storage.getAllIdentityAssets();
      const subscriptions = await storage.getAllPodcastSubscriptions();
      
      res.json({
        totalUsers: users.length,
        activeUsers: users.filter(u => u.isActive === 'true').length,
        adminCount: users.filter(u => u.role === 'admin' || u.role === 'superadmin').length,
        totalIdentityAssets: identityAssets.length,
        verifiedIdentities: identityAssets.filter(a => a.certStatus === 'minted').length,
        totalSubscriptions: subscriptions.length
      });
    } catch (error) {
      console.error('Error getting platform stats:', error);
      res.status(500).json({ message: 'Failed to get stats' });
    }
  });

  // ============ ADMIN FINANCIALS ============
  // Platform expenses for the Admin Dashboard's Financials tab: fixed plan
  // prices (maintained here — update when plans change) plus live metered
  // usage pulled from each provider's API.

  const FIXED_PLATFORM_SERVICES = [
    { name: "influencers.club (Pro)", purpose: "Guest research & social analytics (credit-based)", monthlyUsd: 299, notes: "Includes 500 export credits/mo · extra credits $0.60 each · full enrich = 1 credit (~$0.60/lookup)", linkUrl: "https://app.influencers.club/account/credits" },
    { name: "Upload-Post", purpose: "Social posting + FFmpeg 1,000 min/mo + 300 video analyses/mo", monthlyUsd: 50, notes: "25 profiles · unlimited uploads · 2 seats", linkUrl: "https://app.upload-post.com/" },
    { name: "Supabase (Pro)", purpose: "Postgres + storage", monthlyUsd: 25, linkUrl: "https://supabase.com/dashboard" },
    { name: "Vercel (Pro)", purpose: "Hosting (podlogix.io)", monthlyUsd: 20, notes: "Per seat · on-demand build/bandwidth overages bill separately (no public billing API — watch the dashboard)", linkUrl: "https://vercel.com/podlogix" },
    { name: "Resend (Pro)", purpose: "Transactional email", monthlyUsd: 20, notes: "No public spend API — overage visible in their dashboard", linkUrl: "https://resend.com/overview" },
    { name: "OpenAI API", purpose: "AI Write, AI images, AI Studio, transcription", monthlyUsd: null, notes: "Usage-based — month-to-date pulls live once OPENAI_ADMIN_KEY is set (platform.openai.com → Admin keys)", linkUrl: "https://platform.openai.com/usage" },
    { name: "Podchaser (Starter)", purpose: "Guest intelligence — creator search, appearances, podcast credits", monthlyUsd: 0, notes: "Free Starter tier · 1,000 requests/month · cached to minimize spend", linkUrl: "https://www.podchaser.com/dashboard" },
  ];

  const financialsHandler = async (req: any, res: any) => {
    try {
      const financialsUserId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      const [icCredits, ffmpegConsumption, profileSlots, openaiCosts, podchaserQuota, podchaserUsageBreakdown, podchaserUsageByUser] = await Promise.all([
        (async () => {
          try {
            const apiKey = getInfluencersClubApiKey();
            if (!apiKey) return null;
            const response = await fetch('https://api-dashboard.influencers.club/public/v1/accounts/credits/', {
              headers: { 'Authorization': `Bearer ${apiKey}` },
            });
            if (!response.ok) return null;
            const data = await response.json();
            return { available: data.credits_available ?? 0, used: data.credits_used ?? 0 };
          } catch { return null; }
        })(),
        (async () => {
          try {
            const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/ffmpeg/consumption`, {
              headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
            });
            if (!response.ok) return null;
            const data = await response.json();
            return data?.consumption ?? null;
          } catch { return null; }
        })(),
        (async () => {
          // The $50 plan includes 25 connected-profile slots; the users listing
          // returns every profile on the API key, so its length is slots in use.
          try {
            const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/users`, {
              headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
            });
            if (!response.ok) return null;
            const data = await response.json();
            return Array.isArray((data as any).profiles)
              ? { used: (data as any).profiles.length, total: 25 }
              : null;
          } catch { return null; }
        })(),
        (async () => {
          // OpenAI's costs endpoint needs an ADMIN key (org-scoped), not the
          // regular API key — returns daily buckets since the 1st of the month.
          try {
            const adminKey = process.env.OPENAI_ADMIN_KEY;
            if (!adminKey) return null;
            const monthStart = new Date();
            monthStart.setUTCDate(1);
            monthStart.setUTCHours(0, 0, 0, 0);
            const params = new URLSearchParams({
              start_time: String(Math.floor(monthStart.getTime() / 1000)),
              limit: '31',
            });
            const response = await fetch(`https://api.openai.com/v1/organization/costs?${params}`, {
              headers: { 'Authorization': `Bearer ${adminKey}` },
            });
            if (!response.ok) return null;
            const data = await response.json();
            const monthToDateUsd = ((data as any).data ?? []).reduce(
              (sum: number, bucket: any) =>
                sum + (bucket.results ?? []).reduce(
                  (s: number, r: any) => s + (typeof r.amount?.value === 'number' ? r.amount.value : 0),
                  0,
                ),
              0,
            );
            return { monthToDateUsd };
          } catch { return null; }
        })(),
        (async () => {
          try {
            if (!isPodchaserConfigured()) return null;
            const apiKey = process.env.PODCHASER_API_KEY!.trim();
            const response = await fetch("https://developers.podchaser.com/api/rest/v1/usage", {
              headers: { Accept: "application/json", "x-api-key": apiKey },
              signal: AbortSignal.timeout(10_000),
            });
            // The Financials tab's own quota check is itself an uncached real
            // request every time an admin loads this page — log it distinctly
            // from the quota checks inside probePodchaserGuest so it's clear
            // in podchaser_usage_log how much budget dashboard views alone cost.
            void logPodchaserUsage("usage_check_dashboard", "/usage", {}, response.status, financialsUserId);
            if (!response.ok) return null;
            const raw = await response.json();
            const d = raw?.data ?? raw;
            return {
              tier: d.tier ?? "unknown",
              quota: typeof d.quota === "number" ? d.quota : null,
              used: typeof d.used === "number" ? d.used : 0,
              remaining: typeof d.remaining === "number" ? d.remaining : null,
              cycleEnd: d.cycle_end ?? null,
            };
          } catch { return null; }
        })(),
        getPodchaserUsageBreakdown(30).catch(() => []),
        getPodchaserUsageByUser(30).catch(() => []),
      ]);

      const fixedTotalUsd = FIXED_PLATFORM_SERVICES.reduce((sum, s) => sum + (s.monthlyUsd ?? 0), 0);
      res.json({
        services: FIXED_PLATFORM_SERVICES,
        fixedTotalUsd,
        icCredits,
        icCreditUsd: 0.6,
        icMonthlyCredits: 500,
        ffmpegConsumption,
        profileSlots,
        openaiCosts,
        podchaserQuota,
        podchaserUsageBreakdown,
        podchaserUsageByUser,
        estimatedMonthlyUsd: fixedTotalUsd + (openaiCosts?.monthToDateUsd ?? 0),
      });
    } catch (error) {
      console.error('Error building admin financials:', error);
      res.status(500).json({ message: 'Failed to load financials' });
    }
  };

  app.get('/api/admin/financials', isAuthenticated, isSuperAdmin, financialsHandler);

  // Server-to-server variant for the VPS Command Center dashboard — same
  // payload, gated by a shared secret instead of a session. Disabled entirely
  // unless INTERNAL_METRICS_KEY is set in the environment.
  app.get('/api/internal/financials', async (req, res) => {
    const expected = process.env.INTERNAL_METRICS_KEY;
    if (!expected || req.headers['x-internal-key'] !== expected) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    return financialsHandler(req, res);
  });

  // ============ ADMIN CREATOR LIST ROUTES ============

  // Get all creators in admin list
  app.get('/api/admin/creators', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const creators = await storage.getAdminCreators();
      res.json(creators);
    } catch (error) {
      console.error('Error getting admin creators:', error);
      res.status(500).json({ message: 'Failed to get creators' });
    }
  });

  // Add creator to admin list
  app.post('/api/admin/creators', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const creator = await storage.createAdminCreator({ 
        ...req.body, 
        addedByUserId: userId 
      });
      res.json(creator);
    } catch (error) {
      console.error('Error adding creator:', error);
      res.status(500).json({ message: 'Failed to add creator' });
    }
  });

  // Get single creator details
  app.get('/api/admin/creators/:id', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const creator = await storage.getAdminCreator(req.params.id);
      if (!creator) {
        return res.status(404).json({ message: 'Creator not found' });
      }
      res.json(creator);
    } catch (error) {
      console.error('Error getting creator:', error);
      res.status(500).json({ message: 'Failed to get creator' });
    }
  });

  // Update creator (rate sheet, notes, status, etc.)
  app.patch('/api/admin/creators/:id', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const creator = await storage.updateAdminCreator(req.params.id, req.body);
      if (!creator) {
        return res.status(404).json({ message: 'Creator not found' });
      }
      res.json(creator);
    } catch (error) {
      console.error('Error updating creator:', error);
      res.status(500).json({ message: 'Failed to update creator' });
    }
  });

  // Delete creator from admin list
  app.delete('/api/admin/creators/:id', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      await storage.deleteAdminCreator(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting creator:', error);
      res.status(500).json({ message: 'Failed to delete creator' });
    }
  });

  // ==================== ADMIN DEV DOCUMENTS ====================

  app.get('/api/admin/dev-documents', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const docs = await db.select().from(adminDevDocuments).orderBy(desc(adminDevDocuments.updatedAt));
      res.json(docs);
    } catch (error) {
      console.error('Error fetching dev documents:', error);
      res.status(500).json({ message: 'Failed to fetch documents' });
    }
  });

  app.post('/api/admin/dev-documents', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const schema = z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        category: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.format() });
      }
      const [doc] = await db.insert(adminDevDocuments).values({
        ...parsed.data,
        createdByUserId: userId,
      }).returning();
      res.json(doc);
    } catch (error) {
      console.error('Error creating dev document:', error);
      res.status(500).json({ message: 'Failed to create document' });
    }
  });

  app.patch('/api/admin/dev-documents/:id', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const schema = z.object({
        title: z.string().min(1).optional(),
        content: z.string().min(1).optional(),
        category: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.format() });
      }
      const [doc] = await db.update(adminDevDocuments)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(adminDevDocuments.id, req.params.id))
        .returning();
      if (!doc) return res.status(404).json({ message: 'Document not found' });
      res.json(doc);
    } catch (error) {
      console.error('Error updating dev document:', error);
      res.status(500).json({ message: 'Failed to update document' });
    }
  });

  app.delete('/api/admin/dev-documents/:id', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      await db.delete(adminDevDocuments).where(eq(adminDevDocuments.id, req.params.id));
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting dev document:', error);
      res.status(500).json({ message: 'Failed to delete document' });
    }
  });

  // ==================== TEAM INVITATIONS ====================

  app.get('/api/admin/team-invitations', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const invitations = await db.select().from(teamInvitations).orderBy(desc(teamInvitations.createdAt));
      res.json(invitations);
    } catch (error) {
      console.error('Error fetching team invitations:', error);
      res.status(500).json({ message: 'Failed to fetch invitations' });
    }
  });

  app.post('/api/admin/team-invitations', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const schema = z.object({
        email: z.string().email(),
        role: z.enum(['admin', 'superadmin']),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.format() });
      }

      const existing = await db.select().from(teamInvitations).where(
        and(
          eq(teamInvitations.email, parsed.data.email),
          eq(teamInvitations.status, 'pending')
        )
      );
      if (existing.length > 0) {
        return res.status(409).json({ message: 'A pending invitation already exists for this email' });
      }

      const user = await authStorage.getUser(userId);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const [invitation] = await db.insert(teamInvitations).values({
        email: parsed.data.email,
        role: parsed.data.role,
        invitedByUserId: userId,
        invitedByName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Admin',
        status: 'pending',
        expiresAt,
      }).returning();

      res.json(invitation);
    } catch (error) {
      console.error('Error creating team invitation:', error);
      res.status(500).json({ message: 'Failed to create invitation' });
    }
  });

  app.delete('/api/admin/team-invitations/:id', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      await db.delete(teamInvitations).where(eq(teamInvitations.id, req.params.id));
      res.json({ success: true });
    } catch (error) {
      console.error('Error revoking invitation:', error);
      res.status(500).json({ message: 'Failed to revoke invitation' });
    }
  });

  app.post('/api/admin/team-invitations/:id/resend', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const [invitation] = await db.update(teamInvitations)
        .set({ expiresAt, status: 'pending' })
        .where(eq(teamInvitations.id, req.params.id))
        .returning();
      if (!invitation) return res.status(404).json({ message: 'Invitation not found' });
      res.json(invitation);
    } catch (error) {
      console.error('Error resending invitation:', error);
      res.status(500).json({ message: 'Failed to resend invitation' });
    }
  });

  // Auto-accept invitation when user logs in (checked on admin check)
  app.post('/api/admin/accept-invitation', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const user = await authStorage.getUser(userId);
      if (!user?.email) return res.status(400).json({ message: 'User email not found' });

      const [invitation] = await db.select().from(teamInvitations).where(
        and(
          eq(teamInvitations.email, user.email),
          eq(teamInvitations.status, 'pending')
        )
      );

      if (!invitation) return res.json({ accepted: false, message: 'No pending invitation' });

      if (invitation.expiresAt && new Date() > invitation.expiresAt) {
        await db.update(teamInvitations)
          .set({ status: 'expired' })
          .where(eq(teamInvitations.id, invitation.id));
        return res.json({ accepted: false, message: 'Invitation has expired' });
      }

      await authStorage.updateUserRole(user.id, invitation.role);
      await db.update(teamInvitations)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(eq(teamInvitations.id, invitation.id));

      res.json({ accepted: true, role: invitation.role });
    } catch (error) {
      console.error('Error accepting invitation:', error);
      res.status(500).json({ message: 'Failed to accept invitation' });
    }
  });

  // ==================== INFLUENCERS.CLUB API ROUTES ====================

  const getInfluencersClubApiKey = () => process.env.INFLUENCERS_CLUB_API_KEY;

  // Influencers.club Discovery API
  app.post('/api/influencers-club/discover', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Influencers.club API key not configured' });
      }
      if (!icEnrichmentEnabled()) {
        return res.status(400).json({ error: 'Creator discovery is currently disabled' });
      }

      const { platform, filters, prompt, limit = 20 } = req.body;

      const response = await fetch('https://api-dashboard.influencers.club/public/v1/discovery/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          platform: platform || 'instagram',
          paging: { limit: Math.min(limit, 50), page: 0 },
          sort: { sort_by: 'relevancy', sort_order: 'desc' },
          filters: {
            ai_search: prompt || '',
            ...(filters || {}),
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Influencers.club API error:', errorText);
        return res.status(response.status).json({ 
          error: 'Discovery API request failed',
          details: errorText 
        });
      }

      const data = await response.json();
      const items = data.result?.items || data.results || data.creators || data.items || [];
      res.json({ creators: items, total: data.result?.total || data.total || items.length });
    } catch (error) {
      console.error('Error with Influencers.club discovery:', error);
      res.status(500).json({ error: 'Failed to search creators' });
    }
  });

  // Influencers.club Enrich by Handle
  app.post('/api/influencers-club/enrich-handle', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Influencers.club API key not configured' });
      }

      const { handle, platform } = req.body;
      if (!handle || !platform) {
        return res.status(400).json({ error: 'Handle and platform are required' });
      }

      const enriched = await enrichHandleCached(apiKey, platform, handle, {
        email_required: 'preferred',
        include_lookalikes: false,
      }, { userId: req.session.userId });
      if (!enriched) {
        return res.status(icEnrichmentEnabled() ? 502 : 400).json({
          error: icEnrichmentEnabled() ? 'Enrichment failed' : 'Creator enrichment is currently disabled',
        });
      }

      res.json({ ...enriched.data, cached: enriched.fromCache });
    } catch (error) {
      console.error('Error enriching handle:', error);
      res.status(500).json({ error: 'Failed to enrich creator' });
    }
  });

  // Check Influencers.club API status and credits
  app.get('/api/influencers-club/status', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.json({ configured: false });
      }

      const response = await fetch('https://api-dashboard.influencers.club/public/v1/accounts/credits/', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        return res.json({ configured: true, valid: false });
      }

      const data = await response.json();
      res.json({ 
        configured: true, 
        valid: true,
        credits: data.credits_remaining || data.credits || 0,
        usage: data
      });
    } catch (error) {
      console.error('Error checking Influencers.club status:', error);
      res.json({ configured: true, valid: false });
    }
  });

  // ==================== EMAIL HUB ROUTES ====================

  // Get all email contacts
  app.get('/api/email/contacts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const contacts = await storage.getEmailContacts(userId);
      res.json(contacts);
    } catch (error) {
      console.error('Error getting contacts:', error);
      res.status(500).json({ message: 'Failed to get contacts' });
    }
  });

  // Add email contact
  app.post('/api/email/contacts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const input = emailContactCreateInputSchema.parse(req.body);
      const existing = await storage.getEmailContactByEmail(userId, input.email);
      if (existing) return res.status(409).json({ message: 'A contact with this email already exists.' });
      const contact = await storage.createEmailContact({ ...input, userId });
      res.status(201).json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid contact details' });
      }
      console.error('Error creating contact:', error);
      res.status(500).json({ message: 'Failed to create contact' });
    }
  });

  // Update email contact
  app.patch('/api/email/contacts/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const existing = await storage.getEmailContact(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ message: 'Contact not found' });
      }

      const input = emailContactUpdateInputSchema.parse(req.body);
      const existingEmail = existing.email?.trim().toLowerCase() ?? null;
      if (input.email && input.email !== existingEmail) {
        const duplicate = await storage.getEmailContactByEmail(userId, input.email);
        if (duplicate && duplicate.id !== existing.id) {
          return res.status(409).json({ message: 'Another contact already uses this email.' });
        }
      }

      const contact = await storage.updateEmailContact(req.params.id, userId, input);
      if (!contact) {
        return res.status(404).json({ message: 'Contact not found' });
      }

      if (input.email && input.email !== existingEmail) {
        const [emailMatches, linkedEntries] = await Promise.all([
          existingEmail ? storage.getGuestProspectsByEmail(userId, existingEmail) : Promise.resolve([]),
          storage.getGuestPipelineEntriesByContact(existing.id),
        ]);
        const linkedProspectIds = new Set(linkedEntries
          .map((entry) => entry.guestProspectId)
          .filter((id): id is string => Boolean(id)));
        if (existing.guestProspectId) linkedProspectIds.add(existing.guestProspectId);
        for (const prospect of emailMatches) linkedProspectIds.add(prospect.id);
        await Promise.all([...linkedProspectIds]
          .map((prospectId) => storage.updateGuestProspect(prospectId, userId, { email: input.email! })));
      }

      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid contact details' });
      }
      console.error('Error updating contact:', error);
      res.status(500).json({ message: 'Failed to update contact' });
    }
  });

  // Delete email contact
  // CRM notes — timestamped activity trail on a contact.
  app.get('/api/email/contacts/:id/notes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const contact = await storage.getEmailContact(req.params.id);
      if (!contact || contact.userId !== userId) {
        return res.status(404).json({ message: 'Contact not found' });
      }
      const notes = await storage.getContactNotes(contact.id, userId);
      res.json({ notes });
    } catch (error) {
      console.error('Error fetching contact notes:', error);
      res.status(500).json({ message: 'Failed to fetch notes' });
    }
  });

  app.post('/api/email/contacts/:id/notes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const contact = await storage.getEmailContact(req.params.id);
      if (!contact || contact.userId !== userId) {
        return res.status(404).json({ message: 'Contact not found' });
      }
      const body = String(req.body?.body ?? '').trim();
      if (!body) return res.status(400).json({ message: 'Note text is required' });
      const note = await storage.createContactNote({ contactId: contact.id, userId, body });
      res.json({ note });
    } catch (error) {
      console.error('Error creating contact note:', error);
      res.status(500).json({ message: 'Failed to add note' });
    }
  });

  app.delete('/api/email/contacts/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const contact = await storage.getEmailContact(req.params.id);
      if (!contact || contact.userId !== userId) {
        return res.status(404).json({ message: 'Contact not found' });
      }
      await storage.deleteEmailContact(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting contact:', error);
      res.status(500).json({ message: 'Failed to delete contact' });
    }
  });

  // ==================== GUEST DISCOVERY & PIPELINE ROUTES ====================

  const userOwnsGuestShow = async (userId: string, showId: string): Promise<boolean> => {
    const podcast = await storage.getPodcast(showId);
    if (podcast) return podcast.userId === userId;

    const buzzsproutConnectionId = showId.startsWith('buzzsprout:')
      ? showId.slice('buzzsprout:'.length)
      : null;
    if (!buzzsproutConnectionId) return false;
    const connection = await getBuzzsproutConnection(userId);
    return connection?.id === buzzsproutConnectionId;
  };

  const guestDiscoverySearchSchema = z.object({
    q: z.string().trim().min(2).max(120),
    max: z.coerce.number().int().min(1).max(25).default(10),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    sort: z.enum(['relevance', 'alphabetical', 'recent_episode', 'appearance_count']).default('appearance_count'),
  });

  const podcastDiscoverySearchSchema = z.object({
    q: z.string().trim().min(2).max(120),
    max: z.coerce.number().int().min(1).max(25).default(10),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    sort: z.enum(['relevance', 'alphabetical', 'date_of_first_episode', 'power_score']).default('relevance'),
  });

  const guestAppearanceSchema = z.object({
    max: z.coerce.number().int().min(1).max(25).default(10),
  });

  const sendPodchaserRouteError = (res: any, error: unknown) => {
    if (error instanceof PodchaserError) {
      const status = error.code === 'NOT_CONFIGURED'
        ? 503
        : error.code === 'RATE_LIMITED'
          ? 429
          : 502;
      return res.status(status).json({ provider: 'podchaser', code: error.code, message: error.message });
    }
    console.error('Guest discovery failed:', error);
    return res.status(500).json({ message: 'Guest discovery failed' });
  };

  // Search is intentionally separate from appearances: an unconfirmed search
  // spends one provider request, and the two history requests run only after the
  // user chooses the correct person.
  // Cross-transcript keyword search: "which shows have talked about this?".
  // Crisis-aware — a self-harm query returns help resources up top, always.
  app.post('/api/transcript-search', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      const query = String(req.body?.query ?? '').trim();
      if (!query) return res.status(400).json({ message: 'Type what you want to search for.' });
      const crisis = detectCrisis(query);
      const { terms, matches } = await searchTranscripts(userId, query);
      res.json({ query, crisis, resources: crisis ? CRISIS_RESOURCES : null, terms, matches });
    } catch (error: any) {
      console.error('Transcript search error:', error?.message);
      res.status(500).json({ message: 'Search failed — try again.' });
    }
  });

  app.get('/api/guest-discovery/search', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      const input = guestDiscoverySearchSchema.parse(req.query);
      const result = await searchPodchaserCreators(input.q, input.max, input.page, input.sort, userId);
      res.json({ configured: true, ...result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid guest search' });
      }
      return sendPodchaserRouteError(res, error);
    }
  });

  app.get('/api/guest-discovery/podcasts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      const input = podcastDiscoverySearchSchema.parse(req.query);
      const result = await searchPodchaserPodcasts(input.q, input.max, input.page, input.sort, userId);
      res.json({ configured: true, ...result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid podcast search' });
      }
      return sendPodchaserRouteError(res, error);
    }
  });

  // Batched, one HTTP call for however many topic tiles Discover renders.
  // Fetched SEQUENTIALLY (not Promise.all) — 14+ simultaneous searches from
  // one page load was hitting the Starter plan's rate limit, which silently
  // dropped some tiles to their icon fallback with no visible error. Each
  // topic still goes through searchPodchaserPodcasts's normal cache chain
  // (memory -> DB -> real request), so repeat page loads cost nothing.
  const topicArtSchema = z.object({
    topics: z.string().trim().min(1).transform((value) => value.split(',').map((t) => t.trim()).filter(Boolean)).pipe(z.array(z.string()).min(1).max(30)),
  });

  app.get('/api/guest-discovery/topic-art', isAuthenticated, async (req: any, res) => {
    try {
      const { topics } = topicArtSchema.parse(req.query);
      const configured = isPodchaserConfigured();
      const art: Record<string, string[]> = {};
      const topicArtUserId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      if (configured) {
        for (const topic of topics) {
          try {
            const result = await searchPodchaserPodcasts(topic, 4, 1, 'power_score', topicArtUserId);
            art[topic] = result.podcastCandidates.map((p) => p.imageUrl).filter((url): url is string => Boolean(url)).slice(0, 4);
          } catch (error) {
            console.error(`Topic art fetch failed for "${topic}":`, error);
            art[topic] = [];
          }
        }
      } else {
        for (const topic of topics) art[topic] = [];
      }
      res.json({ configured, art });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid topics list' });
      }
      return sendPodchaserRouteError(res, error);
    }
  });

  app.get('/api/guest-discovery/podcasts/:podcastId/credits', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      const podcastId = z.string().trim().min(1).max(80).parse(req.params.podcastId);
      const input = guestAppearanceSchema.parse(req.query);
      const result = await getPodchaserPodcastCredits(podcastId, input.max, userId);
      res.json({ configured: true, ...result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid podcast request' });
      }
      return sendPodchaserRouteError(res, error);
    }
  });

  app.get('/api/guest-discovery/creators/:creatorId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      const creatorId = z.string().trim().min(1).max(80).parse(req.params.creatorId);
      const creator = await getPodchaserCreator(creatorId, userId);
      res.json({ configured: true, creator });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid creator request' });
      }
      return sendPodchaserRouteError(res, error);
    }
  });

  app.get('/api/guest-discovery/creators/:creatorId/appearances', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      const creatorId = z.string().trim().min(1).max(80).parse(req.params.creatorId);
      const input = guestAppearanceSchema.parse(req.query);
      const result = await getPodchaserGuestAppearances(creatorId, input.max, userId);
      res.json({ configured: true, ...result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid creator request' });
      }
      return sendPodchaserRouteError(res, error);
    }
  });

  app.get('/api/guest-discovery/creators/:creatorId/podcasts/:podcastId/playback', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId ?? req.dbUser?.id ?? req.user?.id ?? req.user?.claims?.sub;
      const creatorId = z.string().trim().min(1).max(80).parse(req.params.creatorId);
      const podcastId = z.string().trim().min(1).max(80).parse(req.params.podcastId);
      const guestName = z.string().trim().min(1).max(240).parse(req.query.guestName);
      const result = await getGuestPodcastPlayback(creatorId, podcastId, guestName, userId);
      res.json({ configured: true, ...result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid playback request' });
      }
      return sendPodchaserRouteError(res, error);
    }
  });

  const guestProspectUrlSchema = z.string().url().refine(
    (value) => value.startsWith('https://') || value.startsWith('http://'),
    'Only http and https links are allowed',
  );

  const guestProspectPayloadSchema = z.object({
    providerPersonId: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(240),
    informalName: z.string().trim().max(120).nullish(),
    pronouns: z.string().trim().max(40).nullish(),
    subtitle: z.string().trim().max(1000).nullish(),
    location: z.string().trim().max(240).nullish(),
    bio: z.string().trim().max(10_000).nullish(),
    profileUrl: guestProspectUrlSchema.nullish(),
    imageUrl: guestProspectUrlSchema.nullish(),
    email: z.string().email().nullish(),
    socialLinks: z.record(guestProspectUrlSchema).optional(),
    episodeAppearanceCount: z.number().int().min(0).nullish(),
  });

  app.get('/api/guest-prospects', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const [prospects, contacts, pipelineEntries] = await Promise.all([
        storage.getGuestProspectsByUser(userId),
        storage.getEmailContacts(userId),
        // Native shows only — Buzzsprout-synced shows aren't in the podcasts
        // table, so their pipeline entries don't surface a stage here. Cosmetic
        // gap: the badge is missing, the pipeline entry itself is unaffected.
        storage.getGuestPipelineEntriesByUser(userId),
      ]);
      const contactsByProspectId = new Map(contacts
        .filter((contact) => Boolean(contact.guestProspectId))
        .map((contact) => [contact.guestProspectId!, contact]));
      const contactsByEmail = new Map(contacts
        .filter((contact) => Boolean(contact.email))
        .map((contact) => [contact.email!.trim().toLowerCase(), contact]));
      // Entries are already ordered by updatedAt desc, so the first match per
      // prospect is their most recently touched pipeline stage.
      const stageByProspectId = new Map<string, string>();
      for (const entry of pipelineEntries) {
        if (entry.guestProspectId && !stageByProspectId.has(entry.guestProspectId)) {
          stageByProspectId.set(entry.guestProspectId, entry.stage);
        }
      }
      res.json({
        prospects: prospects.map((prospect) => ({
          ...prospect,
          masterContactId: contactsByProspectId.get(prospect.id)?.id
            ?? (prospect.email ? contactsByEmail.get(prospect.email.trim().toLowerCase())?.id : undefined)
            ?? null,
          pipelineStage: stageByProspectId.get(prospect.id) ?? null,
        })),
      });
    } catch (error) {
      console.error('Error fetching guest prospects:', error);
      res.status(500).json({ message: 'Failed to fetch guest prospects' });
    }
  });

  app.patch('/api/guest-prospects/:id/star', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const existing = await storage.getGuestProspect(req.params.id, userId);
      if (!existing) return res.status(404).json({ message: 'Guest prospect not found' });
      const input = z.object({ starred: z.boolean() }).parse(req.body);
      const updated = await storage.updateGuestProspect(req.params.id, userId, { starred: input.starred });
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid request' });
      }
      console.error('Error starring guest prospect:', error);
      res.status(500).json({ message: 'Failed to update guest prospect' });
    }
  });

  // Lets the Contacts page move a guest's pipeline stage without knowing the
  // pipeline entry's own id — it only has the prospect id. Mirrors the
  // most-recently-touched-entry resolution GET /api/guest-prospects uses to
  // derive pipelineStage in the first place.
  app.patch('/api/guest-prospects/:id/stage', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const existing = await storage.getGuestProspect(req.params.id, userId);
      if (!existing) return res.status(404).json({ message: 'Guest prospect not found' });
      const input = z.object({
        stage: z.enum(['prospect', 'invited', 'booked', 'recorded', 'published', 'follow_up', 'alumni']),
      }).parse(req.body);
      const entries = await storage.getGuestPipelineEntriesByUser(userId);
      const entry = entries.find((e) => e.guestProspectId === req.params.id);
      if (!entry) return res.status(404).json({ message: 'This guest is not in a pipeline yet' });
      const updated = await storage.updateGuestPipelineEntry(entry.id, { stage: input.stage });
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid request' });
      }
      console.error('Error updating guest prospect stage:', error);
      res.status(500).json({ message: 'Failed to update stage' });
    }
  });

  app.post('/api/guest-prospects', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const input = guestProspectPayloadSchema.parse(req.body);
      const existing = await storage.getGuestProspectByProvider(
        userId,
        'podchaser',
        input.providerPersonId,
      );
      const prospect = await storage.upsertGuestProspect({
        userId,
        provider: 'podchaser',
        providerPersonId: input.providerPersonId,
        name: input.name,
        informalName: input.informalName ?? null,
        pronouns: input.pronouns ?? null,
        subtitle: input.subtitle ?? null,
        location: input.location ?? null,
        bio: input.bio ?? null,
        profileUrl: input.profileUrl ?? null,
        imageUrl: input.imageUrl ?? null,
        // Re-research refreshes Podchaser data without erasing contact details
        // that may already have been added through optional IC enrichment.
        email: existing?.email ?? input.email ?? null,
        socialLinks: { ...(existing?.socialLinks ?? {}), ...(input.socialLinks ?? {}) },
        episodeAppearanceCount: input.episodeAppearanceCount ?? null,
        lastResearchedAt: new Date(),
      });
      res.status(201).json(prospect);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid guest prospect' });
      }
      console.error('Error saving guest prospect:', error);
      res.status(500).json({ message: 'Failed to save guest prospect' });
    }
  });

  const guestProspectEnrichmentSchema = z.object({
    email: z.string().email().nullish(),
    socialLinks: z.record(guestProspectUrlSchema).optional(),
  });

  app.patch('/api/guest-prospects/:id/enrichment', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const existing = await storage.getGuestProspect(req.params.id, userId);
      if (!existing) return res.status(404).json({ message: 'Guest prospect not found' });
      const input = guestProspectEnrichmentSchema.parse(req.body);
      const updated = await storage.updateGuestProspect(req.params.id, userId, {
        ...(input.email !== undefined ? { email: input.email ?? null } : {}),
        socialLinks: { ...(existing.socialLinks ?? {}), ...(input.socialLinks ?? {}) },
      });
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid enrichment data' });
      }
      console.error('Error updating guest prospect:', error);
      res.status(500).json({ message: 'Failed to update guest prospect' });
    }
  });

  app.put('/api/guest-prospects/:id/contact', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const prospect = await storage.getGuestProspect(req.params.id, userId);
      if (!prospect) return res.status(404).json({ message: 'Guest prospect not found' });
      const input = guestContactInputSchema.parse(req.body);
      const result = await ensureOfficialGuestContact(userId, prospect, input.email, {
        firstName: input.firstName,
        lastName: input.lastName,
        company: input.company,
        title: input.title,
      });
      res.json({ ...result, masterContactId: result.contact.id });
    } catch (error) {
      if (error instanceof GuestContactConflictError) {
        return res.status(409).json({ message: error.message });
      }
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid contact details' });
      }
      console.error('Error saving guest contact:', error);
      res.status(500).json({ message: 'Failed to save guest contact' });
    }
  });

  app.post('/api/guest-prospects/:id/reveal-email', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const prospect = await storage.getGuestProspect(req.params.id, userId);
      if (!prospect) return res.status(404).json({ message: 'Guest prospect not found' });

      // Persisted contact data is the deduplication boundary: repeat reveals do
      // not call IC or spend another credit.
      if (prospect.email) {
        const linked = await ensureOfficialGuestContact(userId, prospect, prospect.email);
        return res.json({ ...linked, charged: false, cached: true, contactId: linked.contact.id });
      }

      const apiKey = getInfluencersClubApiKey()?.trim();
      if (!apiKey) return res.status(503).json({ message: 'Contact enrichment is not configured.' });

      const target = guestEnrichmentTarget(prospect.socialLinks ?? {});
      if (!target) {
        return res.status(422).json({ message: 'No supported social profile is available for this guest yet.' });
      }

      // Global creator cache next — this handle may already have been
      // enriched via search, another guest's profile, or a different feature.
      const cachedEnrichment = await getCachedEnrichment(target.platform, target.handle);
      let data: any;
      let charged = false;
      if (cachedEnrichment) {
        data = cachedEnrichment.payload;
      } else {
        if (!icEnrichmentEnabled()) {
          return res.status(503).json({ message: 'Contact enrichment is currently disabled.' });
        }
        const response = await fetch('https://api-dashboard.influencers.club/public/v1/creators/enrich/handle/full/', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            handle: target.handle,
            platform: target.platform,
            email_required: 'preferred',
            include_lookalikes: false,
          }),
          signal: AbortSignal.timeout(20_000),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          console.error('Guest email reveal failed:', response.status, detail.slice(0, 300));
          const status = response.status === 429 ? 429 : 502;
          return res.status(status).json({ message: response.status === 429 ? 'Contact enrichment allowance has been reached.' : 'Contact enrichment could not be completed.' });
        }

        data = await response.json();
        charged = true;
        await saveEnrichment(target.platform, target.handle, data);
      }

      const email = extractGuestEnrichmentEmail(data);
      if (!email) return res.status(404).json({ message: 'No verified email was found for this guest.' });

      const linked = await ensureOfficialGuestContact(
        userId,
        prospect,
        email,
        {},
        'Email revealed from a saved guest profile.',
      );
      res.json({ ...linked, charged, cached: !charged, contactId: linked.contact.id });
    } catch (error) {
      if (error instanceof GuestContactConflictError) {
        return res.status(409).json({ message: error.message });
      }
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        return res.status(504).json({ message: 'Contact enrichment timed out. No result was saved.' });
      }
      console.error('Error revealing guest email:', error);
      res.status(500).json({ message: 'Failed to reveal guest email' });
    }
  });

  app.delete('/api/guest-prospects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const prospect = await storage.getGuestProspect(req.params.id, userId);
      if (!prospect) return res.status(404).json({ message: 'Guest prospect not found' });
      const pipelineEntries = await storage.getGuestPipelineEntriesByProspect(prospect.id);
      if (pipelineEntries.length > 0) {
        return res.status(409).json({ message: 'Remove this person from the guest pipeline before deleting the prospect.' });
      }
      const masterContact = await storage.getEmailContactByGuestProspect(userId, prospect.id);
      if (masterContact) {
        await storage.updateEmailContact(masterContact.id, userId, { guestProspectId: null });
      }
      await storage.deleteGuestProspect(prospect.id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting guest prospect:', error);
      res.status(500).json({ message: 'Failed to delete guest prospect' });
    }
  });

  // Pipeline entries can begin with a researched prospect and gain an email
  // contact later. This keeps the existing show-specific CRM stages intact.

  app.get('/api/podcasts/:podcastId/guests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const ownsShow = await userOwnsGuestShow(userId, req.params.podcastId);
      if (!ownsShow) return res.status(404).json({ message: 'Show not found' });

      const entries = await storage.getGuestPipelineEntriesByPodcast(req.params.podcastId);
      const guests = await Promise.all(
        entries.map(async (entry) => ({
          ...entry,
          contact: entry.contactId ? await storage.getEmailContact(entry.contactId) : undefined,
          prospect: entry.guestProspectId
            ? await storage.getGuestProspect(entry.guestProspectId, userId)
            : undefined,
        }))
      );
      res.json(guests);
    } catch (error) {
      console.error('Error getting guest pipeline:', error);
      res.status(500).json({ message: 'Failed to get guests' });
    }
  });

  app.post('/api/podcasts/:podcastId/guests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const ownsShow = await userOwnsGuestShow(userId, req.params.podcastId);
      if (!ownsShow) return res.status(404).json({ message: 'Show not found' });

      const addGuestInput = z.object({
        guestProspectId: z.string().trim().min(1).optional(),
        contactId: z.string().trim().min(1).optional(),
        email: z.string().email().optional(),
        firstName: z.string().trim().max(120).optional(),
        lastName: z.string().trim().max(120).optional(),
        notes: z.string().trim().max(10_000).optional(),
        stage: z.enum(['prospect', 'invited', 'booked', 'recorded', 'published', 'follow_up', 'alumni']).optional(),
      }).refine((value) => Boolean(value.guestProspectId || value.contactId || value.email), {
        message: 'A prospect, contact, or email is required',
      }).parse(req.body);

      if (addGuestInput.guestProspectId) {
        const prospect = await storage.getGuestProspect(addGuestInput.guestProspectId, userId);
        if (!prospect) return res.status(404).json({ message: 'Guest prospect not found' });
        const existing = await storage.getGuestPipelineEntryByProspect(req.params.podcastId, prospect.id);
        if (existing) {
          const entry = addGuestInput.stage && addGuestInput.stage !== existing.stage
            ? await storage.updateGuestPipelineEntry(existing.id, { stage: addGuestInput.stage })
            : existing;
          return res.json({ ...entry, contact: undefined, prospect });
        }
        const entry = await storage.createGuestPipelineEntry({
          podcastId: req.params.podcastId,
          contactId: null,
          guestProspectId: prospect.id,
          stage: addGuestInput.stage || 'prospect',
          notes: addGuestInput.notes,
        });
        return res.status(201).json({ ...entry, contact: undefined, prospect });
      }

      let contact = addGuestInput.contactId
        ? await storage.getEmailContact(addGuestInput.contactId)
        : undefined;
      if (!contact && addGuestInput.email) {
        const email = normalizedEmailSchema.parse(addGuestInput.email);
        contact = await storage.getEmailContactByEmail(userId, email)
          ?? await storage.createEmailContact({
            userId,
            email,
            firstName: addGuestInput.firstName,
            lastName: addGuestInput.lastName,
            category: 'guest',
          });
      }

      if (!contact || contact.userId !== userId) return res.status(404).json({ message: 'Contact not found' });

      const entry = await storage.createGuestPipelineEntry({
        podcastId: req.params.podcastId,
        contactId: contact.id,
        guestProspectId: null,
        stage: addGuestInput.stage || 'prospect',
        notes: addGuestInput.notes,
      });

      res.status(201).json({ ...entry, contact });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid guest' });
      }
      console.error('Error creating guest pipeline entry:', error);
      res.status(500).json({ message: 'Failed to add guest' });
    }
  });

  app.patch('/api/guest-pipeline/:id', isAuthenticated, async (req: any, res) => {
    try {
      const existing = await storage.getGuestPipelineEntry(req.params.id);
      if (!existing) return res.status(404).json({ message: 'Guest pipeline entry not found' });
      const ownsShow = await userOwnsGuestShow(req.session.userId!, existing.podcastId);
      if (!ownsShow) {
        return res.status(404).json({ message: 'Guest pipeline entry not found' });
      }
      const updates = z.object({
        stage: z.enum(['prospect', 'invited', 'booked', 'recorded', 'published', 'follow_up', 'alumni']).optional(),
        episodeId: z.string().trim().max(120).nullish(),
        notes: z.string().trim().max(10_000).nullish(),
      }).parse(req.body);
      const entry = await storage.updateGuestPipelineEntry(req.params.id, updates);
      res.json(entry);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || 'Invalid guest update' });
      }
      console.error('Error updating guest pipeline entry:', error);
      res.status(500).json({ message: 'Failed to update guest' });
    }
  });

  app.delete('/api/guest-pipeline/:id', isAuthenticated, async (req: any, res) => {
    try {
      const existing = await storage.getGuestPipelineEntry(req.params.id);
      if (!existing) return res.status(404).json({ message: 'Guest pipeline entry not found' });
      const ownsShow = await userOwnsGuestShow(req.session.userId!, existing.podcastId);
      if (!ownsShow) {
        return res.status(404).json({ message: 'Guest pipeline entry not found' });
      }
      await storage.deleteGuestPipelineEntry(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting guest pipeline entry:', error);
      res.status(500).json({ message: 'Failed to delete guest' });
    }
  });

  // ==================== SAVED CREATORS (DIRECTORY) ====================

  app.get('/api/discover/saved', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const saved = await storage.getSavedCreatorsByUser(userId);
      res.json({ creators: saved });
    } catch (error) {
      console.error('Error fetching saved creators:', error);
      res.status(500).json({ message: 'Failed to fetch saved creators' });
    }
  });

  app.post('/api/discover/saved', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { listName, handle, platform, name, profilePictureUrl, followers, engagementRate, avgLikes, avgViews, email, bio, isVerified } = req.body;

      if (!handle || !platform) {
        return res.status(400).json({ message: 'handle and platform are required' });
      }

      const created = await storage.createSavedCreator({
        userId,
        listName: listName?.trim() || 'Saved creators',
        handle,
        platform,
        name,
        profilePictureUrl,
        followers,
        engagementRate,
        avgLikes,
        avgViews,
        email,
        bio,
        isVerified,
      });
      res.status(201).json(created);
    } catch (error) {
      console.error('Error saving creator:', error);
      res.status(500).json({ message: 'Failed to save creator' });
    }
  });

  app.delete('/api/discover/saved/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteSavedCreator(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting saved creator:', error);
      res.status(500).json({ message: 'Failed to delete saved creator' });
    }
  });

  // Get email templates
  app.get('/api/email/templates', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const templates = await storage.getEmailTemplates(userId);
      res.json(templates);
    } catch (error) {
      console.error('Error getting templates:', error);
      res.status(500).json({ message: 'Failed to get templates' });
    }
  });

  // Create email template
  app.post('/api/email/templates', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const template = await storage.createEmailTemplate({ ...req.body, userId });
      res.json(template);
    } catch (error) {
      console.error('Error creating template:', error);
      res.status(500).json({ message: 'Failed to create template' });
    }
  });

  // Delete email template
  app.delete('/api/email/templates/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteEmailTemplate(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting template:', error);
      res.status(500).json({ message: 'Failed to delete template' });
    }
  });

  // Get email campaigns
  app.get('/api/email/campaigns', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const campaigns = await storage.getEmailCampaigns(userId);
      res.json(campaigns);
    } catch (error) {
      console.error('Error getting campaigns:', error);
      res.status(500).json({ message: 'Failed to get campaigns' });
    }
  });

  // Create email campaign
  app.post('/api/email/campaigns', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const campaign = await storage.createEmailCampaign({ ...req.body, userId });
      res.json(campaign);
    } catch (error) {
      console.error('Error creating campaign:', error);
      res.status(500).json({ message: 'Failed to create campaign' });
    }
  });

  // Update email campaign
  app.patch('/api/email/campaigns/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const campaign = await storage.updateEmailCampaign(req.params.id, userId, req.body);
      if (!campaign) {
        return res.status(404).json({ message: 'Campaign not found' });
      }
      res.json(campaign);
    } catch (error) {
      console.error('Error updating campaign:', error);
      res.status(500).json({ message: 'Failed to update campaign' });
    }
  });

  // Send email campaign
  app.post('/api/email/campaigns/:id/send', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { recipientIds } = req.body;
      const result = await sendEmailCampaign(req.params.id, userId, recipientIds);
      res.json(result);
    } catch (error) {
      console.error('Error sending campaign:', error);
      res.status(500).json({ message: 'Failed to send campaign' });
    }
  });

  // Generate email with AI
  app.post('/api/email/generate', isAuthenticated, async (req: any, res) => {
    try {
      const email = await generateEmailWithAI(req.body);
      await chargeCredits(req.session.userId, 'ai_email', { label: 'Draft email' });
      res.json(email);
    } catch (error) {
      console.error('Error generating email:', error);
      res.status(500).json({ message: 'Failed to generate email' });
    }
  });

  // Improve email with AI
  app.post('/api/email/improve', isAuthenticated, async (req: any, res) => {
    try {
      const { subject, body, instruction } = req.body;
      const improved = await improveEmailWithAI(subject, body, instruction);
      await chargeCredits(req.session.userId, 'ai_email', { label: 'Improve email' });
      res.json(improved);
    } catch (error) {
      console.error('Error improving email:', error);
      res.status(500).json({ message: 'Failed to improve email' });
    }
  });

  // Generate subject lines
  app.post('/api/email/subjects', isAuthenticated, async (req: any, res) => {
    try {
      const { body, count } = req.body;
      const subjects = await generateSubjectLines(body, count || 5);
      await chargeCredits(req.session.userId, 'ai_email', { label: 'Subject lines' });
      res.json({ subjects });
    } catch (error) {
      console.error('Error generating subjects:', error);
      res.status(500).json({ message: 'Failed to generate subjects' });
    }
  });

  // Check email service status
  app.get('/api/email/status', isAuthenticated, async (req: any, res) => {
    try {
      const configured = await isEmailConfigured();
      res.json({ configured });
    } catch (error) {
      res.json({ configured: false });
    }
  });

  // YouTube Video Analysis Routes
  app.get('/api/video-analysis', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const analyses = await storage.getVideoAnalysesByUser(userId);
      res.json(analyses);
    } catch (error) {
      console.error('Error fetching video analyses:', error);
      res.status(500).json({ message: 'Failed to fetch analyses' });
    }
  });

  app.post('/api/video-analysis', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { videoUrl } = req.body;

      if (!videoUrl) {
        return res.status(400).json({ message: 'Video URL is required' });
      }

      // Extract video ID from YouTube URL
      const videoIdMatch = videoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
      if (!videoIdMatch) {
        return res.status(400).json({ message: 'Invalid YouTube URL' });
      }
      const videoId = videoIdMatch[1];

      // Create initial analysis record
      const analysis = await storage.createVideoAnalysis({
        userId,
        videoUrl,
        videoId,
        status: 'pending',
      });

      // Start async analysis
      analyzeYouTubeVideo(analysis.id, videoId).catch(err => {
        console.error('Error in video analysis:', err);
      });

      res.json(analysis);
    } catch (error) {
      console.error('Error creating video analysis:', error);
      res.status(500).json({ message: 'Failed to create analysis' });
    }
  });

  // Speaking analysis over a transcript we produced ourselves (Whisper) —
  // replaces the brittle YouTube-caption scrape. gpt-4o grades presence,
  // speaking ability, and fillers; appearance needs video and stays null.
  app.post('/api/video-analysis/speech', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { transcript, durationSeconds, title, mediaUrl } = req.body ?? {};
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ message: 'Analysis needs the OpenAI key configured' });
      }
      const text = String(transcript ?? '').trim();
      if (text.length < 20) {
        return res.status(400).json({ message: 'Not enough speech to analyze — the clip may be music or silence' });
      }
      const seconds = Math.max(1, Math.floor(Number(durationSeconds) || 0));
      const words = text.split(/\s+/).filter(Boolean).length;
      const wpm = seconds > 1 ? Math.round((words / seconds) * 60) : null;

      const FILLERS = ['um', 'uh', 'like', 'you know', 'sort of', 'kind of', 'basically', 'actually'];
      const lower = ` ${text.toLowerCase()} `;
      const fillerCounts: Record<string, number> = {};
      for (const f of FILLERS) {
        const count = lower.split(` ${f} `).length - 1;
        if (count > 0) fillerCounts[f] = count;
      }

      const OpenAI = (await import('openai')).default;
      const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        max_tokens: 900,
        messages: [
          {
            role: 'system',
            content: `You are a speaking coach for podcasters. Grade the transcript of a spoken recording.
Speaking pace: ${wpm ?? 'unknown'} words/minute. Filler counts already measured: ${JSON.stringify(fillerCounts)}.
Respond with JSON: {"presenceScore": 1-100, "speakingAbilityScore": 1-100, "fillerWordsScore": 1-100,
"presenceFeedback": "<2 sentences on confidence/energy/authority>",
"speakingAbilityFeedback": "<2 sentences on clarity, structure, pacing>",
"fillerWordsFeedback": "<2 sentences on filler usage with the counts>",
"overallFeedback": "<3 sentences: the one thing to keep, the one thing to fix, and how>"}`,
          },
          { role: 'user', content: text.slice(0, 12000) },
        ],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      await chargeCredits(userId, 'speech_analysis', { label: `${words.toLocaleString()} words · ${Math.round(seconds / 60)} min` });
      const clamp = (n: unknown) => Math.max(1, Math.min(100, Math.round(Number(n) || 0))) || null;
      const presence = clamp(parsed.presenceScore);
      const speaking = clamp(parsed.speakingAbilityScore);
      const fillers = clamp(parsed.fillerWordsScore);
      const overall = presence && speaking && fillers ? Math.round((presence + speaking + fillers) / 3) : null;

      const analysis = await storage.createVideoAnalysis({
        userId,
        videoUrl: String(mediaUrl ?? ''),
        videoId: `speech-${Date.now()}`,
        videoTitle: String(title ?? 'Speaking analysis').slice(0, 120),
        transcript: text.slice(0, 20000),
        presenceScore: presence,
        speakingAbilityScore: speaking,
        fillerWordsScore: fillers,
        appearanceScore: null,
        overallScore: overall,
        presenceFeedback: String(parsed.presenceFeedback ?? ''),
        speakingAbilityFeedback: String(parsed.speakingAbilityFeedback ?? ''),
        fillerWordsFeedback: String(parsed.fillerWordsFeedback ?? ''),
        appearanceFeedback: null,
        overallFeedback: String(parsed.overallFeedback ?? ''),
        fillerWordsDetected: fillerCounts,
        status: 'completed',
      });
      res.json({ analysis });
    } catch (error) {
      console.error('Speech analysis error:', error);
      res.status(500).json({ message: 'Analysis failed — try again' });
    }
  });

  app.get('/api/video-analysis/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { id } = req.params;
      const analysis = await storage.getVideoAnalysis(id);
      if (!analysis || analysis.userId !== userId) {
        return res.status(404).json({ message: 'Analysis not found' });
      }
      res.json(analysis);
    } catch (error) {
      console.error('Error fetching video analysis:', error);
      res.status(500).json({ message: 'Failed to fetch analysis' });
    }
  });

  async function analyzeYouTubeVideo(analysisId: string, videoId: string) {
    try {
      const { YoutubeTranscript } = await import('youtube-transcript');
      const OpenAI = (await import('openai')).default;

      // Fetch transcript
      let transcript = '';
      try {
        const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
        transcript = transcriptData.map(t => t.text).join(' ');
      } catch (e) {
        console.error('Error fetching transcript:', e);
        await storage.updateVideoAnalysis(analysisId, {
          status: 'failed',
          overallFeedback: 'Could not fetch transcript. The video may not have captions available.',
        });
        return;
      }

      if (!transcript || transcript.length < 50) {
        await storage.updateVideoAnalysis(analysisId, {
          status: 'failed',
          overallFeedback: 'Transcript too short or unavailable for analysis.',
        });
        return;
      }

      // Fetch video info from YouTube API
      const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
      let videoTitle = '';
      let channelName = '';
      let thumbnailUrl = '';

      if (YOUTUBE_API_KEY) {
        try {
          const videoResponse = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`
          );
          const videoData = await videoResponse.json();
          if (videoData.items?.[0]?.snippet) {
            const snippet = videoData.items[0].snippet;
            videoTitle = snippet.title;
            channelName = snippet.channelTitle;
            thumbnailUrl = snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url;
          }
        } catch (e) {
          console.error('Error fetching video info:', e);
        }
      }

      // Analyze with OpenAI
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const analysisPrompt = `You are an expert speaking coach analyzing a speaker based on their video transcript. Analyze the following transcript and provide scores (0-100) and detailed feedback for each category.

TRANSCRIPT:
${transcript.substring(0, 8000)}

Analyze the speaker on these 5 criteria:

1. PRESENCE (How commanding, confident, and engaging is the speaker?)
2. SPEAKING ABILITY (Clarity, articulation, pacing, and flow)
3. FILLER WORDS (Count and impact of filler words like "um", "uh", "like", "you know", "basically", "actually", "so", etc.)
4. APPEARANCE (Based on speaking style, professionalism in word choice, energy level)

For each category, provide:
- A score from 0-100
- Specific feedback with examples from the transcript
- Actionable improvement suggestions

Also provide an OVERALL SCORE (average of all scores) and OVERALL FEEDBACK summarizing the speaker's strengths and areas for improvement.

Respond in this exact JSON format:
{
  "presence": {"score": 85, "feedback": "..."},
  "speakingAbility": {"score": 80, "feedback": "..."},
  "fillerWords": {"score": 70, "feedback": "...", "detected": ["um (5x)", "like (3x)"]},
  "appearance": {"score": 75, "feedback": "..."},
  "overall": {"score": 78, "feedback": "..."}
}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: analysisPrompt }],
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(completion.choices[0].message.content || '{}');
      // This runs detached from the request, so bill the analysis's owner.
      const owner = await storage.getVideoAnalysis(analysisId);
      if (owner?.userId) await chargeCredits(owner.userId, 'video_analysis', { label: videoTitle || videoId, resourceType: 'video_analysis', resourceId: analysisId });

      await storage.updateVideoAnalysis(analysisId, {
        videoTitle,
        channelName,
        thumbnailUrl,
        transcript: transcript.substring(0, 50000),
        presenceScore: result.presence?.score || 0,
        speakingAbilityScore: result.speakingAbility?.score || 0,
        fillerWordsScore: result.fillerWords?.score || 0,
        appearanceScore: result.appearance?.score || 0,
        overallScore: result.overall?.score || 0,
        presenceFeedback: result.presence?.feedback || '',
        speakingAbilityFeedback: result.speakingAbility?.feedback || '',
        fillerWordsFeedback: result.fillerWords?.feedback || '',
        appearanceFeedback: result.appearance?.feedback || '',
        overallFeedback: result.overall?.feedback || '',
        fillerWordsDetected: result.fillerWords?.detected || [],
        status: 'completed',
        analyzedAt: new Date(),
      });

    } catch (error) {
      console.error('Error analyzing video:', error);
      await storage.updateVideoAnalysis(analysisId, {
        status: 'failed',
        overallFeedback: 'An error occurred during analysis.',
      });
    }
  }

  // ============ UPLOAD-POST INTEGRATION ============

  const UPLOAD_POST_API_BASE = 'https://api.upload-post.com';

  // In-house FFmpeg lane — jobs run on the VPS (no 180s job timeout, no
  // per-minute quota). Active when both env vars are set; FFMPEG_LANE=uploadpost
  // forces the old Upload-Post lane without unsetting anything.
  const vpsFfmpegActive = () =>
    !!process.env.FFMPEG_VPS_URL && !!process.env.FFMPEG_VPS_KEY && process.env.FFMPEG_LANE !== 'uploadpost';
  const vpsFfmpegHeaders = () => ({ 'x-ffmpeg-key': process.env.FFMPEG_VPS_KEY! });

  function getUploadPostApiKey(): string {
    const key = process.env.UPLOAD_POST_API_KEY;
    if (!key) throw new Error('UPLOAD_POST_API_KEY not configured');
    return key;
  }

  // Create Upload-Post profile for user (called on first connect)
  app.post('/api/upload-post/create-profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const uploadPostUsername = `podlogix_${userId}`;

      const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/users`, {
        method: 'POST',
        headers: {
          'Authorization': `ApiKey ${getUploadPostApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: uploadPostUsername }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Upload-Post profile creation error:', error);
        if (response.status === 409) {
          return res.json({ success: true, username: uploadPostUsername, message: 'Profile already exists' });
        }
        return res.status(response.status).json({ message: 'Failed to create Upload-Post profile' });
      }

      const data = await response.json();
      res.json({ success: true, username: uploadPostUsername, ...data });
    } catch (error) {
      console.error('Error creating Upload-Post profile:', error);
      res.status(500).json({ message: 'Failed to create Upload-Post profile' });
    }
  });

  // Generate secure connection URL for OAuth
  app.post('/api/upload-post/connect-url', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const uploadPostUsername = `podlogix_${userId}`;
      // Default to every platform included in our Upload-Post plan.
      const { platforms = ['instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'x', 'threads', 'reddit', 'pinterest', 'bluesky', 'discord', 'telegram'], returnTo } = req.body;

      // Send the user back to wherever they started the connect flow —
      // internal paths only, so the redirect can't be pointed off-site.
      const safeReturnTo = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
        ? returnTo
        : '/dashboard/social-hub';

      const host = req.headers['host'] || 'localhost:5001';
      // Local dev has no TLS — a hardcoded https default sent users back to
      // https://localhost and an SSL error after connecting.
      const isLocal = host.startsWith('localhost') || host.startsWith('127.');
      const protocol = (req.headers['x-forwarded-proto'] as string) || (isLocal ? 'http' : 'https');
      const baseUrl = `${protocol}://${host}`;

      const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/users/generate-jwt`, {
        method: 'POST',
        headers: {
          'Authorization': `ApiKey ${getUploadPostApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: uploadPostUsername,
          redirect_url: `${baseUrl}${safeReturnTo}${safeReturnTo.includes('?') ? '&' : '?'}connected=true`,
          // Must be publicly reachable by the visitor's browser — a localhost
          // baseUrl renders as a broken image on Upload-Post's hosted page.
          logo_image: 'https://podlogix.io/logo.png',
          redirect_button_text: 'Return to Podlogix',
          connect_title: 'Connect Your Social Accounts',
          connect_description: 'Link your social media to start posting from Podlogix',
          show_calendar: false,
          platforms,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Upload-Post JWT generation error:', error);
        return res.status(response.status).json({ message: 'Failed to generate connection URL' });
      }

      const data = await response.json();
      res.json({ success: true, ...data });
    } catch (error) {
      console.error('Error generating Upload-Post connection URL:', error);
      res.status(500).json({ message: 'Failed to generate connection URL' });
    }
  });

  // Get connected accounts from Upload-Post
  app.get('/api/upload-post/accounts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const uploadPostUsername = `podlogix_${userId}`;

      const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/users?username=${uploadPostUsername}`, {
        method: 'GET',
        headers: {
          'Authorization': `ApiKey ${getUploadPostApiKey()}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return res.json({ accounts: [], hasProfile: false });
        }
        const error = await response.text();
        console.error('Upload-Post get accounts error:', error);
        return res.status(response.status).json({ message: 'Failed to fetch accounts' });
      }

      const data = await response.json();

      // Upload-Post ignores the ?username filter and returns every profile on the
      // API key — including profiles belonging to other projects. Select ours by
      // exact username or we'd display another product's connections (real bug:
      // profiles[0] used to surface an unrelated profile with 5 platforms).
      // social_accounts is keyed by platform — falsy means "not connected".
      const profile = Array.isArray(data.profiles)
        ? (data.profiles.find((p: any) => p.username === uploadPostUsername) ?? null)
        : null;
      const socialAccounts = profile?.social_accounts || {};
      const connected = Object.entries(socialAccounts).filter(
        ([, value]) => value && typeof value === 'object'
      ) as [string, { display_name?: string; handle?: string; social_images?: string }][];

      // Sync accounts to local database. Avatar URLs from Upload-Post are
      // expiring CDN links — mirror them into our storage once and reuse the
      // mirrored copy on subsequent syncs.
      const previousAccounts = await storage.getUploadPostAccountsByUser(userId);
      const supabaseHost = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;
      const mirroredByPlatform = new Map(
        previousAccounts
          .filter((a) => {
            try { return supabaseHost && a.profilePictureUrl && new URL(a.profilePictureUrl).host === supabaseHost; }
            catch { return false; }
          })
          .map((a) => [a.platform, a.profilePictureUrl!])
      );
      // Facebook posts land on a Page (the posting route always targets the first
      // managed page), so the pill should carry the Page's name — showing the
      // personal profile name would misstate where posts actually go.
      let facebookPageName: string | null = null;
      if (connected.some(([platform]) => platform === 'facebook')) {
        try {
          const pagesResponse = await fetch(
            `${UPLOAD_POST_API_BASE}/api/uploadposts/facebook/pages?profile=${encodeURIComponent(uploadPostUsername)}`,
            { headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` } }
          );
          if (pagesResponse.ok) {
            const pagesData = await pagesResponse.json().catch(() => ({}));
            facebookPageName = ((pagesData as any).pages ?? (pagesData as any).data ?? [])[0]?.name ?? null;
          }
        } catch { /* fall back to the profile name */ }
      }

      await storage.deleteUploadPostAccountsByUser(userId);
      const accounts = [];
      for (const [platform, account] of connected) {
        const avatarUrl = mirroredByPlatform.get(platform)
          ?? (account.social_images ? await mirrorExternalMedia(account.social_images, `avatars/${userId}`) : null);
        const created = await storage.createUploadPostAccount({
          userId,
          uploadPostUsername,
          platform,
          platformAccountId: null,
          platformUsername: (platform === 'facebook' && facebookPageName ? facebookPageName
            : (account.handle || account.display_name || platform)).replace(/^@/, ''),
          profileUrl: null,
          profilePictureUrl: avatarUrl,
          isConnected: true,
        });
        // reauth_required=true on an account object means its token expired and the
        // creator has to go back through the connect flow (per Upload-Post support).
        accounts.push({ ...created, reauthRequired: (account as any).reauth_required === true });
      }

      res.json({ hasProfile: true, accounts });
    } catch (error) {
      console.error('Error fetching Upload-Post accounts:', error);
      res.status(500).json({ message: 'Failed to fetch accounts' });
    }
  });

  // Get local cached accounts
  app.get('/api/upload-post/local-accounts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const accounts = await storage.getUploadPostAccountsByUser(userId);
      res.json({ accounts });
    } catch (error) {
      console.error('Error fetching local accounts:', error);
      res.status(500).json({ message: 'Failed to fetch local accounts' });
    }
  });

  // Platforms that accept a pure text post on Upload-Post's /api/upload_text.
  // Instagram/YouTube/TikTok/Pinterest are media-first — they need a photo or video.
  const TEXT_CAPABLE_PLATFORMS = new Set(['x', 'linkedin', 'facebook', 'threads', 'reddit', 'bluesky', 'discord', 'telegram']);

  // Create a post via Upload-Post. Routes to the correct endpoint by media type:
  // text -> /api/upload_text, photo -> /api/upload_photos (file forwarded as
  // multipart), video -> /api/upload (accepts a URL directly).
  app.post('/api/upload-post/posts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const uploadPostUsername = `podlogix_${userId}`;
      const { platforms, content, mediaUrl, mediaType, scheduledAt, draft, subreddit, pinterestBoardId } = req.body;

      if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
        return res.status(400).json({ message: 'At least one platform is required' });
      }
      if (!content && !mediaUrl) {
        return res.status(400).json({ message: 'Content or media is required' });
      }
      // Media must come from our own storage bucket — the server fetches this
      // URL, so anything else is an open relay.
      if (mediaUrl) {
        try {
          const supabaseHost = new URL(process.env.SUPABASE_URL!).host;
          if (new URL(mediaUrl).host !== supabaseHost) {
            return res.status(400).json({ message: 'Media must be uploaded through Podlogix first' });
          }
        } catch {
          return res.status(400).json({ message: 'Invalid media URL' });
        }
      }

      const wantsReddit = platforms.some((p: string) => p.toLowerCase() === 'reddit');
      const wantsPinterest = platforms.some((p: string) => p.toLowerCase() === 'pinterest');
      if (!draft && wantsReddit && !subreddit?.trim()) {
        return res.status(400).json({ message: 'Reddit needs a subreddit name' });
      }
      if (!draft && wantsPinterest && !pinterestBoardId) {
        return res.status(400).json({ message: 'Pinterest needs a board selected' });
      }

      // Drafts never touch Upload-Post — they're a local save.
      if (draft) {
        const localDraft = await storage.createUploadPostPost({
          userId,
          uploadPostPostId: null,
          platforms,
          content: content ?? '',
          mediaUrls: mediaUrl ? [mediaUrl] : null,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
          status: 'draft',
        });
        return res.json({ success: true, post: localDraft });
      }

      if (!mediaUrl) {
        const incompatible = platforms.filter((p: string) => !TEXT_CAPABLE_PLATFORMS.has(p.toLowerCase()));
        if (incompatible.length > 0) {
          return res.status(400).json({
            message: `Text-only posts aren't supported on ${incompatible.join(', ')} — attach a photo or video first`,
          });
        }
      }

      const form = new FormData();
      form.append('user', uploadPostUsername);
      if (content) form.append('title', content);
      if (scheduledAt) form.append('scheduled_date', new Date(scheduledAt).toISOString());
      if (wantsReddit && subreddit?.trim()) form.append('subreddit', subreddit.trim().replace(/^r\//i, ''));
      if (wantsPinterest && pinterestBoardId) form.append('pinterest_board_id', pinterestBoardId);

      // Facebook posts land on a Page, and the API needs the page id explicitly.
      // Use the first managed page (the one chosen on the connect screen).
      if (platforms.some((p: string) => p.toLowerCase() === 'facebook')) {
        try {
          const pagesResponse = await fetch(
            `${UPLOAD_POST_API_BASE}/api/uploadposts/facebook/pages?profile=${encodeURIComponent(uploadPostUsername)}`,
            { headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` } }
          );
          if (pagesResponse.ok) {
            const pagesData = await pagesResponse.json();
            const firstPage = (pagesData.pages ?? pagesData.data ?? [])[0];
            if (firstPage?.id) form.append('facebook_page_id', firstPage.id);
          }
        } catch { /* let Upload-Post surface its own error if pages can't load */ }
      }

      let endpoint: string;
      if (mediaUrl && mediaType === 'video') {
        endpoint = '/api/upload';
        // The video endpoint's platform vocabulary uses "twitter" where the others use "x".
        for (const p of platforms) form.append('platform[]', p.toLowerCase() === 'x' ? 'twitter' : p);
        form.append('video', mediaUrl); // accepts a URL directly
      } else if (mediaUrl) {
        endpoint = '/api/upload_photos';
        for (const p of platforms) form.append('platform[]', p);
        // photos[] wants a file — fetch from storage and forward as multipart.
        const photoResponse = await fetch(mediaUrl);
        if (!photoResponse.ok) {
          return res.status(400).json({ message: 'Could not read the uploaded photo' });
        }
        const contentType = photoResponse.headers.get('content-type') || 'image/jpeg';
        const buffer = Buffer.from(await photoResponse.arrayBuffer());
        const fileName = (() => {
          try {
            const base = new URL(mediaUrl).pathname.split('/').pop();
            return base && base.includes('.') ? base : 'photo.jpg';
          } catch { return 'photo.jpg'; }
        })();
        form.append('photos[]', new Blob([buffer], { type: contentType }), fileName);
      } else {
        endpoint = '/api/upload_text';
        for (const p of platforms) form.append('platform[]', p);
      }

      const response = await fetch(`${UPLOAD_POST_API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
        body: form,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error('Upload-Post create post error:', response.status, data);
        return res.status(response.status).json({
          message: (data as any)?.message || (data as any)?.error || 'Failed to create post',
        });
      }

      const localPost = await storage.createUploadPostPost({
        userId,
        // job_id first: it's what the upload_completed webhook sends back.
        uploadPostPostId: (data as any).job_id?.toString() ?? (data as any).post_id?.toString() ?? (data as any).request_id ?? null,
        platforms,
        content: content ?? '',
        mediaUrls: mediaUrl ? [mediaUrl] : null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: scheduledAt ? 'scheduled' : 'published',
      });

      res.json({ success: true, post: localPost, ...data });
    } catch (error) {
      console.error('Error creating Upload-Post post:', error);
      res.status(500).json({ message: 'Failed to create post' });
    }
  });

  // Rich per-platform analytics from Upload-Post (followers, reach, views,
  // likes/comments/shares/saves, 30-day reach timeseries, demographics).
  // Included in the flat plan — no metered cost.
  app.get('/api/upload-post/analytics', isAuthenticated, async (req: any, res) => {
    try {
      const uploadPostUsername = `podlogix_${req.session.userId!}`;
      const platforms = String(req.query.platforms || '').trim();
      if (!platforms) {
        return res.status(400).json({ message: 'platforms query param is required' });
      }

      // Facebook analytics need a page_id — resolve the first managed page, best-effort.
      let pageIdParam = '';
      if (platforms.split(',').includes('facebook')) {
        try {
          const pagesResponse = await fetch(
            `${UPLOAD_POST_API_BASE}/api/uploadposts/facebook/pages?profile=${encodeURIComponent(uploadPostUsername)}`,
            { headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` } }
          );
          if (pagesResponse.ok) {
            const pagesData = await pagesResponse.json();
            const firstPage = (pagesData.pages ?? pagesData.data ?? [])[0];
            if (firstPage?.id) pageIdParam = `&page_id=${encodeURIComponent(firstPage.id)}`;
          }
        } catch { /* analytics still succeed for other platforms */ }
      }

      const response = await fetch(
        `${UPLOAD_POST_API_BASE}/api/analytics/${encodeURIComponent(uploadPostUsername)}?platforms=${encodeURIComponent(platforms)}${pageIdParam}`,
        { headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` } }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({ message: 'Failed to fetch analytics' });
      }
      res.json(data);
    } catch (error) {
      console.error('Error fetching Upload-Post analytics:', error);
      res.status(500).json({ message: 'Failed to fetch analytics' });
    }
  });

  // ============ MEDIA LIBRARY (back-catalog import via Upload-Post /media) ============

  // Browse a connected channel's existing posts (for the import picker).
  // Quirks per Upload-Post support: TikTok/YouTube return permalink only (no
  // media_url); LinkedIn rejects cursors.
  app.get('/api/upload-post/media', isAuthenticated, async (req: any, res) => {
    try {
      const uploadPostUsername = `podlogix_${req.session.userId!}`;
      const platform = String(req.query.platform || '');
      if (!platform) return res.status(400).json({ message: 'platform is required' });
      const cursor = req.query.cursor ? String(req.query.cursor) : null;

      const params = new URLSearchParams({ platform, user: uploadPostUsername, limit: '24' });
      if (cursor && platform !== 'linkedin') params.set('cursor', cursor);

      const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/media?${params}`, {
        headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({ message: (data as any)?.message || 'Failed to fetch media' });
      }
      res.json(data);
    } catch (error) {
      console.error('Error fetching channel media:', error);
      res.status(500).json({ message: 'Failed to fetch media' });
    }
  });

  // Import selected posts: mirror media/thumbnails into OUR storage, then save.
  // Add one item by hand: an uploaded file (already in our bucket), a direct
  // media URL (downloaded into our bucket), or a YouTube link (kept as a
  // linked reference — we don't rip YouTube videos).
  app.post('/api/media-library/add', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const title = String(req.body?.title ?? '').trim().slice(0, 200);
      let url: URL;
      try { url = new URL(String(req.body?.url ?? '')); } catch {
        return res.status(400).json({ message: 'Paste a valid link first' });
      }
      if (url.protocol !== 'https:') return res.status(400).json({ message: 'The link must be https' });

      const extOf = (p: string) => (/\.([a-z0-9]{2,5})(?:$|\?)/i.exec(p)?.[1] ?? '').toLowerCase();
      const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
      const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v']);

      // YouTube: store the link itself, not the file.
      if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(url.host)) {
        const item = await storage.createMediaLibraryItem({
          userId,
          platform: 'youtube',
          externalId: `link-${crypto.createHash('sha1').update(url.toString()).digest('hex').slice(0, 16)}`,
          caption: title || 'YouTube video',
          mediaType: 'video',
          mediaUrl: null,
          thumbnailUrl: null,
          permalink: url.toString(),
          postedAt: new Date(),
        });
        return res.json({ item, linked: true });
      }

      const supabaseHost = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;
      const ext = extOf(url.pathname);
      const mediaType = AUDIO_EXT.has(ext) ? 'audio' : VIDEO_EXT.has(ext) ? 'video' : 'image';

      // Already in our bucket (fresh upload) — just file it.
      if (supabaseHost && url.host === supabaseHost) {
        const item = await storage.createMediaLibraryItem({
          userId,
          platform: 'upload',
          externalId: `upload-${crypto.createHash('sha1').update(url.toString()).digest('hex').slice(0, 16)}`,
          caption: title || 'Uploaded media',
          mediaType,
          mediaUrl: url.toString(),
          thumbnailUrl: null,
          permalink: null,
          postedAt: new Date(),
        });
        return res.json({ item });
      }

      // External direct file: copy it into our bucket (never keep foreign URLs).
      const dl = await fetch(url.toString());
      if (!dl.ok) return res.status(400).json({ message: `That link refused the download (HTTP ${dl.status})` });
      const contentType = dl.headers.get('content-type') || '';
      if (!/^(video|audio|image)\//.test(contentType)) {
        return res.status(400).json({ message: 'That link is a web page, not a media file. Paste a direct .mp4/.mp3 link — or use Upload.' });
      }
      const buffer = Buffer.from(await dl.arrayBuffer());
      if (buffer.length === 0 || buffer.length > MAX_CLIP_BYTES) {
        return res.status(413).json({ message: buffer.length === 0 ? 'That file is empty' : 'That file is over the 80MB link limit — upload it instead' });
      }
      const stored = contentType.startsWith('audio/')
        ? await storeAudioBuffer(buffer, `imports/${userId}`, contentType)
        : contentType.startsWith('image/')
          ? await storeImageBuffer(buffer, `imports/${userId}`, contentType)
          : await storeVideoBuffer(buffer, `imports/${userId}`, contentType);
      if (!stored) return res.status(502).json({ message: "Couldn't store the file" });
      const item = await storage.createMediaLibraryItem({
        userId,
        platform: 'upload',
        externalId: `import-${crypto.createHash('sha1').update(url.toString()).digest('hex').slice(0, 16)}`,
        caption: title || url.pathname.split('/').pop() || 'Imported media',
        mediaType: contentType.startsWith('audio/') ? 'audio' : contentType.startsWith('image/') ? 'image' : 'video',
        mediaUrl: stored,
        thumbnailUrl: null,
        permalink: null,
        postedAt: new Date(),
      });
      res.json({ item });
    } catch (error) {
      console.error('Error adding media:', error);
      res.status(500).json({ message: 'Failed to add that to the library' });
    }
  });

  app.post('/api/media-library/import', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { platform, items } = req.body ?? {};
      if (!platform || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'platform and items are required' });
      }
      if (items.length > 50) {
        return res.status(400).json({ message: 'Import at most 50 items at a time' });
      }

      let imported = 0;
      for (const item of items) {
        if (!item?.id) continue;
        const [mediaUrl, thumbnailUrl] = await Promise.all([
          item.media_url ? mirrorExternalMedia(item.media_url, `media-library/${userId}`) : Promise.resolve(null),
          item.thumbnail_url ? mirrorExternalMedia(item.thumbnail_url, `media-library/${userId}`) : Promise.resolve(null),
        ]);
        const created = await storage.createMediaLibraryItem({
          userId,
          platform,
          externalId: String(item.id),
          caption: item.caption ?? null,
          mediaType: item.media_type ?? (mediaUrl ? 'image' : 'link'),
          mediaUrl,
          thumbnailUrl,
          permalink: item.permalink ?? null,
          postedAt: item.timestamp ? new Date(item.timestamp) : null,
        });
        if (created) imported += 1;
      }
      res.json({ success: true, imported, skipped: items.length - imported });
    } catch (error) {
      console.error('Error importing media:', error);
      res.status(500).json({ message: 'Failed to import media' });
    }
  });

  app.get('/api/media-library', isAuthenticated, async (req: any, res) => {
    try {
      const items = await storage.getMediaLibraryItemsByUser(req.session.userId!);
      res.json({ items });
    } catch (error) {
      console.error('Error fetching media library:', error);
      res.status(500).json({ message: 'Failed to fetch media library' });
    }
  });

  app.delete('/api/media-library/:id', isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteMediaLibraryItem(req.params.id, req.session.userId!);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting media item:', error);
      res.status(500).json({ message: 'Failed to delete media item' });
    }
  });

  // Pinterest boards for the board picker (required per pin)
  app.get('/api/upload-post/pinterest/boards', isAuthenticated, async (req: any, res) => {
    try {
      const uploadPostUsername = `podlogix_${req.session.userId!}`;
      const response = await fetch(
        `${UPLOAD_POST_API_BASE}/api/uploadposts/pinterest/boards?profile=${encodeURIComponent(uploadPostUsername)}`,
        { headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` } }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({ message: (data as any)?.message || 'Failed to fetch boards' });
      }
      res.json(data);
    } catch (error) {
      console.error('Error fetching Pinterest boards:', error);
      res.status(500).json({ message: 'Failed to fetch boards' });
    }
  });

  // Scheduled posts — live from Upload-Post (list + cancel)
  app.get('/api/upload-post/scheduled', isAuthenticated, async (req: any, res) => {
    try {
      const uploadPostUsername = `podlogix_${req.session.userId!}`;
      const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/schedule`, {
        headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({ message: 'Failed to fetch scheduled posts' });
      }
      // The API key spans every profile on the account — only return this user's.
      const jobs = (Array.isArray((data as any).jobs) ? (data as any).jobs
        : Array.isArray(data) ? data : (data as any).scheduled_posts ?? [])
        .filter((job: any) => !job.user || job.user === uploadPostUsername || job.profile === uploadPostUsername);
      res.json({ jobs });
    } catch (error) {
      console.error('Error fetching scheduled posts:', error);
      res.status(500).json({ message: 'Failed to fetch scheduled posts' });
    }
  });

  app.delete('/api/upload-post/scheduled/:jobId', isAuthenticated, async (req: any, res) => {
    try {
      const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/schedule/${req.params.jobId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({ message: (data as any)?.message || 'Failed to cancel scheduled post' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error cancelling scheduled post:', error);
      res.status(500).json({ message: 'Failed to cancel scheduled post' });
    }
  });

  app.patch('/api/upload-post/scheduled/:jobId', isAuthenticated, async (req: any, res) => {
    try {
      const { scheduledAt, title, caption } = req.body ?? {};
      const payload: Record<string, string> = {};
      if (scheduledAt) payload.scheduled_date = new Date(scheduledAt).toISOString();
      if (typeof title === 'string' && title.trim()) payload.title = title.trim();
      if (typeof caption === 'string' && caption.trim()) payload.caption = caption.trim();
      if (Object.keys(payload).length === 0) {
        return res.status(400).json({ message: 'Nothing to update' });
      }
      const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/schedule/${req.params.jobId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `ApiKey ${getUploadPostApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({ message: (data as any)?.message || 'Failed to update scheduled post' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating scheduled post:', error);
      res.status(500).json({ message: 'Failed to update scheduled post' });
    }
  });

  // Upload-Post webhook receiver. upload_completed fires on BOTH published and
  // failed posts (support-confirmed), carrying job_id + result.{success,url,error}.
  // Reauth events need no handling here — the accounts sync already surfaces
  // reauth_required on every fetch. Always 200 so Upload-Post doesn't retry.
  // Point the dashboard webhook at /api/webhooks/upload-post?secret=<value of
  // UPLOAD_POST_WEBHOOK_SECRET>; without the env var the endpoint accepts all
  // (dev convenience), with it set a bad secret is rejected.
  app.post('/api/webhooks/upload-post', async (req, res) => {
    try {
      const secret = process.env.UPLOAD_POST_WEBHOOK_SECRET;
      if (secret && req.query.secret !== secret) {
        return res.status(401).json({ message: 'Invalid webhook secret' });
      }

      const event = req.body ?? {};
      const jobId = event.job_id?.toString() ?? event.request_id?.toString() ?? null;
      const result = event.result ?? event;
      const hasOutcome = typeof result?.success === 'boolean';

      if (jobId && hasOutcome) {
        const post = await storage.getUploadPostPostByExternalId(jobId);
        if (post) {
          await storage.updateUploadPostPost(post.id, {
            status: result.success ? 'published' : 'failed',
            publishedAt: result.success ? new Date() : null,
            errorMessage: result.success ? null : (result.error?.toString() ?? 'Publish failed'),
          });
        } else {
          console.warn('upload_completed webhook for unknown job_id:', jobId);
        }
      }

      res.json({ received: true });
    } catch (error) {
      console.error('Error handling Upload-Post webhook:', error);
      // Still 200 — a retry storm won't fix a handler bug.
      res.json({ received: true });
    }
  });

  // ============ ENGAGEMENT: INSTAGRAM DMS + COMMENTS ============
  // DMs are Instagram-only today (support-confirmed); other platforms error.
  // Reading covers the full inbox. Sending is bound by Instagram's 24-hour
  // window (recipient must have messaged first) and a daily cap that 429s.

  app.get('/api/upload-post/dms/conversations', isAuthenticated, async (req: any, res) => {
    try {
      const uploadPostUsername = `podlogix_${req.session.userId!}`;
      const response = await fetch(
        `${UPLOAD_POST_API_BASE}/api/uploadposts/dms/conversations?platform=instagram&user=${encodeURIComponent(uploadPostUsername)}`,
        { headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` } }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({ message: (data as any)?.message || 'Failed to load conversations' });
      }
      res.json({ conversations: (data as any).conversations ?? [] });
    } catch (error) {
      console.error('Error fetching DM conversations:', error);
      res.status(500).json({ message: 'Failed to load conversations' });
    }
  });

  app.post('/api/upload-post/dms/send', isAuthenticated, async (req: any, res) => {
    try {
      const uploadPostUsername = `podlogix_${req.session.userId!}`;
      const { recipientId, message } = req.body ?? {};
      if (!recipientId || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ message: 'recipientId and message are required' });
      }
      const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/dms/send`, {
        method: 'POST',
        headers: {
          'Authorization': `ApiKey ${getUploadPostApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          platform: 'instagram',
          user: uploadPostUsername,
          recipient_id: recipientId,
          message: message.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const readable = response.status === 429
          ? "Daily DM limit reached — Instagram caps how many DMs can go out per day. Try again tomorrow."
          : (data as any)?.message || "Couldn't send the message — Instagram only allows replies within 24 hours of the person's last message.";
        return res.status(response.status).json({ message: readable });
      }
      res.json({ success: true, messageId: (data as any).message_id });
    } catch (error) {
      console.error('Error sending DM:', error);
      res.status(500).json({ message: 'Failed to send message' });
    }
  });

  // ============ COMPOSER AI (write + images) ============
  // Ported from Empowerify's composer, grounded in the creator's own podcast.

  const AI_TONES: Record<string, string> = {
    pro: 'Professional and polished. Clear, confident, no slang, minimal emoji.',
    casual: 'Casual and friendly, like talking to a friend. Contractions welcome, one or two emoji fine.',
    funny: 'Witty and playful. Light humor that lands without being cringey.',
    promo: 'Promotional and action-driven. Strong hook, clear call to action, urgency without hype.',
    edu: 'Educational and generous. Teach one concrete thing; lead with the insight.',
  };

  const PLATFORM_CHAR_LIMITS: Record<string, number> = {
    x: 280, bluesky: 300, threads: 500, pinterest: 500, discord: 2000,
    instagram: 2200, tiktok: 2200, linkedin: 3000, telegram: 4096,
    youtube: 5000, reddit: 40000, facebook: 63206,
  };
  const tightestCharLimit = (platforms: unknown): number => {
    const list = Array.isArray(platforms) ? platforms : [];
    return Math.min(
      ...list.map((p) => PLATFORM_CHAR_LIMITS[String(p).toLowerCase()] ?? 2200),
      2200,
    );
  };

  app.post('/api/social/ai-write', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { focus, customFocus, tone, direction, platforms, episodeId } = req.body ?? {};
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ message: 'AI writing needs the OpenAI key configured' });
      }

      const podcasts = await storage.getPodcastsByUserId(userId);
      const show = podcasts[0] ?? null;

      // "My Show" focus can target a specific episode — verify it's theirs.
      let episodeContext = '';
      if (episodeId) {
        const episode = await storage.getEpisode(String(episodeId));
        if (episode && podcasts.some((p) => p.id === episode.podcastId)) {
          const notes = String(episode.description || episode.showNotes || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500);
          episodeContext = `\nThe post promotes this specific episode: "${episode.title}"${notes ? ` — ${notes}` : ''}. Tease it; don't give everything away.`;
        }
      }
      const showContext = show
        ? `The creator hosts the podcast "${show.title}"${show.description ? ` — ${String(show.description).slice(0, 300)}` : ''}.`
        : 'The creator hosts a podcast.';

      const focusMap: Record<string, string> = {
        show: `${showContext} Write a social post that promotes the show or a recent episode and gives people a reason to listen.`,
        general: `${showContext} Write a social post sharing a useful tip, insight, or piece of news from their subject area. Value first, show second.`,
        personal: `${showContext} Write a personal, authentic post that shows the human behind the mic — a lesson, a behind-the-scenes moment, a candid thought.`,
        custom: `${showContext} Write a social post about: ${String(customFocus || direction || 'a general update')}.`,
      };

      const toneLine = AI_TONES[String(tone)] ?? AI_TONES.pro;
      const platformList: string[] = Array.isArray(platforms) ? platforms : [];
      const tightest = tightestCharLimit(platformList);

      const system = `You write social media posts for podcast creators.
${focusMap[String(focus)] ?? focusMap.general}${episodeContext}
Tone: ${toneLine}
The post must fit in ${Math.min(tightest, 2200)} characters (the tightest selected platform). No markdown formatting — plain text with natural line breaks only.
Respond with JSON: {"post": "<the post text, no hashtags in it>", "hashtags": ["five", "relevant", "hashtags", "without", "#"]}`;

      const OpenAI = (await import('openai')).default;
      const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        max_tokens: 700,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Topic/direction: ${String(direction || customFocus || 'surprise me — something on-brand')}` },
        ],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      await chargeCredits(userId, 'social_post_ai', { label: String(direction || customFocus || focus || 'social post').slice(0, 80) });
      res.json({
        post: typeof parsed.post === 'string' ? parsed.post : '',
        hashtags: Array.isArray(parsed.hashtags)
          ? parsed.hashtags.slice(0, 5).map((h: unknown) => String(h).replace(/^#/, ''))
          : [],
      });
    } catch (error) {
      console.error('AI write error:', error);
      res.status(500).json({ message: 'AI writing failed — try again' });
    }
  });

  app.post('/api/social/ai-image', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { prompt, count } = req.body ?? {};
      if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ message: 'prompt is required' });
      }
      if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ message: 'Image generation needs the OpenAI key configured' });
      }
      if (!isSupabaseStorageConfigured()) {
        return res.status(503).json({ message: 'Storage is not configured' });
      }
      const n = Math.min(Math.max(1, Number(count) || 2), 4);
      const fullPrompt = `${prompt.trim()}, photorealistic, professional photo, high quality, no text, no words`;
      const { generateImageBuffer } = await import('./replit_integrations/image/client');
      const buffers = await Promise.all(
        Array.from({ length: n }, () => generateImageBuffer(fullPrompt).catch(() => null))
      );
      const urls = (
        await Promise.all(
          buffers.filter((b): b is Buffer => !!b).map((b) => storeImageBuffer(b, `ai-images/${userId}`))
        )
      ).filter((u): u is string => !!u);
      if (urls.length === 0) {
        return res.status(500).json({ message: 'Image generation failed — try again' });
      }
      res.json({ urls });
    } catch (error) {
      console.error('AI image error:', error);
      res.status(500).json({ message: 'Image generation failed — try again' });
    }
  });

  // Batch generation for Campaigns and Cadences: the client sends dated slots
  // (each with a theme), one gpt call writes the whole series with varied
  // angles, and the client schedules each post through the normal posts route.
  app.post('/api/social/ai-batch', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { slots, tone, platforms, theme, mode } = req.body ?? {};
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ message: 'AI writing needs the OpenAI key configured' });
      }
      if (!Array.isArray(slots) || slots.length === 0) {
        return res.status(400).json({ message: 'slots are required' });
      }
      if (slots.length > 30) {
        return res.status(400).json({ message: 'Plan 30 posts or fewer at a time' });
      }

      const podcasts = await storage.getPodcastsByUserId(userId);
      const show = podcasts[0] ?? null;
      const showContext = show
        ? `The creator hosts the podcast "${show.title}"${show.description ? ` — ${String(show.description).slice(0, 300)}` : ''}.`
        : 'The creator hosts a podcast.';
      const toneLine = AI_TONES[String(tone)] ?? AI_TONES.pro;
      const limit = tightestCharLimit(platforms);

      const slotLines = slots
        .map((s: any, i: number) => `${i + 1}. ${new Date(s.date).toDateString()} — theme: ${String(s.theme || theme || 'general')}`)
        .join('\n');
      const system = `You write a series of social media posts for a podcast creator.
${showContext}
${mode === 'cadence'
  ? 'This is a recurring weekly cadence — each day has its own theme.'
  : `This is a campaign around one theme: ${String(theme || 'a themed push')}.`}
Write exactly one post per slot below, in order. Every post must take a DIFFERENT angle — vary the hook and format (question, bold claim, mini-story, list, stat); never reuse phrasing between posts.
Tone: ${toneLine}
Each post must fit in ${limit} characters. Plain text with natural line breaks; no hashtags inside the post body.
Slots:
${slotLines}
Respond with JSON: {"posts":[{"slot":1,"title":"<short internal label>","post":"<the text>","hashtags":["five","relevant","tags","without","symbol"]}]}`;

      const OpenAI = (await import('openai')).default;
      const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        max_tokens: 4000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Write the series now.' },
        ],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      const generated = Array.isArray(parsed.posts) ? parsed.posts : [];
      await chargeCredits(userId, 'social_batch_ai', { label: `${generated.length} posts · ${String(mode)}`, meta: { posts: generated.length } });
      const posts = slots.map((s: any, i: number) => {
        const g = generated.find((p: any) => p?.slot === i + 1) ?? generated[i] ?? {};
        return {
          date: s.date,
          theme: s.theme ?? theme ?? null,
          title: typeof g.title === 'string' ? g.title : `Post ${i + 1}`,
          post: typeof g.post === 'string' ? g.post : '',
          hashtags: Array.isArray(g.hashtags)
            ? g.hashtags.slice(0, 5).map((h: unknown) => String(h).replace(/^#/, ''))
            : [],
        };
      }).filter((p: { post: string }) => p.post.trim().length > 0);
      if (posts.length === 0) {
        return res.status(500).json({ message: 'Generation came back empty — try again' });
      }
      res.json({ posts });
    } catch (error) {
      console.error('AI batch error:', error);
      res.status(500).json({ message: 'Batch generation failed — try again' });
    }
  });

  // Transcribe a clip's audio (WAV extracted client-side) via OpenAI Whisper.
  // Word + segment timestamps power SRT/VTT caption downloads. 25MB is
  // Whisper's hard cap; the client's extractor targets well under it.
  app.post('/api/social/transcribe', isAuthenticated,
    express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }),
    async (req: any, res) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ message: 'Transcription needs the OpenAI key configured' });
      }
      const buffer: Buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return res.status(400).json({ message: 'Send the audio as the request body' });
      }
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: 'audio/wav' }), 'clip.wav');
      form.append('model', 'whisper-1');
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'word');
      form.append('timestamp_granularities[]', 'segment');
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error('Whisper error:', response.status, data);
        return res.status(response.status >= 500 ? 502 : response.status).json({ message: (data as any)?.error?.message || 'Transcription failed' });
      }
      res.json({
        text: (data as any).text ?? '',
        segments: Array.isArray((data as any).segments)
          ? (data as any).segments.map((s: any) => ({ start: s.start, end: s.end, text: String(s.text ?? '').trim() }))
          : [],
        // Word timing rides along free — Facet's browser lane cuts with it.
        words: Array.isArray((data as any).words)
          ? (data as any).words.map((w: any) => ({ word: w.word, start: w.start, end: w.end }))
          : [],
      });
    } catch (error) {
      console.error('Error transcribing:', error);
      res.status(500).json({ message: 'Transcription failed' });
    }
  });

  // Attach an episode's (or show's) artwork as post media. The artwork URL
  // comes from our own DB — never the client — so fetching it is safe; the
  // image still gets content-type and size checks, and lands in our bucket
  // so the posting route's Supabase-host guard passes.
  app.post('/api/social/episode-artwork', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { episodeId } = req.body ?? {};
      if (!episodeId) return res.status(400).json({ message: 'episodeId is required' });
      const episode = await storage.getEpisode(String(episodeId));
      const podcasts = await storage.getPodcastsByUserId(userId);
      const podcast = episode ? podcasts.find((p) => p.id === episode.podcastId) : undefined;
      if (!episode || !podcast) return res.status(404).json({ message: 'Episode not found' });

      const sourceUrl = episode.artworkUrl || podcast.artworkUrl || null;
      if (!sourceUrl) return res.status(404).json({ message: 'No artwork on this episode or show yet' });

      const supabaseHost = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;
      try {
        if (supabaseHost && new URL(sourceUrl).host === supabaseHost) {
          return res.json({ url: sourceUrl });
        }
      } catch { /* relative path — resolve below */ }

      const absolute = sourceUrl.startsWith('http')
        ? sourceUrl
        : `${process.env.PUBLIC_BASE_URL || 'https://podlogix.io'}${sourceUrl}`;
      const response = await fetch(absolute);
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.startsWith('image/')) {
        return res.status(422).json({ message: "Couldn't fetch the artwork image" });
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0 || buffer.length > 15 * 1024 * 1024) {
        return res.status(422).json({ message: 'Artwork is too large to attach' });
      }
      const url = await storeImageBuffer(buffer, `artwork/${userId}`, contentType);
      if (!url) return res.status(500).json({ message: "Couldn't store the artwork" });
      res.json({ url });
    } catch (error) {
      console.error('Episode artwork error:', error);
      res.status(500).json({ message: "Couldn't attach artwork" });
    }
  });

  // ============ LIVE STUDIO (mark moments live, cut clips after) ============
  // Ported from MilCrunch's Live Companion. The creator streams wherever they
  // already stream; this records WHEN the good moments happened, then turns
  // marks into clips via Upload-Post's FFmpeg jobs — command built server-side
  // from validated numbers ONLY, clip downloaded into OUR storage (their
  // result URLs expire), filed in the media library.

  const LIVE_PRE_ROLL = 20;  // people press CLIP after the good part happens
  const LIVE_POST_ROLL = 10;
  const MAX_CLIP_BYTES = 80 * 1024 * 1024;
  const FFMPEG_JOBS_BASE = `${UPLOAD_POST_API_BASE}/api/uploadposts/ffmpeg/jobs`;
  const MAX_RECORDING_BYTES = 250 * 1024 * 1024;

  // Studio recordings are WebM (the only format browsers can record). MP4
  // (H.264 + AAC) is what phones, QuickTime, and social uploaders expect, so
  // every recording converts itself in the background — fire-and-forget: a
  // failure leaves the WebM in place, never blocks the show flow. Costs
  // roughly one FFmpeg minute per show minute.
  async function convertRecordingToMp4(sessionId: string, userId: string, webmUrl: string): Promise<void> {
    try {
      const cmd = 'ffmpeg -i {input} -c:v libx264 -preset veryfast -c:a aac -movflags +faststart {output}';
      const submit = await fetch(`${FFMPEG_JOBS_BASE}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [webmUrl], full_command: cmd, output_extension: 'mp4' }),
      });
      const data = await submit.json().catch(() => ({}));
      const jobId = (data as any).job_id ?? (data as any).jobId ?? (data as any).id;
      if (!submit.ok || !jobId) {
        console.error(`MP4 convert: submit failed (${submit.status}) for session ${sessionId}`);
        return;
      }
      let finished = false;
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 10000));
        const st = await fetch(`${FFMPEG_JOBS_BASE}/${encodeURIComponent(String(jobId))}`, {
          headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
        });
        const js = await st.json().catch(() => ({}));
        const status = String((js as any).status ?? '').toUpperCase();
        if (status === 'FINISHED' || status === 'COMPLETED') { finished = true; break; }
        if (status === 'ERROR' || status === 'FAILED') {
          console.error(`MP4 convert: job failed for session ${sessionId}`);
          return;
        }
      }
      if (!finished) {
        console.error(`MP4 convert: timed out for session ${sessionId}`);
        return;
      }
      const dl = await fetch(`${FFMPEG_JOBS_BASE}/${encodeURIComponent(String(jobId))}/download`, {
        headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
      });
      if (!dl.ok) return;
      const buffer = Buffer.from(await dl.arrayBuffer());
      if (buffer.length === 0 || buffer.length > MAX_RECORDING_BYTES) {
        console.error(`MP4 convert: result ${buffer.length} bytes out of range for session ${sessionId}`);
        return;
      }
      const mp4Url = await storeVideoBuffer(buffer, `recordings/${userId}`, 'video/mp4');
      if (!mp4Url) return;
      // Only swap the VOD if nobody replaced it while we were converting.
      const current = await storage.getLiveSession(sessionId);
      if (current && current.vodUrl === webmUrl) {
        await storage.updateLiveSession(sessionId, { vodUrl: mp4Url });
      }
      await storage.updateMediaLibraryItemMedia(userId, 'live', `recording-${sessionId}`, mp4Url);
    } catch (error) {
      console.error('MP4 convert failed:', error);
    }
  }

  // ---- Studios (named rooms) -------------------------------------------
  app.get('/api/studios', isAuthenticated, async (req: any, res) => {
    try {
      res.json({ studios: await storage.getStudios(req.session.userId!) });
    } catch (error) {
      console.error('Error listing studios:', error);
      res.status(500).json({ message: 'Failed to load studios' });
    }
  });

  app.post('/api/studios', isAuthenticated, async (req: any, res) => {
    try {
      const name = String(req.body?.name ?? '').trim().slice(0, 80);
      if (!name) return res.status(400).json({ message: 'Give the studio a name' });
      const studio = await storage.createStudio({ userId: req.session.userId!, name });
      res.json({ studio });
    } catch (error) {
      console.error('Error creating studio:', error);
      res.status(500).json({ message: 'Failed to create the studio' });
    }
  });

  app.patch('/api/studios/:id', isAuthenticated, async (req: any, res) => {
    try {
      const patch: { name?: string; thumbnailUrl?: string | null } = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim().slice(0, 80);
        if (!name) return res.status(400).json({ message: 'Give the studio a name' });
        patch.name = name;
      }
      if (req.body?.thumbnailUrl !== undefined) {
        patch.thumbnailUrl = typeof req.body.thumbnailUrl === 'string' && req.body.thumbnailUrl ? req.body.thumbnailUrl : null;
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ message: 'Nothing to update' });
      const studio = await storage.updateStudio(req.params.id, req.session.userId!, patch);
      if (!studio) return res.status(404).json({ message: 'Studio not found' });
      res.json({ studio });
    } catch (error) {
      console.error('Error updating studio:', error);
      res.status(500).json({ message: 'Failed to update the studio' });
    }
  });

  app.get('/api/studios/:id/scenes', isAuthenticated, async (req: any, res) => {
    try {
      res.json({ scenes: await storage.getStudioScenes(req.params.id, req.session.userId!) });
    } catch (error) {
      console.error('Error listing scenes:', error);
      res.status(500).json({ message: 'Failed to load scenes' });
    }
  });

  app.post('/api/studios/:id/scenes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const owned = await storage.getStudios(userId);
      if (!owned.some((s) => s.id === req.params.id)) return res.status(404).json({ message: 'Studio not found' });
      const name = String(req.body?.name ?? '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ message: 'Name the scene' });
      const VALID_LAYOUTS = ['fullscreen', 'pip-br', 'pip-bl', 'pip-tr', 'pip-tl', 'split'];
      const layout = VALID_LAYOUTS.includes(req.body?.layout) ? req.body.layout : 'fullscreen';
      const mediaUrl = typeof req.body?.mediaUrl === 'string' && req.body.mediaUrl ? req.body.mediaUrl : null;
      const mediaType = ['video', 'image'].includes(req.body?.mediaType) ? req.body.mediaType : null;
      const scene = await storage.createStudioScene({
        userId, studioId: req.params.id, name, layout,
        mediaUrl, mediaType: mediaUrl ? mediaType : null, position: 0,
      });
      res.json({ scene });
    } catch (error) {
      console.error('Error creating scene:', error);
      res.status(500).json({ message: 'Failed to save the scene' });
    }
  });

  app.delete('/api/studios/scenes/:sceneId', isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteStudioScene(req.params.sceneId, req.session.userId!);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting scene:', error);
      res.status(500).json({ message: 'Failed to delete the scene' });
    }
  });

  app.delete('/api/studios/:id', isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteStudio(req.params.id, req.session.userId!);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting studio:', error);
      res.status(500).json({ message: 'Failed to delete the studio' });
    }
  });

  app.get('/api/live/sessions', isAuthenticated, async (req: any, res) => {
    try {
      res.json({ sessions: await storage.getLiveSessions(req.session.userId!) });
    } catch (error) {
      console.error('Error listing sessions:', error);
      res.status(500).json({ message: 'Failed to load past streams' });
    }
  });

  app.get('/api/live/current', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const session = await storage.getLatestLiveSession(userId);
      if (!session) return res.json({ session: null, marks: [] });
      const marks = await storage.getLiveMarks(session.id);
      res.json({ session, marks });
    } catch (error) {
      console.error('Error loading live session:', error);
      res.status(500).json({ message: 'Failed to load session' });
    }
  });

  app.post('/api/live/sessions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      // One open session at a time — close any stragglers first.
      const latest = await storage.getLatestLiveSession(userId);
      if (latest && !latest.endedAt) {
        await storage.updateLiveSession(latest.id, { endedAt: new Date() });
      }
      const title = String(req.body?.title ?? '').trim().slice(0, 120) || 'Live session';
      // Sessions may belong to a named studio — only one the user owns.
      let studioId: string | null = null;
      if (typeof req.body?.studioId === 'string' && req.body.studioId) {
        const owned = await storage.getStudios(userId);
        if (owned.some((s) => s.id === req.body.studioId)) studioId = req.body.studioId;
      }
      const session = await storage.createLiveSession({ userId, title, studioId, startedAt: new Date() });
      res.json({ session });
    } catch (error) {
      console.error('Error starting live session:', error);
      res.status(500).json({ message: 'Failed to start the session' });
    }
  });

  app.post('/api/live/sessions/:id/end', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const session = await storage.getLiveSession(req.params.id);
      if (!session || session.userId !== userId) return res.status(404).json({ message: 'Session not found' });
      const updated = await storage.updateLiveSession(session.id, { endedAt: new Date() });
      res.json({ session: updated });
    } catch (error) {
      console.error('Error ending live session:', error);
      res.status(500).json({ message: 'Failed to end the session' });
    }
  });

  // ---- Cloud recording (LiveKit Egress → S3) ---------------------------
  // Server-side full-res recording; the browser 720p canvas path stays as a
  // fallback when Egress isn't configured.
  app.get('/api/live/egress-status', isAuthenticated, async (_req: any, res) => {
    // Reports which required env vars are missing (names only, no values) so a
    // misconfigured deploy is diagnosable instead of a silent "not configured".
    res.json(egressConfigReport());
  });

  app.post('/api/live/sessions/:id/recording/start', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const session = await storage.getLiveSession(req.params.id);
      if (!session || session.userId !== userId) return res.status(404).json({ message: 'Session not found' });
      if (!isEgressConfigured()) return res.status(503).json({ message: 'Cloud recording is not configured yet (LiveKit Egress + S3 keys).' });
      if (session.recordingStatus === 'recording' || session.recordingStatus === 'starting') {
        return res.json({ session, alreadyRecording: true });
      }
      // Reserve the session before the provider call so two concurrent starts
      // can't both spawn an Egress job (the second would orphan the first).
      await storage.updateLiveSession(session.id, { recordingStatus: 'starting' });
      const startedAtMs = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
      const filepath = recordingFilepath(session.id, startedAtMs);
      try {
        const roomName = roomNameForRecording(session);
        const videoTrackId = typeof req.body?.videoTrackId === 'string' ? req.body.videoTrackId : undefined;
        const audioTrackId = typeof req.body?.audioTrackId === 'string' ? req.body.audioTrackId : undefined;
        let egressId: string;
        if (videoTrackId) {
          // Preferred path: the host publishes the composited studio canvas as a
          // "program" track and hands us its SID — record exactly that, so the
          // MP4 is pixel-identical to the stage.
          ({ egressId } = await startTrackCompositeRecording(roomName, filepath, videoTrackId, audioTrackId));
        } else {
          // Fallback (older client): room composite via the studio-view template.
          const templateBaseUrl =
            process.env.EGRESS_TEMPLATE_URL ||
            (process.env.EGRESS_USE_STUDIO_VIEW === 'false' ? undefined : `${getPublicBaseUrl(req)}/studio/egress-view`);
          ({ egressId } = await startSessionRecording(roomName, filepath, templateBaseUrl));
        }
        const updated = await storage.updateLiveSession(session.id, { egressId, recordingStatus: 'recording' });
        res.json({ session: updated, egressId });
      } catch (startErr) {
        await storage.updateLiveSession(session.id, { recordingStatus: 'failed' });
        throw startErr;
      }
    } catch (error: any) {
      console.error('Egress start error:', error?.message);
      res.status(502).json({ message: 'Could not start cloud recording.' });
    }
  });

  app.post('/api/live/sessions/:id/recording/stop', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const session = await storage.getLiveSession(req.params.id);
      if (!session || session.userId !== userId) return res.status(404).json({ message: 'Session not found' });
      if (!session.egressId) return res.status(400).json({ message: 'No cloud recording is in progress' });
      await stopSessionRecording(session.egressId);
      const startedAtMs = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
      const filepath = recordingFilepath(session.id, startedAtMs);
      const bucket = process.env.EGRESS_S3_BUCKET!;
      const vodUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${filepath}`;
      const updated = await storage.updateLiveSession(session.id, { recordingStatus: 'done', vodUrl });

      // File the cloud recording in the Media Library too (the browser-recording
      // path does the same on PATCH), so the Editing Room, Lab, and composer see
      // it. Best-effort + idempotent-ish via a stable externalId.
      try {
        await storage.createMediaLibraryItem({
          userId,
          platform: 'live',
          externalId: `recording-${session.id}`,
          caption: `${session.title} — full recording`,
          mediaType: 'video',
          mediaUrl: vodUrl,
          thumbnailUrl: null,
          permalink: null,
          postedAt: new Date(),
        });
      } catch { /* library filing is best-effort */ }

      res.json({ session: updated, vodUrl });
    } catch (error: any) {
      console.error('Egress stop error:', error?.message);
      res.status(502).json({ message: 'Could not stop cloud recording.' });
    }
  });

  // ---- Guest rooms (LiveKit) -------------------------------------------
  // Tokens are minted here, server-side; the LiveKit secret never ships to
  // the browser. Guests authenticate with the session's invite code alone.

  app.get('/api/live/livekit-status', isAuthenticated, async (_req: any, res) => {
    res.json({ configured: isLiveKitConfigured() });
  });

  // Studio-keyed guest room: invites work before the show is live — the
  // guest waits in the green room, the host sees them the moment both join.
  app.post('/api/studios/:id/guest-link', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      if (!isLiveKitConfigured()) {
        return res.status(503).json({ message: 'Guest rooms are not configured yet (LiveKit keys missing).' });
      }
      const owned = await storage.getStudios(userId);
      const studio = owned.find((s) => s.id === req.params.id);
      if (!studio) return res.status(404).json({ message: 'Studio not found' });
      let code = studio.guestInviteCode;
      if (!code) {
        code = crypto.randomUUID();
        await storage.updateStudioInviteCode(studio.id, userId, code);
      }
      const origin = `${req.protocol}://${req.get('host')}`;
      res.json({ code, url: `${origin}/studio/guest?code=${code}` });
    } catch (error) {
      console.error('Error creating studio guest link:', error);
      res.status(500).json({ message: 'Failed to create the guest link' });
    }
  });

  app.post('/api/studios/:id/host-token', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      if (!isLiveKitConfigured()) {
        return res.status(503).json({ message: 'Guest rooms are not configured yet (LiveKit keys missing).' });
      }
      const owned = await storage.getStudios(userId);
      const studio = owned.find((s) => s.id === req.params.id);
      if (!studio) return res.status(404).json({ message: 'Studio not found' });
      const token = await mintRoomToken(`studio-${studio.id}`, `host-${userId.slice(0, 8)}`, 'Host');
      res.json({ token, url: liveKitUrl() });
    } catch (error) {
      console.error('Error minting studio host token:', error);
      res.status(500).json({ message: 'Failed to join the room' });
    }
  });

  app.post('/api/live/sessions/:id/guest-link', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      if (!isLiveKitConfigured()) {
        return res.status(503).json({ message: 'Guest rooms are not configured yet (LiveKit keys missing).' });
      }
      const session = await storage.getLiveSession(req.params.id);
      if (!session || session.userId !== userId) return res.status(404).json({ message: 'Session not found' });
      if (session.endedAt) return res.status(400).json({ message: 'This show has ended — start a new one to invite guests.' });
      let code = session.guestInviteCode;
      if (!code) {
        code = crypto.randomUUID();
        await storage.updateLiveSession(session.id, { guestInviteCode: code });
      }
      const origin = `${req.protocol}://${req.get('host')}`;
      res.json({ code, url: `${origin}/studio/guest?code=${code}` });
    } catch (error) {
      console.error('Error creating guest link:', error);
      res.status(500).json({ message: 'Failed to create the guest link' });
    }
  });

  // Public: a guest trades an invite code + display name for a room token.
  app.post('/api/live/guest/join', async (req: any, res) => {
    try {
      if (!isLiveKitConfigured()) {
        return res.status(503).json({ message: 'Guest rooms are not configured.' });
      }
      const code = String(req.body?.code ?? '').trim();
      const name = String(req.body?.name ?? '').trim().slice(0, 60);
      if (!code || !name) return res.status(400).json({ message: 'An invite code and your name are required.' });
      const identity = `guest-${crypto.randomUUID().slice(0, 8)}`;
      const studio = await storage.getStudioByInviteCode(code);
      if (studio) {
        const token = await mintRoomToken(`studio-${studio.id}`, identity, name);
        return res.json({ token, url: liveKitUrl(), roomTitle: studio.name });
      }
      // Legacy: codes minted per-session before rooms moved to studios.
      const session = await storage.getLiveSessionByInviteCode(code);
      if (!session) return res.status(404).json({ message: 'This invite link is not valid.' });
      if (session.endedAt) return res.status(410).json({ message: 'This show has ended.' });
      const token = await mintRoomToken(roomNameForSession(session.id), identity, name);
      res.json({ token, url: liveKitUrl(), roomTitle: session.title });
    } catch (error) {
      console.error('Error joining guest room:', error);
      res.status(500).json({ message: 'Failed to join the room' });
    }
  });

  app.post('/api/live/sessions/:id/host-token', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      if (!isLiveKitConfigured()) {
        return res.status(503).json({ message: 'Guest rooms are not configured yet (LiveKit keys missing).' });
      }
      const session = await storage.getLiveSession(req.params.id);
      if (!session || session.userId !== userId) return res.status(404).json({ message: 'Session not found' });
      const token = await mintRoomToken(roomNameForSession(session.id), `host-${userId.slice(0, 8)}`, 'Host');
      res.json({ token, url: liveKitUrl() });
    } catch (error) {
      console.error('Error minting host token:', error);
      res.status(500).json({ message: 'Failed to join the room' });
    }
  });

  // Attach a VOD to a session — the in-browser recorder calls this right
  // after uploading its recording, so the cut panel is pre-filled.
  app.patch('/api/live/sessions/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const session = await storage.getLiveSession(req.params.id);
      if (!session || session.userId !== userId) return res.status(404).json({ message: 'Session not found' });
      const updates: Record<string, unknown> = {};
      if (typeof req.body?.vodUrl === 'string') {
        try {
          const u = new URL(req.body.vodUrl);
          if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad');
          updates.vodUrl = u.toString();
        } catch { return res.status(400).json({ message: 'Invalid VOD URL' }); }
      }
      if (req.body?.vodOffsetSeconds !== undefined) {
        updates.vodOffsetSeconds = Math.max(0, Math.floor(Number(req.body.vodOffsetSeconds) || 0));
      }
      const updated = await storage.updateLiveSession(session.id, updates);

      // A studio recording (in our own bucket) is real content — file it in
      // the Media Library so the Lab, Speaking Analysis, and composer see it.
      try {
        const supabaseHost = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;
        if (typeof updates.vodUrl === 'string' && supabaseHost && new URL(updates.vodUrl).host === supabaseHost) {
          await storage.createMediaLibraryItem({
            userId,
            platform: 'live',
            externalId: `recording-${session.id}`,
            caption: `${session.title} — full recording`,
            mediaType: 'video',
            mediaUrl: updates.vodUrl,
            thumbnailUrl: null,
            permalink: null,
            postedAt: new Date(),
          });
        }
      } catch { /* library filing is best-effort */ }

      // WebM studio recordings convert themselves to MP4 in the background.
      if (typeof updates.vodUrl === 'string' && updates.vodUrl.toLowerCase().endsWith('.webm')) {
        void convertRecordingToMp4(session.id, userId, updates.vodUrl);
      }

      res.json({ session: updated });
    } catch (error) {
      console.error('Error updating live session:', error);
      res.status(500).json({ message: 'Failed to update the session' });
    }
  });

  app.post('/api/live/sessions/:id/marks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const session = await storage.getLiveSession(req.params.id);
      if (!session || session.userId !== userId) return res.status(404).json({ message: 'Session not found' });
      if (session.endedAt) return res.status(400).json({ message: 'The show has ended' });
      // Server-authoritative clock — client latency can't skew the mark.
      const atSeconds = Math.max(0, Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000));
      const mark = await storage.createLiveMark({ sessionId: session.id, userId, atSeconds, clipStatus: 'marked' });
      res.json({ mark });
    } catch (error) {
      console.error('Error creating mark:', error);
      res.status(500).json({ message: 'Failed to mark the moment' });
    }
  });

  app.patch('/api/live/marks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const mark = await storage.getLiveMark(req.params.id);
      if (!mark || mark.userId !== userId) return res.status(404).json({ message: 'Mark not found' });
      const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined;
      const updated = await storage.updateLiveMark(mark.id, { ...(note !== undefined ? { note } : {}) });
      res.json({ mark: updated });
    } catch (error) {
      console.error('Error updating mark:', error);
      res.status(500).json({ message: 'Failed to save the note' });
    }
  });

  // Submit the trim job. The ffmpeg command is assembled here from validated
  // numbers only — user text never reaches full_command.
  app.post('/api/live/marks/:id/cut', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const mark = await storage.getLiveMark(req.params.id);
      if (!mark || mark.userId !== userId) return res.status(404).json({ message: 'Mark not found' });

      let vodUrl: URL;
      try { vodUrl = new URL(String(req.body?.vodUrl ?? '')); } catch {
        return res.status(400).json({ message: 'Paste the recording\u2019s direct video URL first' });
      }
      if (vodUrl.protocol !== 'https:') return res.status(400).json({ message: 'The VOD URL must be https' });
      const offset = Math.floor(Number(req.body?.offsetSeconds) || 0);
      const start = Math.max(0, mark.atSeconds + offset - LIVE_PRE_ROLL);
      const duration = LIVE_PRE_ROLL + LIVE_POST_ROLL;
      if (!Number.isFinite(start) || start < 0 || duration < 5 || duration > 120) {
        return res.status(400).json({ message: 'Invalid clip window' });
      }

      // Their worker requires the literal {output} placeholder (a hardcoded
      // filename is rejected with "full_command debe contener {output}").
      // Vertical = center-crop to 9:16 at 720x1280 for Reels/Shorts/TikTok.
      const vertical = req.body?.format === 'vertical';
      const vf = vertical ? ' -vf crop=ih*9/16:ih,scale=720:1280' : '';
      const cmd = `ffmpeg -ss ${start} -i {input} -t ${duration}${vf} -c:v libx264 -preset veryfast -c:a aac -movflags +faststart {output}`;
      const response = await fetch(`${FFMPEG_JOBS_BASE}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `ApiKey ${getUploadPostApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: [vodUrl.toString()], full_command: cmd, output_extension: 'mp4' }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 429) {
        return res.status(429).json({ message: "This month's FFmpeg minutes are used up — the allowance resets monthly." });
      }
      const jobId = (data as any).job_id ?? (data as any).jobId ?? (data as any).id;
      if (!response.ok || !jobId) {
        return res.status(response.status >= 400 ? response.status : 502).json({ message: (data as any)?.message || 'Could not start the cut' });
      }
      await storage.updateLiveMark(mark.id, { clipStatus: 'cutting', clipJobId: String(jobId) });
      // Remember the VOD on the session so a reload keeps the panel filled.
      await storage.updateLiveSession(mark.sessionId, { vodUrl: vodUrl.toString(), vodOffsetSeconds: offset });
      res.json({ jobId: String(jobId) });
    } catch (error) {
      console.error('Error starting cut:', error);
      res.status(500).json({ message: 'Clip service unreachable' });
    }
  });

  // The producer's ear: gpt-4o reads the Whisper transcript and finds the
  // strong moments — hooks, quotes, stories — and files them as AI marks so
  // the Editing Room fills itself. The host's manual marks stay first-class.
  app.post('/api/live/sessions/:id/detect-moments', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const session = await storage.getLiveSession(req.params.id);
      if (!session || session.userId !== userId) return res.status(404).json({ message: 'Session not found' });
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ message: 'Moment detection needs the OpenAI key configured' });
      }
      const segments: Array<{ start: number; end: number; text: string }> = Array.isArray(req.body?.segments) ? req.body.segments : [];
      if (segments.length < 3) {
        return res.status(400).json({ message: 'Not enough speech to scan — the recording may be music or silence' });
      }
      const transcript = segments
        .map((s) => `[${Math.floor(Number(s.start) || 0)}s] ${String(s.text ?? '').trim()}`)
        .join('\n')
        .slice(0, 15000);

      const OpenAI = (await import('openai')).default;
      const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        max_tokens: 700,
        messages: [
          {
            role: 'system',
            content: `You are a live producer scanning a show transcript (lines are prefixed with [seconds]).
Find up to 5 clip-worthy moments — strong hooks, provocative statements, self-contained stories, quotable lines, funny exchanges.
Each moment must stand alone as a ~30-second vertical clip.
Respond with JSON: {"moments":[{"startSeconds": <number, when the moment begins>, "title": "<punchy 5-9 word clip title>", "kind": "hook|quote|story|funny", "confidence": 1-100}]}
Order by confidence, best first. If nothing is clip-worthy, return an empty array.`,
          },
          { role: 'user', content: transcript },
        ],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      const moments = (Array.isArray(parsed.moments) ? parsed.moments : []).slice(0, 5);
      await chargeCredits(userId, 'detect_moments', { label: session.title, resourceType: 'live_session', resourceId: session.id, meta: { moments: moments.length } });
      const created = [];
      for (const m of moments) {
        const startSeconds = Math.max(0, Math.floor(Number(m.startSeconds) || 0));
        // The cut window reaches PRE_ROLL back from the mark, so placing the
        // mark PRE_ROLL after the moment start makes the clip begin AT it.
        const mark = await storage.createLiveMark({
          sessionId: session.id,
          userId,
          atSeconds: startSeconds + LIVE_PRE_ROLL,
          note: `AI ${String(m.kind ?? 'moment')} \u00b7 ${String(m.title ?? 'Untitled moment').slice(0, 90)}`,
          clipStatus: 'marked',
        });
        created.push({ ...mark, confidence: Math.max(1, Math.min(100, Math.round(Number(m.confidence) || 50))) });
      }
      res.json({ marks: created });
    } catch (error) {
      console.error('Moment detection error:', error);
      res.status(500).json({ message: 'Moment detection failed — try again' });
    }
  });

  app.get('/api/live/marks/:id/cut-status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const mark = await storage.getLiveMark(req.params.id);
      if (!mark || mark.userId !== userId || !mark.clipJobId) return res.status(404).json({ message: 'No cut in progress' });
      const response = await fetch(`${FFMPEG_JOBS_BASE}/${encodeURIComponent(mark.clipJobId)}`, {
        headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
      });
      const data = await response.json().catch(() => ({}));
      const status = String((data as any).status ?? 'UNKNOWN');
      let hint: string | undefined;
      if (['failed', 'error'].includes(status.toLowerCase())) {
        // Stamp it so Retry survives a reload.
        await storage.updateLiveMark(mark.id, { clipStatus: 'failed' });
        const exc = String((data as any).exc_info ?? '');
        if (exc.includes('403')) hint = "The VOD host refused the download — use a direct, publicly downloadable video URL.";
        else if (exc.includes('404')) hint = 'The VOD URL was not found — check the link.';
      }
      res.status(response.ok ? 200 : response.status).json({ status, ...(hint ? { hint } : {}) });
    } catch (error) {
      console.error('Error checking cut status:', error);
      res.status(500).json({ message: 'Failed to check the cut' });
    }
  });

  // Pull the finished clip into OUR storage and file it in the media library.
  // Upload-Post's result URLs expire — same law as every platform CDN.
  app.post('/api/live/marks/:id/collect', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const mark = await storage.getLiveMark(req.params.id);
      if (!mark || mark.userId !== userId || !mark.clipJobId) return res.status(404).json({ message: 'No cut to collect' });
      const session = await storage.getLiveSession(mark.sessionId);

      const dl = await fetch(`${FFMPEG_JOBS_BASE}/${encodeURIComponent(mark.clipJobId)}/download`, {
        headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
      });
      if (!dl.ok) {
        await storage.updateLiveMark(mark.id, { clipStatus: 'failed' });
        return res.status(dl.status === 404 ? 404 : 502).json({ message: `Clip not ready (HTTP ${dl.status})` });
      }
      const buffer = Buffer.from(await dl.arrayBuffer());
      if (buffer.length === 0 || buffer.length > MAX_CLIP_BYTES) {
        await storage.updateLiveMark(mark.id, { clipStatus: 'failed' });
        return res.status(413).json({ message: buffer.length === 0 ? 'Empty clip' : 'Clip too large to store' });
      }

      const clipUrl = await storeVideoBuffer(buffer, `clips/${userId}`, dl.headers.get('content-type') || 'video/mp4');
      if (!clipUrl) {
        await storage.updateLiveMark(mark.id, { clipStatus: 'failed' });
        return res.status(502).json({ message: "Couldn't store the clip" });
      }

      const media = await storage.createMediaLibraryItem({
        userId,
        platform: 'live',
        externalId: mark.clipJobId,
        caption: (mark.note || `${session?.title ?? 'Live clip'} \u2014 mark`).slice(0, 200),
        mediaType: 'video',
        mediaUrl: clipUrl,
        thumbnailUrl: null,
        permalink: null,
        postedAt: new Date(),
      });
      await storage.updateLiveMark(mark.id, { clipStatus: 'ready', clipMediaId: media?.id ?? null });
      res.json({ success: true, clipUrl });
    } catch (error) {
      console.error('Error collecting clip:', error);
      await storage.updateLiveMark(req.params.id, { clipStatus: 'failed' }).catch(() => {});
      res.status(502).json({ message: 'Clip service unreachable' });
    }
  });

  // Comments: list + reply/create + delete across instagram/facebook/youtube/
  // linkedin (TikTok has no public API). Instagram only supports *replies* to
  // existing comments; YouTube needs a reconnect with the youtube.force-ssl scope.
  const COMMENT_PLATFORMS = new Set(['instagram', 'facebook', 'youtube', 'linkedin']);

  app.get('/api/upload-post/comments', isAuthenticated, async (req: any, res) => {
    try {
      const uploadPostUsername = `podlogix_${req.session.userId!}`;
      const platform = String(req.query.platform || 'instagram').toLowerCase();
      const postUrl = String(req.query.postUrl || '').trim();
      const after = String(req.query.after || '').trim();
      if (!COMMENT_PLATFORMS.has(platform)) {
        return res.status(400).json({ message: 'Comments are available for Instagram, Facebook, YouTube, and LinkedIn' });
      }
      if (!postUrl) {
        return res.status(400).json({ message: 'postUrl is required' });
      }
      const params = new URLSearchParams({ platform, user: uploadPostUsername, post_url: postUrl });
      if (after) params.set('after', after);
      const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/comments?${params}`, {
        headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const readable = response.status === 403 && platform === 'youtube'
          ? 'YouTube needs to be reconnected with comment permissions — go to Connectors and reconnect YouTube.'
          : (data as any)?.message || 'Failed to load comments';
        return res.status(response.status).json({ message: readable });
      }
      res.json({ comments: (data as any).comments ?? [], pagination: (data as any).pagination ?? null });
    } catch (error) {
      console.error('Error fetching comments:', error);
      res.status(500).json({ message: 'Failed to load comments' });
    }
  });

  app.post('/api/upload-post/comments', isAuthenticated, async (req: any, res) => {
    try {
      const uploadPostUsername = `podlogix_${req.session.userId!}`;
      const { platform, message, postUrl, commentId } = req.body ?? {};
      const platformKey = String(platform || '').toLowerCase();
      if (!COMMENT_PLATFORMS.has(platformKey)) {
        return res.status(400).json({ message: 'Comments are available for Instagram, Facebook, YouTube, and LinkedIn' });
      }
      if (typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ message: 'message is required' });
      }
      if (platformKey === 'instagram' && !commentId) {
        return res.status(400).json({ message: 'Instagram only supports replying to an existing comment' });
      }
      if (!commentId && !postUrl) {
        return res.status(400).json({ message: 'postUrl or commentId is required' });
      }
      const body: Record<string, string> = {
        platform: platformKey,
        user: uploadPostUsername,
        message: message.trim(),
      };
      if (commentId) body.comment_id = commentId;
      else body.post_url = postUrl;
      const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/comments/create`, {
        method: 'POST',
        headers: {
          'Authorization': `ApiKey ${getUploadPostApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({ message: (data as any)?.message || 'Failed to post comment' });
      }
      res.json({ success: true, id: (data as any).id });
    } catch (error) {
      console.error('Error creating comment:', error);
      res.status(500).json({ message: 'Failed to post comment' });
    }
  });

  // Get user's posts
  app.get('/api/upload-post/posts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const posts = await storage.getUploadPostPostsByUser(userId);
      res.json({ posts });
    } catch (error) {
      console.error('Error fetching posts:', error);
      res.status(500).json({ message: 'Failed to fetch posts' });
    }
  });

  // ============ MEDIA LAB (Upload-Post FFmpeg Editor + AI Shorts APIs) — beta, gated to allowlisted accounts ============
  // Note: Upload-Post's public docs say the AI Shorts analyzer is dashboard-only, but their support
  // confirmed (Aug 2026) that POST /api/uploadposts/analyze-shorts works over the API with our key.
  // Quota (300 analyses/mo on Professional) is counted per account email, not per key.

  // Graduated from the Media Lab beta into Facet's Clip copy panel —
  // generally available, same host/size guards.
  app.post('/api/media-lab/analyze-shorts', isAuthenticated, async (req: any, res) => {
    try {
      const { videoUrl, platforms } = req.body ?? {};
      if (!videoUrl || !Array.isArray(platforms) || platforms.length === 0) {
        return res.status(400).json({ message: 'videoUrl and platforms (non-empty array) are required' });
      }

      // Only analyze videos from OUR storage. An open URL here would let anyone
      // burn the monthly analysis allowance on arbitrary files.
      try {
        const supabaseHost = new URL(process.env.SUPABASE_URL!).host;
        if (new URL(videoUrl).host !== supabaseHost) {
          return res.status(400).json({ message: 'Video must be uploaded through Podlogix first' });
        }
      } catch {
        return res.status(400).json({ message: 'Invalid video URL' });
      }

      // Pull the video from storage and forward it as multipart — Upload-Post only accepts a file here.
      const videoResponse = await fetch(videoUrl);
      if (!videoResponse.ok) {
        return res.status(400).json({ message: 'Could not fetch the uploaded video' });
      }
      const contentType = videoResponse.headers.get('content-type') || 'video/mp4';
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      if (videoBuffer.length > 100 * 1024 * 1024) {
        return res.status(400).json({ message: 'Video exceeds the 100MB analyze-shorts limit' });
      }
      const fileName = (() => {
        try {
          const base = new URL(videoUrl).pathname.split('/').pop();
          return base && base.includes('.') ? base : 'video.mp4';
        } catch {
          return 'video.mp4';
        }
      })();

      const form = new FormData();
      form.append('video', new Blob([videoBuffer], { type: contentType }), fileName);
      form.append('platforms', platforms.join(','));

      const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/analyze-shorts`, {
        method: 'POST',
        headers: { 'Authorization': `Apikey ${getUploadPostApiKey()}` },
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error('analyze-shorts error:', response.status, data);
        if (response.status === 429) {
          return res.status(429).json({ message: 'Monthly analyze-shorts quota exhausted' });
        }
        return res.status(response.status).json({ message: (data as any)?.message || 'Analysis failed' });
      }
      res.json(data);
    } catch (error) {
      console.error('Error analyzing shorts video:', error);
      res.status(500).json({ message: 'Failed to analyze video' });
    }
  });

  app.post('/api/media-lab/ffmpeg/jobs', isAuthenticated, isBetaTester, async (req: any, res) => {
    try {
      const { files, full_command, output_extension, publish } = req.body ?? {};
      if (!Array.isArray(files) || files.length === 0 || !full_command || !output_extension) {
        return res.status(400).json({ message: 'files (array of URLs), full_command, and output_extension are required' });
      }
      const response = vpsFfmpegActive()
        ? await fetch(`${process.env.FFMPEG_VPS_URL}/jobs`, {
            method: 'POST',
            headers: { ...vpsFfmpegHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ files, full_command, output_extension }),
          })
        : await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/ffmpeg/jobs/upload`, {
            method: 'POST',
            headers: {
              'Authorization': `ApiKey ${getUploadPostApiKey()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ files, full_command, output_extension, publish: !!publish }),
          });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error('FFmpeg job submission error:', data);
        return res.status(response.status).json({ message: data?.message || 'Failed to submit FFmpeg job' });
      }
      res.status(202).json(data);
    } catch (error) {
      console.error('Error submitting FFmpeg job:', error);
      res.status(500).json({ message: 'Failed to submit FFmpeg job' });
    }
  });

  app.get('/api/media-lab/ffmpeg/jobs/:jobId', isAuthenticated, isBetaTester, async (req: any, res) => {
    try {
      const response = vpsFfmpegActive()
        ? await fetch(`${process.env.FFMPEG_VPS_URL}/jobs/${encodeURIComponent(req.params.jobId)}`, { headers: vpsFfmpegHeaders() })
        : await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/ffmpeg/jobs/${req.params.jobId}`, {
            headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
          });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({ message: data?.message || 'Failed to fetch job status' });
      }
      res.json(data);
    } catch (error) {
      console.error('Error fetching FFmpeg job status:', error);
      res.status(500).json({ message: 'Failed to fetch job status' });
    }
  });

  app.get('/api/media-lab/ffmpeg/jobs/:jobId/download', isAuthenticated, isBetaTester, async (req: any, res) => {
    try {
      const response = vpsFfmpegActive()
        ? await fetch(`${process.env.FFMPEG_VPS_URL}/jobs/${encodeURIComponent(req.params.jobId)}/download`, { headers: vpsFfmpegHeaders() })
        : await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/ffmpeg/jobs/${req.params.jobId}/download`, {
            headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
          });
      if (!response.ok) {
        return res.status(response.status).json({ message: 'Failed to download result' });
      }
      const contentType = response.headers.get('content-type');
      const contentDisposition = response.headers.get('content-disposition');
      if (contentType) res.setHeader('Content-Type', contentType);
      if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch (error) {
      console.error('Error downloading FFmpeg result:', error);
      res.status(500).json({ message: 'Failed to download result' });
    }
  });

  // Pull a finished Media Lab job into the user's own storage + Media Library.
  // Same law as clips: their result URLs expire, ours don't.
  app.post('/api/media-lab/collect', isAuthenticated, isBetaTester, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const jobId = String(req.body?.jobId ?? '');
      if (!jobId) return res.status(400).json({ message: 'jobId is required' });
      const extension = String(req.body?.extension ?? 'mp4').toLowerCase();
      const isAudio = ['mp3', 'm4a', 'wav'].includes(extension);
      const dl = vpsFfmpegActive()
        ? await fetch(`${process.env.FFMPEG_VPS_URL}/jobs/${encodeURIComponent(jobId)}/download`, { headers: vpsFfmpegHeaders() })
        : await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/ffmpeg/jobs/${encodeURIComponent(jobId)}/download`, {
            headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
          });
      if (!dl.ok) return res.status(dl.status === 404 ? 404 : 502).json({ message: `Result not ready (HTTP ${dl.status})` });
      const buffer = Buffer.from(await dl.arrayBuffer());
      // Refined VIDEOS of full shows are legitimately large — the old 80MB cap
      // silently killed every long video refine at the finish line. Audio
      // keeps the tight cap; video gets headroom (outputs are bitrate-capped
      // client-side to ~250MB/12min).
      const maxBytes = (isAudio ? 80 : 500) * 1024 * 1024;
      if (buffer.length === 0 || buffer.length > maxBytes) {
        return res.status(413).json({ message: buffer.length === 0 ? 'Empty result' : 'Result too large to store' });
      }
      const contentType = dl.headers.get('content-type') || (isAudio ? 'audio/mpeg' : 'video/mp4');
      const url = isAudio
        ? await storeAudioBuffer(buffer, `media-lab/${userId}`, contentType)
        : await storeVideoBuffer(buffer, `media-lab/${userId}`, contentType);
      if (!url) return res.status(502).json({ message: "Couldn't store the result" });
      const media = await storage.createMediaLibraryItem({
        userId,
        platform: 'media-lab',
        externalId: jobId,
        caption: String(req.body?.title ?? 'Media Lab output').slice(0, 200),
        mediaType: isAudio ? 'audio' : 'video',
        mediaUrl: url,
        thumbnailUrl: null,
        permalink: null,
        postedAt: new Date(),
      });
      res.json({ success: true, url, media });
    } catch (error) {
      console.error('Media Lab collect error:', error);
      res.status(500).json({ message: "Couldn't save the result" });
    }
  });

  app.get('/api/media-lab/ffmpeg/consumption', isAuthenticated, isBetaTester, async (req: any, res) => {
    try {
      const response = await fetch(`${UPLOAD_POST_API_BASE}/api/uploadposts/ffmpeg/consumption`, {
        headers: { 'Authorization': `ApiKey ${getUploadPostApiKey()}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({ message: data?.message || 'Failed to fetch consumption' });
      }
      res.json(data);
    } catch (error) {
      console.error('Error fetching FFmpeg consumption:', error);
      res.status(500).json({ message: 'Failed to fetch consumption' });
    }
  });

  // ============ SOCIAL ANALYTICS (Influencers.club for user's connected accounts) ============

  // Normalize a pasted profile URL or @handle to a bare handle
  function normalizeSocialHandle(input: string): string {
    let h = (input || "").trim();
    const urlMatch = h.match(/(?:instagram\.com|tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|twitch\.tv)\/(@?[A-Za-z0-9_.\-]+)/i);
    if (urlMatch) h = urlMatch[1];
    return h.replace(/^@/, "").replace(/\/+$/, "");
  }

  // extractIcAnalytics moved to server/services/icEnrichment.ts (imported above)
  // so the morning enrichment sweep can share the same response mapping.

  
  // Get analytics for a user's connected social account
  app.post('/api/social-analytics/profile', isAuthenticated, async (req: any, res) => {
    try {
      const profileSchema = z.object({
        handle: z.string().min(1, 'Handle is required').max(300),
        platform: z.enum(['instagram', 'tiktok', 'youtube', 'twitter', 'twitch']),
      });

      const parseResult = profileSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid request', details: parseResult.error.issues });
      }

      const { handle, platform } = parseResult.data;

      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Analytics API not configured' });
      }

      const enriched = await enrichHandleCached(apiKey, platform.toLowerCase(), handle, {}, { userId: req.session.userId });
      if (!enriched) {
        return res.status(icEnrichmentEnabled() ? 502 : 400).json({
          error: icEnrichmentEnabled() ? 'Failed to fetch analytics' : 'Creator enrichment is currently disabled',
        });
      }

      const analytics = extractIcAnalytics(enriched.data, platform.toLowerCase(), handle);

      res.json({ success: true, analytics, cached: enriched.fromCache });
    } catch (error) {
      console.error('Error fetching social analytics:', error);
      res.status(500).json({ message: 'Failed to fetch analytics' });
    }
  });

  // NOTE: the uncached /api/social-analytics/my-accounts route was removed —
  // it enriched every connected account on every page view with no cache and
  // no kill-switch gate, unlike /my-accounts-cached (server/socialAnalyticsCache.ts),
  // which every client page actually uses. Nothing referenced it, but it was
  // still reachable by anyone authenticated and was silently spending real
  // Influencers.club credits.

  // Calculate suggested rates based on analytics
  app.post('/api/social-analytics/calculate-rates', isAuthenticated, async (req: any, res) => {
    try {
      const ratesSchema = z.object({
        followers: z.number().min(1, 'Followers must be at least 1'),
        engagementRate: z.number().min(0).max(100).optional().default(2),
        platform: z.enum(['instagram', 'tiktok', 'youtube', 'twitter', 'twitch']).optional().default('instagram'),
        avgViews: z.number().min(0).optional(),
      });

      const parseResult = ratesSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid request', details: parseResult.error.issues });
      }

      const { followers, engagementRate, platform, avgViews } = parseResult.data;

      // Rate calculation based on industry standards
      // Base rate per 1000 followers, adjusted by engagement
      const baseRates: Record<string, { post: number; story: number; reel: number; video: number }> = {
        instagram: { post: 10, story: 3, reel: 15, video: 20 },
        tiktok: { post: 8, story: 2, reel: 12, video: 15 },
        youtube: { post: 15, story: 5, reel: 18, video: 25 },
        twitter: { post: 5, story: 0, reel: 0, video: 8 },
        twitch: { post: 12, story: 4, reel: 0, video: 20 },
      };

      const platformRates = baseRates[platform] || baseRates.instagram;
      const engagementMultiplier = Math.max(0.5, Math.min(3, engagementRate / 2));
      const followerMultiplier = Math.max(followers, 1) / 1000; // Guard against 0
      const viewsBonus = avgViews && followers > 0 ? Math.min(1.5, avgViews / followers) : 1;

      const calculateRate = (baseRate: number) => {
        const rate = baseRate * followerMultiplier * engagementMultiplier * viewsBonus;
        return Math.round(Math.max(rate, 25)); // Minimum $25
      };

      const rates = {
        feedPost: calculateRate(platformRates.post),
        story: platformRates.story > 0 ? calculateRate(platformRates.story) : null,
        reel: platformRates.reel > 0 ? calculateRate(platformRates.reel) : null,
        video: calculateRate(platformRates.video),
        // Package deals
        package3Posts: Math.round(calculateRate(platformRates.post) * 2.7),
        packageMonthly: Math.round(calculateRate(platformRates.post) * 8),
      };

      res.json({
        success: true,
        rates,
        breakdown: {
          followers,
          engagementRate: engagementRate || 2,
          engagementMultiplier: engagementMultiplier.toFixed(2),
          platform: platform || 'instagram',
        },
      });
    } catch (error) {
      console.error('Error calculating rates:', error);
      res.status(500).json({ message: 'Failed to calculate rates' });
    }
  });

  // ============ INFLUENCERS.CLUB PRO API FEATURES ============

  // Discovery API - Search creators with 60+ filters and AI-powered search
  app.post('/api/social-analytics/discover', isAuthenticated, async (req: any, res) => {
    try {
      const discoverSchema = z.object({
        platform: z.enum(['instagram', 'tiktok', 'youtube', 'twitter', 'twitch']).optional(),
        minFollowers: z.number().min(0).optional(),
        maxFollowers: z.number().min(0).optional(),
        minEngagement: z.number().min(0).max(100).optional(),
        maxEngagement: z.number().min(0).max(100).optional(),
        location: z.string().optional(),
        language: z.string().optional(),
        niche: z.string().optional(),
        hasEmail: z.boolean().optional(),
        isVerified: z.boolean().optional(),
        aiPrompt: z.string().max(500).optional(), // AI-powered natural language search
        limit: z.number().min(1).max(100).optional().default(25),
        offset: z.number().min(0).optional().default(0),
      });

      const parseResult = discoverSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid request', details: parseResult.error.issues });
      }

      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Analytics API not configured' });
      }
      if (!icEnrichmentEnabled()) {
        return res.status(400).json({ error: 'Creator discovery is currently disabled' });
      }

      const filters = parseResult.data;

      // Build discovery request per Influencers.club /public/v1/discovery/ contract
      // TODO: map minEngagement/maxEngagement, hasEmail, isVerified to documented filter keys
      // (dropped from the upstream request until the correct keys are confirmed)
      const limit = filters.limit ?? 25;
      const discoveryRequest: Record<string, any> = {
        platform: filters.platform || 'instagram',
        paging: { limit, page: Math.floor((filters.offset ?? 0) / limit) },
        sort: { sort_by: 'relevancy', sort_order: 'desc' },
        filters: {
          ai_search: [filters.aiPrompt, filters.niche].filter(Boolean).join(', '),
          ...(filters.minFollowers || filters.maxFollowers
            ? { number_of_followers: { min: filters.minFollowers ?? null, max: filters.maxFollowers ?? null } }
            : {}),
          ...(filters.location ? { location: [filters.location] } : {}),
          ...(filters.language ? { profile_language: [filters.language] } : {}),
        },
      };

      const response = await fetch('https://api-dashboard.influencers.club/public/v1/discovery/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(discoveryRequest),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Discovery API error:', error);
        return res.status(response.status).json({ error: 'Discovery search failed', detail: error.slice(0, 300) });
      }

      const data = await response.json();
      
      const creators = (data.result?.items || data.results || data.creators || data.items || []).map((creator: any) => ({
        handle: creator.handle || creator.username,
        platform: creator.platform,
        name: creator.name || creator.fullname,
        profilePicture: creator.avatar || creator.profile_pic_url,
        followers: creator.followers || creator.follower_count || 0,
        engagementRate: creator.engagement_rate || 0,
        avgViews: creator.avg_views || 0,
        email: creator.email || null,
        emailVerified: creator.email_verified || false,
        location: creator.location || creator.country,
        niche: creator.niche || creator.category,
        isVerified: creator.is_verified || false,
        estimatedMonthlyIncome: creator.estimated_monthly_income || null,
        fakeFollowerPercent: creator.fake_follower_percent || null,
      }));

      res.json({
        success: true,
        creators,
        total: data.result?.total || data.total || creators.length,
        offset: filters.offset,
        limit: filters.limit,
      });
    } catch (error) {
      console.error('Error in discovery search:', error);
      res.status(500).json({ message: 'Failed to search creators' });
    }
  });

  // Lookalikes API - Find similar creators
  app.post('/api/social-analytics/lookalikes', isAuthenticated, async (req: any, res) => {
    try {
      const lookalikesSchema = z.object({
        handle: z.string().min(1).max(300),
        platform: z.enum(['instagram', 'tiktok', 'youtube', 'twitter', 'twitch']),
        limit: z.number().min(1).max(50).optional().default(20),
        // Additional filters for lookalikes
        minFollowers: z.number().min(0).optional(),
        maxFollowers: z.number().min(0).optional(),
        location: z.string().optional(),
      });

      const parseResult = lookalikesSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid request', details: parseResult.error.issues });
      }

      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Analytics API not configured' });
      }
      if (!icEnrichmentEnabled()) {
        return res.status(400).json({ error: 'Creator discovery is currently disabled' });
      }

      const { handle, platform, limit, minFollowers, maxFollowers, location } = parseResult.data;

      // TODO: map minFollowers/maxFollowers/location to documented similar-creators filter keys
      const requestBody: Record<string, any> = {
        filter_value: normalizeSocialHandle(handle),
        filter_key: 'handle',
        platform,
        paging: { limit, page: 0 },
        filters: { ai_search: '' },
      };

      const response = await fetch('https://api-dashboard.influencers.club/public/v1/discovery/creators/similar/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Lookalikes API error:', error);
        return res.status(response.status).json({ error: 'Failed to find lookalikes', detail: error.slice(0, 300) });
      }

      const data = await response.json();
      
      const lookalikes = (data.result?.items || data.results || data.lookalikes || data.items || []).map((creator: any) => ({
        handle: creator.handle || creator.username,
        platform: creator.platform || platform,
        name: creator.name || creator.fullname,
        profilePicture: creator.avatar || creator.profile_pic_url,
        followers: creator.followers || creator.follower_count || 0,
        engagementRate: creator.engagement_rate || 0,
        avgViews: creator.avg_views || 0,
        email: creator.email || null,
        location: creator.location,
        niche: creator.niche || creator.category,
        similarityScore: creator.similarity_score || creator.match_score || null,
      }));

      res.json({
        success: true,
        originalHandle: handle,
        originalPlatform: platform,
        lookalikes,
      });
    } catch (error) {
      console.error('Error finding lookalikes:', error);
      res.status(500).json({ message: 'Failed to find similar creators' });
    }
  });

  // Email Enrichment API - Enrich by email (basic or advanced)
  app.post('/api/social-analytics/enrich-email', isAuthenticated, async (req: any, res) => {
    try {
      const enrichSchema = z.object({
        email: z.string().email(),
        mode: z.enum(['basic', 'advanced']).optional().default('advanced'),
      });

      const parseResult = enrichSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid request', details: parseResult.error.issues });
      }

      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Analytics API not configured' });
      }
      if (!icEnrichmentEnabled()) {
        return res.status(400).json({ error: 'Creator enrichment is currently disabled' });
      }

      const { email, mode } = parseResult.data;
      // Influencers.club exposes a single email-enrich endpoint (no basic/advanced split)
      const endpoint = 'https://api-dashboard.influencers.club/public/v1/creators/enrich/email/';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Email enrichment error:', error);
        return res.status(response.status).json({ error: 'Email enrichment failed', detail: error.slice(0, 300) });
      }

      const data = await response.json();

      const profiles = (data.profiles || data.social_profiles || [data]).filter((p: any) => p).map((profile: any) => ({
        platform: profile.platform,
        handle: profile.handle || profile.username,
        name: profile.name || profile.fullname,
        profilePicture: profile.avatar || profile.profile_pic_url,
        followers: profile.followers || profile.follower_count || 0,
        engagementRate: profile.engagement_rate || 0,
        isVerified: profile.is_verified || false,
        bio: profile.bio || profile.biography,
      }));

      res.json({
        success: true,
        email,
        mode,
        name: data.name || data.fullname,
        profiles,
        socialLinks: data.social_links || [],
        estimatedMonthlyIncome: data.estimated_monthly_income,
      });
    } catch (error) {
      console.error('Error enriching email:', error);
      res.status(500).json({ message: 'Failed to enrich email' });
    }
  });

  // Get Creator Posts with Engagement Metrics
  app.post('/api/social-analytics/posts', isAuthenticated, async (req: any, res) => {
    try {
      const postsSchema = z.object({
        handle: z.string().min(1).max(300),
        platform: z.enum(['instagram', 'tiktok', 'youtube', 'twitter', 'twitch']),
        limit: z.number().min(1).max(50).optional().default(12),
      });

      const parseResult = postsSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid request', details: parseResult.error.issues });
      }

      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Analytics API not configured' });
      }
      if (!icEnrichmentEnabled()) {
        return res.status(400).json({ error: 'Creator enrichment is currently disabled' });
      }

      const { handle, platform, limit } = parseResult.data;

      const response = await fetch('https://api-dashboard.influencers.club/public/v1/creators/content/posts/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          platform,
          handle: normalizeSocialHandle(handle),
          count: limit ?? 30,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Posts API error:', error);
        return res.status(response.status).json({ error: 'Failed to fetch posts', detail: error.slice(0, 300) });
      }

      const data = await response.json();

      const posts = (data.result?.items || []).slice(0, limit).map((post: any) => ({
        id: post.id || post.post_id,
        type: post.type || post.media_type || 'post',
        caption: post.caption || post.text || post.title,
        thumbnail: post.thumbnail || post.thumbnail_url || post.image,
        url: post.url || post.permalink,
        likes: post.likes || post.like_count || 0,
        comments: post.comments || post.comment_count || 0,
        views: post.views || post.view_count || 0,
        shares: post.shares || post.share_count || 0,
        engagementRate: post.engagement_rate || 0,
        postedAt: post.posted_at || post.timestamp || post.created_at,
      }));

      res.json({
        success: true,
        handle,
        platform,
        posts,
        moreAvailable: data.result?.more_available ?? false,
        nextToken: data.result?.next_token ?? null,
      });
    } catch (error) {
      console.error('Error fetching posts:', error);
      res.status(500).json({ message: 'Failed to fetch posts' });
    }
  });

  // Check API Credits and Usage
  app.get('/api/social-analytics/credits', isAuthenticated, async (req: any, res) => {
    try {
      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Analytics API not configured' });
      }

      const response = await fetch('https://api-dashboard.influencers.club/public/v1/accounts/credits/', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Credits API error:', error);
        return res.status(response.status).json({ error: 'Failed to fetch credits', detail: error.slice(0, 300) });
      }

      const data = await response.json();

      res.json({
        success: true,
        credits: {
          available: data.credits_available || data.remaining || data.balance || 0,
          used: data.credits_used || data.used || 0,
          total: data.credits_total || data.total || 0,
          plan: data.plan || data.subscription_plan || 'PRO',
          resetDate: data.reset_date || data.billing_cycle_end,
        },
      });
    } catch (error) {
      console.error('Error fetching credits:', error);
      res.status(500).json({ message: 'Failed to fetch credits' });
    }
  });

  // Batch Enrichment - Create batch job
  app.post('/api/social-analytics/batch/create', isAuthenticated, async (req: any, res) => {
    try {
      const batchSchema = z.object({
        handles: z.array(z.object({
          handle: z.string().min(1).max(300),
          platform: z.enum(['instagram', 'tiktok', 'youtube', 'twitter', 'twitch']),
        })).min(1).max(1000),
      });

      const parseResult = batchSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid request', details: parseResult.error.issues });
      }

      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Analytics API not configured' });
      }
      if (!icEnrichmentEnabled()) {
        return res.status(400).json({ error: 'Batch creator enrichment is currently disabled' });
      }

      const { handles } = parseResult.data;

      // TODO: upstream /public/v1/enrichment/batch/ expects multipart form data
      // (file, enrichment_mode, platform); this JSON body may need conversion.
      const response = await fetch('https://api-dashboard.influencers.club/public/v1/enrichment/batch/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: handles.map(h => ({
            handle: normalizeSocialHandle(h.handle),
            platform: h.platform,
          })),
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Batch create error:', error);
        return res.status(response.status).json({ error: 'Failed to create batch job', detail: error.slice(0, 300) });
      }

      const data = await response.json();

      res.json({
        success: true,
        batchId: data.batch_id || data.id,
        itemCount: handles.length,
        status: data.status || 'processing',
        estimatedCredits: data.estimated_credits || handles.length * 2,
      });
    } catch (error) {
      console.error('Error creating batch:', error);
      res.status(500).json({ message: 'Failed to create batch job' });
    }
  });

  // Batch Enrichment - Check status
  app.get('/api/social-analytics/batch/:batchId/status', isAuthenticated, async (req: any, res) => {
    try {
      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Analytics API not configured' });
      }

      const { batchId } = req.params;

      const response = await fetch(`https://api-dashboard.influencers.club/public/v1/enrichment/batch/${batchId}/status/`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Batch status error:', errorText);
        return res.status(response.status).json({ error: 'Failed to fetch batch status', detail: errorText.slice(0, 300) });
      }

      const data = await response.json();

      res.json({
        success: true,
        batchId,
        status: data.status,
        progress: data.progress || 0,
        completed: data.completed || 0,
        total: data.total || 0,
        errors: data.errors || 0,
      });
    } catch (error) {
      console.error('Error fetching batch status:', error);
      res.status(500).json({ message: 'Failed to fetch batch status' });
    }
  });

  // Batch Enrichment - Download results
  app.get('/api/social-analytics/batch/:batchId/results', isAuthenticated, async (req: any, res) => {
    try {
      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Analytics API not configured' });
      }

      const { batchId } = req.params;

      const response = await fetch(`https://api-dashboard.influencers.club/public/v1/enrichment/batch/${batchId}/results/`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Batch results error:', errorText);
        return res.status(response.status).json({ error: 'Failed to fetch batch results', detail: errorText.slice(0, 300) });
      }

      const data = await response.json();

      const results = (data.results || []).map((item: any) => ({
        handle: item.handle,
        platform: item.platform,
        name: item.name || item.fullname,
        profilePicture: item.avatar || item.profile_pic_url,
        followers: item.followers || 0,
        engagementRate: item.engagement_rate || 0,
        avgViews: item.avg_views || 0,
        email: item.email,
        emailVerified: item.email_verified || false,
        location: item.location,
        niche: item.niche || item.category,
        isVerified: item.is_verified || false,
        estimatedMonthlyIncome: item.estimated_monthly_income,
        fakeFollowerPercent: item.fake_follower_percent,
        error: item.error,
      }));

      res.json({
        success: true,
        batchId,
        results,
        total: results.length,
      });
    } catch (error) {
      console.error('Error fetching batch results:', error);
      res.status(500).json({ message: 'Failed to fetch batch results' });
    }
  });

  // Get available locations for discovery filters
  app.get('/api/social-analytics/filters/locations', isAuthenticated, async (req: any, res) => {
    try {
      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Analytics API not configured' });
      }

      const platform = req.query.platform || 'instagram';

      const response = await fetch(`https://api-dashboard.influencers.club/public/v1/discovery/classifier/locations/${platform}/`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        // Return default locations if API fails
        return res.json({
          success: true,
          locations: ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France', 'Spain', 'Italy', 'Brazil', 'Mexico', 'India', 'Japan'],
        });
      }

      const data = await response.json();
      res.json({ success: true, locations: data.locations || data });
    } catch (error) {
      console.error('Error fetching locations:', error);
      res.json({ success: true, locations: ['United States', 'United Kingdom', 'Canada', 'Australia'] });
    }
  });

  // Get available languages for discovery filters
  app.get('/api/social-analytics/filters/languages', isAuthenticated, async (req: any, res) => {
    try {
      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Analytics API not configured' });
      }

      const response = await fetch('https://api-dashboard.influencers.club/public/v1/discovery/classifier/languages/', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        return res.json({
          success: true,
          languages: ['English', 'Spanish', 'Portuguese', 'French', 'German', 'Italian', 'Japanese', 'Korean', 'Chinese', 'Hindi', 'Arabic'],
        });
      }

      const data = await response.json();
      res.json({ success: true, languages: data.languages || data });
    } catch (error) {
      console.error('Error fetching languages:', error);
      res.json({ success: true, languages: ['English', 'Spanish', 'Portuguese', 'French', 'German'] });
    }
  });

  // Get available niches/categories for discovery filters
  app.get('/api/social-analytics/filters/niches', isAuthenticated, async (req: any, res) => {
    try {
      const apiKey = getInfluencersClubApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'Analytics API not configured' });
      }

      // Influencers.club has no /filters/niches endpoint; the classifier only exposes
      // languages and locations. Return a static niche list (niche text is folded into
      // ai_search on the discovery request).
      res.json({
        success: true,
        niches: [
          'Fashion', 'Beauty', 'Fitness', 'Food', 'Travel', 'Gaming', 'Music', 'Sports',
          'Business', 'Education', 'Comedy', 'Family', 'Military', 'Technology', 'Health'
        ],
      });
    } catch (error) {
      console.error('Error fetching niches:', error);
      res.json({ 
        success: true, 
        niches: ['Fashion', 'Beauty', 'Fitness', 'Travel', 'Food', 'Technology', 'Gaming', 'Music'] 
      });
    }
  });

  // ==================== CLIENT PORTAL ROUTES ====================
  
  // Get all saved creators for the current user
  app.get('/api/client-portal/saved-creators', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const creators = await db
        .select()
        .from(clientSavedCreators)
        .where(eq(clientSavedCreators.userId, userId))
        .orderBy(desc(clientSavedCreators.createdAt));
      
      res.json(creators);
    } catch (error) {
      console.error('Error fetching saved creators:', error);
      res.status(500).json({ message: 'Failed to fetch saved creators' });
    }
  });

  // Save a new creator
  app.post('/api/client-portal/saved-creators', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const finiteInt = z.number().optional().transform(val => {
        if (val === undefined || val === null) return undefined;
        if (!isFinite(val)) return undefined;
        return Math.round(Math.max(0, val));
      });

      const schema = z.object({
        platform: z.string(),
        platformUserId: z.string().optional(),
        username: z.string(),
        displayName: z.string().optional(),
        profilePicUrl: z.string().optional(),
        bio: z.string().optional(),
        followerCount: finiteInt,
        engagementRate: finiteInt,
        avgViews: finiteInt,
        avgLikes: finiteInt,
        location: z.string().optional(),
        categories: z.array(z.string()).optional(),
        email: z.string().optional(),
        estimatedPostRate: finiteInt,
        estimatedStoryRate: finiteInt,
        estimatedVideoRate: finiteInt,
        notes: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: z.string().optional(),
        listName: z.string().optional(),
      });

      const parseResult = schema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid request body', details: parseResult.error.format() });
      }

      const data = parseResult.data;

      // Check if already saved
      const existing = await db
        .select()
        .from(clientSavedCreators)
        .where(
          and(
            eq(clientSavedCreators.userId, userId),
            eq(clientSavedCreators.platform, data.platform),
            eq(clientSavedCreators.username, data.username)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        return res.status(400).json({ error: 'Creator already saved' });
      }

      const [creator] = await db
        .insert(clientSavedCreators)
        .values({
          userId,
          ...data,
        })
        .returning();

      res.json(creator);
    } catch (error) {
      console.error('Error saving creator:', error);
      res.status(500).json({ message: 'Failed to save creator' });
    }
  });

  // Update a saved creator
  app.patch('/api/client-portal/saved-creators/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { id } = req.params;

      const schema = z.object({
        status: z.string().optional(),
        notes: z.string().optional(),
        tags: z.array(z.string()).optional(),
        listName: z.string().optional(),
      });

      const parseResult = schema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid request body', details: parseResult.error.format() });
      }

      const [updated] = await db
        .update(clientSavedCreators)
        .set({ ...parseResult.data, updatedAt: new Date() })
        .where(
          and(
            eq(clientSavedCreators.id, id),
            eq(clientSavedCreators.userId, userId)
          )
        )
        .returning();

      if (!updated) {
        return res.status(404).json({ error: 'Creator not found' });
      }

      res.json(updated);
    } catch (error) {
      console.error('Error updating creator:', error);
      res.status(500).json({ message: 'Failed to update creator' });
    }
  });

  // Delete a saved creator
  app.delete('/api/client-portal/saved-creators/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { id } = req.params;

      const [deleted] = await db
        .delete(clientSavedCreators)
        .where(
          and(
            eq(clientSavedCreators.id, id),
            eq(clientSavedCreators.userId, userId)
          )
        )
        .returning();

      if (!deleted) {
        return res.status(404).json({ error: 'Creator not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting creator:', error);
      res.status(500).json({ message: 'Failed to delete creator' });
    }
  });

  return httpServer;
}
