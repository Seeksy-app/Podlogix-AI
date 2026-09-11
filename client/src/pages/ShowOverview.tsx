import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Mic, CheckCircle2, ArrowRight, Share2, UserPlus,
  PlusCircle, Rss, DollarSign, Headphones, BarChart2,
  Clock, AlertCircle, Radio, ExternalLink,
  Pencil,
} from "lucide-react";
import { SiSpotify, SiApplepodcasts, SiAmazon } from "react-icons/si";
import { Card, CardRow, SectionHeader, TopStat, EmptyState } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { Episode, DistributionChannel, ChannelSubmission, Podcast, RssFeed } from "@shared/schema";

interface AccountAnalytics {
  followers: number;
}

const KEY_CHANNEL_IDS = ["apple", "spotify", "amazon"] as const;

const channelIcon: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  spotify: SiSpotify,
  apple: SiApplepodcasts,
  amazon: SiAmazon,
};

const statusColor: Record<string, string> = {
  approved: "text-emerald-600",
  submitted: "text-amber-600",
  pending: "text-amber-600",
  rejected: "text-red-600",
  not_submitted: "text-zinc-400",
};

const statusLabel: Record<string, string> = {
  approved: "Live",
  submitted: "Submitted",
  pending: "Pending",
  rejected: "Rejected",
  not_submitted: "Not Submitted",
};

