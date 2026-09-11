import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { GlobalSearch } from "@/components/GlobalSearch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import logoImg from "@assets/podlogix-logo-dark.png";
import {
  LayoutDashboard,
  Shield,
  ShieldCheck,
  Link2,
  Share2,
  Sparkles,
  User,
  HelpCircle,
  LogOut,
  Users,
  Plug,
  Plus,
  Building2,
  Search,
  Bell,
  Mic,
  List,
  Settings,
  Settings2,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  X,
  Contact,
  Headphones,
  Video,
  UserPlus,
  Fingerprint,
  Compass,
  IdCard,
  FlaskConical,
  Puzzle,
  PenSquare,
  CalendarRange,
  Repeat,
  GalleryVerticalEnd,
  MessageCircle,
  Radio,
  Gem,
  WandSparkles,
  AudioLines,
  PlayCircle,
  Globe,
  DollarSign,
  BarChart3,
  ListChecks,
  RefreshCw,
  Send,
  Loader2,
  type LucideIcon,
} from "lucide-react";

interface AdminCheck {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  role: string;
}

// ─── Workspace nav model ─────────────────────────────────────────────────────
//
// One nav model instead of "modes". The rail shows the primary workspace
// destinations; the panel lists them with labels plus a lower Settings group.
// Adding a future destination (Guests, Sponsors, …) is one entry in
// WORKSPACE_PRIMARY.

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Active only on exact match (for index-style routes like /today). */
  exact?: boolean;
  /** Panel section this item renders under. Items must stay grouped consecutively — omit for a pinned, unlabeled top item (e.g. Today). */
  group?: string;
}

const WORKSPACE_PRIMARY: NavItem[] = [
  { title: "Dashboard", url: "/today", icon: LayoutDashboard, exact: true },
  { title: "Shows", url: "/shows", icon: Mic, group: "Podcast" },
  { title: "Listen", url: "/listener", icon: Headphones, group: "Podcast" },
  { title: "Transcript Search", url: "/transcript-search", icon: Search, group: "Podcast" },
  // Guest work follows the user's natural funnel: discover, research, pursue.
  // Starring isn't its own destination — it's a filter on Contacts and Guest
  // Pipeline, so there's no separate "Starred" nav item here.
  { title: "Discover", url: "/social/discover", icon: Compass, group: "Guests" },
  { title: "Guest Pipeline", url: "/guests", icon: UserPlus, group: "Guests" },
  // The reverse direction of the same funnel — what shows the host themself
  // has appeared on, for pitching new ones.
  { title: "My Appearances", url: "/guests/my-profile", icon: IdCard, group: "Guests" },
  // Contacts and Email are distinct workspace tools. A person can exist in
  // Contacts without being a guest, and campaigns should not crowd guest CRM.
  { title: "Contacts", url: "/contacts", icon: Contact, group: "Contacts" },
  { title: "Email", url: "/email", icon: Send, group: "Email" },
  { title: "Social Hub", url: "/dashboard/social-hub", icon: Share2, group: "Social" },
  { title: "Engagement", url: "/social/engagement", icon: MessageCircle, group: "Social" },
  { title: "Posts", url: "/social/posts", icon: PenSquare, group: "Social", exact: true },
  // Campaign and Cadence are tabs inside Posts — no separate panel entries.
  { title: "Bio Page", url: "/dashboard/profile", icon: Link2, group: "Social" },
  { title: "Live Studio", url: "/studio/live", icon: Radio, group: "Studio" },
  { title: "Refiner", url: "/studio/refiner", icon: Sparkles, group: "Studio" },
  { title: "Facet", url: "/studio/facet", icon: Gem, group: "Studio" },
  { title: "Media Storage", url: "/media-library", icon: GalleryVerticalEnd, group: "Studio" },
  // Beta — filtered out of the panel for non-allowlisted accounts (see activeGroupItems).
  { title: "Media Lab", url: "/media-lab", icon: FlaskConical, group: "Studio" },
  { title: "Workspace Settings", url: "/settings", icon: Settings, group: "Settings" },
  // Ungrouped: standalone page reached from the rail's plug icon — no panel group,
  // but listed here so the active-leaf matcher lights the rail icon on /connectors.
  { title: "Connectors", url: "/connectors", icon: Plug },
];

