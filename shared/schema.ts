import { pgTable, text, serial, timestamp, varchar, integer, boolean, jsonb, real, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
export { serial };
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// Re-export auth models
export * from "./models/auth";

export const subscribers = pgTable("subscribers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const identityAssets = pgTable("identity_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("voice_identity"), // voice_identity or likeness_identity
  voiceHash: text("voice_hash"), // Hash of the voice recording
  likenessImages: text("likeness_images").array(), // Array of object storage paths for likeness images
  likenessHash: text("likeness_hash"), // Hash of combined likeness images
  certStatus: text("cert_status").notNull().default("pending"), // pending, minting, minted, failed
  certTxHash: text("cert_tx_hash"), // Polygon transaction hash
  certTokenId: text("cert_token_id"), // NFT token ID
  certExplorerUrl: text("cert_explorer_url"), // Polygonscan URL
  youtubeChannel: text("youtube_channel"),
  twitterHandle: text("twitter_handle"),
  instagramHandle: text("instagram_handle"),
  tiktokHandle: text("tiktok_handle"),
  linkedinUrl: text("linkedin_url"),
  spotifyUrl: text("spotify_url"),
  monitorChannels: boolean("monitor_channels").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  mintedAt: timestamp("minted_at"),
});

export const insertSubscriberSchema = createInsertSchema(subscribers).pick({
  email: true,
});

