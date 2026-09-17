import { useState, useEffect, useRef } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Mic,
  Headphones,
  Rss,
  Sparkles,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  LogOut,
  Bookmark,
  BookOpen,
  Bell,
  BarChart3,
  Search,
  Play,
  Pause,
  Volume2,
  FileText,
  Filter,
  ArrowUpDown,
  CheckSquare,
  Zap,
  Settings,
  Tag,
  Trash2,
  RefreshCw,
  Loader2,
  ExternalLink,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  ListMusic,
  MessageCircle,
  X,
  Send,
  Download,
  Copy,
  MoreHorizontal,
  RotateCw
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EpisodeAskSheet } from "@/components/listener/EpisodeAskSheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SiSpotify } from "react-icons/si";

interface PodcastSubscription {
  id: string;
  title: string;
  author: string | null;
  description: string | null;
  artworkUrl: string | null;
  feedUrl: string;
  spotifyShowId: string | null;
  isActive: boolean;
  createdAt: string;
}

interface SubscriptionEpisode {
  id: string;
  subscriptionId: string;
  title: string;
  description: string | null;
  audioUrl: string | null;
  duration: number | null;
  publishedAt: string | null;
  transcriptStatus: string;
  briefingStatus: string;
  isRead: boolean;
}

interface UserInterest {
  id: string;
  topic: string;
  keywords: string[] | null;
  priority: string;
  isActive: boolean;
}

interface EpisodeBriefing {
  id: string;
  episodeId: string;
  summary: string;
  keyTakeaways: string[] | null;
  relevantQuotes: string[] | null;
  personalInsights: string[] | null;
  matchedInterests: string[] | null;
  relevanceScore: number;
  isBookmarked: boolean;
  createdAt: string;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  isRead: boolean;
  createdAt: string;
}

interface SpotifyShow {
  id: string;
  name: string;
  publisher: string;
  description: string;
  imageUrl: string | null;
  totalEpisodes: number;
}