function DistStatusIcon({ status }: { status: string }) {
  if (status === "approved") return <CheckCircle2 size={13} className="text-emerald-500" />;
  if (status === "submitted" || status === "pending") return <Clock size={13} className="text-amber-500" />;
  if (status === "rejected") return <AlertCircle size={13} className="text-red-500" />;
  return <Radio size={13} className="text-zinc-300" />;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ShowOverview() {
  const { id } = useParams<{ id: string }>();
  const isHostSynced = id === "buzzsprout";

  const { data: podcast } = useQuery<Podcast>({
    queryKey: ["/api/podcasts", id],
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/${id}`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
    enabled: !!id && !isHostSynced,
    retry: false,
  });

  const { data: hostStatus } = useQuery<{
    connected: boolean;
    connection?: { id: string; podcastTitle?: string | null; podcastArtworkUrl?: string | null };
  }>({
    queryKey: ["/api/connectors/buzzsprout/status"],
    enabled: isHostSynced,
    retry: false,
  });

  const { data: hostEpisodes } = useQuery<{ episodes: Array<{ id: string; title: string; publishedAt: string | null; artworkUrl?: string | null }> }>({
    queryKey: ["/api/connectors/buzzsprout/episodes"],
    enabled: isHostSynced,
    retry: false,
  });

  const { data: nativeEpisodes, isLoading: episodesLoading } = useQuery<Episode[]>({
    queryKey: ["/api/podcasts", id, "episodes"],
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/${id}/episodes`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
    enabled: !!id && !isHostSynced,
    retry: false,
  });

  const episodes: Episode[] = isHostSynced
    ? ((hostEpisodes?.episodes ?? []) as unknown as Episode[])
    : Array.isArray(nativeEpisodes) ? nativeEpisodes : [];

  const showTitle = isHostSynced ? hostStatus?.connection?.podcastTitle : podcast?.title;
  const showArtwork = isHostSynced ? hostStatus?.connection?.podcastArtworkUrl : podcast?.artworkUrl;
  const guestShowId = isHostSynced
    ? hostStatus?.connection?.id ? `buzzsprout:${hostStatus.connection.id}` : ""
    : id ?? "";

  const { data: rssFeeds } = useQuery<RssFeed[]>({
    queryKey: ["/api/podcasts", id, "rss"],
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/${id}/rss`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id && !isHostSynced,
    retry: false,
  });

  const { data: channels } = useQuery<DistributionChannel[]>({
    queryKey: ["/api/distribution/channels"],
  });

  const { data: submissions } = useQuery<ChannelSubmission[]>({
    queryKey: ["/api/podcasts", id, "distribution"],
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/${id}/distribution`);
      return res.json();
    },
    enabled: !!id,
  });

  const { data: guestPipeline } = useQuery<Array<{ id: string }>>({
    queryKey: ["/api/podcasts", guestShowId, "guests"],
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/${encodeURIComponent(guestShowId)}/guests`);
      if (!res.ok) throw new Error("guest pipeline unavailable");
      return res.json();
    },
    enabled: Boolean(guestShowId),
    retry: false,
  });

  const { data: promotion } = useQuery<{ accounts: AccountAnalytics[] }>({
    queryKey: ["/api/social-analytics/my-accounts-cached"],
    retry: false,
  });

  const recentEpisodes = useMemo(
    () =>
      [...episodes]
        .sort((a, b) => {
          const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
          const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
          return tb - ta;
        })
        .slice(0, 5),
    [episodes]
  );

  const feedsList = Array.isArray(rssFeeds) ? rssFeeds : [];
  const isImportedFromRss = feedsList.some((f) => f.sourceType === "existing");
  const podlogixFeed = feedsList.find((f) => f.sourceType === "podlogix");
  const rssFeedUrl = podlogixFeed?.feedUrl ?? (id ? `${window.location.origin}/feeds/${id}/feed.xml` : "");
  const hasActiveFeed = feedsList.length > 0;

  const keyChannels = KEY_CHANNEL_IDS.map((cid) => ({
    channel: (Array.isArray(channels) ? channels : []).find((c) => c.id === cid),
    submission: (Array.isArray(submissions) ? submissions : []).find((s) => s.channelId === cid),
  })).filter((x) => x.channel);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
  };

  return (
    <div className="w-full max-w-[1600px] px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3.5">
          {/* Artwork + title open Show Settings, where both are editable. Host-synced
              shows are read-only here (their metadata lives at the host). */}
          <Link
            href={`/shows/${id}/settings`}
            className={`group flex items-center gap-4 rounded-xl ${isHostSynced ? "pointer-events-none" : ""}`}
            title={isHostSynced ? undefined : "Edit title and artwork"}
            aria-label="Edit show details"
          >
            <span className="relative shrink-0">
              {showArtwork ? (
                <img
                  src={showArtwork}
                  alt=""
                  className="h-14 w-14 rounded-xl border border-zinc-200 object-cover"
                />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100">
                  <Mic size={20} className="text-zinc-400" strokeWidth={1.75} />
                </span>
              )}
              {!isHostSynced && (
                <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                  <Pencil size={11} />
                </span>
              )}
            </span>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
              {isHostSynced ? (showTitle || "Overview") : (
                <Link href={`/shows/${id}/settings`} className="rounded decoration-zinc-300 underline-offset-4 hover:underline" title="Edit title and artwork">
                  {showTitle || "Overview"}
                </Link>
              )}
            </h1>
            {isImportedFromRss ? (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                <Rss size={10} /> Imported from RSS
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" asChild>
            <Link href={`/shows/${id}/episodes`}>
              <PlusCircle size={13} className="mr-1.5" /> Create Episode
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={handleShare}>
            <Share2 size={13} className="mr-1.5" /> Share
          </Button>
          {rssFeedUrl ? (
            <Button size="sm" variant="outline" asChild>
              <a href={rssFeedUrl} target="_blank" rel="noreferrer">
                <Rss size={13} className="mr-1.5" /> RSS Feed
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {/* ── Stat strip ── */}
      <section className="mt-6">
        <Card className="grid grid-cols-2 divide-x divide-y divide-zinc-100 overflow-hidden sm:grid-cols-4 sm:divide-y-0">
          <TopStat label="Total Episodes" value={String(episodes.length)} icon={Mic} href={`/shows/${id}/episodes`} />
          <TopStat label="Total Listens" value="0" icon={Headphones} href={`/shows/${id}/stats`} />
          <TopStat label="Est. Revenue" value="$0.00" icon={DollarSign} href={`/shows/${id}/monetization`} />
          <TopStat label="Ad Impressions" value="0" icon={BarChart2} href={`/shows/${id}/stats`} />
        </Card>
      </section>

      {/* ── Guests ── */}
      {guestShowId ? (
        <section className="mt-6">
          <SectionHeader title="Guests" action={{ label: "Open pipeline", href: `/guests?showId=${encodeURIComponent(guestShowId)}` }} />
          <Card padding="lg" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50">
                <UserPlus size={17} className="text-orange-600" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-950">{guestPipeline?.length ?? 0} guest{guestPipeline?.length === 1 ? "" : "s"} in this show's pipeline</p>
                <p className="text-xs text-zinc-500">Research candidates before spending IC credits on social enrichment.</p>
              </div>
            </div>
            <Link href={`/social/discover?showId=${encodeURIComponent(guestShowId)}`} className="text-sm font-medium text-orange-600 hover:text-orange-700">
              Find guests →
            </Link>
          </Card>
        </section>
      ) : null}

      {/* ── Recent Episodes ── */}
      <section className="mt-6">
        <SectionHeader title="Recent Episodes" action={{ label: "All episodes", href: `/shows/${id}/episodes` }} />
        {episodesLoading ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : recentEpisodes.length === 0 ? (
          <EmptyState
            icon={Mic}
            title="No episodes yet"
            description="Import an RSS feed or upload your first episode to see it here."
            action={{ label: "Add episodes", href: `/shows/${id}/episodes` }}
          />
        ) : (
          <Card className="divide-y divide-zinc-100 overflow-hidden">
            {recentEpisodes.map((ep) => {
              const duration = formatDuration((ep as any).durationSeconds);
              const isPublished = ep.status === "published" || isHostSynced;
              return (
                <Link key={ep.id} href={`/episodes/${ep.id}`}>
                  <CardRow className="cursor-pointer px-4 py-3 hover:bg-zinc-50/60">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 overflow-hidden">
                      {ep.artworkUrl ? (
                        <img src={ep.artworkUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Mic size={14} className="text-zinc-400" strokeWidth={1.75} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-950">{ep.title}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                        <span>{ep.publishedAt ? new Date(ep.publishedAt).toLocaleDateString() : "Draft"}</span>
                        {duration ? <><span className="text-zinc-200">·</span><span>{duration}</span></> : null}
                        <span className="text-zinc-200">·</span>
                        <span>0 listens</span>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${isPublished ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-500"}`}>
                      {isPublished ? "Published" : "Draft"}
                    </span>
                    <ArrowRight size={14} className="shrink-0 text-zinc-300" />
                  </CardRow>
                </Link>
              );
            })}
          </Card>
        )}
      </section>

      {/* ── Distribution Status ── */}
      <section className="mt-6">
        <SectionHeader title="Distribution Status" action={{ label: "Manage", href: `/shows/${id}/directories` }} />
        <Card className="divide-y divide-zinc-100 overflow-hidden">
          {keyChannels.map(({ channel, submission }) => {
            const status = submission?.status ?? "not_submitted";
            const Icon = channelIcon[channel!.id] ?? Radio;
            return (
              <div key={channel!.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                  <Icon size={15} />
                </div>
                <span className="flex-1 text-sm font-medium text-zinc-950">{channel!.name}</span>
                <div className="flex items-center gap-1.5">
                  <DistStatusIcon status={status} />
                  <span className={`text-xs font-medium ${statusColor[status]}`}>{statusLabel[status]}</span>
                </div>
                {submission?.externalUrl ? (
                  <a href={submission.externalUrl} target="_blank" rel="noreferrer" className="ml-2 text-zinc-400 hover:text-zinc-600">
                    <ExternalLink size={13} />
                  </a>
                ) : null}
              </div>
            );
          })}
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
              <Rss size={15} />
            </div>
            <span className="flex-1 text-sm font-medium text-zinc-950">RSS Feed</span>
            <div className="flex items-center gap-1.5">
              {hasActiveFeed ? (
                <>
                  <CheckCircle2 size={13} className="text-emerald-500" />
                  <span className="text-xs font-medium text-emerald-600">Active</span>
                </>
              ) : (
                <>
                  {/* The hosted feed is generated on request, so it's live for every show;
                      "Active" above means it's been registered for directory submission. */}
                  <CheckCircle2 size={13} className="text-zinc-400" />
                  <span className="text-xs font-medium text-zinc-500" title={rssFeedUrl}>Ready — not submitted yet</span>
                </>
              )}
            </div>
            {rssFeedUrl && hasActiveFeed ? (
              <a href={rssFeedUrl} target="_blank" rel="noreferrer" className="ml-2 text-zinc-400 hover:text-zinc-600">
                <ExternalLink size={13} />
              </a>
            ) : null}
          </div>
        </Card>
      </section>
    </div>
  );
}
