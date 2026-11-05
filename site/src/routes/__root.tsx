import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportHiggsfieldError } from "../lib/higgsfield-error-reporting";
import appMetaJson from "../app-meta.json";
import { getOrigin } from "../lib/live.functions";
import { PRIMARY_ORIGIN } from "../lib/site";

declare const __HF_DESIGN_INSPECTOR__: boolean;

const DEFAULT_TITLE = "Rialto";
const DEFAULT_DESCRIPTION =
  "Venice AI agent kit for Solana. One command installs a wallet-native CLI, an MCP server and a budgeted reference agent that pays in USDC.";

type AppMeta = {
  og_title?: string | null;
  og_description?: string | null;
  og_image_url?: string | null;
  favicon_url?: string | null;
  og_video_url?: string | null;
};

const appMeta = appMetaJson as AppMeta;
const APP_HOST_ZONES = ["higgsfield.app", "higgsfield-dev.app"];

function toOwnAssetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/")) return value;
  try {
    const u = new URL(value);
    const isAppHost = APP_HOST_ZONES.some(
      (zone) => u.hostname === zone || u.hostname.endsWith(`.${zone}`),
    );
    if (isAppHost) return u.pathname + u.search;
    return value;
  } catch {
    return value;
  }
}

function buildHead(meta: AppMeta, origin: string) {
  const title = meta.og_title ?? DEFAULT_TITLE;
  const description = meta.og_description ?? DEFAULT_DESCRIPTION;
  // The page's own share card is the clean Rialto OG (absolute URL for crawlers); the feed card reads app-meta.json directly.
  const ogImage = `${origin}/assets/og.jpg`;
  const favicon = "/favicon.svg";
  const ogVideo = toOwnAssetUrl(meta.og_video_url);

  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title },
      { name: "description", content: description },
      { name: "theme-color", content: "#F7F7F5" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: ogImage ? "summary_large_image" : "summary" },
      ...(ogImage
        ? [
            { property: "og:image", content: ogImage },
            { name: "twitter:image", content: ogImage },
          ]
        : []),
      ...(ogVideo ? [{ property: "og:video", content: ogVideo }] : []),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: favicon },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" as const },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap",
      },
    ],
  };
}

function NotFoundComponent() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="font-mono text-sm text-ink-2">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Page not found</h1>
        <p className="mt-3 text-ink-2">That span of the bridge does not exist.</p>
        <Link to="/" className="mt-6 inline-block text-brick underline underline-offset-4">
          Back to Rialto
        </Link>
      </div>
    </main>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportHiggsfieldError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Something broke</h1>
        <p className="mt-3 text-ink-2">The page hit an error while rendering.</p>
        <button
          type="button"
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper active:scale-[0.98]"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: () => getOrigin(),
  head: ({ loaderData }) => buildHead(appMeta, (loaderData as string | undefined) ?? PRIMARY_ORIGIN),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="rialto">
      <head>
        <HeadContent />
        {/* Apply a saved light/dark choice before first paint; otherwise the system setting decides. */}
        <script dangerouslySetInnerHTML={{ __html: 'try{var m=localStorage.getItem("rialto-mode");if(m==="dark"||m==="light")document.documentElement.setAttribute("data-mode",m)}catch(e){}' }} />
      </head>
      <body className="bg-paper font-sans text-ink antialiased">
        {children}
        <Scripts />
        {/* Vercel Web Analytics: page views and visitors, no cookies, no personal data. */}
        <script defer src="/_vercel/insights/script.js" />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    if (!__HF_DESIGN_INSPECTOR__) {
      return;
    }
    void import("../module/design-inspector/runtime")
      .then(({ installHiggsfieldDesignInspector }) => {
        installHiggsfieldDesignInspector();
      })
      .catch((error) => {
        reportHiggsfieldError(
          error instanceof Error ? error : new Error("Failed to load design inspector"),
          { boundary: "higgsfield_design_inspector_import" },
        );
      });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