export default function ListenerDashboard() {
  const [location, navigate] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated, logout } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [rssFeedUrl, setRssFeedUrl] = useState("");
  const [isAddPodcastOpen, setIsAddPodcastOpen] = useState(false);
  const [isAddInterestOpen, setIsAddInterestOpen] = useState(false);
  const [newInterest, setNewInterest] = useState({ topic: "", keywords: "", priority: "medium" });
  const [selectedEpisode, setSelectedEpisode] = useState<SubscriptionEpisode | null>(null);
  // The transcript viewer: opened per episode, fetched on demand (transcripts
  // are long; the episode list query deliberately doesn't carry them).
  const [transcriptEpisode, setTranscriptEpisode] = useState<SubscriptionEpisode | null>(null);
  const [askEpisode, setAskEpisode] = useState<SubscriptionEpisode | null>(null);
  const transcriptQuery = useQuery<{ id: string; title: string; transcript: string; wordCount: number }>({
    queryKey: ['/api/listener/episodes', transcriptEpisode?.id, 'transcript'],
    queryFn: async () => (await apiRequest('GET', `/api/listener/episodes/${transcriptEpisode!.id}/transcript`)).json(),
    enabled: !!transcriptEpisode,
  });
  const [playingEpisodeId, setPlayingEpisodeId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [episodeSort, setEpisodeSort] = useState<'newest' | 'oldest' | 'unread'>('newest');
  const [episodeFilter, setEpisodeFilter] = useState<string>('all');
  const [selectedEpisodeIds, setSelectedEpisodeIds] = useState<Set<string>>(new Set());
  const [expandedPodcastId, setExpandedPodcastId] = useState<string | null>(null);
  const [spotifyPlaylistPodcasts, setSpotifyPlaylistPodcasts] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('spotifyPlaylistPodcasts');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  // AI Chat state
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiEndRef = useRef<HTMLDivElement | null>(null);

  const { data: subscriptions = [], isLoading: subsLoading } = useQuery<PodcastSubscription[]>({
    queryKey: ['/api/listener/subscriptions'],
    enabled: isAuthenticated,
  });

  const { data: episodes = [], isLoading: episodesLoading } = useQuery<SubscriptionEpisode[]>({
    queryKey: ['/api/listener/episodes'],
    enabled: isAuthenticated,
  });

  const { data: interests = [] } = useQuery<UserInterest[]>({
    queryKey: ['/api/listener/interests'],
    enabled: isAuthenticated,
  });

  const { data: briefings = [] } = useQuery<EpisodeBriefing[]>({
    queryKey: ['/api/listener/briefings'],
    enabled: isAuthenticated,
  });

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ['/api/listener/notifications'],
    enabled: isAuthenticated,
  });

  const { data: spotifyStatus, refetch: refetchSpotifyStatus } = useQuery<{ 
    connected: boolean; 
    displayName: string | null;
    spotifyUserId: string | null;
  }>({
    queryKey: ['/api/listener/spotify/status'],
    enabled: isAuthenticated,
  });

  const { data: spotifyShows = [], isLoading: spotifyLoading } = useQuery<SpotifyShow[]>({
    queryKey: ['/api/listener/spotify/shows'],
    enabled: isAuthenticated && spotifyStatus?.connected,
  });

  const connectSpotifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('GET', '/api/listener/spotify/auth');
      return res.json();
    },
    onSuccess: (data: { authUrl: string }) => {
      window.location.href = data.authUrl;
    },
    onError: () => {
      toast({ title: "Connection failed", description: "Could not connect to Spotify", variant: "destructive" });
    },
  });

  const disconnectSpotifyMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('DELETE', '/api/listener/spotify/disconnect');
    },
    onSuccess: () => {
      refetchSpotifyStatus();
      queryClient.invalidateQueries({ queryKey: ['/api/listener/spotify/shows'] });
      toast({ title: "Disconnected", description: "Spotify account disconnected" });
    },
    onError: () => {
      toast({ title: "Disconnect failed", description: "Could not disconnect Spotify", variant: "destructive" });
    },
  });

  const searchSpotifyMutation = useMutation({
    mutationFn: async (query: string) => {
      const res = await apiRequest('GET', `/api/listener/spotify/search?q=${encodeURIComponent(query)}`);
      return res.json();
    },
  });

  const importFromSpotifyMutation = useMutation({
    mutationFn: async (showId: string) => {
      const res = await apiRequest('POST', '/api/listener/spotify/import', { showId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listener/subscriptions'] });
      toast({ title: "Podcast imported", description: "Successfully imported from Spotify" });
    },
    onError: () => {
      toast({ title: "Import failed", description: "Could not import podcast", variant: "destructive" });
    },
  });

  const subscribeRssMutation = useMutation({
    mutationFn: async (feedUrl: string) => {
      const res = await apiRequest('POST', '/api/listener/subscriptions', { feedUrl });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listener/subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/listener/episodes'] });
      setRssFeedUrl("");
      setIsAddPodcastOpen(false);
      toast({ title: "Subscribed!", description: "Successfully subscribed to podcast" });
    },
    onError: () => {
      toast({ title: "Subscription failed", description: "Could not subscribe to podcast feed", variant: "destructive" });
    },
  });

  const unsubscribeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/listener/subscriptions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listener/subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/listener/episodes'] });
      toast({ title: "Unsubscribed", description: "Removed from your subscriptions" });
    },
  });

  const addInterestMutation = useMutation({
    mutationFn: async (data: { topic: string; keywords: string[]; priority: string }) => {
      const res = await apiRequest('POST', '/api/listener/interests', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listener/interests'] });
      setNewInterest({ topic: "", keywords: "", priority: "medium" });
      setIsAddInterestOpen(false);
      toast({ title: "Interest added", description: "AI will now track this topic in your podcasts" });
    },
  });

  const deleteInterestMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/listener/interests/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listener/interests'] });
      toast({ title: "Interest removed" });
    },
  });

  // Which episode is transcribing right now, and how far in. A full episode
  // takes minutes and several server round-trips, so the row it was started
  // from has to show that on its own — a shared "isPending" flag just greys
  // every button out and reads as a dead click.
  const [transcribing, setTranscribing] = useState<{ id: string; done: number; total: number } | null>(null);

  const transcribeMutation = useMutation({
    mutationFn: async (episodeId: string) => {
      setTranscribing({ id: episodeId, done: 0, total: 0 });
      // The server transcribes as many parts as fit in one invocation and
      // reports progress; keep asking until it says the episode is done.
      for (let pass = 0; pass < 20; pass++) {
        const res = await apiRequest('POST', `/api/listener/episodes/${episodeId}/transcribe`);
        const data = await res.json();
        setTranscribing({ id: episodeId, done: data.partsDone ?? 0, total: data.partsTotal ?? 0 });
        queryClient.invalidateQueries({ queryKey: ['/api/listener/episodes'] });
        if (data.status === 'completed') return data;
      }
      throw new Error('Transcription is taking longer than expected — open the episode again to resume it.');
    },
    onSuccess: () => {
      setTranscribing(null);
      queryClient.invalidateQueries({ queryKey: ['/api/listener/episodes'] });
      toast({ title: "Transcript ready", description: "Open it, download it, or search across all your transcripts." });
    },
    onError: (error: any) => {
      setTranscribing(null);
      queryClient.invalidateQueries({ queryKey: ['/api/listener/episodes'] });
      // apiRequest surfaces the server message as "500: {json}" — pull the reason out.
      let reason = String(error?.message || "Transcription failed");
      try { reason = JSON.parse(reason.replace(/^\d{3}:\s*/, "")).message || reason; } catch { reason = reason.replace(/^\d{3}:\s*/, ""); }
      toast({ title: "Couldn't transcribe this episode", description: reason, variant: "destructive" });
    },
  });

  // Tell the person the wait is expected, and roughly how far along it is.
  const startTranscribe = (episodeId: string, title?: string) => {
    if (transcribeMutation.isPending) {
      toast({ title: "One at a time", description: "Another episode is still transcribing — it'll finish in a few minutes." });
      return;
    }
    toast({ title: "Transcribing…", description: `${title ? `"${title}"` : 'This episode'} takes a few minutes. Keep this tab open.` });
    transcribeMutation.mutate(episodeId);
  };

  const generateBriefingMutation = useMutation({
    mutationFn: async (episodeId: string) => {
      const res = await apiRequest('POST', `/api/listener/episodes/${episodeId}/briefing`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listener/briefings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/listener/episodes'] });
      toast({ title: "Briefing generation started", description: "Your personalized briefing is being created" });
    },
  });

  const markNotificationsReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('PATCH', '/api/listener/notifications/read-all');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listener/notifications'] });
    },
  });

  const syncEpisodesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/listener/sync');
      return res.json();
    },
    onSuccess: (data: { synced: number; newEpisodes: number }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/listener/episodes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/listener/subscriptions'] });
      toast({ 
        title: "Sync complete", 
        description: `Found ${data.newEpisodes} new episodes from ${data.synced} podcasts` 
      });
    },
    onError: () => {
      toast({ title: "Sync failed", variant: "destructive" });
    },
  });

  const autoBriefingsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/listener/auto-briefings', { maxEpisodes: 3 });
      return res.json();
    },
    onSuccess: (data: { processed: number; briefings: number }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/listener/episodes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/listener/briefings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/listener/notifications'] });
      toast({ 
        title: "Auto-briefings complete", 
        description: `Generated ${data.briefings} briefings from ${data.processed} episodes` 
      });
    },
    onError: () => {
      toast({ title: "Auto-briefings failed", variant: "destructive" });
    },
  });

  const createPlaylistMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/listener/spotify/playlist', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create playlist');
      return data;
    },
    onSuccess: (data: { externalUrl: string }) => {
      toast({
        title: "Playlist created!",
        description: "Podlogix Recommendations playlist is ready in Spotify"
      });
    },
    onError: (error: any) => {
      toast({ title: "Spotify playlist error", description: error.message, variant: "destructive" });
    },
  });

  const addToPlaylistMutation = useMutation({
    mutationFn: async ({ episodeId, podcastName, episodeTitle }: { episodeId: string; podcastName: string; episodeTitle: string }) => {
      const res = await fetch('/api/listener/spotify/playlist/add', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, podcastName, episodeTitle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to add to playlist');
      return data;
    },
    onSuccess: () => {
      toast({ title: "Added to playlist!", description: "Episode added to Podlogix Recommendations" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add to playlist", description: error.message, variant: "destructive" });
    },
  });

  const addNewEpisodesToPlaylistMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/listener/spotify/playlist/add-new', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to add episodes');
      return data;
    },
    onSuccess: (data: { addedCount: number; totalAttempted: number; playlistUrl: string }) => {
      toast({ 
        title: "Episodes added!", 
        description: `Added ${data.addedCount} of ${data.totalAttempted} new episodes to your playlist` 
      });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add episodes", description: error.message, variant: "destructive" });
    },
  });

  const syncSmartPlaylistMutation = useMutation({
    mutationFn: async (subscriptionIds: string[]) => {
      const res = await fetch('/api/listener/spotify/playlist/sync-smart', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to sync playlist');
      return data;
    },
    onSuccess: (data: { addedCount: number; playlistUrl: string }) => {
      toast({
        title: "Smart playlist synced!",
        description: `Added ${data.addedCount} episode${data.addedCount !== 1 ? 's' : ''} from your marked podcasts`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
    },
  });

  const togglePlaylistPodcast = (subId: string) => {
    setSpotifyPlaylistPodcasts(prev => {
      const next = new Set(prev);
      if (next.has(subId)) {
        next.delete(subId);
      } else {
        next.add(subId);
      }
      try {
        localStorage.setItem('spotifyPlaylistPodcasts', JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const toggleBookmarkMutation = useMutation({
    mutationFn: async (briefingId: string) => {
      const res = await apiRequest('PATCH', `/api/listener/briefings/${briefingId}/bookmark`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/listener/briefings'] });
      toast({ 
        title: data.isBookmarked ? "Briefing saved!" : "Briefing unsaved",
        description: data.isBookmarked ? "Added to your saved briefings" : "Removed from saved briefings"
      });
    },
    onError: () => {
      toast({ title: "Failed to save briefing", variant: "destructive" });
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('spotify_connected') === 'true') {
      toast({ title: "Spotify connected!", description: "You can now import your followed podcasts" });
      refetchSpotifyStatus();
      window.history.replaceState({}, '', '/listener');
    }
    if (params.get('spotify_error')) {
      const errorType = params.get('spotify_error');
      const detail = params.get('spotify_error_detail');
      const message = errorType === 'missing_params'
        ? 'Authorization parameters missing'
        : errorType === 'not_authenticated'
        ? 'Session expired — please log in again'
        : detail
        ? decodeURIComponent(detail)
        : 'Failed to connect Spotify account';
      toast({ title: "Spotify connection failed", description: message, variant: "destructive" });
      window.history.replaceState({}, '', '/listener');
    }
  }, [location, toast, refetchSpotifyStatus]);

  if (authLoading) {
    return (
      <div className="min-h-full bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const unreadNotifications = notifications.filter(n => !n.isRead);
  const recentBriefings = briefings.slice(0, 5);

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  };

  const togglePlayEpisode = (episode: SubscriptionEpisode) => {
    if (!episode.audioUrl) return;
    
    if (playingEpisodeId === episode.id) {
      audioRef.current?.pause();
      setPlayingEpisodeId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = episode.audioUrl;
        audioRef.current.play();
      }
      setPlayingEpisodeId(episode.id);
    }
  };

  const getPodcastName = (subscriptionId: string) => {
    const sub = subscriptions.find(s => s.id === subscriptionId);
    return sub?.title || 'Unknown Podcast';
  };

  const toggleEpisodeSelection = (episodeId: string) => {
    setSelectedEpisodeIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(episodeId)) {
        newSet.delete(episodeId);
      } else {
        newSet.add(episodeId);
      }
      return newSet;
    });
  };

  const selectAllEpisodes = () => {
    if (selectedEpisodeIds.size === filteredEpisodes.length) {
      setSelectedEpisodeIds(new Set());
    } else {
      setSelectedEpisodeIds(new Set(filteredEpisodes.map(e => e.id)));
    }
  };

  const filteredEpisodes = episodes
    .filter(ep => episodeFilter === 'all' || ep.subscriptionId === episodeFilter)
    .sort((a, b) => {
      if (episodeSort === 'unread') {
        if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
      }
      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return episodeSort === 'oldest' ? dateA - dateB : dateB - dateA;
    });

  // Scroll AI chat to bottom when messages change
  useEffect(() => {
    aiEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

  const sendAiMessage = async () => {
    if (!aiInput.trim() || aiLoading) return;
    const userMsg = aiInput.trim();
    setAiInput('');
    setAiMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setAiLoading(true);
    try {
      const context = `The user listens to these podcasts: ${subscriptions.map(s => s.title).join(', ')}. They have ${episodes.filter(e => !e.isRead).length} unread episodes and ${briefings.length} briefings.`;
      const res = await fetch('/api/listener/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, context, history: aiMessages.slice(-10) }),
      });
      const data = await res.json();
      setAiMessages(prev => [...prev, { role: 'assistant', content: data.response || data.message || 'Sorry, I could not get a response.' }]);
    } catch {
      setAiMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setAiLoading(false);
    }
  };

  const batchBriefingMutation = useMutation({
    mutationFn: async (episodeIds: string[]) => {
      const results = [];
      for (const id of episodeIds) {
        const res = await apiRequest('POST', `/api/listener/episodes/${id}/transcribe`);
        results.push(await res.json());
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listener/episodes'] });
      setSelectedEpisodeIds(new Set());
      toast({ title: "Processing started", description: `Transcribing ${selectedEpisodeIds.size} episodes for briefings` });
    },
    onError: () => {
      toast({ title: "Failed to start batch processing", variant: "destructive" });
    },
  });

  return (
    <div className="min-h-full bg-background">
      <main className="px-6 py-6 space-y-6">
        {/* Compact action row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold" data-testid="text-welcome">Podcast Briefings</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncEpisodesMutation.mutate()}
                  disabled={syncEpisodesMutation.isPending}
                  data-testid="button-sync"
                >
                  {syncEpisodesMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Sync
                </Button>
              </TooltipTrigger>
              <TooltipContent>Check all podcasts for new episodes</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => autoBriefingsMutation.mutate()}
                  disabled={autoBriefingsMutation.isPending || interests.length === 0}
                  data-testid="button-auto-briefings"
                >
                  {autoBriefingsMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Auto Briefings
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {interests.length === 0
                  ? "Add interests first to generate briefings"
                  : "Automatically transcribe and generate briefings for new episodes"}
              </TooltipContent>
            </Tooltip>
            <Dialog open={isAddPodcastOpen} onOpenChange={setIsAddPodcastOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-podcast">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Podcast
                </Button>
              </DialogTrigger>
                <DialogContent className="max-w-lg overflow-hidden">
                  <DialogHeader>
                    <DialogTitle>Add Podcast</DialogTitle>
                    <DialogDescription>
                      Import from Spotify or subscribe via RSS feed
                    </DialogDescription>
                  </DialogHeader>
                  <Tabs defaultValue="rss" className="mt-4 min-w-0 w-full">
                    <TabsList className="grid grid-cols-2 w-full">
                      <TabsTrigger value="rss">
                        <Rss className="h-4 w-4 mr-2" />
                        RSS Feed
                      </TabsTrigger>
                      <TabsTrigger value="spotify" disabled={!spotifyStatus?.connected}>
                        <SiSpotify className="h-4 w-4 mr-2" />
                        Spotify
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="rss" className="space-y-4 mt-4 min-w-0">
                      <div className="space-y-2">
                        <Label htmlFor="rss-url">RSS Feed URL</Label>
                        <Input
                          id="rss-url"
                          placeholder="https://example.com/feed.xml"
                          value={rssFeedUrl}
                          onChange={(e) => setRssFeedUrl(e.target.value)}
                          data-testid="input-rss-url"
                        />
                      </div>
                      <Button 
                        onClick={() => subscribeRssMutation.mutate(rssFeedUrl)}
                        disabled={!rssFeedUrl || subscribeRssMutation.isPending}
                        className="w-full"
                        data-testid="button-subscribe-rss"
                      >
                        {subscribeRssMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Subscribe
                      </Button>
                    </TabsContent>
                    <TabsContent value="spotify" className="space-y-4 mt-4 min-w-0">
                      {spotifyStatus?.connected ? (
                        <>
                          <div className="space-y-2">
                            <Label>Search Spotify</Label>
                            <div className="flex min-w-0 gap-2">
                              <Input
                                placeholder="Search podcasts..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && searchQuery && !searchSpotifyMutation.isPending) searchSpotifyMutation.mutate(searchQuery);
                                }}
                                className="min-w-0 flex-1"
                                data-testid="input-spotify-search"
                              />
                              <Button
                                variant="outline"
                                className="shrink-0"
                                onClick={() => searchSpotifyMutation.mutate(searchQuery)}
                                disabled={!searchQuery || searchSpotifyMutation.isPending}
                              >
                                {searchSpotifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {searchSpotifyMutation.data ? "Search results" : "Shows you follow on Spotify — or search for any show"}
                            </p>
                          </div>
                          {/* Plain overflow container, not Radix ScrollArea: its viewport
                              wrapper sizes to the content's intrinsic width, which let long
                              titles push rows past the dialog's edge. */}
                          <div className="max-h-64 min-w-0 space-y-2 overflow-y-auto overflow-x-hidden pr-1">
                            {((searchSpotifyMutation.data as SpotifyShow[] | undefined) ?? spotifyShows).length === 0 && (
                              <p className="py-8 text-center text-sm text-muted-foreground">
                                {searchSpotifyMutation.data ? "No shows matched — try another name." : "No followed shows yet. Search for one above."}
                              </p>
                            )}
                            {((searchSpotifyMutation.data as SpotifyShow[] | undefined) ?? spotifyShows).map((show: SpotifyShow) => (
                              <div key={show.id} className="flex min-w-0 items-center gap-3 rounded-lg border p-2">
                                <Avatar className="h-10 w-10 shrink-0 rounded">
                                  <AvatarImage src={show.imageUrl || undefined} />
                                  <AvatarFallback><Mic className="h-4 w-4" /></AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium">{show.name}</p>
                                  <p className="truncate text-xs text-muted-foreground">{show.publisher}</p>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="shrink-0"
                                  onClick={() => importFromSpotifyMutation.mutate(show.id)}
                                  disabled={importFromSpotifyMutation.isPending}
                                  aria-label={`Add ${show.name}`}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-8">
                          <SiSpotify className="h-12 w-12 mx-auto text-green-500 mb-4" />
                          <p className="text-muted-foreground mb-4">Connect your Spotify account to import podcasts</p>
                          <Button 
                            variant="outline" 
                            onClick={() => connectSpotifyMutation.mutate()}
                            disabled={connectSpotifyMutation.isPending}
                            data-testid="button-connect-spotify"
                          >
                            {connectSpotifyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            <SiSpotify className="h-4 w-4 mr-2" />
                            Connect Spotify
                          </Button>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div
            className="rounded-xl border bg-card p-4 cursor-pointer hover:border-primary/40 transition-colors"
            onClick={() => {/* navigate to podcasts tab */}}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Rss className="h-4 w-4 text-primary" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Podcasts</span>
            </div>
            <p className="text-4xl font-black text-foreground leading-none">{subscriptions.length}</p>
            <p className="text-sm text-muted-foreground mt-1">subscribed</p>
          </div>

          <div className="rounded-xl border bg-card p-4 cursor-pointer hover:border-orange-400/40 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <Play className="h-4 w-4 text-orange-500" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Episodes</span>
            </div>
            <p className="text-4xl font-black text-foreground leading-none">{episodes.filter(e => !e.isRead).length}</p>
            <p className="text-sm text-muted-foreground mt-1">unread</p>
          </div>

          <div className="rounded-xl border bg-card p-4 cursor-pointer hover:border-violet-400/40 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <Sparkles className="h-4 w-4 text-violet-500" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Briefings</span>
            </div>
            <p className="text-4xl font-black text-foreground leading-none">{briefings.length}</p>
            <p className="text-sm text-muted-foreground mt-1">generated</p>
          </div>

          <div className="rounded-xl border bg-card p-4 cursor-pointer hover:border-green-400/40 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <SiSpotify className="h-4 w-4 text-green-500" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Spotify</span>
            </div>
            <p className="text-4xl font-black text-foreground leading-none">{spotifyPlaylistPodcasts.size}</p>
            <p className="text-sm text-muted-foreground mt-1">in smart playlist</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Tabs defaultValue="subscriptions" className="w-full">
              <TabsList className="grid grid-cols-3 w-full max-w-md">
                <TabsTrigger value="subscriptions" data-testid="tab-subscriptions">
                  <Rss className="h-4 w-4 mr-2" />
                  Podcasts
                </TabsTrigger>
                <TabsTrigger value="briefings" data-testid="tab-briefings">
                  <BookOpen className="h-4 w-4 mr-2" />
                  Briefings
                </TabsTrigger>
                <TabsTrigger value="episodes" data-testid="tab-episodes">
                  <Play className="h-4 w-4 mr-2" />
                  Episodes
                </TabsTrigger>
              </TabsList>

              <TabsContent value="episodes" className="mt-6 space-y-4">
                {/* Sort, Filter, and Batch Actions */}
                <div className="flex flex-wrap items-center gap-3 pb-2">
                  <Select value={episodeSort} onValueChange={(v) => setEpisodeSort(v as 'newest' | 'oldest' | 'unread')}>
                    <SelectTrigger className="w-[140px]" data-testid="select-sort">
                      <ArrowUpDown className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest First</SelectItem>
                      <SelectItem value="oldest">Oldest First</SelectItem>
                      <SelectItem value="unread">Unread First</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={episodeFilter} onValueChange={setEpisodeFilter}>
                    <SelectTrigger className="w-[180px]" data-testid="select-filter">
                      <Filter className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Filter" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Podcasts</SelectItem>
                      {subscriptions.map(sub => (
                        <SelectItem key={sub.id} value={sub.id}>{sub.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={selectAllEpisodes}
                    data-testid="button-select-all"
                  >
                    <CheckSquare className="h-4 w-4 mr-2" />
                    {selectedEpisodeIds.size === filteredEpisodes.length ? 'Deselect All' : 'Select All'}
                  </Button>

                  {selectedEpisodeIds.size > 0 && (
                    <Button 
                      onClick={() => batchBriefingMutation.mutate(Array.from(selectedEpisodeIds))}
                      disabled={batchBriefingMutation.isPending}
                      data-testid="button-batch-brief"
                    >
                      {batchBriefingMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Brief {selectedEpisodeIds.size} Episode{selectedEpisodeIds.size > 1 ? 's' : ''}
                    </Button>
                  )}
                </div>

                {episodesLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
                  </div>
                ) : filteredEpisodes.length === 0 ? (
                  <Card className="p-8 text-center">
                    <Play className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-semibold mb-2">No episodes yet</h3>
                    <p className="text-muted-foreground text-sm">Subscribe to podcasts to see their latest episodes here</p>
                  </Card>
                ) : (
                  filteredEpisodes.map((episode) => (
                    <Card key={episode.id} className={`hover-elevate ${!episode.isRead ? 'border-primary/30' : ''} ${selectedEpisodeIds.has(episode.id) ? 'ring-2 ring-primary' : ''}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <div className="flex flex-col items-center gap-2">
                            <Checkbox
                              checked={selectedEpisodeIds.has(episode.id)}
                              onCheckedChange={() => toggleEpisodeSelection(episode.id)}
                              data-testid={`checkbox-episode-${episode.id}`}
                            />
                            <button 
                              onClick={() => togglePlayEpisode(episode)}
                              disabled={!episode.audioUrl}
                              className="flex-shrink-0 w-12 h-12 bg-muted rounded-lg flex items-center justify-center hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              data-testid={`button-play-${episode.id}`}
                            >
                              {playingEpisodeId === episode.id ? (
                                <Pause className="h-5 w-5 text-primary" />
                              ) : (
                                <Play className="h-5 w-5 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {!episode.isRead && <Badge className="text-xs">New</Badge>}
                              {episode.duration && (
                                <span className="text-xs text-muted-foreground">{formatDuration(episode.duration)}</span>
                              )}
                            </div>
                            <p className="text-xs text-primary font-medium truncate" data-testid={`text-podcast-name-${episode.id}`}>
                              {getPodcastName(episode.subscriptionId)}
                            </p>
                            <h3 className="font-semibold truncate" data-testid={`text-episode-title-${episode.id}`}>
                              {episode.title}
                            </h3>
                            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                              {episode.description}
                            </p>
                            <div className="flex items-center gap-2 mt-3">
                              {episode.transcriptStatus === 'completed' && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="outline" data-testid={`button-episode-menu-${episode.id}`}>
                                      <MoreHorizontal className="h-4 w-4 mr-1" />
                                      Episode
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start">
                                    <DropdownMenuItem onSelect={() => setTranscriptEpisode(episode)}><FileText className="h-4 w-4 mr-2" />Transcript</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => (episode.briefingStatus === 'completed' ? setSelectedEpisode(episode) : generateBriefingMutation.mutate(episode.id))}><BookOpen className="h-4 w-4 mr-2" />{episode.briefingStatus === 'completed' ? 'Brief' : 'Generate brief'}</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => setAskEpisode(episode)}><Search className="h-4 w-4 mr-2" />Ask &amp; search</DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                              {episode.transcriptStatus === 'completed' ? (
                                episode.briefingStatus === 'completed' ? (
                                  <Button size="sm" variant="outline" onClick={() => setSelectedEpisode(episode)} data-testid={`button-view-briefing-${episode.id}`}>
                                    <BookOpen className="h-4 w-4 mr-1" />
                                    View Briefing
                                  </Button>
                                ) : episode.briefingStatus === 'processing' ? (
                                  <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Generating...</Badge>
                                ) : episode.briefingStatus === 'failed' ? (
                                  <div className="flex items-center gap-2">
                                    <Badge variant="destructive">Briefing Failed</Badge>
                                    <Button size="sm" onClick={() => generateBriefingMutation.mutate(episode.id)} disabled={generateBriefingMutation.isPending} data-testid={`button-retry-briefing-${episode.id}`}>
                                      Retry
                                    </Button>
                                  </div>
                                ) : (
                                  <Button size="sm" onClick={() => generateBriefingMutation.mutate(episode.id)} disabled={generateBriefingMutation.isPending} data-testid={`button-generate-briefing-${episode.id}`}>
                                    <Sparkles className="h-4 w-4 mr-1" />
                                    Generate Briefing
                                  </Button>
                                )
                              ) : transcribing?.id === episode.id ? (
                                <Badge variant="secondary">
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  {transcribing.total > 1
                                    ? `Transcribing part ${Math.min(transcribing.done + 1, transcribing.total)} of ${transcribing.total}…`
                                    : 'Transcribing…'}
                                </Badge>
                              ) : episode.transcriptStatus === 'processing' ? (
                                <div className="flex items-center gap-2">
                                  {/* A job can die mid-flight (tab closed, request cut off). The parts
                                      already transcribed are saved, so this picks up where it stopped. */}
                                  <Badge variant="secondary">Partly transcribed</Badge>
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => startTranscribe(episode.id, episode.title)} data-testid={`button-resume-transcribe-${episode.id}`}>
                                    <RotateCw className="h-3.5 w-3.5 mr-1" />
                                    Resume
                                  </Button>
                                </div>
                              ) : episode.transcriptStatus === 'failed' ? (
                                <div className="flex items-center gap-2">
                                  <Badge variant="destructive">Transcription Failed</Badge>
                                  <Button size="sm" variant="outline" onClick={() => startTranscribe(episode.id, episode.title)} data-testid={`button-retry-transcribe-${episode.id}`}>
                                    Retry
                                  </Button>
                                </div>
                              ) : (
                                <Button size="sm" variant="outline" onClick={() => startTranscribe(episode.id, episode.title)} disabled={!episode.audioUrl} data-testid={`button-transcribe-${episode.id}`}>
                                  <FileText className="h-4 w-4 mr-1" />
                                  Transcribe
                                </Button>
                              )}
                              {episode.audioUrl && (
                                <Button size="sm" variant="ghost" asChild>
                                  <a href={episode.audioUrl} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>

              <TabsContent value="briefings" className="mt-6 space-y-4">
                {briefings.length === 0 ? (
                  <Card className="p-8 text-center">
                    <Sparkles className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-semibold mb-2">No briefings yet</h3>
                    <p className="text-muted-foreground text-sm">Generate your first AI-powered briefing from an episode</p>
                  </Card>
                ) : (
                  briefings.map((briefing) => {
                    const episode = episodes.find(e => e.id === briefing.episodeId);
                    const subscription = subscriptions.find(s => s.id === episode?.subscriptionId);
                    return (
                    <Card key={briefing.id} className="hover-elevate">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Badge variant={briefing.relevanceScore >= 70 ? 'default' : 'secondary'}>
                              {briefing.relevanceScore}% Relevant
                            </Badge>
                            <Button
                              size="sm"
                              variant={briefing.isBookmarked ? "default" : "outline"}
                              onClick={() => toggleBookmarkMutation.mutate(briefing.id)}
                              disabled={toggleBookmarkMutation.isPending}
                              data-testid={`button-save-briefing-${briefing.id}`}
                            >
                              <Bookmark className={`h-4 w-4 mr-1 ${briefing.isBookmarked ? 'fill-current' : ''}`} />
                              {briefing.isBookmarked ? 'Saved' : 'Save'}
                            </Button>
                          </div>
                          {spotifyStatus?.connected && briefing.relevanceScore >= 70 && episode && subscription && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => window.open(
                                `https://open.spotify.com/search/${encodeURIComponent(`${subscription.title} ${episode.title}`)}`,
                                "_blank",
                                "noopener,noreferrer",
                              )}
                              data-testid={`button-open-spotify-${briefing.id}`}
                            >
                              <SiSpotify className="h-4 w-4 mr-1" />
                              Open in Spotify
                            </Button>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground line-clamp-3">{briefing.summary}</p>
                        {briefing.matchedInterests && briefing.matchedInterests.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-3">
                            {briefing.matchedInterests.map((interest, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                <Tag className="h-3 w-3 mr-1" />
                                {interest}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )})
                )}
              </TabsContent>

              <TabsContent value="subscriptions" className="mt-6 space-y-3">
                {spotifyStatus?.connected && subscriptions.length > 0 && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-muted-foreground">
                    <ListMusic className="h-4 w-4 text-green-600 flex-shrink-0" />
                    <span>Toggle <SiSpotify className="inline h-3 w-3 mx-0.5 text-green-600" /> on each podcast to include its latest episode in your smart Spotify playlist.</span>
                  </div>
                )}
                {subsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
                  </div>
                ) : subscriptions.length === 0 ? (
                  <Card className="p-8 text-center">
                    <Rss className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-semibold mb-2">No podcasts yet</h3>
                    <p className="text-muted-foreground text-sm mb-4">Add your first podcast to get started</p>
                    <Button onClick={() => setIsAddPodcastOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Podcast
                    </Button>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {subscriptions.map((sub) => {
                      const isExpanded = expandedPodcastId === sub.id;
                      const subEpisodes = episodes
                        .filter(e => e.subscriptionId === sub.id)
                        .sort((a, b) => {
                          const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
                          const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
                          return db - da;
                        });
                      const inPlaylist = spotifyPlaylistPodcasts.has(sub.id);

                      return (
                        <Card key={sub.id} className={`transition-all ${isExpanded ? 'ring-2 ring-primary/30' : 'hover-elevate'}`}>
                          <CardContent className="p-0">
                            {/* Podcast header row — clicking expands */}
                            <div
                              className="flex items-center gap-3 p-3 cursor-pointer select-none"
                              onClick={() => setExpandedPodcastId(isExpanded ? null : sub.id)}
                            >
                              <Avatar className="h-9 w-9 rounded flex-shrink-0">
                                <AvatarImage src={sub.artworkUrl || undefined} />
                                <AvatarFallback><Mic className="h-4 w-4" /></AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold truncate">{sub.title}</h3>
                                <p className="text-sm text-muted-foreground truncate">{sub.author}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-muted-foreground">{subEpisodes.length} episode{subEpisodes.length !== 1 ? 's' : ''}</span>
                                  {sub.spotifyShowId && (
                                    <Badge variant="secondary" className="text-xs py-0">
                                      <SiSpotify className="h-3 w-3 mr-1" />
                                      Spotify
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                                {spotifyStatus?.connected && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant={inPlaylist ? "default" : "outline"}
                                        className={inPlaylist ? "bg-green-500 hover:bg-green-600 text-white border-green-500" : ""}
                                        onClick={() => togglePlaylistPodcast(sub.id)}
                                        data-testid={`button-playlist-toggle-${sub.id}`}
                                      >
                                        <SiSpotify className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{inPlaylist ? 'Remove from smart playlist' : 'Add to smart playlist'}</TooltipContent>
                                  </Tooltip>
                                )}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => unsubscribeMutation.mutate(sub.id)}
                                      data-testid={`button-unsubscribe-${sub.id}`}
                                    >
                                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Unsubscribe</TooltipContent>
                                </Tooltip>
                                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                              </div>
                            </div>

                            {/* Expanded episodes list */}
                            {isExpanded && (
                              <div className="border-t px-4 pb-4 pt-3 space-y-2">
                                {subEpisodes.length === 0 ? (
                                  <p className="text-sm text-muted-foreground text-center py-3">No episodes yet — try syncing</p>
                                ) : (
                                  subEpisodes.slice(0, 8).map(ep => (
                                    <div key={ep.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors">
                                      <button
                                        onClick={() => togglePlayEpisode(ep)}
                                        disabled={!ep.audioUrl}
                                        className="flex-shrink-0 w-8 h-8 bg-background rounded-md flex items-center justify-center hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                      >
                                        {playingEpisodeId === ep.id ? (
                                          <Pause className="h-4 w-4 text-primary" />
                                        ) : (
                                          <Play className="h-4 w-4 text-muted-foreground" />
                                        )}
                                      </button>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{ep.title}</p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                          {ep.publishedAt && (
                                            <span className="text-xs text-muted-foreground">
                                              {new Date(ep.publishedAt).toLocaleDateString()}
                                            </span>
                                          )}
                                          {ep.duration && <span className="text-xs text-muted-foreground">{formatDuration(ep.duration)}</span>}
                                          {!ep.isRead && <Badge className="text-xs py-0 px-1">New</Badge>}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1 flex-shrink-0">
                                        {ep.transcriptStatus === 'completed' && (
                                          <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                              <Button size="sm" variant="ghost" className="h-7 px-2" title="Transcript, brief, ask & search">
                                                <MoreHorizontal className="h-3.5 w-3.5" />
                                              </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                              <DropdownMenuItem onSelect={() => setTranscriptEpisode(ep)}><FileText className="h-4 w-4 mr-2" />Transcript</DropdownMenuItem>
                                              <DropdownMenuItem onSelect={() => (ep.briefingStatus === 'completed' ? setSelectedEpisode(ep) : generateBriefingMutation.mutate(ep.id))}><BookOpen className="h-4 w-4 mr-2" />{ep.briefingStatus === 'completed' ? 'Brief' : 'Generate brief'}</DropdownMenuItem>
                                              <DropdownMenuItem onSelect={() => setAskEpisode(ep)}><Search className="h-4 w-4 mr-2" />Ask &amp; search</DropdownMenuItem>
                                            </DropdownMenuContent>
                                          </DropdownMenu>
                                        )}
                                        {ep.transcriptStatus === 'completed' && ep.briefingStatus === 'completed' ? (
                                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSelectedEpisode(ep)}>
                                            <BookOpen className="h-3.5 w-3.5" />
                                          </Button>
                                        ) : transcribing?.id === ep.id ? (
                                          <span className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground whitespace-nowrap">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            {transcribing.total > 1 ? `Part ${Math.min(transcribing.done + 1, transcribing.total)}/${transcribing.total}` : 'Transcribing…'}
                                          </span>
                                        ) : ep.transcriptStatus !== 'completed' ? (
                                          <Button size="sm" variant="ghost" className="h-7 px-2" title={ep.transcriptStatus === 'processing' ? "Resume transcribing" : "Transcribe"} onClick={() => startTranscribe(ep.id, ep.title)} disabled={!ep.audioUrl}>
                                            {ep.transcriptStatus === 'processing' ? <RotateCw className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                                          </Button>
                                        ) : null}
                                      </div>
                                    </div>
                                  ))
                                )}
                                {subEpisodes.length > 8 && (
                                  <p className="text-xs text-muted-foreground text-center pt-1">
                                    + {subEpisodes.length - 8} more — see Episodes tab for full list
                                  </p>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Tag className="h-5 w-5" />
                    Your Interests
                  </CardTitle>
                  <Dialog open={isAddInterestOpen} onOpenChange={setIsAddInterestOpen}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" data-testid="button-add-interest">
                            <Plus className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                      </TooltipTrigger>
                      <TooltipContent>Add a new topic for AI to track</TooltipContent>
                    </Tooltip>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Interest</DialogTitle>
                        <DialogDescription>
                          AI will track and highlight content related to your interests
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label htmlFor="topic">Topic</Label>
                          <Input
                            id="topic"
                            placeholder="e.g., AI trends, startup funding"
                            value={newInterest.topic}
                            onChange={(e) => setNewInterest(prev => ({ ...prev, topic: e.target.value }))}
                            data-testid="input-interest-topic"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="keywords">Keywords (comma separated)</Label>
                          <Input
                            id="keywords"
                            placeholder="e.g., machine learning, GPT, neural networks"
                            value={newInterest.keywords}
                            onChange={(e) => setNewInterest(prev => ({ ...prev, keywords: e.target.value }))}
                            data-testid="input-interest-keywords"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="priority">Priority</Label>
                          <Select value={newInterest.priority} onValueChange={(v) => setNewInterest(prev => ({ ...prev, priority: v }))}>
                            <SelectTrigger data-testid="select-priority">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="low">Low</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <DialogFooter className="mt-4">
                        <Button 
                          onClick={() => addInterestMutation.mutate({
                            topic: newInterest.topic,
                            keywords: newInterest.keywords.split(',').map(k => k.trim()).filter(Boolean),
                            priority: newInterest.priority,
                          })}
                          disabled={!newInterest.topic || addInterestMutation.isPending}
                          data-testid="button-save-interest"
                        >
                          {addInterestMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Save Interest
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
                <CardDescription>Topics AI tracks for you</CardDescription>
              </CardHeader>
              <CardContent>
                {interests.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No interests added yet. Add topics to get personalized briefings!
                  </p>
                ) : (
                  <div className="space-y-2">
                    {interests.map((interest) => (
                      <div key={interest.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-2">
                          <Badge variant={
                            interest.priority === 'high' ? 'default' : 
                            interest.priority === 'medium' ? 'secondary' : 'outline'
                          } className="text-xs">
                            {interest.priority}
                          </Badge>
                          <span className="text-sm font-medium">{interest.topic}</span>
                        </div>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          onClick={() => deleteInterestMutation.mutate(interest.id)}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <SiSpotify className="h-5 w-5 text-green-500" />
                  Spotify
                </CardTitle>
              </CardHeader>
              <CardContent>
                {spotifyStatus?.connected ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Connected</p>
                        {spotifyStatus.displayName && (
                          <p className="text-xs text-muted-foreground">{spotifyStatus.displayName}</p>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border p-3 space-y-1.5">
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <ListMusic className="h-4 w-4 text-green-500" />
                        Add episodes to Spotify
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Spotify no longer lets apps build playlists for you. Hit <span className="font-medium text-foreground">Open in Spotify</span> on any recommended episode — it opens in Spotify so you can add it to your own playlist in a tap.
                      </p>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full"
                      onClick={() => disconnectSpotifyMutation.mutate()}
                      disabled={disconnectSpotifyMutation.isPending}
                      data-testid="button-disconnect-spotify"
                    >
                      {disconnectSpotifyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Disconnect
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Connect Spotify to import your followed podcasts
                    </p>
                    <Button 
                      onClick={() => connectSpotifyMutation.mutate()}
                      disabled={connectSpotifyMutation.isPending}
                      className="w-full bg-green-500 text-white"
                      data-testid="button-connect-spotify-sidebar"
                    >
                      {connectSpotifyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      <SiSpotify className="h-4 w-4 mr-2" />
                      Connect Spotify
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </div>

          <EpisodeAskSheet episode={askEpisode} onOpenChange={(open) => { if (!open) setAskEpisode(null); }} />

          <Dialog open={!!transcriptEpisode} onOpenChange={(open) => { if (!open) setTranscriptEpisode(null); }}>
            <DialogContent className="max-w-2xl overflow-hidden">
              <DialogHeader>
                <DialogTitle className="pr-6 leading-snug">{transcriptEpisode?.title}</DialogTitle>
                <DialogDescription>
                  {transcriptQuery.data ? `Transcript · ${transcriptQuery.data.wordCount.toLocaleString()} words` : "Transcript"}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <a href={`/api/listener/episodes/${transcriptEpisode?.id}/transcript?format=txt`} download data-testid="button-download-transcript">
                    <Download className="h-4 w-4 mr-1" />
                    Download .txt
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!transcriptQuery.data}
                  onClick={async () => {
                    if (!transcriptQuery.data) return;
                    await navigator.clipboard.writeText(transcriptQuery.data.transcript);
                    toast({ title: "Transcript copied" });
                  }}
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copy
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/transcript-search">
                    <Search className="h-4 w-4 mr-1" />
                    Search all transcripts
                  </Link>
                </Button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto rounded-md border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                {transcriptQuery.isLoading ? (
                  <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading transcript…</span>
                ) : transcriptQuery.error ? (
                  <span className="text-destructive">Couldn't load this transcript. Close and try again.</span>
                ) : (
                  transcriptQuery.data?.transcript
                )}
              </div>
            </DialogContent>
          </Dialog>

        {selectedEpisode && (
          <Dialog open={!!selectedEpisode} onOpenChange={() => setSelectedEpisode(null)}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{selectedEpisode.title}</DialogTitle>
                <DialogDescription>AI-generated briefing</DialogDescription>
              </DialogHeader>
              {(() => {
                const briefing = briefings.find(b => b.episodeId === selectedEpisode.id);
                if (!briefing) return <p>No briefing found</p>;
                return (
                  <div className="space-y-6 mt-4">
                    <div className="flex items-center gap-4">
                      <Badge>{briefing.relevanceScore}% Relevant</Badge>
                      {briefing.matchedInterests?.map((interest, i) => (
                        <Badge key={i} variant="outline">{interest}</Badge>
                      ))}
                    </div>
                    
                    <div>
                      <h4 className="font-semibold mb-2 flex items-center gap-2">
                        <BookOpen className="h-4 w-4" />
                        Summary
                      </h4>
                      <p className="text-sm text-muted-foreground">{briefing.summary}</p>
                    </div>

                    {briefing.keyTakeaways && briefing.keyTakeaways.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          Key Takeaways
                        </h4>
                        <ul className="space-y-2">
                          {briefing.keyTakeaways.map((takeaway, i) => (
                            <li key={i} className="text-sm flex items-start gap-2">
                              <span className="text-primary">•</span>
                              {takeaway}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {briefing.relevantQuotes && briefing.relevantQuotes.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          Notable Quotes
                        </h4>
                        <div className="space-y-2">
                          {briefing.relevantQuotes.map((quote, i) => (
                            <blockquote key={i} className="text-sm italic border-l-2 border-primary pl-4 py-1 text-muted-foreground">
                              "{quote}"
                            </blockquote>
                          ))}
                        </div>
                      </div>
                    )}

                    {briefing.personalInsights && briefing.personalInsights.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <Sparkles className="h-4 w-4" />
                          Personal Insights
                        </h4>
                        <ul className="space-y-2">
                          {briefing.personalInsights.map((insight, i) => (
                            <li key={i} className="text-sm flex items-start gap-2 bg-primary/5 p-2 rounded">
                              <Zap className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                              {insight}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}
            </DialogContent>
          </Dialog>
        )}
      </main>
      
      {/* Hidden audio element for playback */}
      <audio
        ref={audioRef}
        onEnded={() => setPlayingEpisodeId(null)}
        onPause={() => setPlayingEpisodeId(null)}
        className="hidden"
      />

      {/* Floating AI Chat Bubble */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {aiChatOpen && (
          <div className="w-80 sm:w-96 bg-card border rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: '480px' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                <span className="font-semibold text-sm">Ask Podlogix AI</span>
              </div>
              <button onClick={() => setAiChatOpen(false)} className="hover:opacity-70 transition-opacity">
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{ minHeight: '200px', maxHeight: '300px' }}>
              {aiMessages.length === 0 && (
                <p className="text-xs text-muted-foreground text-center pt-4">
                  Ask me anything about your podcasts, briefings, or recommendations.
                </p>
              )}
              {aiMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] text-sm px-3 py-2 rounded-xl ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {aiLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-xl rounded-bl-sm px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div ref={aiEndRef} />
            </div>
            {/* Input */}
            <div className="p-3 border-t flex gap-2">
              <input
                type="text"
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendAiMessage()}
                placeholder="Ask about your podcasts..."
                className="flex-1 text-sm bg-muted rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={sendAiMessage}
                disabled={!aiInput.trim() || aiLoading}
                className="p-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        {/* Bubble toggle button */}
        <button
          onClick={() => setAiChatOpen(prev => !prev)}
          className="w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
        >
          {aiChatOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        </button>
      </div>
    </div>
  );
}