// Connected social accounts via Phyllo for monitoring
export const connectedSocialAccounts = pgTable("connected_social_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  phylloUserId: varchar("phyllo_user_id"),
  phylloAccountId: varchar("phyllo_account_id"),
  platform: varchar("platform").notNull(), // instagram, tiktok, youtube, twitter, linkedin, facebook
  username: varchar("username").notNull(),
  profileUrl: text("profile_url"),
  profilePictureUrl: text("profile_picture_url"),
  followerCount: integer("follower_count"),
  isVerified: boolean("is_verified").default(false),
  status: varchar("status").default("connected"), // connected, syncing, disconnected, error
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Social monitoring alerts (impersonation, brand safety, etc.)
export const socialMonitoringAlerts = pgTable("social_monitoring_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  platform: varchar("platform").notNull(),
  alertType: varchar("alert_type").notNull(), // impersonation, brand_safety, mention, content_flag
  severity: varchar("severity").default("medium"), // low, medium, high
  title: varchar("title").notNull(),
  description: text("description"),
  contentUrl: text("content_url"),
  suspiciousAccountUsername: varchar("suspicious_account_username"),
  isResolved: boolean("is_resolved").default(false),
  resolvedAt: timestamp("resolved_at"),
  detectedAt: timestamp("detected_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertConnectedSocialAccountSchema = createInsertSchema(connectedSocialAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSocialMonitoringAlertSchema = createInsertSchema(socialMonitoringAlerts).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).pick({
  name: true,
  email: true,
  message: true,
});

export const insertIdentityAssetSchema = createInsertSchema(identityAssets).pick({
  email: true,
  name: true,
  type: true,
}).extend({
  socialChannels: z.object({
    youtube: z.string().optional(),
    twitter: z.string().optional(),
    instagram: z.string().optional(),
    tiktok: z.string().optional(),
    linkedin: z.string().optional(),
    spotify: z.string().optional(),
  }).optional(),
  monitorChannels: z.boolean().optional(),
  likenessImages: z.array(z.string()).optional(),
});

export type Subscriber = typeof subscribers.$inferSelect;
export type InsertSubscriber = z.infer<typeof insertSubscriberSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type IdentityAsset = typeof identityAssets.$inferSelect;
export type InsertIdentityAsset = z.infer<typeof insertIdentityAssetSchema>;

// Podcaster Profiles (public Linktree-style pages)
/** Full design/theme settings for a profile page — mirrors the page builder's Design tab. */
export interface ProfileDesignSettings {
  themeColor: string;
  bgMode: "solid" | "gradient" | "image";
  bgColor: string;
  bgImageUrl?: string;
  cardStyle: "round" | "square" | "shadow" | "glass";
  fontFamily: string;
  darkMode: boolean;
  shade: "none" | "minimal" | "light" | "color" | "dark";
  linkShape: "pill" | "rounded" | "square" | "squircle";
  linkStyle: "fill" | "outline" | "soft-shadow" | "hard-shadow";
  linkColor: string;
  showBranding: boolean;
  showProfileImage: boolean;
  showHeroImage: boolean;
  showUsername: boolean;
  profileImageSize: "s" | "m" | "l";
  template?: string;
  showSocialIcons?: boolean;
  socialIconsOrder?: string[];
  socialIconsEnabled?: Record<string, boolean>;
}

export const DEFAULT_PROFILE_DESIGN_SETTINGS: ProfileDesignSettings = {
  themeColor: "#E75427",
  bgMode: "solid",
  bgColor: "#ffffff",
  cardStyle: "round",
  fontFamily: "Inter",
  darkMode: false,
  shade: "none",
  linkShape: "pill",
  linkStyle: "fill",
  linkColor: "#E75427",
  showBranding: true,
  showProfileImage: true,
  showHeroImage: true,
  showUsername: true,
  profileImageSize: "m",
  showSocialIcons: true,
  socialIconsOrder: [],
  socialIconsEnabled: {},
};

export const profiles = pgTable("profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  slug: varchar("slug").notNull().unique(), // URL-friendly identifier
  displayName: varchar("display_name").notNull(),
  headline: text("headline"),
  bio: text("bio"),
  heroImageUrl: text("hero_image_url"),
  heroImageFormat: varchar("hero_image_format").default("portrait"), // portrait, landscape, full_blend
  avatarUrl: text("avatar_url"),
  // Deprecated — superseded by designSettings.themeColor. Left in place to avoid an ambiguous
  // rename migration; no code reads these anymore.
  theme: varchar("theme").default("default"),
  accentColor: varchar("accent_color").default("#6366f1"),
  isPublished: boolean("is_published").default(false),
  // Full Design-tab settings (color, shade, font, link style, background, branding, ...)
  designSettings: jsonb("design_settings").$type<ProfileDesignSettings>().default(DEFAULT_PROFILE_DESIGN_SETTINGS),
  // Social icons displayed at top of profile
  socialIcons: jsonb("social_icons").$type<{ platform: string; url: string }[]>().default([]),
  // YouTube video embed
  youtubeVideoUrl: text("youtube_video_url"),
  youtubeVideoMode: varchar("youtube_video_mode").default("specific"), // specific, latest, channel, latestLink
  youtubeChannelId: varchar("youtube_channel_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Profile Links (legacy flat links — retained for existing data; new content lives in profileSections)
export const profileLinks = pgTable("profile_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: varchar("profile_id").notNull(),
  title: varchar("title").notNull(),
  url: text("url").notNull(),
  icon: varchar("icon"), // lucide icon name or custom
  order: integer("order").default(0),
  isActive: boolean("is_active").default(true),
  clickCount: integer("click_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Content-block types selectable from the "Add Content" picker on the profile page builder. */
export type ProfileSectionType =
  | "section_title"
  | "custom_links"
  | "featured_video"
  | "podcast"
  | "book_meeting"
  | "promo_codes"
  | "tips"
  | "streaming_channel"
  | "books"
  | "store"
  | "blog";

export interface ProfileSectionCatalogEntry {
  type: ProfileSectionType;
  label: string;
  description: string;
  icon: string;
  comingSoon: boolean;
}

export const PROFILE_SECTION_CATALOG: ProfileSectionCatalogEntry[] = [
  { type: "section_title", label: "Section Title / Divider", description: "Organize your content into named groups", icon: "Type", comingSoon: false },
  { type: "custom_links", label: "Custom Links", description: "Add unlimited custom links with groupings", icon: "Link", comingSoon: false },
  { type: "featured_video", label: "Featured Video", description: "Highlight a video from your media library", icon: "Clapperboard", comingSoon: false },
  { type: "podcast", label: "Podcast", description: "Showcase your podcast and episodes", icon: "Mic", comingSoon: false },
  { type: "book_meeting", label: "Book a Meeting", description: "Let visitors schedule time with you", icon: "CalendarCheck", comingSoon: false },
  { type: "promo_codes", label: "Promo Codes", description: "Share discount codes and special offers", icon: "Ticket", comingSoon: false },
  { type: "tips", label: "Tips / Support Me", description: "Accept tips and donations from supporters", icon: "HandCoins", comingSoon: true },
  { type: "streaming_channel", label: "My Streaming Channel", description: "Show your live streams and replays", icon: "MonitorPlay", comingSoon: true },
  { type: "books", label: "Books", description: "Showcase your published books", icon: "BookOpen", comingSoon: true },
  { type: "store", label: "Store", description: "Sell products directly from your page", icon: "ShoppingBag", comingSoon: true },
  { type: "blog", label: "Blog", description: "Display your subscribers", icon: "Mail", comingSoon: true },
];

// Profile Sections (flexible content blocks on the profile page builder)
export const profileSections = pgTable("profile_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: varchar("profile_id").notNull(),
  type: varchar("type").$type<ProfileSectionType>().notNull(),
  label: varchar("label").notNull(),
  visible: boolean("visible").default(true),
  order: integer("order").default(0),
  // References the id of a section_title section this belongs to, if grouped
  groupId: varchar("group_id"),
  // Section-specific configuration (links, URLs, toggles, etc.)
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProfileSectionSchema = createInsertSchema(profileSections).omit({
  id: true,
  createdAt: true,
});

export type ProfileSection = typeof profileSections.$inferSelect;
export type InsertProfileSection = z.infer<typeof insertProfileSectionSchema>;

// Podcasts
export const podcasts = pgTable("podcasts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: varchar("title").notNull(),
  description: text("description"),
  artworkUrl: text("artwork_url"),
  language: varchar("language").default("en"),
  category: varchar("category"),
  isExplicit: boolean("is_explicit").default(false),
  // Apple Podcasts spec fields (required for a valid hosted feed)
  author: varchar("author"), // itunes:author
  ownerName: varchar("owner_name"), // itunes:owner > itunes:name
  ownerEmail: varchar("owner_email"), // itunes:owner > itunes:email
  websiteUrl: text("website_url"), // channel <link>
  copyright: varchar("copyright"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Creator Episodes (episodes hosted by Podlogix for creator podcasts)
// Shows an admin has chosen to feature on the marketing landing page. Kept
// apart from `podcasts` so the feed can ship without altering that table.
export const landingFeaturedPodcasts = pgTable("landing_featured_podcasts", {
  podcastId: varchar("podcast_id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const episodes = pgTable("episodes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  podcastId: varchar("podcast_id").notNull(),
  title: varchar("title").notNull(),
  description: text("description"),
  showNotes: text("show_notes"),
  audioUrl: text("audio_url"), // object storage path (/objects/...) or absolute URL
  fileSizeBytes: integer("file_size_bytes"),
  mimeType: varchar("mime_type").default("audio/mpeg"),
  durationSeconds: integer("duration_seconds"),
  episodeNumber: integer("episode_number"),
  seasonNumber: integer("season_number"),
  episodeType: varchar("episode_type").default("full"), // full | trailer | bonus
  isExplicit: boolean("is_explicit").default(false),
  artworkUrl: text("artwork_url"),
  guid: varchar("guid"),
  status: varchar("status").notNull().default("draft"), // draft | published
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// One-time login codes for passwordless email sign-in. Only the sha256 of the
// code is stored; rows are single-use and expire after 10 minutes.
export const loginCodes = pgTable(
  "login_codes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    email: varchar("email").notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [index("login_codes_email_idx").on(t.email, t.createdAt)],
);

// Listen events — one row per tracked feed fetch or audio download on hosted
// feeds. Raw IPs are never stored; listener_hash is a daily-salted digest so
// unique-listener counts work without retaining anything identifying.
export const listenEvents = pgTable(
  "listen_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    podcastId: varchar("podcast_id").notNull(),
    episodeId: varchar("episode_id"), // null for feed fetches
    kind: varchar("kind").notNull(), // download | feed
    app: varchar("app"), // parsed listening app ("Apple Podcasts", "Spotify", …)
    userAgent: text("user_agent"),
    listenerHash: varchar("listener_hash", { length: 64 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("listen_events_podcast_created_idx").on(t.podcastId, t.createdAt),
    index("listen_events_episode_idx").on(t.episodeId),
  ],
);

export type ListenEvent = typeof listenEvents.$inferSelect;

// RSS Feeds
export const rssFeeds = pgTable("rss_feeds", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  podcastId: varchar("podcast_id").notNull(),
  feedUrl: text("feed_url").notNull(),
  sourceType: varchar("source_type").notNull().default("existing"), // existing | podlogix
  status: varchar("status").notNull().default("pending"), // pending, validated, invalid, active
  lastValidatedAt: timestamp("last_validated_at"),
  episodeCount: integer("episode_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Distribution Channels (catalog of available platforms)
export const distributionChannels = pgTable("distribution_channels", {
  id: varchar("id").primaryKey(),
  name: varchar("name").notNull(),
  icon: varchar("icon"),
  description: text("description"),
  isActive: boolean("is_active").default(true),
});

// Channel Submissions (per podcast distribution status)
export const channelSubmissions = pgTable("channel_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  podcastId: varchar("podcast_id").notNull(),
  channelId: varchar("channel_id").notNull(),
  status: varchar("status").notNull().default("not_submitted"), // not_submitted, pending, submitted, approved, rejected
  externalUrl: text("external_url"), // URL on the platform once approved
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  errorMessage: text("error_message"),
});

// Insert schemas
export const insertProfileSchema = createInsertSchema(profiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProfileLinkSchema = createInsertSchema(profileLinks).omit({
  id: true,
  createdAt: true,
  clickCount: true,
});

export const insertPodcastSchema = createInsertSchema(podcasts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRssFeedSchema = createInsertSchema(rssFeeds).omit({
  id: true,
  createdAt: true,
  lastValidatedAt: true,
});

export const insertEpisodeSchema = createInsertSchema(episodes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
});

export const insertChannelSubmissionSchema = createInsertSchema(channelSubmissions).omit({
  id: true,
  submittedAt: true,
  approvedAt: true,
});

// AI Conversations (for Podlogix AI Assistant)
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id"),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

// Podcast Subscriptions (listener-side - podcasts user follows)
export const podcastSubscriptions = pgTable("podcast_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: varchar("title").notNull(),
  author: varchar("author"),
  description: text("description"),
  artworkUrl: text("artwork_url"),
  feedUrl: text("feed_url").notNull(),
  spotifyShowId: varchar("spotify_show_id"), // If imported from Spotify
  lastCheckedAt: timestamp("last_checked_at"),
  latestEpisodeAt: timestamp("latest_episode_at"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Episodes from subscribed podcasts
export const subscriptionEpisodes = pgTable("subscription_episodes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subscriptionId: varchar("subscription_id").notNull(),
  userId: varchar("user_id").notNull(),
  title: varchar("title").notNull(),
  description: text("description"),
  audioUrl: text("audio_url"),
  duration: integer("duration"), // In seconds
  publishedAt: timestamp("published_at"),
  guid: varchar("guid"), // RSS GUID for deduplication
  transcriptStatus: varchar("transcript_status").default("pending"), // pending, processing, completed, failed
  transcript: text("transcript"),
  // Whisper caps each request at 25MB, so long episodes transcribe in parts.
  // One serverless invocation can't always finish them inside its time limit,
  // so progress is persisted and the next call resumes at the first unfinished part.
  transcriptPartsDone: integer("transcript_parts_done").default(0),
  transcriptPartsTotal: integer("transcript_parts_total"),
  briefingStatus: varchar("briefing_status").default("pending"), // pending, processing, completed, failed
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// User interests (topics to track in podcasts)
export const userInterests = pgTable("user_interests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  topic: varchar("topic").notNull(), // e.g., "AI trends", "startup funding"
  keywords: text("keywords").array(), // Related keywords to search for
  priority: varchar("priority").default("medium"), // high, medium, low
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Episode briefings (AI-generated summaries personalized to user interests)
export const episodeBriefings = pgTable("episode_briefings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  episodeId: varchar("episode_id").notNull(),
  userId: varchar("user_id").notNull(),
  summary: text("summary").notNull(), // Overall episode summary
  keyTakeaways: text("key_takeaways").array(), // Bullet points
  relevantQuotes: text("relevant_quotes").array(), // Notable quotes
  personalInsights: text("personal_insights").array(), // Insights matching user interests
  matchedInterests: text("matched_interests").array(), // Which user interests were matched
  relevanceScore: integer("relevance_score").default(0), // 0-100 how relevant to user
  isBookmarked: boolean("is_bookmarked").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// User Spotify Connections (per-user OAuth tokens)
// Credit ledger — one row per action that costs Podlogix money. Users see
// credits; admins also see our estimated vendor cost. Append-only; balances are
// derived. Written by server/services/credits.ts.
export const creditLedger = pgTable("credit_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  action: varchar("action").notNull(),
  credits: numeric("credits", { precision: 10, scale: 2 }).notNull(),
  costCents: integer("cost_cents").notNull().default(0),
  label: varchar("label"),
  resourceType: varchar("resource_type"),
  resourceId: varchar("resource_id"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;

export const spotifyConnections = pgTable("spotify_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  spotifyUserId: varchar("spotify_user_id"),
  displayName: varchar("display_name"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  scope: text("scope"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Google Calendar Connections (per-user OAuth tokens)
export const googleCalendarConnections = pgTable("google_calendar_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  googleUserId: varchar("google_user_id"),
  email: varchar("email"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  scope: text("scope"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Authenticated YouTube creator source. Distinct from public analytics and
// posting connections: this proves ownership for the content import picker.
export const youtubeConnections = pgTable("youtube_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  googleUserId: varchar("google_user_id"),
  email: varchar("email"),
  channelId: varchar("channel_id").notNull(),
  channelTitle: varchar("channel_title"),
  channelThumbnailUrl: text("channel_thumbnail_url"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  scope: text("scope"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Notifications (for dashboard and email alerts)
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  type: varchar("type").notNull(), // new_episode, briefing_ready, impersonator_alert
  title: varchar("title").notNull(),
  message: text("message"),
  resourceType: varchar("resource_type"), // episode, briefing, etc.
  resourceId: varchar("resource_id"),
  isRead: boolean("is_read").default(false),
  emailSent: boolean("email_sent").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas for new tables
export const insertPodcastSubscriptionSchema = createInsertSchema(podcastSubscriptions).omit({
  id: true,
  createdAt: true,
  lastCheckedAt: true,
  latestEpisodeAt: true,
});

export const insertSubscriptionEpisodeSchema = createInsertSchema(subscriptionEpisodes).omit({
  id: true,
  createdAt: true,
});

export const insertUserInterestSchema = createInsertSchema(userInterests).omit({
  id: true,
  createdAt: true,
});

export const insertEpisodeBriefingSchema = createInsertSchema(episodeBriefings).omit({
  id: true,
  createdAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});

// Brand Influencer Discovery Tables

// Saved influencers from Modash discovery
export const savedInfluencers = pgTable("saved_influencers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  platform: varchar("platform").notNull(), // instagram, tiktok, youtube
  platformUserId: varchar("platform_user_id").notNull(),
  username: varchar("username").notNull(),
  fullName: varchar("full_name"),
  profilePicUrl: text("profile_pic_url"),
  bio: text("bio"),
  followerCount: integer("follower_count"),
  followingCount: integer("following_count"),
  engagementRate: integer("engagement_rate"), // Stored as percentage * 100 (e.g., 1.5% = 150)
  avgLikes: integer("avg_likes"),
  avgComments: integer("avg_comments"),
  location: varchar("location"),
  categories: text("categories").array(),
  notes: text("notes"),
  status: varchar("status").default("saved"), // saved, contacted, negotiating, partnered, rejected
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Hashtag/keyword monitors for brands
export const hashtagMonitors = pgTable("hashtag_monitors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  hashtag: varchar("hashtag").notNull(),
  platform: varchar("platform").default("instagram"), // instagram, tiktok, youtube
  isActive: boolean("is_active").default(true),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Saved influencer searches
export const influencerSearches = pgTable("influencer_searches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: varchar("name"),
  filters: text("filters"), // JSON stringified search filters
  resultCount: integer("result_count"),
  isSaved: boolean("is_saved").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSavedInfluencerSchema = createInsertSchema(savedInfluencers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertHashtagMonitorSchema = createInsertSchema(hashtagMonitors).omit({
  id: true,
  lastCheckedAt: true,
  createdAt: true,
});

export const insertInfluencerSearchSchema = createInsertSchema(influencerSearches).omit({
  id: true,
  createdAt: true,
});

// Modash search request schema
export const modashSearchSchema = z.object({
  platform: z.enum(['instagram', 'tiktok', 'youtube']).default('instagram'),
  minFollowers: z.number().optional(),
  maxFollowers: z.number().optional(),
  minEngagement: z.number().optional(),
  maxEngagement: z.number().optional(),
  location: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  hashtags: z.array(z.string()).optional(),
  page: z.number().default(1),
});

// Types
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type ProfileLink = typeof profileLinks.$inferSelect;
export type InsertProfileLink = z.infer<typeof insertProfileLinkSchema>;
export type Podcast = typeof podcasts.$inferSelect;
export type InsertPodcast = z.infer<typeof insertPodcastSchema>;
export type RssFeed = typeof rssFeeds.$inferSelect;
export type InsertRssFeed = z.infer<typeof insertRssFeedSchema>;
export type Episode = typeof episodes.$inferSelect;
export type InsertEpisode = z.infer<typeof insertEpisodeSchema>;
export type DistributionChannel = typeof distributionChannels.$inferSelect;
export type ChannelSubmission = typeof channelSubmissions.$inferSelect;
export type InsertChannelSubmission = z.infer<typeof insertChannelSubmissionSchema>;
export type PodcastSubscription = typeof podcastSubscriptions.$inferSelect;
export type InsertPodcastSubscription = z.infer<typeof insertPodcastSubscriptionSchema>;
export type SubscriptionEpisode = typeof subscriptionEpisodes.$inferSelect;
export type InsertSubscriptionEpisode = z.infer<typeof insertSubscriptionEpisodeSchema>;
export type UserInterest = typeof userInterests.$inferSelect;
export type InsertUserInterest = z.infer<typeof insertUserInterestSchema>;
export type EpisodeBriefing = typeof episodeBriefings.$inferSelect;
export type InsertEpisodeBriefing = z.infer<typeof insertEpisodeBriefingSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type SpotifyConnection = typeof spotifyConnections.$inferSelect;
export type GoogleCalendarConnection = typeof googleCalendarConnections.$inferSelect;
export type SavedInfluencer = typeof savedInfluencers.$inferSelect;
export type InsertSavedInfluencer = z.infer<typeof insertSavedInfluencerSchema>;
export type HashtagMonitor = typeof hashtagMonitors.$inferSelect;
export type InsertHashtagMonitor = z.infer<typeof insertHashtagMonitorSchema>;
export type InfluencerSearch = typeof influencerSearches.$inferSelect;
export type InsertInfluencerSearch = z.infer<typeof insertInfluencerSearchSchema>;
export type ConnectedSocialAccount = typeof connectedSocialAccounts.$inferSelect;
export type InsertConnectedSocialAccount = z.infer<typeof insertConnectedSocialAccountSchema>;
export type SocialMonitoringAlert = typeof socialMonitoringAlerts.$inferSelect;
export type InsertSocialMonitoringAlert = z.infer<typeof insertSocialMonitoringAlertSchema>;

// Creator Social Profiles (native API integration for influencers)
export const creatorSocialProfiles = pgTable("creator_social_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  platform: varchar("platform").notNull(), // youtube, instagram, tiktok, twitter, linkedin
  profileUrl: text("profile_url").notNull(),
  username: varchar("username"),
  displayName: varchar("display_name"),
  profilePictureUrl: text("profile_picture_url"),
  // YouTube-specific analytics (populated via YouTube Data API)
  youtubeChannelId: varchar("youtube_channel_id"),
  subscriberCount: integer("subscriber_count"),
  videoCount: integer("video_count"),
  viewCount: integer("view_count"),
  // Instagram-specific fields (populated via Instagram Graph API OAuth)
  instagramAccountId: varchar("instagram_account_id"),
  instagramAccessToken: text("instagram_access_token"),
  instagramTokenExpiresAt: timestamp("instagram_token_expires_at"),
  followersCount: integer("followers_count"),
  followingCount: integer("following_count"),
  mediaCount: integer("media_count"),
  // LinkedIn-specific fields (populated via LinkedIn OAuth)
  linkedinMemberId: varchar("linkedin_member_id"),
  linkedinAccessToken: text("linkedin_access_token"),
  linkedinTokenExpiresAt: timestamp("linkedin_token_expires_at"),
  // Facebook-specific fields (populated via Facebook OAuth)
  facebookPageId: varchar("facebook_page_id"),
  facebookAccessToken: text("facebook_access_token"),
  facebookTokenExpiresAt: timestamp("facebook_token_expires_at"),
  facebookPageName: varchar("facebook_page_name"),
  facebookFansCount: integer("facebook_fans_count"),
  // Verification status
  verified: boolean("verified").default(false),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCreatorSocialProfileSchema = createInsertSchema(creatorSocialProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreatorSocialProfile = typeof creatorSocialProfiles.$inferSelect;
export type InsertCreatorSocialProfile = z.infer<typeof insertCreatorSocialProfileSchema>;

// Guest Prospects — a durable person record created during research before an
// email address or booking exists. Provider identity prevents duplicate saves;
// the show-specific booking state remains in guest_pipeline_entries.
export const guestProspects = pgTable("guest_prospects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  provider: varchar("provider").notNull().default("podchaser"),
  providerPersonId: varchar("provider_person_id").notNull(),
  name: varchar("name").notNull(),
  informalName: varchar("informal_name"),
  pronouns: varchar("pronouns"),
  subtitle: text("subtitle"),
  location: varchar("location"),
  bio: text("bio"),
  profileUrl: text("profile_url"),
  imageUrl: text("image_url"),
  email: varchar("email"),
  socialLinks: jsonb("social_links").$type<Record<string, string>>().default({}),
  episodeAppearanceCount: integer("episode_appearance_count"),
  // A user-curated flag ("these are the ones I'm most excited about"), independent
  // of pipeline stage or contact status — applies to anyone already reviewed.
  starred: boolean("starred").notNull().default(false),
  lastResearchedAt: timestamp("last_researched_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("guest_prospects_user_provider_person").on(table.userId, table.provider, table.providerPersonId),
]);

export const insertGuestProspectSchema = createInsertSchema(guestProspects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type GuestProspect = typeof guestProspects.$inferSelect;
export type InsertGuestProspect = z.infer<typeof insertGuestProspectSchema>;

// Master Contacts (guests, subscribers, team, etc.). A researched guest can be
// promoted here before an email is known; guestProspectId keeps that identity
// linked to the reusable contact record.
export const emailContacts = pgTable("email_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  guestProspectId: varchar("guest_prospect_id"), // -> guest_prospects.id
  email: varchar("email"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  company: varchar("company"),
  title: varchar("title"),
  category: varchar("category").default("subscriber"), // guest, subscriber, sponsor, collaborator, team
  // Copied from guest_prospects at promotion time (see ensureOfficialGuestContact
  // in routes.ts) so the contact record survives even if the prospect research
  // is later deleted, instead of relying only on the guestProspectId join.
  subtitle: text("subtitle"),
  location: varchar("location"),
  bio: text("bio"),
  imageUrl: text("image_url"),
  socialLinks: jsonb("social_links").$type<Record<string, string>>(),
  episodeAppearanceCount: integer("episode_appearance_count"),
  notes: text("notes"),
  tags: text("tags").array(),
  isSubscribed: boolean("is_subscribed").default(true),
  lastEmailedAt: timestamp("last_emailed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("email_contacts_user_guest_prospect").on(table.userId, table.guestProspectId),
]);

// Email Templates (reusable templates)
export const emailTemplates = pgTable("email_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: varchar("name").notNull(),
  subject: varchar("subject").notNull(),
  body: text("body").notNull(), // HTML content
  category: varchar("category").default("custom"), // guest_invite, newsletter, thank_you, follow_up, custom
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Email Campaigns (sent emails / drafts)
export const emailCampaigns = pgTable("email_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: varchar("name").notNull(),
  subject: varchar("subject").notNull(),
  body: text("body").notNull(),
  templateId: varchar("template_id"),
  recipientType: varchar("recipient_type").default("individual"), // individual, category, all
  recipientFilter: text("recipient_filter"), // JSON for filtering (e.g., { category: "guest" })
  status: varchar("status").default("draft"), // draft, scheduled, sending, sent, failed
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  recipientCount: integer("recipient_count").default(0),
  openCount: integer("open_count").default(0),
  clickCount: integer("click_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Email Campaign Recipients (individual recipients for a campaign)
export const emailCampaignRecipients = pgTable("email_campaign_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull(),
  contactId: varchar("contact_id"),
  email: varchar("email").notNull(),
  status: varchar("status").default("pending"), // pending, sent, delivered, opened, clicked, bounced, failed
  sentAt: timestamp("sent_at"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  errorMessage: text("error_message"),
});

export const insertEmailContactSchema = createInsertSchema(emailContacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastEmailedAt: true,
});

export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmailCampaignSchema = createInsertSchema(emailCampaigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  sentAt: true,
  openCount: true,
  clickCount: true,
});

export const insertEmailCampaignRecipientSchema = createInsertSchema(emailCampaignRecipients).omit({
  id: true,
  sentAt: true,
  openedAt: true,
  clickedAt: true,
});

export type EmailContact = typeof emailContacts.$inferSelect;
export type InsertEmailContact = z.infer<typeof insertEmailContactSchema>;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type InsertEmailCampaign = z.infer<typeof insertEmailCampaignSchema>;
export type EmailCampaignRecipient = typeof emailCampaignRecipients.$inferSelect;
export type InsertEmailCampaignRecipient = z.infer<typeof insertEmailCampaignRecipientSchema>;

// Guest Pipeline tracks either a researched prospect or an email contact through
// a show's booking workflow. Contact details can be attached later without
// forcing discovery results to invent an email address.
export const guestPipelineEntries = pgTable("guest_pipeline_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  podcastId: varchar("podcast_id").notNull(),
  contactId: varchar("contact_id"), // -> email_contacts.id, optional until contact enrichment
  guestProspectId: varchar("guest_prospect_id"), // -> guest_prospects.id
  stage: varchar("stage").notNull().default("prospect"), // prospect, invited, booked, recorded, published, follow_up, alumni
  episodeId: varchar("episode_id"), // -> episodes.id, set once recorded/published
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("guest_pipeline_podcast_prospect").on(table.podcastId, table.guestProspectId),
]);

export const insertGuestPipelineEntrySchema = createInsertSchema(guestPipelineEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Timestamped notes on a contact — the CRM activity trail.
export const contactNotes = pgTable("contact_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull(), // -> email_contacts.id
  userId: varchar("user_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertContactNoteSchema = createInsertSchema(contactNotes).omit({
  id: true,
  createdAt: true,
});

export type ContactNote = typeof contactNotes.$inferSelect;
export type InsertContactNote = z.infer<typeof insertContactNoteSchema>;

// Named studios — persistent rooms a creator sets up once and returns to.
// A studio is identity (name) + a home for its sessions; deleting a studio
// leaves past sessions and clips untouched.
export const studios = pgTable("studios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: varchar("name").notNull(),
  // Guest room invite code (LiveKit) — the room belongs to the studio, so
  // guests can join the green room before the show goes live.
  guestInviteCode: varchar("guest_invite_code"),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Scenes — one-click stage presets (Countdown, Welcome, Outro…): a layout
// plus optional media. Clicking a scene applies both instantly.
export const studioScenes = pgTable("studio_scenes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  studioId: varchar("studio_id").notNull(), // -> studios.id
  name: varchar("name").notNull(),
  layout: varchar("layout").notNull().default("fullscreen"),
  mediaUrl: text("media_url"),
  mediaType: varchar("media_type"), // video | image | null
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertStudioSceneSchema = createInsertSchema(studioScenes).omit({ id: true, createdAt: true });
export type StudioScene = typeof studioScenes.$inferSelect;
export type InsertStudioScene = z.infer<typeof insertStudioSceneSchema>;

export const insertStudioSchema = createInsertSchema(studios).omit({ id: true, createdAt: true });
export type Studio = typeof studios.$inferSelect;
export type InsertStudio = z.infer<typeof insertStudioSchema>;

// Live Studio: mark moments during a live show, cut them into clips after.
// The creator streams wherever they already stream — this records WHEN the
// good moments happened; the VOD gets attached afterwards and marks become
// clips. Deliberately no streaming infra (plan of record).
export const liveSessions = pgTable("live_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: varchar("title").notNull().default("Live session"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  vodUrl: text("vod_url"),
  // Seconds between VOD 0:00 and the moment Go live was pressed here.
  vodOffsetSeconds: integer("vod_offset_seconds").notNull().default(0),
  // Guest room invite code (LiveKit). Valid only while the session is open.
  guestInviteCode: varchar("guest_invite_code"),
  studioId: varchar("studio_id"), // -> studios.id (nullable: pre-studio sessions)
  // Server-side cloud recording (LiveKit Egress). When present, the VOD is the
  // full-res egress capture rather than the 720p browser recording.
  egressId: varchar("egress_id"),
  recordingStatus: varchar("recording_status"), // null | starting | recording | done | failed
  createdAt: timestamp("created_at").defaultNow(),
});

export const liveMarks = pgTable("live_marks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(), // -> live_sessions.id
  userId: varchar("user_id").notNull(),
  atSeconds: integer("at_seconds").notNull(),
  note: text("note"),
  clipStatus: varchar("clip_status").notNull().default("marked"), // marked | cutting | ready | failed
  clipJobId: varchar("clip_job_id"),
  clipMediaId: varchar("clip_media_id"), // -> media_library_items.id
  createdAt: timestamp("created_at").defaultNow(),
});

// Sponsors — a creator's active sponsors, so every clip posted from the
// Refiner/Studio can auto-attach the sponsor's hashtags and per-platform
// @mentions. This is the piece stock clippers don't have.
export const sponsors = pgTable("sponsors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  showId: varchar("show_id"), // -> podcasts.id (null = applies to all shows)
  name: varchar("name").notNull(),
  // Space/comma-separated tags, stored without the leading #.
  hashtags: text("hashtags").default(""),
  // Per-platform handle for @mentions, e.g. { instagram: "acme", tiktok: "acmehq" }.
  mentions: jsonb("mentions").$type<Record<string, string>>().default({}),
  // Optional one-line spoken/credit note surfaced in the composer.
  creditLine: text("credit_line"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSponsorSchema = createInsertSchema(sponsors).omit({ id: true, createdAt: true });
export type Sponsor = typeof sponsors.$inferSelect;
export type InsertSponsor = typeof sponsors.$inferInsert;

export const insertLiveSessionSchema = createInsertSchema(liveSessions).omit({ id: true, createdAt: true });
export const insertLiveMarkSchema = createInsertSchema(liveMarks).omit({ id: true, createdAt: true });
export type LiveSession = typeof liveSessions.$inferSelect;
export type InsertLiveSession = z.infer<typeof insertLiveSessionSchema>;
export type LiveMark = typeof liveMarks.$inferSelect;
export type InsertLiveMark = z.infer<typeof insertLiveMarkSchema>;

export type GuestPipelineEntry = typeof guestPipelineEntries.$inferSelect;
export type InsertGuestPipelineEntry = z.infer<typeof insertGuestPipelineEntrySchema>;

// Saved Creators (Discover results saved into a free-text named list/directory —
// lighter than a full Lists/Directories system, just enough to group saved research)
export const savedCreators = pgTable("saved_creators", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  listName: varchar("list_name").notNull().default("Saved creators"),
  handle: varchar("handle").notNull(),
  platform: varchar("platform").notNull(),
  name: varchar("name"),
  profilePictureUrl: text("profile_picture_url"),
  followers: integer("followers"),
  engagementRate: real("engagement_rate"),
  avgLikes: real("avg_likes"),
  avgViews: real("avg_views"),
  email: varchar("email"),
  bio: text("bio"),
  isVerified: boolean("is_verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSavedCreatorSchema = createInsertSchema(savedCreators).omit({
  id: true,
  createdAt: true,
});

export type SavedCreator = typeof savedCreators.$inferSelect;
export type InsertSavedCreator = z.infer<typeof insertSavedCreatorSchema>;

// Media Library — posts imported from the creator's existing channels via
// Upload-Post's /media back-catalog API. mediaUrl/thumbnailUrl are OUR mirrored
// copies (platform CDN links expire); permalink-only rows (TikTok/YouTube)
// have mediaUrl null and link out instead.
export const mediaLibraryItems = pgTable(
  "media_library_items",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    platform: varchar("platform").notNull(),
    externalId: varchar("external_id").notNull(),
    caption: text("caption"),
    mediaType: varchar("media_type"), // image, video, carousel, link
    mediaUrl: text("media_url"),
    thumbnailUrl: text("thumbnail_url"),
    permalink: text("permalink"),
    postedAt: timestamp("posted_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [uniqueIndex("media_library_user_platform_external").on(table.userId, table.platform, table.externalId)]
);

export const insertMediaLibraryItemSchema = createInsertSchema(mediaLibraryItems).omit({
  id: true,
  createdAt: true,
});

export type MediaLibraryItem = typeof mediaLibraryItems.$inferSelect;
export type InsertMediaLibraryItem = z.infer<typeof insertMediaLibraryItemSchema>;

// YouTube Video Analysis
export const videoAnalyses = pgTable("video_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  videoUrl: text("video_url").notNull(),
  videoId: text("video_id").notNull(),
  videoTitle: text("video_title"),
  channelName: text("channel_name"),
  thumbnailUrl: text("thumbnail_url"),
  transcript: text("transcript"),
  presenceScore: integer("presence_score"),
  speakingAbilityScore: integer("speaking_ability_score"),
  fillerWordsScore: integer("filler_words_score"),
  appearanceScore: integer("appearance_score"),
  overallScore: integer("overall_score"),
  presenceFeedback: text("presence_feedback"),
  speakingAbilityFeedback: text("speaking_ability_feedback"),
  fillerWordsFeedback: text("filler_words_feedback"),
  appearanceFeedback: text("appearance_feedback"),
  overallFeedback: text("overall_feedback"),
  fillerWordsDetected: jsonb("filler_words_detected"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  analyzedAt: timestamp("analyzed_at"),
});

export const insertVideoAnalysisSchema = createInsertSchema(videoAnalyses).omit({
  id: true,
  createdAt: true,
  analyzedAt: true,
});

export type VideoAnalysis = typeof videoAnalyses.$inferSelect;
export type InsertVideoAnalysis = z.infer<typeof insertVideoAnalysisSchema>;

// Upload-Post connected social accounts for creators
export const uploadPostAccounts = pgTable("upload_post_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  uploadPostUsername: varchar("upload_post_username").notNull(),
  platform: varchar("platform").notNull(),
  platformAccountId: varchar("platform_account_id"),
  platformUsername: varchar("platform_username"),
  profileUrl: text("profile_url"),
  profilePictureUrl: text("profile_picture_url"),
  isConnected: boolean("is_connected").default(true),
  connectedAt: timestamp("connected_at").defaultNow(),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Upload-Post scheduled/published posts
export const uploadPostPosts = pgTable("upload_post_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  uploadPostPostId: varchar("upload_post_post_id"),
  platforms: text("platforms").array(),
  content: text("content"),
  mediaUrls: text("media_urls").array(),
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),
  status: varchar("status").default("draft"),
  // Set by the upload_completed webhook when a post fails at publish time.
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUploadPostAccountSchema = createInsertSchema(uploadPostAccounts).omit({
  id: true,
  createdAt: true,
});

export const insertUploadPostPostSchema = createInsertSchema(uploadPostPosts).omit({
  id: true,
  createdAt: true,
});

export type UploadPostAccount = typeof uploadPostAccounts.$inferSelect;
export type InsertUploadPostAccount = z.infer<typeof insertUploadPostAccountSchema>;
export type UploadPostPost = typeof uploadPostPosts.$inferSelect;
export type InsertUploadPostPost = z.infer<typeof insertUploadPostPostSchema>;

// Admin Creator List - influencers discovered and added by admin for outreach/management
export const adminCreatorList = pgTable("admin_creator_list", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  addedByUserId: varchar("added_by_user_id").notNull(),
  platform: varchar("platform").notNull(),
  platformUserId: varchar("platform_user_id"),
  username: varchar("username").notNull(),
  fullName: varchar("full_name"),
  profilePicUrl: text("profile_pic_url"),
  bio: text("bio"),
  email: varchar("email"),
  phone: varchar("phone"),
  websiteUrl: text("website_url"),
  followerCount: integer("follower_count"),
  followingCount: integer("following_count"),
  engagementRate: integer("engagement_rate"),
  avgLikes: integer("avg_likes"),
  avgComments: integer("avg_comments"),
  avgViews: integer("avg_views"),
  location: varchar("location"),
  categories: text("categories").array(),
  niche: varchar("niche"),
  hourlyRate: integer("hourly_rate"),
  perPostRate: integer("per_post_rate"),
  perVideoRate: integer("per_video_rate"),
  perStoryRate: integer("per_story_rate"),
  monthlyRetainerRate: integer("monthly_retainer_rate"),
  packageDescription: text("package_description"),
  currency: varchar("currency").default("USD"),
  status: varchar("status").default("prospect"),
  priority: varchar("priority").default("medium"),
  notes: text("notes"),
  tags: text("tags").array(),
  lastContactedAt: timestamp("last_contacted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAdminCreatorSchema = createInsertSchema(adminCreatorList).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AdminCreator = typeof adminCreatorList.$inferSelect;
export type InsertAdminCreator = z.infer<typeof insertAdminCreatorSchema>;

// Client Portal - Saved Creators for brands/agencies
export const clientSavedCreators = pgTable("client_saved_creators", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(), // The client/brand user
  platform: varchar("platform").notNull(), // instagram, youtube, tiktok, twitter, podcast
  platformUserId: varchar("platform_user_id"), // External platform ID if available
  username: varchar("username").notNull(),
  displayName: varchar("display_name"),
  profilePicUrl: text("profile_pic_url"),
  bio: text("bio"),
  followerCount: integer("follower_count"),
  engagementRate: integer("engagement_rate"), // Stored as percentage * 100
  avgViews: integer("avg_views"),
  avgLikes: integer("avg_likes"),
  location: varchar("location"),
  categories: text("categories").array(),
  email: varchar("email"), // Contact email if available
  estimatedPostRate: integer("estimated_post_rate"), // In cents
  estimatedStoryRate: integer("estimated_story_rate"),
  estimatedVideoRate: integer("estimated_video_rate"),
  notes: text("notes"),
  tags: text("tags").array(),
  status: varchar("status").default("saved"), // saved, interested, contacted, negotiating, partnered, declined
  listName: varchar("list_name"), // For organizing into lists
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Client Portal - Outreach/Connection Requests
export const clientOutreachRequests = pgTable("client_outreach_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(), // The client/brand user
  savedCreatorId: varchar("saved_creator_id").notNull(), // References clientSavedCreators
  messageType: varchar("message_type").default("collaboration"), // collaboration, sponsorship, ambassador, custom
  subject: varchar("subject"),
  message: text("message"),
  proposedBudget: integer("proposed_budget"), // In cents
  proposedDeliverables: text("proposed_deliverables"),
  status: varchar("status").default("draft"), // draft, sent, viewed, replied, accepted, declined
  sentAt: timestamp("sent_at"),
  respondedAt: timestamp("responded_at"),
  creatorResponse: text("creator_response"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertClientSavedCreatorSchema = createInsertSchema(clientSavedCreators).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertClientOutreachRequestSchema = createInsertSchema(clientOutreachRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ClientSavedCreator = typeof clientSavedCreators.$inferSelect;
export type InsertClientSavedCreator = z.infer<typeof insertClientSavedCreatorSchema>;
export type ClientOutreachRequest = typeof clientOutreachRequests.$inferSelect;
export type InsertClientOutreachRequest = z.infer<typeof insertClientOutreachRequestSchema>;

export const adminDevDocuments = pgTable("admin_dev_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title").notNull(),
  content: text("content").notNull(),
  category: varchar("category").default("general"),
  createdByUserId: varchar("created_by_user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAdminDevDocumentSchema = createInsertSchema(adminDevDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AdminDevDocument = typeof adminDevDocuments.$inferSelect;
export type InsertAdminDevDocument = z.infer<typeof insertAdminDevDocumentSchema>;

export const teamInvitations = pgTable("team_invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").notNull(),
  role: varchar("role").notNull().default("admin"),
  invitedByUserId: varchar("invited_by_user_id").notNull(),
  invitedByName: varchar("invited_by_name"),
  status: varchar("status").default("pending"),
  expiresAt: timestamp("expires_at"),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTeamInvitationSchema = createInsertSchema(teamInvitations).omit({
  id: true,
  acceptedAt: true,
  createdAt: true,
});

export type TeamInvitation = typeof teamInvitations.$inferSelect;
export type InsertTeamInvitation = z.infer<typeof insertTeamInvitationSchema>;

// ─── Buzzsprout Integration ────────────────────────────────────────────────────
// One connection per user (Buzzsprout uses static API tokens, not OAuth).
// Episodes are stored in a separate table so they don't pollute the creator's
// own `episodes` table — imported data and native data are clearly separated.

export const buzzsproutConnections = pgTable("buzzsprout_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  // Stored as-is. Treat as sensitive — never expose to client.
  apiToken: text("api_token").notNull(),
  // The Buzzsprout podcast_id (numeric string, e.g. "12345").
  podcastId: varchar("podcast_id").notNull(),
  // Metadata cached from the last successful /podcasts.json call.
  podcastTitle: varchar("podcast_title"),
  podcastArtworkUrl: text("podcast_artwork_url"),
  podcastAuthor: varchar("podcast_author"),
  podcastCategory: varchar("podcast_category"),
  // "connected" | "error" | "syncing"
  status: varchar("status").notNull().default("connected"),
  episodeCount: integer("episode_count").default(0),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const buzzsproutEpisodes = pgTable("buzzsprout_episodes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull(),
  userId: varchar("user_id").notNull(),
  // Buzzsprout's own episode id — used as the upsert key.
  externalId: varchar("external_id").notNull(),
  title: varchar("title").notNull(),
  // Buzzsprout `summary` = short blurb; `description` = full HTML show notes.
  description: text("description"),
  showNotes: text("show_notes"),
  audioUrl: text("audio_url"),
  artworkUrl: text("artwork_url"),
  durationSeconds: integer("duration_seconds"),
  episodeNumber: integer("episode_number"),
  seasonNumber: integer("season_number"),
  tags: text("tags"),
  totalPlays: integer("total_plays").default(0),
  // "draft" | "scheduled" | "published" | "archived"
  status: varchar("status").notNull().default("published"),
  publishedAt: timestamp("published_at"),
  guid: varchar("guid"),
  isExplicit: boolean("is_explicit").default(false),
  isPrivate: boolean("is_private").default(false),
  syncedAt: timestamp("synced_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBuzzsproutConnectionSchema = createInsertSchema(buzzsproutConnections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastSyncedAt: true,
  episodeCount: true,
});

export const insertBuzzsproutEpisodeSchema = createInsertSchema(buzzsproutEpisodes).omit({
  id: true,
  syncedAt: true,
  updatedAt: true,
});

export type BuzzsproutConnection = typeof buzzsproutConnections.$inferSelect;
export type InsertBuzzsproutConnection = z.infer<typeof insertBuzzsproutConnectionSchema>;
export type BuzzsproutEpisode = typeof buzzsproutEpisodes.$inferSelect;
export type InsertBuzzsproutEpisode = z.infer<typeof insertBuzzsproutEpisodeSchema>;
export type YouTubeConnection = typeof youtubeConnections.$inferSelect;