interface RailItem {
  title: string;
  icon: LucideIcon;
  /** Where clicking this rail entry navigates — the group's first child, or the item's own url. */
  url: string;
  /** Whether this rail entry is "lit" for the currently matched WORKSPACE_PRIMARY leaf. */
  isActive: (activeLeaf: NavItem | null) => boolean;
}

// The rail shows only the big-ticket destinations — Today, one icon per
// WORKSPACE_PRIMARY group, and any ungrouped standalone item. Clicking a
// group icon navigates to its first child; the panel then reveals that
// group's full item list (see `panelItems` below) instead of repeating
// every leaf in the rail too.
const RAIL_ITEMS: RailItem[] = [
  { title: "Dashboard", icon: LayoutDashboard, url: "/today", isActive: (leaf) => leaf?.url === "/today" },
  { title: "Podcast", icon: Mic, url: "/shows", isActive: (leaf) => leaf?.group === "Podcast" },
  { title: "Discover", icon: Compass, url: "/social/discover", isActive: (leaf) => leaf?.group === "Guests" },
  { title: "Contacts", icon: Contact, url: "/contacts", isActive: (leaf) => leaf?.group === "Contacts" },
  { title: "Email", icon: Send, url: "/email", isActive: (leaf) => leaf?.group === "Email" },
  { title: "Social", icon: Share2, url: "/dashboard/social-hub", isActive: (leaf) => leaf?.group === "Social" },
  // Facet and Media Storage keep their Studio panel entries, but each gets
  // its own rail icon — most sessions go straight to one of them.
  { title: "Studio", icon: WandSparkles, url: "/studio/live", isActive: (leaf) => leaf?.group === "Studio" && leaf?.url !== "/media-library" && leaf?.url !== "/studio/facet" },
  { title: "Facet", icon: Gem, url: "/studio/facet", isActive: (leaf) => leaf?.url === "/studio/facet" },
  { title: "Media Storage", icon: GalleryVerticalEnd, url: "/media-library", isActive: (leaf) => leaf?.url === "/media-library" },
  { title: "Connectors", icon: Plug, url: "/connectors", isActive: (leaf) => leaf?.url === "/connectors" },
  { title: "Settings", icon: Settings, url: "/settings", isActive: (leaf) => leaf?.group === "Settings" },
  { title: "Help Center", icon: HelpCircle, url: "/help", isActive: () => false },
];

/** Nav for a single show's context — shown in the panel when inside /shows/:id. */
function showNavItems(showId: string): NavItem[] {
  const base = `/shows/${showId}`;
  return [
    { title: "Overview", url: base, icon: LayoutDashboard, exact: true },
    { title: "Episodes", url: `${base}/episodes`, icon: List },
    { title: "Studio", url: `${base}/studio`, icon: AudioLines },
    { title: "Players", url: `${base}/players`, icon: PlayCircle },
    { title: "Website", url: `${base}/website`, icon: Globe },
    { title: "Monetization", url: `${base}/monetization`, icon: DollarSign },
    { title: "Stats", url: `${base}/stats`, icon: BarChart3 },
    { title: "Directories", url: `${base}/directories`, icon: ListChecks },
    { title: "RSS Migration", url: `${base}/rss-migration`, icon: RefreshCw },
    { title: "Show Settings", url: `${base}/settings`, icon: Settings2 },
  ];
}

interface PodcastSummary {
  id: string;
  title: string;
  artworkUrl?: string | null;
}

