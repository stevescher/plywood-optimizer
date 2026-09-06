import Link from 'next/link';

export function AppFooter() {
  return (
    <footer className="shrink-0 border-t border-border bg-card px-4 py-1.5 flex items-center justify-between text-xs text-muted-foreground">
      <span>© {new Date().getFullYear()} Cut Planner</span>
      <div className="flex items-center gap-4">
        <a
          href="https://buymeacoffee.com/stevescher"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          aria-label="Buy me a coffee (opens in new tab)"
        >
          <CoffeeIcon />
          <span>Buy me a coffee</span>
        </a>
        <Link href="/privacy" className="hover:text-foreground transition-colors">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-foreground transition-colors">
          Terms
        </Link>
      </div>
    </footer>
  );
}

function CoffeeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
      <line x1="6" y1="1" x2="6" y2="4" />
      <line x1="10" y1="1" x2="10" y2="4" />
      <line x1="14" y1="1" x2="14" y2="4" />
    </svg>
  );
}
