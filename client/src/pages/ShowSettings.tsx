import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ArrowUpRight, Camera, Loader2, Mic, Plug, Rss } from "lucide-react";
import { Card, SectionHeader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { apiRequest } from "@/lib/queryClient";
import type { Podcast } from "@shared/schema";

interface BuzzsproutStatus {
  connected: boolean;
  connection?: {
    podcastTitle?: string | null;
    lastSyncedAt?: string | null;
    episodeCount?: number | null;
    status?: string | null;
  };
}

function formatLastSync(iso?: string | null) {
  if (!iso) return "Not synced yet";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Not synced yet";
  return `Last synced ${d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** Apple Podcasts wants square artwork between 1400 and 3000px. */
const ART_MIN = 1400;
const ART_MAX = 3000;

function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { reject(new Error("That file isn't an image we can read.")); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

export default function ShowSettings() {
  const [, params] = useRoute("/shows/:id/settings");
  const id = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: buzzsprout, isLoading } = useQuery<BuzzsproutStatus>({
    queryKey: ["/api/connectors/buzzsprout/status"],
  });
  const { data: podcast } = useQuery<Podcast>({
    queryKey: ["/api/podcasts", id],
    queryFn: async () => (await apiRequest("GET", `/api/podcasts/${id}`)).json(),
    enabled: !!id,
  });

  const conn =
    buzzsprout?.connected && buzzsprout.connection ? buzzsprout.connection : null;

  // ── Show details form ──────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null);
  const [artworkWarning, setArtworkWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Seed the form once the show loads (and re-seed if the user navigates to another show).
  useEffect(() => {
    if (!podcast) return;
    setTitle(podcast.title ?? "");
    setDescription(podcast.description ?? "");
    setAuthor(podcast.author ?? "");
    setWebsiteUrl(podcast.websiteUrl ?? "");
    setArtworkUrl(podcast.artworkUrl ?? null);
    setArtworkPreview(null);
    setArtworkWarning(null);
  }, [podcast?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { uploadFile, isUploading } = useUpload();

  const onPickArtwork = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Artwork must be an image", description: "Use a JPG or PNG.", variant: "destructive" });
      return;
    }
    try {
      const { width, height } = await readImageSize(file);
      if (width !== height) setArtworkWarning(`This image is ${width}×${height}. Apple Podcasts and Spotify want a square — it'll be cropped in some apps.`);
      else if (width < ART_MIN) setArtworkWarning(`This image is ${width}px. Directories want at least ${ART_MIN}×${ART_MIN} — it may be rejected or look soft.`);
      else if (width > ART_MAX) setArtworkWarning(`This image is ${width}px. Apple caps artwork at ${ART_MAX}×${ART_MAX}.`);
      else setArtworkWarning(null);
    } catch (e: any) {
      toast({ title: "Couldn't read that image", description: e?.message, variant: "destructive" });
      return;
    }
    const localPreview = URL.createObjectURL(file);
    setArtworkPreview(localPreview);
    const uploaded = await uploadFile(file);
    if (!uploaded) {
      setArtworkPreview(null);
      toast({ title: "Upload failed", description: "Try again in a moment.", variant: "destructive" });
      return;
    }
    // objectPath is the public storage URL — that's what the RSS feed serves as itunes:image.
    setArtworkUrl(uploaded.objectPath);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/podcasts/${id}`, {
        title: title.trim(),
        description: description.trim() || null,
        author: author.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
        artworkUrl,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts"] });
      toast({ title: "Show updated", description: "Your RSS feed and directories pick this up on their next refresh." });
    },
    onError: (e: any) => {
      let reason = String(e?.message || "Save failed");
      try { reason = JSON.parse(reason.replace(/^\d{3}:\s*/, "")).message || reason; } catch { reason = reason.replace(/^\d{3}:\s*/, ""); }
      toast({ title: "Couldn't save", description: reason, variant: "destructive" });
    },
  });

  const dirty =
    !!podcast &&
    (title.trim() !== (podcast.title ?? "") ||
      (description.trim() || null) !== (podcast.description ?? null) ||
      (author.trim() || null) !== (podcast.author ?? null) ||
      (websiteUrl.trim() || null) !== (podcast.websiteUrl ?? null) ||
      artworkUrl !== (podcast.artworkUrl ?? null));
  const canSave = dirty && title.trim().length > 0 && !isUploading && !saveMutation.isPending;
  const artSrc = artworkPreview ?? artworkUrl ?? null;

  return (
    <div className="w-full max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Show Settings</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Hosting, feeds, and details for this show.
      </p>

      <div className="mt-8 flex flex-col gap-8 max-w-2xl">
        {/* Show details — title, artwork, description. These feed straight into the RSS channel tags. */}
        <section>
          <SectionHeader title="Show details" />
          <Card padding="md">
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => { e.preventDefault(); if (canSave) saveMutation.mutate(); }}
            >
              <div className="flex items-start gap-5">
                <div className="relative shrink-0">
                  {artSrc ? (
                    <img src={artSrc} alt="" className="h-28 w-28 rounded-xl border border-zinc-200 object-cover" />
                  ) : (
                    <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100">
                      <Mic size={26} className="text-zinc-400" strokeWidth={1.75} />
                    </div>
                  )}
                  {isUploading && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70">
                      <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-950">Artwork</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Square JPG or PNG, 1400–3000px. This is what Apple Podcasts, Spotify, and your RSS feed show.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => { void onPickArtwork(e.target.files?.[0]); e.target.value = ""; }}
                    data-testid="input-show-artwork"
                  />
                  <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => fileInputRef.current?.click()} disabled={isUploading || !podcast}>
                    <Camera size={13} className="mr-1.5" />
                    {artSrc ? "Replace artwork" : "Upload artwork"}
                  </Button>
                  {artworkWarning && <p className="mt-2 text-xs text-amber-700">{artworkWarning}</p>}
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="show-title">Title</Label>
                <Input id="show-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Your show's name" maxLength={255} disabled={!podcast} data-testid="input-show-title" />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="show-description">Description</Label>
                <Textarea id="show-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What the show is about — this is what listeners read in Apple Podcasts and Spotify." disabled={!podcast} data-testid="input-show-description" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="show-author">Author</Label>
                  <Input id="show-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Host or network name" disabled={!podcast} data-testid="input-show-author" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="show-website">Website</Label>
                  <Input id="show-website" type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://" disabled={!podcast} data-testid="input-show-website" />
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-zinc-100 pt-4">
                <p className="text-xs text-zinc-500">
                  {dirty ? "Unsaved changes" : "Everything here is saved."}
                </p>
                <Button type="submit" size="sm" disabled={!canSave} data-testid="button-save-show">
                  {saveMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Save changes
                </Button>
              </div>
            </form>
          </Card>
        </section>

        {/* Your podcast host */}
        <section>
          <SectionHeader title="Your podcast host" />
          <Link href="/connectors">
            <Card interactive padding="md" className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 border border-zinc-200">
                <Plug size={18} className="text-zinc-500" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                {isLoading ? (
                  <p className="text-sm text-zinc-400">Checking connection…</p>
                ) : conn ? (
                  <>
                    <p className="text-sm font-medium text-zinc-950">
                      Buzzsprout
                      {conn.podcastTitle ? (
                        <span className="font-normal text-zinc-500">
                          {" "}
                          — {conn.podcastTitle}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {formatLastSync(conn.lastSyncedAt)}
                      {conn.episodeCount != null
                        ? ` · ${conn.episodeCount} episodes`
                        : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-zinc-950">
                      No podcast host connected
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Connect Buzzsprout to sync episodes and analytics automatically.
                    </p>
                  </>
                )}
              </div>
              <span className="flex items-center gap-1 text-xs font-medium text-zinc-500">
                {conn ? "Manage connection" : "Connect"}
                <ArrowUpRight size={13} strokeWidth={1.75} />
              </span>
            </Card>
          </Link>
        </section>

        {/* RSS & feeds (advanced) */}
        <section>
          <SectionHeader title="RSS & feeds (advanced)" />
          <Link href="/dashboard/rss">
            <Card interactive padding="md" className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 border border-zinc-200">
                <Rss size={18} className="text-zinc-500" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-950">Manage RSS feeds</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Import, validate, and inspect the feeds behind this show.
                </p>
              </div>
              <ArrowUpRight size={13} strokeWidth={1.75} className="text-zinc-400" />
            </Card>
          </Link>
        </section>
      </div>
    </div>
  );
}