interface BuzzsproutStatus {
  connected: boolean;
  connection?: {
    podcastTitle?: string | null;
    podcastArtworkUrl?: string | null;
  };
}

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location, navigate] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const [panelOpen, setPanelOpen] = useState(true);

  // The Live Studio and the Dashboard want the whole frame — collapse the panel on entry.
  useEffect(() => {
    if (location.startsWith("/studio/live") || location.startsWith("/studio/guest") || location === "/today") setPanelOpen(false);
  }, [location]);

  // The Dashboard is a dark command center: the top bar joins its surface
  // instead of sitting above it as light chrome.
  const darkChrome = location === "/today";
  const [railExpanded, setRailExpanded] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Any page can fire window.dispatchEvent(new CustomEvent("podlogix:openAi")) to open the panel
  useEffect(() => {
    const handler = () => setAiOpen(true);
    window.addEventListener("podlogix:openAi", handler);
    return () => window.removeEventListener("podlogix:openAi", handler);
  }, []);

  // ── Nav mode: workspace vs. show context ──
  const showMatch = location.match(/^\/shows\/([^/]+)/);
  const showId = showMatch?.[1];
  const navMode: "workspace" | "show" = showId ? "show" : "workspace";

  const { data: adminCheck } = useQuery<AdminCheck>({
    queryKey: ["/api/admin/check"],
    enabled: isAuthenticated,
    queryFn: async () => {
      const res = await fetch("/api/admin/check", { credentials: "include" });
      if (!res.ok) return { isAdmin: false, isSuperAdmin: false, role: "user" };
      return res.json();
    },
    retry: 1,
  });

  // Show identity for the panel header (only fetched inside show context).
  const { data: podcastList } = useQuery<PodcastSummary[]>({
    queryKey: ["/api/podcasts"],
    enabled: isAuthenticated && navMode === "show",
  });
  const { data: buzzsproutStatus } = useQuery<BuzzsproutStatus>({
    queryKey: ["/api/connectors/buzzsprout/status"],
    enabled: isAuthenticated && navMode === "show" && showId === "buzzsprout",
  });

  const currentShow = Array.isArray(podcastList)
    ? podcastList.find((p) => p.id === showId)
    : undefined;
  const showName =
    currentShow?.title ??
    (showId === "buzzsprout"
      ? buzzsproutStatus?.connection?.podcastTitle ?? "Show"
      : "Show");
  const showArtwork =
    currentShow?.artworkUrl ??
    (showId === "buzzsprout"
      ? buzzsproutStatus?.connection?.podcastArtworkUrl ?? null
      : null);

  const isItemActive = (item: NavItem) =>
    item.exact ? location === item.url : location.startsWith(item.url);

  // Which WORKSPACE_PRIMARY leaf the current URL belongs to — drives both the
  // rail's active group icon and which group the panel expands into. Longest
  // matching prefix wins (e.g. /dashboard/social-hub over a shorter /dashboard).
  const activeLeaf: NavItem | null = (() => {
    let best: NavItem | null = null;
    for (const item of WORKSPACE_PRIMARY) {
      const matches = item.exact ? location === item.url : location.startsWith(item.url);
      if (matches && (!best || item.url.length > best.url.length)) best = item;
    }
    return best;
  })();

  // Panel only renders when the URL is inside a group (see panelOpen check
  // below), so it always has a group to show — no pinned Dashboard row here,
  // since the rail's own Dashboard icon is already one click away.
  const activeGroupItems = (
    activeLeaf?.group ? WORKSPACE_PRIMARY.filter((i) => i.group === activeLeaf.group) : []
  ).filter((i) => i.url !== "/media-lab" || user?.email === "andrew@podlogix.co");
  const panelItems =
    navMode === "show" ? showNavItems(showId!) : activeGroupItems;

  const panelLinkClass = (active: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors cursor-pointer ${
      active
        ? "bg-muted text-foreground font-medium"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;

  // The studio takes the whole screen — no rail, no search, no avatar.
  // "Exit Studio" inside the page is the way back to the normal app.
  if (location.startsWith("/studio/live") || location.startsWith("/studio/guest")) {
    return <div className="h-screen w-full overflow-y-auto bg-zinc-950">{children}</div>;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">

      {/* ── Rail ──────────────────────────────────────────────────────────── */}
      <nav
        onClick={(e) => {
          // The rail is the toggle: click anywhere on the dark surface to open
          // or close it. Links and buttons inside keep their own behavior.
          if ((e.target as HTMLElement).closest("a,button")) return;
          setRailExpanded((v) => !v);
        }}
        className={`flex flex-col shrink-0 cursor-pointer bg-[#0D1B2A] border-r border-white/[0.06] z-20 transition-all duration-200 overflow-hidden ${railExpanded ? "w-44" : "w-14"}`}
      >

        {/* Logo row — collapse button appears here when expanded */}
        <div className={`flex items-center h-14 border-b border-white/[0.06] shrink-0 ${railExpanded ? "px-3 justify-between" : "justify-center"}`}>
          <Link href="/today" className="flex items-center gap-2.5 min-w-0">
            <img src={logoImg} alt="Podlogix" className="w-7 h-7 rounded-lg shrink-0" />
            {railExpanded && (
              <span className="text-white text-sm font-semibold truncate">Podlogix</span>
            )}
          </Link>
        </div>

        {/* Primary workspace icons */}
        <div className={`flex flex-col gap-1 py-3 flex-1 ${railExpanded ? "px-2" : "items-center"}`}>

          {RAIL_ITEMS.map((item) => {
            const isActive = item.isActive(activeLeaf);
            const Icon = item.icon;
            const btn = (
              <button
                onClick={() => {
                  navigate(item.url);
                  if (!panelOpen) setPanelOpen(true);
                }}
                className={`
                  relative flex items-center h-10 rounded-full transition-all duration-150
                  ${railExpanded ? "gap-2.5 px-3.5 w-full" : "justify-center w-10"}
                  ${isActive ? "bg-primary/20 ring-1 ring-primary/40" : "hover:bg-white/[0.06]"}
                `}
                aria-label={item.title}
              >
                <Icon className={`h-[18px] w-[18px] shrink-0 transition-colors ${isActive ? "text-primary" : "text-slate-500"}`} />
                {railExpanded && (
                  <span className={`text-sm truncate ${isActive ? "text-white font-medium" : "text-slate-400"}`}>
                    {item.title}
                  </span>
                )}
              </button>
            );
            return (
              <div key={item.url}>
                {item.title === "Settings" && (
                  <div className={`my-1.5 h-px bg-white/[0.08] ${railExpanded ? "" : "mx-auto w-8"}`} />
                )}
                {railExpanded ? (
                  btn
                ) : (
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent side="right" className="text-xs font-medium">{item.title}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom icons */}
        <div className={`flex flex-col gap-1 py-3 border-t border-white/[0.06] ${railExpanded ? "px-2" : "items-center"}`}>

          {/* Bottom cluster is deliberately just Admin (SaaS Portal and
              Integrations live inside the Admin page) + the profile avatar. */}
          {(adminCheck?.isAdmin ? [{ title: "Admin", icon: ShieldCheck, url: "/admin" }] : []).map((item) => {
            const Icon = item.icon;
            const btn = (
              <Link href={item.url}>
                <button
                  className={`flex items-center h-10 rounded-xl hover:bg-white/[0.06] transition-all duration-150 ${
                    railExpanded ? "gap-2.5 px-3 w-full" : "justify-center w-10"
                  }`}
                  aria-label={item.title}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0 text-slate-500" />
                  {railExpanded && <span className="text-sm text-slate-400 truncate">{item.title}</span>}
                </button>
              </Link>
            );
            return railExpanded ? (
              <div key={item.url}>{btn}</div>
            ) : (
              <Tooltip key={item.url} delayDuration={300}>
                <TooltipTrigger asChild>{btn}</TooltipTrigger>
                <TooltipContent side="right" className="text-xs font-medium">{item.title}</TooltipContent>
              </Tooltip>
            );
          })}

          {/* User avatar */}
          <div className="mt-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={`flex items-center h-10 rounded-xl hover:bg-white/[0.06] transition-all duration-150 ${railExpanded ? "gap-2.5 px-2 w-full" : "justify-center w-10"}`}>
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarImage src={user?.profileImageUrl || undefined} />
                    <AvatarFallback className="text-xs bg-primary text-white font-semibold">
                      {user?.firstName?.[0] || "U"}
                    </AvatarFallback>
                  </Avatar>
                  {railExpanded && (
                    <span className="text-sm text-slate-300 truncate">{user?.firstName || "Account"}</span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-56 mb-2">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium leading-none">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-muted-foreground mt-1 truncate">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer">
                    <User className="h-4 w-4 mr-2" />
                    Account Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/profile" className="cursor-pointer">
                    <Link2 className="h-4 w-4 mr-2" />
                    Edit Link Page
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => logout()}
                  className="text-red-500 focus:text-red-500 cursor-pointer"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </nav>

      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      {/* The dashboard has no sibling pages — showing a panel with a single
          entry is dead space, so the panel only renders inside a group. */}
      {panelOpen && (navMode === "show" || activeLeaf?.group) && (
        <aside className="w-52 shrink-0 bg-background border-r flex flex-col z-10">

          {/* Panel header */}
          {navMode === "workspace" ? (
            <div className="flex items-center justify-between px-4 h-14 border-b shrink-0">
              <span className="text-sm font-semibold tracking-tight">Workspace</span>
              <button
                onClick={() => setPanelOpen(false)}
                className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Collapse panel"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="border-b shrink-0">
              <div className="flex items-center justify-between px-4 h-10 pt-1">
                <Link href="/shows">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    All shows
                  </span>
                </Link>
                <button
                  onClick={() => setPanelOpen(false)}
                  className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Collapse panel"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2.5 px-4 pb-3 pt-1">
                {showArtwork ? (
                  <img
                    src={showArtwork}
                    alt={showName}
                    className="h-8 w-8 rounded-lg object-cover border shrink-0"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
                    <Mic className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <span className="text-sm font-semibold tracking-tight truncate">{showName}</span>
              </div>
            </div>
          )}

          {/* Nav items */}
          <nav className="flex-1 overflow-y-auto py-2 px-2 flex flex-col">
            <div className="flex-1">
              {panelItems.map((item, idx) => {
                const Icon = item.icon;
                const prevGroup = idx > 0 ? panelItems[idx - 1].group : undefined;
                const showGroupLabel = navMode === "workspace" && item.group && item.group !== prevGroup;
                return (
                  <div key={item.url}>
                    {showGroupLabel && (
                      <div className="px-3 pt-3 pb-1">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                          {item.group}
                        </p>
                      </div>
                    )}
                    <Link href={item.url}>
                      <div className={panelLinkClass(isItemActive(item))}>
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{item.title}</span>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>

          </nav>
        </aside>
      )}

      {/* ── Main Content ──────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Global top bar — ONE banner: search, + New, and the icon cluster.
            On the dark dashboard it aligns to the content grid and sits a
            touch lower; no page heading underneath. */}
        <header className={`shrink-0 ${darkChrome ? "bg-[#101014] pb-2 pt-4" : "border-b bg-background py-2.5 px-4"}`}>
          <div className={`flex items-center gap-3 ${darkChrome ? "mx-auto w-full max-w-[1600px] px-5" : "w-full"}`}>
          {!panelOpen && !darkChrome && (
            <button
              onClick={() => setPanelOpen(true)}
              className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
              aria-label="Open panel"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {/* Search — site-wide, ⌘K from anywhere */}
          <GlobalSearch dark={darkChrome} />

          {/* + New — create anything from any page */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={`flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                darkChrome
                  ? "bg-red-600 text-white shadow-lg shadow-red-950/40 hover:bg-red-700"
                  : "bg-primary text-white hover:opacity-90"
              }`}
            >
              <Plus size={15} /> New
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className={darkChrome ? "border-zinc-800 bg-zinc-950 text-zinc-200" : ""}>
              <DropdownMenuItem asChild><Link href="/studio/live" className="flex items-center gap-2 cursor-pointer"><Radio size={14} /> Record or go live</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/episodes" className="flex items-center gap-2 cursor-pointer"><Mic size={14} /> New episode</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/social/posts" className="flex items-center gap-2 cursor-pointer"><PenSquare size={14} /> Create a post</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/media-library" className="flex items-center gap-2 cursor-pointer"><GalleryVerticalEnd size={14} /> Add media</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Right actions */}
          <div className="flex items-center gap-0.5 ml-auto">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Link href="/help">
                  <button className={`flex items-center justify-center w-9 h-9 rounded-md transition-colors ${darkChrome ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}>
                    <HelpCircle className="h-[18px] w-[18px]" />
                  </button>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Help Center</TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <button className={`flex items-center justify-center w-9 h-9 rounded-md transition-colors ${darkChrome ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}>
                  <Bell className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Notifications</TooltipContent>
            </Tooltip>

            {/* Avatar dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center rounded-full ml-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-8 w-8 cursor-pointer">
                    <AvatarImage src={user?.profileImageUrl || undefined} />
                    <AvatarFallback className="text-xs bg-primary text-white font-semibold">
                      {user?.firstName?.[0] || "U"}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium leading-none">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-muted-foreground mt-1 truncate">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer">
                    <User className="h-4 w-4 mr-2" />
                    Account Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/profile" className="cursor-pointer">
                    <Link2 className="h-4 w-4 mr-2" />
                    Edit Link Page
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => logout()}
                  className="text-red-500 focus:text-red-500 cursor-pointer"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          </div>
        </header>

        {/* Page content */}
        <main className={`flex-1 overflow-auto ${darkChrome ? "bg-[#0a0a0d]" : ""}`}>
          {children}
        </main>
      </div>

      <AiPanel aiOpen={aiOpen} setAiOpen={setAiOpen} />

    </div>
  );
}

// ─── AI Assistant Panel ───────────────────────────────────────────────────────

interface AiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  loading?: boolean;
}

let _msgId = 0;
function msgId() { return `ai-${++_msgId}-${Date.now()}`; }

const CHIPS = [
  "Write show notes for my last episode",
  "Give me 5 episode ideas for my podcast",
  "How do I grow my audience?",
  "Draft a sponsor pitch email",
  "What should I post on social this week?",
  "Tips to improve my audio quality",
];

const GREETING: AiMessage = {
  id: "greeting",
  role: "assistant",
  text: "Hey! I'm your Podlogix AI — ask me anything about your podcast: episode ideas, show notes, growth, sponsorships, or whatever's on your mind. 🎙️",
};

function AiPanel({ aiOpen, setAiOpen }: { aiOpen: boolean; setAiOpen: (v: boolean) => void }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<AiMessage[]>([GREETING]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Gather lightweight context to ground the system prompt
  const { data: dashData } = useQuery<{ podcasts: Array<{ id: string; title: string }> }>({
    queryKey: ["/api/dashboard"],
    enabled: aiOpen,
  });
  const { data: episodesData } = useQuery<any[]>({
    queryKey: ["/api/podcasts", dashData?.podcasts?.[0]?.id, "episodes"],
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/${dashData!.podcasts[0].id}/episodes`);
      return res.json();
    },
    enabled: !!dashData?.podcasts?.[0]?.id && aiOpen,
  });
  const { data: socialData } = useQuery<{ accounts: Array<{ isConnected: boolean; platform: string }> }>({
    queryKey: ["/api/upload-post/accounts"],
    enabled: aiOpen,
    retry: false,
  });

  const context = {
    podcastTitle: dashData?.podcasts?.[0]?.title,
    episodeCount: Array.isArray(episodesData) ? episodesData.filter((e: any) => e.status === "published").length : undefined,
    draftCount: Array.isArray(episodesData) ? episodesData.filter((e: any) => e.status !== "published").length : undefined,
  };

  useEffect(() => {
    if (aiOpen) {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        inputRef.current?.focus();
      }, 150);
    }
  }, [aiOpen, messages]);

  const showChips = messages.length <= 1;

  const sendMessage = async (input: string) => {
    if (!input.trim() || loading) return;
    const userMsg: AiMessage = { id: msgId(), role: "user", text: input.trim() };
    const loadingId = msgId();
    const loadingMsg: AiMessage = { id: loadingId, role: "assistant", text: "", loading: true };
    setMessages((m) => [...m, userMsg, loadingMsg]);
    setLoading(true);

    try {
      const history = [...messages, userMsg]
        .filter((m) => !m.loading && m.id !== "greeting" && m.text)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.text }));

      // Always include greeting context as first assistant message for tone continuity
      const contextualHistory = [
        { role: "assistant" as const, content: GREETING.text },
        ...history.slice(-(9)),
      ];

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: contextualHistory, context }),
      });
      const data = await res.json();
      const text = res.ok ? (data.text ?? "Sorry, I couldn't get a response.") : "I'm having trouble right now — please try again.";
      setMessages((m) => m.map((msg) => msg.id === loadingId ? { ...msg, text, loading: false } : msg));
    } catch {
      setMessages((m) => m.map((msg) => msg.id === loadingId ? { ...msg, text: "Connection error — please try again.", loading: false } : msg));
    }
    setLoading(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = inputRef.current?.value?.trim();
    if (!val) return;
    if (inputRef.current) inputRef.current.value = "";
    sendMessage(val);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const val = inputRef.current?.value?.trim();
      if (!val) return;
      if (inputRef.current) inputRef.current.value = "";
      sendMessage(val);
    }
  };

  const resetChat = () => {
    setMessages([GREETING]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      {/* Floating trigger */}
      {!aiOpen && (
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              onClick={() => setAiOpen(true)}
              className="fixed bottom-6 right-6 z-30 flex items-center justify-center w-12 h-12 rounded-full bg-primary text-white shadow-lg hover:bg-primary/90 transition-colors"
              aria-label="Open AI Assistant"
            >
              <Sparkles className="h-5 w-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Podlogix AI</TooltipContent>
        </Tooltip>
      )}

      {/* Backdrop */}
      {aiOpen && (
        <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={() => setAiOpen(false)} />
      )}

      {/* Slide-out panel */}
      <div
        className={`fixed inset-y-0 right-0 w-[400px] bg-background border-l shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${aiOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-4 border-b shrink-0 bg-primary text-primary-foreground">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/15">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">Podlogix AI</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={resetChat}
              className="flex items-center gap-1 text-xs text-white/70 hover:text-white px-2 py-1 rounded hover:bg-white/10 transition-colors"
            >
              <Plus className="h-3 w-3" />
              New Chat
            </button>
            <button
              onClick={() => setAiOpen(false)}
              className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Suggestion chips — empty state only */}
        {showChips && (
          <div className="px-3 pt-3 pb-1 grid grid-cols-2 gap-1.5 shrink-0 border-b">
            {CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => sendMessage(chip)}
                className="text-[11px] text-left px-2.5 py-2 rounded-xl border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground leading-snug"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-2xl px-4 py-2.5 text-sm ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm ml-auto max-w-[82%]"
                  : "bg-muted text-foreground rounded-bl-sm mr-auto max-w-[95%] shadow-sm border border-border"
              }`}
            >
              {m.loading ? (
                <div className="flex items-center gap-2 py-1">
                  <div className="flex gap-1">
                    {[0, 150, 300].map((d) => (
                      <span
                        key={d}
                        className="w-2 h-2 rounded-full bg-primary animate-bounce"
                        style={{ animationDelay: `${d}ms` }}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground italic">Thinking…</span>
                </div>
              ) : m.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-2 [&>ul]:mb-2 [&>ol]:mb-2 [&>p:last-child]:mb-0">
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="shrink-0 p-3 border-t">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              className="flex-1 min-h-[56px] max-h-[120px] rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              placeholder="Ask me anything about your podcast…"
              rows={2}
              onKeyDown={handleKeyDown}
            />
            <button
              type="submit"
              disabled={loading}
              className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 text-center mt-2">AI may make mistakes — verify important information.</p>
        </form>
      </div>
    </>
  );
}
